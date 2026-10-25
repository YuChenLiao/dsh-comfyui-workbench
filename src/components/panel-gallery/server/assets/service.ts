import fs from 'node:fs'
import path from 'node:path'

import { IMAGE_EXTS, toListItem } from '../scan/index.js'
import type { ImageRecord, ListItem } from '../scan/index.js'
import { isAuthorized } from './authorize.js'
import { dedupeItems } from './dedupe.js'
import type { DedupedItem } from './dedupe.js'
import { thumbPathFor } from './thumbs.js'
import type { RootEntry } from './roots.js'
import { scanRoot } from './scan-cache.js'

/** 列表查询参数（由 HTTP 层解析后传入，service 不认 URL）。 */
export interface ItemQuery {
  /** 根目录过滤：'all' 表示全部。 */
  root: string
  /** 关键词（已小写）。 */
  q: string
  /** 是否包含非生成图。 */
  all: boolean
  /** 是否跳过扫描缓存。 */
  refresh: boolean
  /** 是否合并同图副本。 */
  dedupe: boolean
  offset: number
  limit: number
}

/** 一页列表结果。 */
export interface ItemPage {
  total: number
  merged: boolean
  offset: number
  limit: number
  truncated: boolean
  items: Array<ListItem | DedupedItem>
}

/** 查询失败：根目录不在白名单内。 */
export class UnknownRootError extends Error {
  constructor() {
    super('这个根目录不在资产库的白名单里。')
    this.name = 'UnknownRootError'
  }
}

/**
 * 查一页资产。
 *
 * 过滤顺序刻意如此：先按扫描阶段的分类型过滤掉普通图片，再读元数据 ——
 * 默认（只看生成图）就不该为整目录的截图付元数据解析成本。
 *
 * @param roots - 授权根目录。
 * @param query - 查询参数。
 */
export function queryItems(
  roots: readonly RootEntry[],
  settings: { maxDepth: number; maxItems: number; includeHidden: boolean; cacheMs: number },
  query: ItemQuery,
): ItemPage {
  if (roots.length === 0) {
    return { total: 0, merged: false, offset: query.offset, limit: query.limit, truncated: false, items: [] }
  }

  const targets = query.root === 'all' ? roots : roots.filter(root => root.path === query.root)
  if (targets.length === 0) throw new UnknownRootError()

  let truncated = false
  const merged: Array<{ file: ImageRecord; label: string }> = []
  // 同一个文件只能出现一次：根目录之间可能是父子关系（工作区与其下的 comfyui-output），
  // 各扫一遍就会把同一张图收两遍，再经同图合并变成莫名其妙的"副本 2"。
  const seenPaths = new Set<string>()
  for (const root of targets) {
    const scanned = scanRoot(root.path, settings, query.refresh)
    // 只有「影响本次结果」的截断才算数：默认只看生成图，普通图片被截断不该报提示。
    truncated = truncated || scanned.truncated
    for (const file of scanned.files) {
      // 大小写折叠只在 Windows 上做：POSIX 下 `IMG.png` 与 `img.png` 是两个文件，
      // 一律小写会把后者静默丢掉。父子根场景本来也用不着折叠 —— 根已 realpath，
      // 同一文件经由不同根扫到的路径字符串逐字相同。
      const key = process.platform === 'win32' ? file.path.toLowerCase() : file.path
      if (seenPaths.has(key)) continue
      seenPaths.add(key)
      merged.push({ file, label: root.label })
    }
  }
  merged.sort((a, b) => b.file.mtime - a.file.mtime)

  const items: ListItem[] = []
  for (const { file, label } of merged) {
    if (!query.all && file.generated !== true) continue
    const item = toListItem(file, label)
    // 兜底：探测到内嵌块但完整解析失败时，这里仍会把它挡在「仅生成图」之外。
    if (!query.all && item.hasMeta !== true) continue
    if (query.q !== '') {
      const haystack = `${item.name} ${item.prompt ?? ''} ${item.negativePrompt ?? ''}`.toLowerCase()
      if (!haystack.includes(query.q)) continue
    }
    items.push(item)
  }

  const visible = query.dedupe ? dedupeItems(items) : items
  return {
    total: visible.length,
    merged: query.dedupe,
    offset: query.offset,
    limit: query.limit,
    truncated,
    items: visible.slice(query.offset, query.offset + query.limit),
  }
}

/** 单次删除的结果。 */
export interface DeleteResult {
  target: string
  removed: string[]
  error?: string
  code?: string
}

/**
 * 物理删除一张图片及其附属文件（sidecar + 缩略图）。
 *
 * 图片本身删失败就立即返回错误；sidecar 与缩略图是附属品，删不掉也不该掩盖
 * "图片已删"的事实 —— 所以它们各自独立 try。
 *
 * @param target - 图片绝对路径。
 * @param roots - 授权根目录。
 */
export function deleteOne(target: string, roots: readonly RootEntry[]): DeleteResult {
  if (!isAuthorized(target, roots)) {
    return { target, removed: [], error: '这个路径不在资产库的白名单里。', code: 'forbidden' }
  }
  if (!IMAGE_EXTS.has(path.extname(target).toLowerCase())) {
    return { target, removed: [], error: '只能删除图片，路径看起来不是图片。', code: 'not-an-image' }
  }

  let stat: fs.Stats
  try {
    stat = fs.statSync(target)
  } catch {
    return { target, removed: [], error: '文件已经不在了。', code: 'missing' }
  }
  if (!stat.isFile()) {
    return { target, removed: [], error: '路径不是文件。', code: 'not-a-file' }
  }

  const sidecar = `${target}.json`
  const thumb = thumbPathFor(target, stat)
  const removed: string[] = []

  try {
    fs.unlinkSync(target)
    removed.push(target)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { target, removed, error: `删除失败：${message}`, code: 'delete-failed' }
  }

  try {
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar)
      removed.push(sidecar)
    }
  } catch {
    // 保留孤儿 sidecar：下次扫描不会再把它当成图片列出
  }

  try {
    fs.unlinkSync(thumb)
  } catch {
    // 没生成过（或已被清理）就不用管
  }

  return { target, removed }
}

/** 批量删除结果。 */
export interface BatchDeleteResult {
  removed: string[]
  failed: Array<{ path: string; error: string; message: string }>
}

/**
 * 批量删除：逐个物理删除，部分失败照实汇报，不整体回滚。
 *
 * @param paths - 待删路径。
 * @param roots - 授权根目录。
 */
export function deleteMany(paths: readonly string[], roots: readonly RootEntry[]): BatchDeleteResult {
  const removed: string[] = []
  const failed: BatchDeleteResult['failed'] = []
  for (const one of paths) {
    const result = deleteOne(one, roots)
    if (result.error !== undefined) {
      failed.push({ path: one, error: result.code ?? 'unknown', message: result.error })
    } else {
      removed.push(...result.removed)
    }
  }
  return { removed, failed }
}

/** 批量导出工作流的中间产物。 */
export interface WorkflowExport {
  entries: Array<{ name: string; data: Buffer }>
  skipped: number
}

/**
 * 收集选中图片的工作流，准备打包。
 *
 * 名字冲突时加序号后缀而不是覆盖：用户选的两张图可能同名不同目录。
 *
 * @param paths - 选中路径。
 * @param roots - 授权根目录。
 * @param readFullSidecar - 读完整元数据的函数（注入，避免 service 直接依赖 scan 的缓存实现）。
 */
export function collectWorkflows(
  paths: readonly string[],
  roots: readonly RootEntry[],
  readFullSidecar: (imagePath: string) => Record<string, unknown> | undefined,
): WorkflowExport {
  const entries: Array<{ name: string; data: Buffer }> = []
  const used = new Set<string>()
  let skipped = 0

  for (const one of paths) {
    if (!isAuthorized(one, roots)) {
      skipped += 1
      continue
    }
    const meta = readFullSidecar(one)
    const workflow = meta?.workflow
    if (workflow === undefined || workflow === null) {
      skipped += 1
      continue
    }
    const base = path.basename(one, path.extname(one))
    let name = `${base}.workflow.json`
    for (let i = 2; used.has(name); i += 1) name = `${base}-${i}.workflow.json`
    used.add(name)
    entries.push({ name, data: Buffer.from(`${JSON.stringify(workflow, null, 2)}\n`, 'utf8') })
  }

  return { entries, skipped }
}
