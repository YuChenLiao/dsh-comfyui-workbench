/**
 * 「建提示词池」的后台任务。
 *
 * 与 `sync-job.ts` 同构：2 万条要 200 次请求（约一分钟），不能同步等在一个 HTTP
 * 请求里。同样单例，同样模块级保存（热重载后新 job 的 `current` 是 idle，守卫会失效）。
 */
import { DEFAULT_POOL, syncPromptPool } from './prompts.js'

/** 池子任务状态。 */
export interface PoolJobState {
  state: 'idle' | 'running' | 'done' | 'failed'
  stage: string
  message: string
  /** 已收集多少条。 */
  size: number
  /** 目标条数。 */
  target: number
  lastSuccessAt: number
}

/** 空状态。 */
function idle(): PoolJobState {
  return { state: 'idle', stage: '', message: '', size: 0, target: DEFAULT_POOL, lastSuccessAt: 0 }
}

/** 池子任务控制器。 */
export interface PoolJob {
  start: () => PoolJobState
  status: () => PoolJobState
}

/**
 * 建一个池子任务控制器。
 *
 * @param options.dataDir - 数据目录。
 * @param options.count - 目标条数。
 * @param options.onSettled - 结束回调。
 */
export function createPoolJob(options: {
  dataDir: string
  count?: number
  onSettled?: () => void
  /** 注入给测试。 */
  runPool?: (log: (message: string) => void) => Promise<{ size: number; seconds: number }>
}): PoolJob {
  let current = idle()
  const target = options.count ?? DEFAULT_POOL

  const run = options.runPool ?? (log => syncPromptPool({ dataDir: options.dataDir, count: target, log }))

  const start = (): PoolJobState => {
    if (current.state === 'running') return current
    current = { ...idle(), state: 'running', stage: '准备中…', target }

    void (async () => {
      try {
        const result = await run(message => {
          current = { ...current, stage: message }
        })
        current = {
          ...current,
          state: 'done',
          stage: '完成',
          message: '',
          size: result.size,
          lastSuccessAt: Date.now(),
        }
      } catch (error) {
        // 已经写进临时文件的部分不会落盘（rename 只在成功时发生），所以失败=池子没变
        current = {
          ...current,
          state: 'failed',
          stage: '失败',
          message: `${error instanceof Error ? error.message : String(error)}（池子没有变化）`,
        }
      } finally {
        options.onSettled?.()
      }
    })()

    return current
  }

  return { start, status: () => current }
}
