import crypto from 'node:crypto'

import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'
import { codeOf, finalStateOf, giveUpMessage, isFatalRunError, TRANSIENT_LIMIT } from './policy.js'
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
  /**
   * 运行注册表。给了就把状态写进去，供面板与 comfyui_runs 读。
   *
   * 只声明这里真正用到的两个方法 —— `shared/run` 与 `shared/tools` 互不允许依赖
   * （tests/arch.mjs 两个方向都查），所以不能 import 那边的类型。
   */
  registry?: {
    update: (promptId: string, patch: object) => void
    get: (promptId: string) => { startedAt?: number } | undefined
  } | undefined
}): () => void {
  const { client, target, promptId, outputDir } = options
  // 与 sweepRun 对称：调用方传超小值时不该把 ComfyUI 打爆
  const intervalMs = Math.max(50, options.intervalMs ?? 5_000)
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
  /** 连续的可重试失败次数。只有确定终态（execution_failed / auth_failed）才立即判死。 */
  let transientFailures = 0

  const timer = setInterval(() => {
    void (async () => {
      if (settled || inflight) return
      inflight = true
      try {
        // 先问队列：这一步只写注册表，绝不进对话 —— 进度是秒级高频数据，
        // 对话是回合制，每写一次就要排一轮。验收标准 14～16 钉的就是这条。
        //
        // **单独 try**：查队列是纯观测动作，它失败不该把这一 tick 的完成判定
        // 一起拖进失败路径（那会误发失败通知，而任务可能已经出图了）。
        if (options.registry !== undefined) {
          try {
            const queue = await client.queue()
            const runningAt = queue.running.indexOf(promptId)
            const pendingAt = queue.pending.indexOf(promptId)
            if (runningAt >= 0) {
              // queuePosition 0 表示"正在跑"；1 表示"下一个就轮到"。
              options.registry.update(promptId, {
                state: 'running',
                startedAt: options.registry.get(promptId)?.startedAt ?? Date.now(),
                queuePosition: 0,
              })
            } else if (pendingAt >= 0) {
              options.registry.update(promptId, { state: 'queued', queuePosition: pendingAt + 1 })
            }
          } catch {
            // 查不到就保持上一次的状态，不影响下面判完成
          }
        }

        const state = await checkRun(client, promptId)
        if (!state.done || state.entry === undefined) {
          // 查到了（只是还没跑完）说明链路是通的 → 把"连续失败"计数清零。
          // 不复位的话，500 与"成功未完成"交替会被记成 6 次连续失败，
          // 而文案写着"连续 6 次"—— 代码与文案对不上。
          transientFailures = 0
          if (Date.now() - startedAt > maxWaitMs) {
            stop()
            settled = true
            // 不标 failed：任务可能还在 ComfyUI 那边跑，只是我们不盯了。
            // 但 error / finishedAt / queuePosition 都要写 —— 否则面板上是一条
            // "队列第 0 位 + unknown"、且没有任何线索可排查的记录。
            options.registry?.update(promptId, {
              state: 'unknown',
              finishedAt: Date.now(),
              queuePosition: undefined,
              error: {
                code: 'wait_timeout',
                message: maxWaitMs >= 60_000 ? `等了 ${Math.round(maxWaitMs / 60_000)} 分钟仍未出图。` : `等了 ${Math.round(maxWaitMs / 1000)} 秒仍未出图。`,
              },
            })
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
        options.registry?.update(promptId, {
          state: 'done',
          finishedAt: Date.now(),
          queuePosition: undefined,
          artifacts: outcome.artifacts.map(artifact => ({
            path: artifact.path,
            bytes: artifact.bytes,
            ...(artifact.width === undefined ? {} : { width: artifact.width }),
            ...(artifact.height === undefined ? {} : { height: artifact.height }),
          })),
        })
        deliver(target, lines.join('\n'), options.logger)
      } catch (error) {
        if (settled) return
        const message = error instanceof Error ? error.message : String(error)
        // 兜底不能是 execution_failed —— 无 code 的错误会记成"执行失败"而 state=unknown，
        // 按 code 分支的消费方会误判。用中性的 wait_failed。
        const code = codeOf(error) === '' ? 'wait_failed' : codeOf(error)

        // 可重试的错误别一次判死：ComfyUI 重启窗口里 /history 报 5xx 是常态，
        // 一次就判死会让用户拿到假失败结论，而且 collectArtifacts 从此不执行 ——
        // 图其实出了也不落盘，产物直接丢。
        if (!isFatalRunError(error)) {
          transientFailures += 1
          if (transientFailures < TRANSIENT_LIMIT) {
            try {
              options.logger?.warn?.(`[notify] ${promptId} 第 ${transientFailures} 次查询失败，继续等：${message}`)
            } catch {
              // 日志自己抛错不该打断轮询
            }
            return
          }
          // 到上限。状态与文案都按**错误类型**决定，不能一律说"查不到 /history" ——
          // `no_output` 明明是"查到了、也完成了、就是没有产物"，说成查不到是撒谎。
          stop()
          settled = true
          options.registry?.update(promptId, {
            state: finalStateOf(error),
            // finishedAt 必须写：runs.ts 的 elapsedMs 用 (finishedAt ?? now)，
            // 缺了它一条 failed 记录的"耗时"会一直涨。
            finishedAt: Date.now(),
            queuePosition: undefined,
            // error 也要落：面板与 comfyui_runs 读的是记录，不是会话通知。
            // 只发通知不写记录 = 留一条无法排查的 unknown。
            error: {
              code: codeOf(error) === '' ? 'wait_failed' : codeOf(error),
              message,
              ...(typeof (error as { kind?: unknown }).kind === 'string' ? { kind: (error as { kind: string }).kind } : {}),
            },
          })
          deliver(target, giveUpMessage(error, promptId, TRANSIENT_LIMIT), options.logger)
          return
        }

        // 确定终态：真的执行失败或认证失败
        transientFailures = 0
        stop()
        // kind 带上：面板与 comfyui_runs 据此能说"该降分辨率"还是"该去装模型"
        const kind = typeof (error as { kind?: unknown }).kind === 'string' ? (error as { kind: string }).kind : undefined
        options.registry?.update(promptId, {
          state: 'failed',
          finishedAt: Date.now(),
          queuePosition: undefined,
          error: { code, message, ...(kind === undefined ? {} : { kind }) },
        })
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


/**
 * 只更新注册表、不投递消息的收尾。
 *
 * 用于没有会话通道的提交路径（`wait: true`、或无 agent 的异步）—— 那些路径
 * 不挂 watchRun，而 watcher 本来是唯一的终态来源。不补这一步，记录会永远停在
 * queued：`comfyui_runs` 对早就出完的图永久答"还在跑"，activeCount 虚高，
 * 僵尸记录还会挤占上限、把真正在跑的那条挤掉。
 *
 * **三条守卫**（与 watchRun 同源，缺了就会误标）：
 * - `inflight`：history 比轮询间隔慢时，同一 promptId 会被并发 tick 处理两次，
 *   序列可能变成 done → failed（图已落盘却记成失败）
 * - `settled`：一旦收敛成终态就不再动
 * - **瞬时错误不即判失败**：ComfyUI 重启/瞬断时首个 tick 抛 ECONNREFUSED 很常见，
 *   立刻记 failed 会把还在跑的任务判死。网络类错误要连续若干次才判；真正来自
 *   history 的 execution_failed 才是确定终态。
 *
 * timer 登记进 watchers，所以 stopAllWatchers()（插件卸载）能一起清掉 ——
 * 否则热重载后会残留最多 maxWaitMs 的轮询。
 *
 * @param options - 客户端、运行 id、产物目录与节奏。
 * @returns 停止函数。
 */
export function sweepRun(options: {
  client: ComfyClient
  promptId: string
  outputDir: string
  workflowId: string
  intervalMs?: number
  maxWaitMs?: number
  logger?: LoggerLike | undefined
  registry?: {
    update: (promptId: string, patch: object) => void
    get: (promptId: string) => { state?: string } | undefined
  } | undefined
}): () => void {
  const { client, promptId, outputDir, workflowId } = options
  const intervalMs = Math.max(50, options.intervalMs ?? 1_000)
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1000
  const startedAt = Date.now()
  /** 连续的网络类失败次数；达到阈值才判 failed。 */
  let transientFailures = 0

  const stop = (): void => {
    const current = watchers.get(promptId)
    if (current !== undefined) {
      clearInterval(current.timer)
      watchers.delete(promptId)
    }
  }
  stop()

  let inflight = false
  let settled = false

  const finish = (patch: object): void => {
    settled = true
    stop()
    options.registry?.update(promptId, patch)
  }

  const timer = setInterval(() => {
    void (async () => {
      if (settled || inflight) return
      // 记录已经被裁掉（trim）就别再白轮询
      if (options.registry !== undefined && options.registry.get(promptId) === undefined) {
        settled = true
        stop()
        return
      }
      inflight = true
      try {
        const state = await checkRun(client, promptId)
        if (state.done && state.entry !== undefined) {
          const context = recallRun(promptId) ?? {
            workflowId,
            workflowHash: '',
            outputDir,
            effective: {},
            writeMetadata: true,
            submittedAt: startedAt,
          }
          const outcome = await collectArtifacts(client, promptId, state.entry, context)
          // 收敛前再确认一次：并发 tick 可能已经写过终态了
          if (settled) return
          finish({
            state: 'done',
            finishedAt: Date.now(),
            queuePosition: undefined,
            artifacts: outcome.artifacts.map(artifact => ({
              path: artifact.path,
              bytes: artifact.bytes,
              ...(artifact.width === undefined ? {} : { width: artifact.width }),
              ...(artifact.height === undefined ? {} : { height: artifact.height }),
            })),
          })
          return
        }
        transientFailures = 0
        if (Date.now() - startedAt > maxWaitMs) {
          // 与 watch 的 maxWaitMs 分支对称：error / finishedAt 都要落，
          // 否则面板上是一条"unknown + 队列第 0 位"、没有任何线索的记录。
          finish({
            state: 'unknown',
            finishedAt: Date.now(),
            queuePosition: undefined,
            error: {
              code: 'wait_timeout',
              message: maxWaitMs >= 60_000 ? `等了 ${Math.round(maxWaitMs / 60_000)} 分钟仍未出图。` : `等了 ${Math.round(maxWaitMs / 1000)} 秒仍未出图。`,
            },
          })
        }
      } catch (error) {
        // 兜底不能是 execution_failed —— 无 code 的错误会记成"执行失败"而 state=unknown
        const code = codeOf(error) === '' ? 'wait_failed' : codeOf(error)
        // 确定终态（ComfyUI 明确告知失败，或认证失败）立即记
        if (isFatalRunError(error)) {
          finish({
            state: 'failed',
            finishedAt: Date.now(),
            queuePosition: undefined,
            error: {
              code,
              message: error instanceof Error ? error.message : String(error),
              ...(typeof (error as { kind?: unknown }).kind === 'string' ? { kind: (error as { kind: string }).kind } : {}),
            },
          })
          return
        }
        // 网络类错误：ComfyUI 重启/瞬断时很常见，连续若干次才放弃
        transientFailures += 1
        if (transientFailures >= TRANSIENT_LIMIT) {
          // 写 unknown 而不是 failed：我们只是查不到，没有证据说任务失败了。
          // sweep 没有会话通道，这条记录就是模型唯一能看到的东西 ——
          // 写成 failed 会让它重跑白等，而图可能已经在盘上了。
          finish({
            state: finalStateOf(error),
            finishedAt: Date.now(),
            queuePosition: undefined,
            error: {
              code,
              message: error instanceof Error ? error.message : String(error),
              ...(typeof (error as { kind?: unknown }).kind === 'string' ? { kind: (error as { kind: string }).kind } : {}),
            },
          })
        } else {
          // 日志自己抛错不能把轮询带崩：这里是 catch 分支里最后一句话，
          // 它一旦逃逸就是 unhandledRejection（Node 默认结束进程）。
          try {
            const detail = error instanceof Error ? error.message : String(error)
            options.logger?.warn?.(`[sweep] ${promptId} 第 ${transientFailures} 次查询失败，继续等：${detail}`)
          } catch {
            // 记不下就算了，下一 tick 继续
          }
        }
      } finally {
        inflight = false
      }
    })()
  }, intervalMs)

  timer.unref?.()
  // 与 watchRun 共用同一张表：stopAllWatchers() 才能一起清掉
  watchers.set(promptId, { timer, startedAt })
  return stop
}

/** 停掉全部等待者（插件卸载时调用）。 */
export function stopAllWatchers(): void {
  for (const [, watcher] of watchers) clearInterval(watcher.timer)
  watchers.clear()
}
