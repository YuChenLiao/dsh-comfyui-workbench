/**
 * 运行注册表：把"提交之后那几分钟"变成可查的状态。
 *
 * 补的是插件原来的空白：出图要 2～6 分钟（实测中位 115 秒、最长 336 秒），
 * 这段时间里用户与模型都不知道任务在跑、排队第几、卡住了还是死了。
 * 完成时才有一条 `followup`。
 *
 * 两条硬约束：
 *
 * ① **进度绝不进对话**。进度是秒级/每 step 的高频数据，对话是回合制 ——
 *    每写一次就要排一轮、唤醒驱动。这里只往内存和盘上写，不碰 session。
 *    一张 30 步的图有 30 条进度、一批 10 张有 300 条；若每条都通知，
 *    比"每张一条"糟一个数量级。
 *
 * ② **状态必须落盘**。通知可能投递失败（会话已关、被压缩替换），用户也可能
 *    想查"上周那批出完了没"。内存里的丢了不影响 ComfyUI 侧，但查不到就白问。
 */

import fs from 'node:fs'
import path from 'node:path'

/** 一条运行的状态。 */
export type RunState = 'queued' | 'running' | 'done' | 'failed' | 'unknown'

/** 进度（P2 接 WebSocket 后会更细；P1 只有排队位）。 */
export interface RunProgress {
  /** 已完成步数。 */
  value: number
  /** 总步数。 */
  max: number
  /** 当前节点 id（P2 才有）。 */
  node?: string
}

/** 产物摘要。 */
export interface RunArtifactRef {
  path: string
  bytes: number
  width?: number
  height?: number
}

/** 一条运行记录。 */
export interface RunRecord {
  promptId: string
  workflowId: string
  /**
   * 单调递增的登记序号。
   *
   * 排序不能只靠 `submittedAt` —— 批量提交的几条会挤在同一毫秒，
   * 时间戳相同时顺序不确定，"最近提交的在最前"就会失效。
   */
  seq: number
  state: RunState
  /** 属于哪一批（批量提交时）。 */
  batchId?: string
  submittedAt: number
  startedAt?: number
  finishedAt?: number
  /** 排队位次；1 表示下一个就轮到它。 */
  queuePosition?: number
  progress?: RunProgress
  artifacts?: RunArtifactRef[]
  error?: { code: string; message: string }
  /** 进程重启后从盘上读回的、当时还在跑的那些 —— 状态已不可知。 */
  stale?: boolean
}

/** 最多保留多少条。更早的丢弃，避免 runs.json 无限增长。 */
const MAX_RECORDS = 200

/** 文件名。 */
const FILE_NAME = 'runs.json'

/**
 * 运行注册表。
 *
 * 单例由 runtime 持有（不是模块级变量）—— 多 entry 各有一份 bundle，
 * 模块级状态会各自分裂（终端面板踩过这个坑）。
 */
export class RunRegistry {
  private readonly records = new Map<string, RunRecord>()
  /** 下一个登记序号；从盘上读回时取最大值 +1，重启后仍单调。 */
  private nextSeq = 1
  /** 落盘路径；为空则只在内存里。 */
  private readonly filePath: string | undefined
  private writeTimer: NodeJS.Timeout | undefined
  private dirty = false

  /**
   * @param outputDir - 会话产物目录（写 `<dir>/runs.json`）。不传则纯内存。
   */
  constructor(outputDir?: string) {
    this.filePath = outputDir === undefined ? undefined : path.join(outputDir, FILE_NAME)
    if (this.filePath !== undefined) this.load()
  }

  /** 从盘上读回历史。进程重启时还在跑的，标成 stale。 */
  private load(): void {
    if (this.filePath === undefined) return
    let parsed: unknown
    try {
      if (!fs.existsSync(this.filePath)) return
      parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'))
    } catch {
      // 文件坏了不该让注册表起不来 —— 当作空表，下次写会覆盖
      return
    }
    if (!Array.isArray(parsed)) return
    for (const raw of parsed) {
      if (raw === null || typeof raw !== 'object') continue
      const record = raw as RunRecord
      if (typeof record.promptId !== 'string' || record.promptId === '') continue
      // 重启后原来在跑/排队的已经无从得知，标 stale 而不是留在 running 让人等
      if (record.state === 'queued' || record.state === 'running') {
        record.state = 'unknown'
        record.stale = true
      }
      this.records.set(record.promptId, record)
      if (typeof record.seq === 'number' && record.seq >= this.nextSeq) this.nextSeq = record.seq + 1
    }
  }

  /**
   * 内存裁剪。
   *
   * **先淘汰终态**（done / failed / unknown），只有全是 active 时才退回按 seq 淘汰 ——
   * 否则 200 条都在跑的时候，新提交一条会把最老的 running 删掉：面板上那条正在跑的
   * 任务凭空消失，之后的 update 也变成静默空操作。
   */
  private trim(): void {
    if (this.records.size < MAX_RECORDS) return
    const all = [...this.records.values()]
    const finished = all.filter(record => record.state !== 'queued' && record.state !== 'running')
      .sort((a, b) => a.seq - b.seq)
    const active = all.filter(record => record.state === 'queued' || record.state === 'running')
      .sort((a, b) => a.seq - b.seq)
    const need = this.records.size - MAX_RECORDS + 1
    // 终态不够就再动 active（极端情况：全都在跑），但那是不得已
    for (const record of [...finished, ...active].slice(0, Math.max(0, need))) {
      this.records.delete(record.promptId)
    }
  }

  /** 攒一下再写：进度更新很频繁，每次落盘会拖慢轮询。 */
  private scheduleFlush(): void {
    if (this.filePath === undefined) return
    this.dirty = true
    if (this.writeTimer !== undefined) return
    this.writeTimer = setTimeout(() => {
      this.writeTimer = undefined
      this.flush()
    }, 1_000)
    this.writeTimer.unref?.()
  }

  /** 立即落盘（插件卸载时用）。 */
  flush(): void {
    if (this.filePath === undefined || !this.dirty) return
    this.dirty = false
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
      const all = [...this.records.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_RECORDS)
      // 先写临时文件再 rename：中途失败不会留半个 JSON
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, `${JSON.stringify(all, null, 1)}\n`, 'utf8')
      fs.renameSync(tmp, this.filePath)
    } catch {
      // 写不了就只留内存态；查询仍可用
    }
  }

  /**
   * 登记一次提交。
   *
   * @param promptId - ComfyUI 给的 id。
   * @param workflowId - 工作流 id。
   * @param batchId - 批量提交时的批次标识。
   */
  submit(promptId: string, workflowId: string, batchId?: string): void {
    this.trim()
    this.records.set(promptId, {
      promptId,
      workflowId,
      seq: this.nextSeq++,
      state: 'queued',
      submittedAt: Date.now(),
      ...(batchId === undefined ? {} : { batchId }),
    })
    this.scheduleFlush()
  }

  /**
   * 更新状态。只合并传入的字段。
   *
   * @param promptId - 运行 id。
   * @param patch - 要改的字段。
   */
  update(promptId: string, patch: object): void {
    const current = this.records.get(promptId)
    if (current === undefined) return
    Object.assign(current, patch)
    this.scheduleFlush()
  }

  /** 查询一条。 */
  get(promptId: string): RunRecord | undefined {
    return this.records.get(promptId)
  }

  /**
   * 列出记录。
   *
   * @param filter - 按状态筛；不传则全部。
   * @param limit - 最多几条，默认 20。
   */
  list(filter?: { state?: string; batchId?: string; limit?: number }): RunRecord[] {
    let all = [...this.records.values()]
    if (filter?.state !== undefined) all = all.filter(record => record.state === filter.state)
    if (filter?.batchId !== undefined) all = all.filter(record => record.batchId === filter.batchId)
    all.sort((a, b) => b.seq - a.seq)
    return all.slice(0, Math.max(1, Math.min(200, filter?.limit ?? 20)))
  }

  /** 还有几条在跑/排队。 */
  activeCount(): number {
    let count = 0
    for (const record of this.records.values()) {
      if (record.state === 'queued' || record.state === 'running') count += 1
    }
    return count
  }

  /** 清空（测试用）。 */
  clear(): void {
    this.records.clear()
  }
}
