import crypto from 'node:crypto'

import type { HostContext, LoggerLike } from './types.js'

/**
 * 插件通知的 source kind。
 *
 * 会话格式 v4 拒绝 `kind: 'plugin'`：`message-sources.ts` 要求每条消息带 producer
 * 自己的 kind，插件消息的统一形状是 `plugin:<包名>`（正是 v3→v4 迁移把
 * `{ kind: 'plugin', plugin: ... }` 改写成的东西）。写成 `kind: 'plugin'` 会让
 * `followup` 在落事件时抛 `SessionFormatError`，通知永远发不出去，而且异常发生在
 * agent 的 inbox 写入路径上，会把发起会话的驱动留在异常态。
 */
export const NOTICE_SOURCE_KIND = 'plugin:dsh-comfyui-workbench'

/**
 * 能给会话塞消息的对象（宿主 Agent 上只用到这一个方法）。
 *
 * 宿主 `Agent.followup(message)` 会排一轮普通回合并唤醒驱动 —— 子代理就是这样
 * 把结果送回父对话的。插件走同一条路，所以出图完成后对话能自己收到结果。
 */
export interface NotifyTarget {
  followup: (message: {
    id: string
    role: 'user'
    content: Array<{ type: 'text'; text: string }>
    source: { kind: string }
  }) => void
}

/** 构造一条插件通知消息。 */
export function noticeMessage(
  text: string,
  id: string = crypto.randomUUID(),
): Parameters<NotifyTarget['followup']>[0] {
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: NOTICE_SOURCE_KIND },
  }
}

/**
 * 投递一条会话通知：失败只记日志。
 *
 * 会话可能已经被关闭、被压缩替换，或宿主拒绝了这次写入；通知是尽力而为的旁路，
 * 不能让它把插件的定时器或宿主的驱动带崩。
 */
export function deliverSessionNotice(
  target: NotifyTarget,
  text: string,
  options?: { id?: string; logger?: LoggerLike | undefined; tag?: string },
): void {
  const tag = options?.tag ?? 'notify'
  try {
    target.followup(noticeMessage(text, options?.id))
  } catch (error) {
    // 日志同样要兜住：这是 catch 分支里的最后一句话，它自己抛错就会逃逸成
    // unhandledRejection（Node 默认因此结束进程），比"没送达"严重得多。
    try {
      options?.logger?.warn?.(`[${tag}] 通知未送达：${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // 连日志都写不了，只能放弃
    }
  }
}

/** 一条交付物引用（与 DSH `deliverables/presented` 的 `files` 项同形）。 */
export interface PresentedFileRef {
  /** 产物绝对路径。 */
  path: string
  /** 给用户看的一句话说明。 */
  description?: string
}

/**
 * 登记交付物的回调：`comfyui_run` 等工具在真的出图成功后调用它。
 *
 * 拿不到 `sessionProjections` 时这条链路整体缺席（返回 `undefined`），
 * 工具侧用可选链调用即可 —— 交付物卡片是增强，不是出图的前提。
 */
export type DeliverablesPresenter = (
  agent: unknown,
  files: readonly PresentedFileRef[],
  callId?: string,
) => void

/** 宿主 `sessionProjections` 服务的最小面。 */
interface SessionProjectionsLike {
  stateOf: (session: unknown, key: string) => unknown
}

/** 会话最小面（只要 append）。 */
interface AppendableSession {
  append: (type: string, payload: unknown) => void
}

/**
 * 造一个"把产物登记成本轮交付物"的写入器。
 *
 * 与内置 `present` 工具写的是**同一个 durable event**（`deliverables/presented`，
 * 形状 `{ turn, callId, files }`），所以对话里会走同一套交付物渲染。
 *
 * 三条硬约束（照抄宿主 `tool-present` 的实现）：
 * 1. 必须 `openTurnStartSeq !== null` —— 回合已关闭时写进去的交付物不会有人渲染；
 * 2. `turn` 用 `turnBoundary.lastTurn`，不是自己数；
 * 3. 全程 try/catch：宿主版本没有这套投影时静默降级，不能让出图失败。
 *
 * @param ctx - 服务端上下文。
 * @returns 写入器；宿主不支持时 `undefined`。
 */
export function createDeliverablesPresenter(ctx: HostContext): DeliverablesPresenter | undefined {
  let projections: SessionProjectionsLike | undefined
  try {
    const candidate = ctx.get?.('sessionProjections') as Partial<SessionProjectionsLike> | undefined
    if (candidate !== undefined && candidate !== null && typeof candidate.stateOf === 'function') {
      projections = candidate as SessionProjectionsLike
    }
  } catch {
    // 服务未挂载：交付物登记整体缺席
  }
  if (projections === undefined) return undefined
  const service = projections

  return (agent, files, callId) => {
    if (files.length === 0) return
    try {
      const session = (agent as { session?: unknown } | undefined)?.session as AppendableSession | undefined
      if (session === undefined || session === null || typeof session.append !== 'function') return

      const boundary = service.stateOf(session, 'turnBoundary') as
        | { lastTurn?: unknown; openTurnStartSeq?: unknown }
        | undefined
      // 回合已关闭：写进去也没人渲染，不如不写（会污染 durable log）
      if (boundary === undefined || boundary.openTurnStartSeq === null || boundary.openTurnStartSeq === undefined) return
      const turn = boundary.lastTurn
      if (typeof turn !== 'number') return

      session.append('deliverables/presented', {
        turn,
        ...(callId === undefined ? {} : { callId }),
        files: files.map(file => ({
          path: file.path,
          ...(file.description === undefined ? {} : { description: file.description }),
        })),
      })
    } catch {
      // 宿主拒绝了这次写入：交付物卡片缺席，但图已经在盘上，不影响任何后续步骤
    }
  }
}
