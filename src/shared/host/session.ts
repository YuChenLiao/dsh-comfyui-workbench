import crypto from 'node:crypto'

import type { LoggerLike } from './types.js'

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
