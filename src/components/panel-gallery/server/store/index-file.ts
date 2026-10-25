import fs from 'node:fs'
import path from 'node:path'

import { ensureDir, pluginDataDir } from '../../../../shared/host/paths.js'

/** 资产状态。missing 不是阶段，是"文件已消失但索引还留着"的标记。 */
export type AssetStatus = 'present' | 'missing' | 'archived'

/** 一条资产记录。 */
export interface AssetRecord {
  /** sha256 前 12 位（物理判同；逻辑判同另有 duplicateKey）。 */
  digest: string
  path: string
  bytes: number
  mime: string
  width?: number
  height?: number
  workflowId: string
  workflowHash: string
  promptId: string
  createdAt: string
  tags: string[]
  status: AssetStatus
}

/** 检索条件。 */
export interface AssetQuery {
  /** 匹配 路径 / 工作流 id / 标签 / 提示词（提示词由 sidecar 提供，这里只匹配前三个）。 */
  q?: string
  workflow?: string
  tag?: string[]
  kind?: 'image' | 'video' | 'audio' | 'file'
  since?: string
  until?: string
  status?: AssetStatus
  limit?: number
  cursor?: string
}

/** 索引文件路径。 */
export function indexPath(): string {
  return path.join(pluginDataDir(), 'assets.jsonl')
}

/**
 * 资产索引（追加式 JSONL）。
 *
 * 为什么不是 sqlite：v0.1 的规模是几千条，JSONL 全量加载 + 内存过滤完全够用，
 * 而且零依赖、可读、可手工修。代价是每次写都追加一行（同 path 以后写为准），
 * 长期会涨 —— 启动时如果行数超过阈值就压实一次。sqlite/FTS5 推迟到 0.2。
 */
export class AssetIndex {
  private readonly file: string
  private rows = new Map<string, AssetRecord>()
  private loadedAt = 0
  private dirty = false
  /** 自上次压实以来的追加次数。 */
  private appends = 0

  constructor(file = indexPath()) {
    this.file = file
  }

  /** 从磁盘加载（带 2 秒缓存）。 */
  private ensureLoaded(): void {
    const now = Date.now()
    if (now - this.loadedAt < 2000 && !this.dirty) return
    this.rows.clear()
    let text = ''
    try {
      text = fs.readFileSync(this.file, 'utf8')
    } catch {
      this.loadedAt = now
      return
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        const record = JSON.parse(line) as AssetRecord
        if (typeof record.path === 'string') this.rows.set(record.path, record)
      } catch {
        // 坏行直接跳过：索引是派生物，不值得为它整体失败
      }
    }
    this.loadedAt = now
    this.dirty = false
  }

  /** 追加一条（同路径覆盖内存里的旧值，文件里以后再写为准）。 */
  add(record: AssetRecord): void {
    this.ensureLoaded()
    this.rows.set(record.path, record)
    ensureDir(path.dirname(this.file))
    fs.appendFileSync(this.file, `${JSON.stringify(record)}\n`, 'utf8')
    this.dirty = true
    this.loadedAt = Date.now()
  }

  /** 批量登记。 */
  addMany(records: readonly AssetRecord[]): void {
    for (const record of records) this.add(record)
  }

  /** 移除一个路径的索引行。 */
  remove(target: string): void {
    this.ensureLoaded()
    if (!this.rows.has(target)) return
    this.rows.delete(target)
    this.rewrite()
  }

  /** 当前全部记录。 */
  all(): AssetRecord[] {
    this.ensureLoaded()
    return [...this.rows.values()]
  }

  /**
   * 检索。
   *
   * 排序固定 `createdAt` 倒序；游标是上一页最后一条的 createdAt（文件会变，offset 会跳项）。
   */
  search(query: AssetQuery): { items: AssetRecord[]; next: string | undefined } {
    this.ensureLoaded()
    const q = (query.q ?? '').trim().toLowerCase()
    const tags = query.tag ?? []

    let items = [...this.rows.values()].filter(record => {
      if (query.status !== undefined && record.status !== query.status) return false
      if (query.workflow !== undefined && record.workflowId !== query.workflow) return false
      if (query.kind !== undefined) {
        const media = /^(image|video|audio)\//;
        if (query.kind === 'file') {
          if (media.test(record.mime)) return false
        } else if (!record.mime.startsWith(`${query.kind}/`)) {
          return false
        }
      }
      if (tags.length > 0 && !tags.every(tag => record.tags.includes(tag))) return false
      if (query.since !== undefined && record.createdAt < query.since) return false
      if (query.until !== undefined && record.createdAt > query.until) return false
      if (q !== '') {
        const haystack = `${record.path} ${record.workflowId} ${record.tags.join(' ')}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })

    items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    if (query.cursor !== undefined) items = items.filter(record => record.createdAt < query.cursor!)

    const limit = Math.min(200, Math.max(1, query.limit ?? 60))
    const page = items.slice(0, limit)
    const last = page[page.length - 1]
    return { items: page, next: items.length > limit && last !== undefined ? last.createdAt : undefined }
  }

  /** 用给定记录整体重写索引（压实 / 重建都走它）。 */
  rewrite(records?: readonly AssetRecord[]): void {
    const list = records ?? [...this.rows.values()]
    ensureDir(path.dirname(this.file))
    const body = list.map(record => JSON.stringify(record)).join('\n')
    fs.writeFileSync(this.file, body === '' ? '' : `${body}\n`, 'utf8')
    this.rows = new Map(list.map(record => [record.path, record]))
    this.loadedAt = Date.now()
    this.dirty = false
  }

  /** 现有行数（用于是否需要压实的判断）。 */
  get size(): number {
    this.ensureLoaded()
    return this.rows.size
  }
}
