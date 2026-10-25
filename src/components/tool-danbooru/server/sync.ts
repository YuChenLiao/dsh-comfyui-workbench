import fs from 'node:fs'

import type { TagRecord } from './store.js'
import { pickNames, pruneSharedAliases, readStore, storePath, writeStore } from './store.js'

/** 同步进度：给用户/模型看的可读状态。 */
export interface SyncProgress {
  kind: 'character' | 'artist'
  /** 已处理的 tag 数。 */
  done: number
  /** 本轮计划处理的 tag 数。 */
  total: number
  /** 有中文名的条数。 */
  withNames: number
  /** 已写盘的条数。 */
  written: number
  /** wiki 查询失败的条数（与"本来就没有别名"不是一回事）。 */
  failed: number
}

/** 同步选项。 */
export interface SyncOptions {
  /** 插件数据目录。 */
  dataDir: string
  /** 热度下限：低于它的 tag 不收录，用来把几万条压到几千条。 */
  minPostCount: number
  /** 每页从 Danbooru 拉多少条（上限 1000）。 */
  pageSize: number
  /** 每轮最多收录多少 tag（0 表示不限）。 */
  maxTags: number
  /** wiki 查询并发数。 */
  concurrency: number
  /** 进度回调。 */
  onProgress?: (progress: SyncProgress) => void
  /** 日志。 */
  log?: (message: string) => void
  /** 中止信号。 */
  signal?: AbortSignal
}

const BASE = 'https://danbooru.donmai.us'
const UA = 'dsh-comfyui-workbench (+https://github.com/YuChenLiao/dsh-comfyui-workbench)'

/** Danbooru 的 tag 分类：1 画师，4 角色。 */
const CATEGORY = { character: 4, artist: 1 } as const

async function getJson(path: string, signal?: AbortSignal): Promise<unknown> {
  // 分页请求也要退避：一次 429 直接抛会让整轮同步作废（已拉的数据全丢）。
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const res = await fetch(BASE + path, { headers: { 'User-Agent': UA }, signal })
    if (res.ok) return res.json()
    // 429 / 5xx 值得重试；404 与其它 4xx 直接失败
    const fail = (): Error => {
      const error = new Error(`Danbooru 返回 ${res.status}：${path}`) as Error & { status?: number }
      error.status = res.status
      return error
    }
    if (res.status !== 429 && res.status < 500) throw fail()
    if (attempt === 3 || signal?.aborted === true) throw fail()
    const retryAfter = Number(res.headers.get('retry-after')) || 0
    // Retry-After 要设上限：服务端回 3600 会让同步原地卡一小时
    const wait = retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 800 * (attempt + 1)
    await new Promise(resolve => setTimeout(resolve, wait))
  }
  throw new Error(`Danbooru 请求失败：${path}`)
}

interface RawTag {
  name?: unknown
  post_count?: unknown
}

interface RawWiki {
  other_names?: unknown
}

/**
 * 分页拉某一类的 tag 名。
 *
 * 只取 tag 名与帖子数：中文名要逐条查 wiki，那是另一个更慢的循环。
 *
 * @param kind - 角色或画师。
 * @param options - 同步选项。
 */
async function fetchTagNames(kind: 'character' | 'artist', options: SyncOptions): Promise<Array<{ tag: string; postCount: number }>> {
  const out: Array<{ tag: string; postCount: number }> = []
  const pageSize = Math.min(Math.max(options.pageSize, 1), 1000)
  for (let page = 1; ; page += 1) {
    if (options.signal?.aborted === true) break
    // 参数名是 `search[post_count]=>N` 而不是 `post_count_gte` —— 后者 Danbooru 不认，
    // 会把最热的几条直接返回，于是热度阈值成了死旋钮（实测 gte=200000 返回 post_count=2 的 tag）。
    const query = `/tags.json?search[category]=${CATEGORY[kind]}&search[post_count]=${encodeURIComponent(`>=${options.minPostCount}`)}`
      + `&search[order]=count&limit=${pageSize}&page=${page}`
    const raw = await getJson(query, options.signal)
    if (!Array.isArray(raw) || raw.length === 0) break
    for (const item of raw as RawTag[]) {
      if (typeof item.name !== 'string' || item.name === '') continue
      out.push({ tag: item.name, postCount: typeof item.post_count === 'number' ? item.post_count : 0 })
      if (options.maxTags > 0 && out.length >= options.maxTags) break
    }
    if (options.maxTags > 0 && out.length >= options.maxTags) break
    if (raw.length < pageSize) break
  }
  return out
}

/**
 * 查一条 tag 的 wiki，取 `other_names`。
 *
 * 失败不抛：个别 tag 没有 wiki 页很正常，不该中断整轮同步。
 *
 * @param tag - Danbooru tag 名。
 * @param signal - 中止信号。
 */
async function fetchOtherNames(tag: string, signal?: AbortSignal): Promise<string[] | undefined> {
  // 返回 undefined 表示"查询失败"，与"查到了但确实没有别名"（返回 []）必须区分开：
  // 之前一律返回 []，限流时会把名字大面积丢光，日志还显示"同步完成"。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await getJson(`/wiki_pages.json?search[title]=${encodeURIComponent(tag)}&limit=1`, signal)
      if (!Array.isArray(raw) || raw.length === 0) return []
      const page = raw[0] as RawWiki
      if (!Array.isArray(page.other_names)) return []
      return page.other_names.filter((name): name is string => typeof name === 'string')
    } catch (error) {
      // 用 status 判断而不是匹配错误文本：tag 名里可能含 404（`404_(error)`），
      // 文本匹配会把"查询失败"误判成"没有这一页"。
      const status = (error as { status?: unknown }).status
      if (status === 404) return []
      if (attempt === 2 || signal?.aborted === true) return undefined
      await new Promise(resolve => setTimeout(resolve, 400 * (attempt + 1)))
    }
  }
  return undefined
}

/**
 * 同步一类标签（角色或画师）。
 *
 * 两步：先按热度拉全部 tag 名，再逐条查 wiki 补中文名。逐条查询是瓶颈（约 150ms/条），
 * 所以用固定并发；`minPostCount` 是最省事的降规模手段 —— 长尾 tag 既没人用、也没人翻译。
 *
 * @param kind - 角色或画师。
 * @param options - 同步选项。
 * @returns 写入的记录数。
 */
export async function syncKind(kind: 'character' | 'artist', options: SyncOptions): Promise<TagRecord[]> {
  const log = options.log ?? (() => {})
  log(`开始同步${kind === 'character' ? '角色' : '画师'}：热度 ≥ ${options.minPostCount}`)

  const tags = await fetchTagNames(kind, options)
  log(`拿到 ${tags.length} 个 tag，开始补中文名（并发 ${options.concurrency}）`)

  const records: TagRecord[] = []
  const updatedAt = new Date().toISOString()
  let done = 0
  let withNames = 0
  let failed = 0

  for (let i = 0; i < tags.length; i += options.concurrency) {
    if (options.signal?.aborted === true) break
    const slice = tags.slice(i, i + options.concurrency)
    const names = await Promise.all(slice.map(item => fetchOtherNames(item.tag, options.signal)))
    for (let j = 0; j < slice.length; j += 1) {
      const item = slice[j] as { tag: string; postCount: number }
      const raw = names[j]
      if (raw === undefined) {
        failed += 1
        // 查不到就当没查到，但别把这条丢掉——tag 本身仍可被搜到
        records.push({ tag: item.tag, kind, postCount: item.postCount, names: [], updatedAt })
        done += 1
        continue
      }
      const picked = pickNames(item.tag, raw)
      if (picked.length > 0) withNames += 1
      records.push({ tag: item.tag, kind, postCount: item.postCount, names: picked, updatedAt })
      done += 1
    }
    options.onProgress?.({ kind, done, total: tags.length, withNames, written: records.length, failed })
    if (done % 200 === 0) log(`  进度 ${done}/${tags.length}，其中有中文名 ${withNames}`)
  }

  // 去掉"同时属于多个 tag"的别名（CP 名/组合名），再落盘
  const pruned = pruneSharedAliases(records)
  if (pruned > 0) log(`去掉 ${pruned} 个被多个 tag 共用的别名（CP 名/组合名）`)

  const file = storePath(options.dataDir, kind)
  const existing = readStore(file)

  // 整份替换的风险：中途 abort 或服务端返回空列表都会把好库写没。
  // 0 条一律不写；明显缩水（不到旧库一半）先备份再写，留个回滚点。
  if (records.length === 0) {
    log(`拿到 0 条，保留旧库（${existing.length} 条）不动`)
    return existing
  }
  if (existing.length > 0 && records.length < existing.length * 0.5) {
    try {
      fs.copyFileSync(file, `${file}.bak`)
      log(`新结果只有 ${records.length} 条（旧库 ${existing.length} 条），已备份旧库到 ${file}.bak`)
    } catch {
      // 备份失败不该阻断同步
    }
  }

  writeStore(file, records)
  // 用落盘后的实际条数统计：prune 会再删一批别名，用之前的计数会让日志与库对不上
  const kept = records.filter(record => record.names.length > 0).length
  log(`同步完成：${records.length} 条，${kept} 条有别名${failed > 0 ? `，**${failed} 条查询失败**（这些条目的别名缺失，重跑一次可补）` : ''}`)
  return records
}
