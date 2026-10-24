import crypto from 'node:crypto'

import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'
import { checkRun, collectArtifacts, recallRun } from './runner.js'

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
    source: { kind: 'plugin'; plugin: string; form: 'notice'; summary: string }
  }) => void
}

/** 正在等待的运行。 */
interface Watcher {
  timer: NodeJS.Timeout
  startedAt: number
}

/** 活跃的等待者：promptId → watcher。插件卸载时统一清掉。 */
const watchers = new Map<string, Watcher>()

/** 宿主对 notice 摘要的长度上限。 */
const SUMMARY_MAX = 120

/** 构造一条插件通知消息。 */
function noticeMessage(text: string, summary: string): Parameters<NotifyTarget['followup']>[0] {
  return {
    id: crypto.randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: {
      kind: 'plugin',
      plugin: 'dsh-comfyui-workbench',
      form: 'notice',
      summary: summary.length > SUMMARY_MAX ? `${summary.slice(0, SUMMARY_MAX - 1)}…` : summary,
    },
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

  const timer = setInterval(() => {
    void (async () => {
      try {
        const state = await checkRun(client, promptId)
        if (!state.done || state.entry === undefined) {
          if (Date.now() - startedAt > maxWaitMs) {
            stop()
            target.followup(noticeMessage(
              `工作流仍在跑（promptId ${promptId}），已经等了 ${Math.round((Date.now() - startedAt) / 60000)} 分钟，先不盯了。\n需要结果时让模型用 comfyui_run 传这个 promptId。`,
              '工作流超时未完成，已停止等待',
            ))
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

        const lines = [`工作流 ${context.workflowId} 出图完成，用时 ${Math.round(outcome.durationMs / 1000)} 秒。`, '']
        for (const artifact of outcome.artifacts) {
          const size = artifact.width !== undefined && artifact.height !== undefined
            ? ` · ${artifact.width}×${artifact.height}`
            : ''
          lines.push(`- ${artifact.path}${size} · ${Math.round(artifact.bytes / 1024)} KB`)
        }
        target.followup(noticeMessage(lines.join('\n'), `工作流 ${context.workflowId} 出图完成（${outcome.artifacts.length} 个产物）`))
      } catch (error) {
        stop()
        const message = error instanceof Error ? error.message : String(error)
        options.logger?.warn?.(`[notify] ${promptId} 等待失败：${message}`)
        try {
          target.followup(noticeMessage(
            `工作流执行失败（promptId ${promptId}）：${message}`,
            '工作流执行失败',
          ))
        } catch {
          // 会话可能已经关了，静默即可
        }
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
