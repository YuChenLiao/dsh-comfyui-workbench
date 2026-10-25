import crypto from 'node:crypto'

import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'
import { checkRun, collectArtifacts, recallRun } from './runner.js'

/**
 * 插件通知的 source kind。
 *
 * 会话格式 v4 拒绝 `kind: 'plugin'`：`message-sources.ts` 要求每条消息带 producer
 * 自己的 kind，插件消息的统一形状是 `plugin:<包名>`（正是 v3→v4 迁移把
 * `{ kind: 'plugin', plugin: ... }` 改写成的东西）。写成 `kind: 'plugin'` 会让
 * `followup` 在落事件时抛 `SessionFormatError`，通知永远发不出去，而且异常发生在
 * agent 的 inbox 写入路径上，会把发起会话的驱动留在异常态。
 */
const NOTICE_SOURCE_KIND = 'plugin:dsh-comfyui-workbench'

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

/** 正在等待的运行。 */
interface Watcher {
  timer: NodeJS.Timeout
  startedAt: number
}

/** 活跃的等待者：promptId → watcher。插件卸载时统一清掉。 */
const watchers = new Map<string, Watcher>()

/** 构造一条插件通知消息。 */
function noticeMessage(text: string): Parameters<NotifyTarget['followup']>[0] {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: NOTICE_SOURCE_KIND },
  }
}

/**
 * 投递一条通知：失败只记日志。
 *
 * 会话可能已经被关闭、被压缩替换，或宿主拒绝了这次写入；通知是尽力而为的旁路，
 * 不能让它把插件的定时器或宿主的驱动带崩。
 * @param target - 会话 Agent。
 * @param text - 通知正文。
 * @param logger - 可选日志。
 */
function deliver(target: NotifyTarget, text: string, logger?: LoggerLike | undefined): void {
  try {
    target.followup(noticeMessage(text))
  } catch (error) {
    // 日志同样要兜住：这是 catch 分支里的最后一句话，它自己抛错就会逃逸成
    // unhandledRejection（Node 默认因此结束进程），比"没送达"严重得多。
    try {
      logger?.warn?.(`[notify] 通知未送达：${error instanceof Error ? error.message : String(error)}`)
    } catch {
      // 连日志都写不了，只能放弃
    }
  }
}

/**
 * 后台盯着一次运行，完成时把结果作为插件通知塞回发起它的会话。
 *
 * 这是"对话能不能自己收到结果"的答案：不等用户再问，也不消耗子代理额度 ——
 * 用的是宿主给 Agent 的 `followup`，与子代理回传同一条通道。
 *
 * @param options - 客户端、目标会话、运行 id、产物目录与节奏。
 * @returns 停止函数（插件卸载或调用方取消时用）。
 */
export function watchRun(options: {
  client: ComfyClient
  target: NotifyTarget
  promptId: string
  outputDir: string
  /** 轮询间隔。 */
  intervalMs?: number
  /** 最长盯多久，超过就放弃（默认 30 分钟）。 */
  maxWaitMs?: number
  logger?: LoggerLike | undefined
}): () => void {
  const { client, target, promptId, outputDir } = options
  const intervalMs = options.intervalMs ?? 5_000
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1000
  const startedAt = Date.now()

  const stop = (): void => {
    const current = watchers.get(promptId)
    if (current !== undefined) {
      clearInterval(current.timer)
      watchers.delete(promptId)
    }
  }

  // 同一个运行只盯一次。
  stop()

  /**
   * 并发守卫。
   *
   * `setInterval` 不等上一轮 async 结束：慢一点的情况下两个 tick 会同时读到 done，
   * 各投递一条通知（实测全量跑测试时约 1/3 概率出现"收到 2 条"）。
   * `settled` 保证只交付一次，`inflight` 防重入；后者必须在 finally 里复位，
   * 否则超时那条收尾通知会被自己挡掉。
   */
  let inflight = false
  let settled = false

  const timer = setInterval(() => {
    void (async () => {
      if (settled || inflight) return
      inflight = true
      try {
        const state = await checkRun(client, promptId)
        if (!state.done || state.entry === undefined) {
          if (Date.now() - startedAt > maxWaitMs) {
            stop()
            settled = true
            deliver(
              target,
              `工作流仍在跑（promptId ${promptId}），已经等了 ${Math.round((Date.now() - startedAt) / 60000)} 分钟，先不盯了。\n需要结果时让模型用 comfyui_run 传这个 promptId。`,
              options.logger,
            )
          }
          return
        }

        const context = recallRun(promptId) ?? {
          workflowId: 'unknown',
          workflowHash: '',
          outputDir,
          effective: {},
          writeMetadata: true,
          submittedAt: startedAt,
        }
        const outcome = await collectArtifacts(client, promptId, state.entry, context)
        stop()

        // settled 只在真正投递之前置位：拼装若抛错，catch 还能走失败通知而不是静默。
        const lines = [`工作流 ${context.workflowId} 出图完成，用时 ${Math.round(outcome.durationMs / 1000)} 秒。`, '']
        for (const artifact of outcome.artifacts) {
          const size = artifact.width !== undefined && artifact.height !== undefined
            ? ` · ${artifact.width}×${artifact.height}`
            : ''
          lines.push(`- ${artifact.path}${size} · ${Math.round(artifact.bytes / 1024)} KB`)
        }
        settled = true
        deliver(target, lines.join('\n'), options.logger)
      } catch (error) {
        stop()
        if (settled) return
        const message = error instanceof Error ? error.message : String(error)
        // 日志本身抛错不能挡住通知：logger 是外部注入的，它失败不该让用户收不到消息。
        try {
          options.logger?.warn?.(`[notify] ${promptId} 等待失败：${message}`)
        } catch {
          // 记不下就算了，下面照常投递
        }
        settled = true
        deliver(target, `工作流执行失败（promptId ${promptId}）：${message}`, options.logger)
      } finally {
        // 必须复位：否则下一 tick 会被 inflight 挡住，超时收尾那条就发不出去。
        inflight = false
      }
    })()
  }, intervalMs)

  timer.unref?.()
  watchers.set(promptId, { timer, startedAt })
  return stop
}

/** 停掉全部等待者（插件卸载时调用）。 */
export function stopAllWatchers(): void {
  for (const [, watcher] of watchers) clearInterval(watcher.timer)
  watchers.clear()
}
