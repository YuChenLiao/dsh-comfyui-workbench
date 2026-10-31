/**
 * 批量提交的通知聚合。
 *
 * 问题：`run_batch` 逐条挂 `watchRun`，于是 10 张图 = 10 次 `followup` =
 * **10 轮对话打断**。一件本来可以一次说完的事被拆成十次汇报，观感跟子代理
 * 逐条回报一样碎。
 *
 * 但**不能改用 `inject`（不唤醒）** —— 模型不知道出图效果就没法继续迭代，
 * 「这张脸崩了换 seed 再来」这类对话根本进行不下去。所以保留唤醒，改**频次**：
 * 一批结束投递一条汇总。
 *
 * 单条 `comfyui_run` 不走这里 —— 那本来只有一次，汇总没有意义。
 */

/** 一条运行结束时的结果。 */
export interface SettledRun {
  /** ComfyUI 的 promptId。 */
  promptId: string
  /** 调用方给的下标（对账用）。 */
  index?: number
  /** 成功还是失败。 */
  ok: boolean
  /** 原本要投递给会话的那段文本（失败时就是错误说明）。 */
  text: string
  /** 产物路径（成功时）。只给路径时汇总里就只有路径。 */
  artifacts?: string[]
  /** 产物的结构化信息（有就带上宽高与体积，汇总更像单条通知）。 */
  artifactDetails?: ArtifactLine[]
}

/** 汇总里一条产物的展示形状。 */
export interface ArtifactLine {
  path: string
  width?: number
  height?: number
  bytes?: number
}

/**
 * 收集一批运行的结果，凑齐后投递一条汇总。
 *
 * 三条约束：
 * - **只投递一次**：`delivered` 标记防重入（同一个 tick 可能并发回报）
 * - **超时不无限等**：到 `maxWaitMs` 就发一条"还有 N 条在跑"的收尾通知
 * - **失败也汇总**：不能因为有一条失败就把整批的通知吞掉
 */
export class BatchCollector {
  private readonly total: number
  private readonly deliver: (text: string) => void
  private readonly startedAt: number
  private readonly maxWaitMs: number
  private readonly logger: { warn?: (message: string) => void } | undefined
  private readonly settled = new Map<string, SettledRun>()
  private delivered = false
  private timer: NodeJS.Timeout | undefined

  /**
   * @param options - 批大小、投递函数与超时。
   */
  constructor(options: {
    total: number
    deliver: (text: string) => void
    maxWaitMs?: number
    startedAt?: number
    logger?: { warn?: (message: string) => void } | undefined
  }) {
    this.total = Math.max(1, options.total)
    this.deliver = options.deliver
    this.startedAt = options.startedAt ?? Date.now()
    this.maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1000
    this.logger = options.logger
    // 到点还没凑齐也要说一声，别让用户一直等
    this.timer = setTimeout(() => {
      this.flush('timeout')
    }, this.maxWaitMs)
    this.timer.unref?.()
  }

  /** 还差几条。 */
  get pending(): number {
    return this.total - this.settled.size
  }

  /** 已经收到几条。 */
  get received(): number {
    return this.settled.size
  }

  /**
   * 回报一条运行的结果。
   *
   * @param run - 结果。
   */
  settle(run: SettledRun): void {
    if (this.delivered) return
    // 同一个 promptId 只记一次（watcher 与 sweep 可能都回报）
    if (this.settled.has(run.promptId)) return
    this.settled.set(run.promptId, run)
    if (this.settled.size >= this.total) this.flush('complete')
  }

  /** 立即汇总（测试与超时用）。 */
  flush(reason: 'complete' | 'timeout'): void {
    if (this.delivered) return
    this.delivered = true
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }

    const all = [...this.settled.values()]
    const ok = all.filter(item => item.ok)
    const failed = all.filter(item => !item.ok)
    const seconds = Math.round((Date.now() - this.startedAt) / 1000)
    const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`

    const lines: string[] = []
    // 措辞按**实际收到的条数**算，不信调用方传的 reason ——
    // 传 'complete' 但只收到 2/3 条时，"全部结束"就是撒谎。
    if (this.pending > 0) {
      lines.push(`本批 ${this.total} 条里已结束 ${all.length} 条（${ok.length} 成功，${failed.length} 失败），还有 ${this.pending} 条在跑。稍后用 comfyui_runs 查。`)
    } else {
      lines.push(`本批 ${this.total} 条全部结束（${ok.length} 成功，${failed.length} 失败），用时 ${duration}。`)
    }

    // 产物逐行列出：模型要拿路径去读图，不能只给"完成了几张"
    const artifacts: ArtifactLine[] = []
    for (const item of ok) {
      for (const line of this.artifactsOf(item)) artifacts.push(line)
    }
    if (artifacts.length > 0) {
      lines.push('')
      for (const artifact of artifacts) {
        const size = artifact.width !== undefined && artifact.height !== undefined
          ? ` · ${artifact.width}×${artifact.height}`
          : ''
        const bytes = artifact.bytes === undefined ? '' : ` · ${Math.round(artifact.bytes / 1024)} KB`
        lines.push(`- ${artifact.path}${size}${bytes}`)
      }
    }

    if (failed.length > 0) {
      lines.push('')
      for (const item of failed) {
        const label = item.index === undefined ? item.promptId : `第 ${item.index + 1} 条`
        lines.push(`失败：${label}（${item.text}）`)
      }
    }

    try {
      this.deliver(lines.join('\n'))
    } catch (error) {
      // 投递失败不该让聚合器抛到调用方（它在 watcher 的 tick 里跑）
      try {
        this.logger?.warn?.(`[batch] 汇总通知未送达：${error instanceof Error ? error.message : String(error)}`)
      } catch {
        // 连日志都写不了就算了
      }
    }
  }

  /** 从一条结果里取出产物行。`text` 里没有结构化信息时退回空数组。 */
  private artifactsOf(run: SettledRun): ArtifactLine[] {
    if (run.artifactDetails !== undefined && run.artifactDetails.length > 0) return run.artifactDetails
    if (run.artifacts === undefined) return []
    return run.artifacts.map(path => ({ path }))
  }

  /** 停掉超时定时器（插件卸载或调用方取消）。 */
  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
  }
}
