/**
 * 提示词参考：从真实用户写的 prompt 里翻灵感。
 *
 * 数据源是 HuggingFace 上的 `FredZhang7/stable-diffusion-prompts-2.47M`（247 万条，
 * `creativeml-openrail-m`）。HF 的 `rows` 接口 `length` 上限 100，所以：
 *
 * - **随机模式**：直接按随机 offset 抽 100 条再挑你要的几条 —— 不依赖任何缓存，
 *   第一次打开就能用。这是主路径。
 * - **搜索模式**：在**本地池**里按子串过滤。池子默认 2 万条（200 次请求，约 1 分钟），
 *   建好之后搜索是纯内存操作。
 *
 * 不用 `TagIndex`：prompt 平均 150 字符，2 万条会产生约 300 万个 2-gram 条目，
 * 内存代价远高于"线性扫 2 万条"（实测 20ms 级）。倒排索引在短 tag 上是好交易，
 * 在长文本上不是。
 */
import fs from 'node:fs'
import path from 'node:path'

import { pluginDataDir } from '../../../shared/host/paths.js'

/** 数据集。 */
const DATASET = 'FredZhang7/stable-diffusion-prompts-2.47M'
/** rows 接口一次最多给 100 条。 */
const PAGE = 100
/** 池子默认上限。 */
export const DEFAULT_POOL = 20_000

/** 一条参考提示词。 */
export interface PromptHit {
  text: string
  /** 它在数据集里的行号，便于复现。 */
  source: number
}

/** 池子信息。 */
export interface PromptPoolInfo {
  size: number
  /** 文件修改时间；0 表示还没建过。 */
  builtAt: number
}

/** 池子文件路径。 */
export function promptPoolPath(dataDir = pluginDataDir()): string {
  return path.join(dataDir, 'prompts', `${DATASET.split('/')[1] ?? 'prompts'}.jsonl`)
}

/** rows 接口的地址。 */
function rowsUrl(offset: number, length: number): string {
  const params = new URLSearchParams({
    dataset: DATASET,
    config: 'default',
    split: 'train',
    offset: String(offset),
    length: String(length),
  })
  return `https://datasets-server.huggingface.co/rows?${params.toString()}`
}

/** 一页的解析结果。 */
interface Page {
  /** 这一页的条目。 */
  items: PromptHit[]
  /** 数据集总行数。 */
  total: number
}

/**
 * 取一页。
 *
 * 字段是 `row.text` 而不是 `prompt` —— HF 的 features 里那条叫 `text`。
 *
 * @param offset - 起始行号。
 * @param length - 要几条（上限 100）。
 * @param fetchImpl - 注入给测试。
 */
async function fetchPage(offset: number, length: number, fetchImpl: typeof fetch, timeoutMs: number): Promise<Page> {
  const res = await fetchImpl(rowsUrl(offset, Math.min(length, PAGE)), {
    headers: { 'User-Agent': 'dsh-comfyui-workbench' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`取提示词失败：HTTP ${res.status}`)
  const body: unknown = await res.json()
  const bag = body !== null && typeof body === 'object'
    ? (body as { rows?: unknown; num_rows_total?: unknown })
    : {}
  const total = typeof bag.num_rows_total === 'number' ? bag.num_rows_total : 0
  const items: PromptHit[] = []
  if (Array.isArray(bag.rows)) {
    for (const entry of bag.rows) {
      const row = entry !== null && typeof entry === 'object' ? (entry as { row_idx?: unknown; row?: unknown }) : {}
      const inner = row.row !== null && typeof row.row === 'object' ? (row.row as { text?: unknown }) : {}
      const text = typeof inner.text === 'string' ? inner.text.trim() : ''
      if (text === '') continue
      items.push({ text, source: typeof row.row_idx === 'number' ? row.row_idx : offset + items.length })
    }
  }
  return { items, total }
}

/**
 * 随机抽几条。
 *
 * 不依赖本地池：随机挑一个 offset 拉一页，再从中随机取。**这是"翻灵感"的主路径**，
 * 第一次打开面板就能用。
 *
 * @param count - 要几条。
 * @param options - 网络参数与注入。
 */
export async function fetchRandomPrompts(
  count: number,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<PromptHit[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const take = Math.min(Math.max(count, 1), 20)

  // 先探一次拿总行数（也从这一页里取结果，不浪费）
  const first = await fetchPage(0, PAGE, fetchImpl, timeoutMs)
  if (first.total <= PAGE) return first.items.slice(0, take)

  // 总行数已知后再随机挑一页：offset 落在 [0, total-PAGE] 区间才不会越界
  const span = Math.max(first.total - PAGE, 1)
  const offset = Math.floor(Math.random() * span)
  const page = offset === 0 ? first : await fetchPage(offset, PAGE, fetchImpl, timeoutMs)
  const pool = page.items.length > 0 ? page.items : first.items

  // 从这一页里随机打散，避免每次都拿到同一批的开头几条
  const shuffled = [...pool]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = shuffled[i] as PromptHit
    shuffled[i] = shuffled[j] as PromptHit
    shuffled[j] = a
  }
  return shuffled.slice(0, take)
}

/**
 * 建（或补）本地池。
 *
 * 池子是"搜索模式"的前提。默认 2 万条——再往上边际收益很小，而首次建池是
 * 串行 200 次请求（约 1 分钟）。**幂等**：每次都重建，中途失败保留已写进去的部分。
 *
 * @param options - 目标条数、数据目录、日志与网络参数。
 */
export async function syncPromptPool(options: {
  dataDir?: string
  count?: number
  log?: (message: string) => void
  fetchImpl?: typeof fetch
  timeoutMs?: number
} = {}): Promise<{ size: number; seconds: number; file: string }> {
  const started = Date.now()
  const file = promptPoolPath(options.dataDir)
  const want = Math.min(Math.max(options.count ?? DEFAULT_POOL, PAGE), 100_000)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const log = options.log ?? (() => {})

  const first = await fetchPage(0, PAGE, fetchImpl, timeoutMs)
  const total = first.total
  if (total === 0) throw new Error('数据集报告总行数为 0，接口可能变了。')

  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const write = fs.createWriteStream(tmp, { encoding: 'utf8' })

  const seen = new Set<string>()
  let written = 0
  const emit = (hit: PromptHit): void => {
    // 数据集里同一句话可能重复出现，池子里留一份就够
    const key = hit.text
    if (seen.has(key)) return
    seen.add(key)
    write.write(`${JSON.stringify(hit)}\n`)
    written += 1
  }

  for (const hit of first.items) emit(hit)

  // 均匀铺开取：等距抽样比连续取更能代表全库（连续取会集中在某个 offset 附近）
  const step = Math.max(Math.floor(total / Math.ceil(want / PAGE)), PAGE)
  for (let offset = step; offset < total && written < want; offset += step) {
    try {
      const page = await fetchPage(offset, PAGE, fetchImpl, timeoutMs)
      for (const hit of page.items) {
        if (written >= want) break
        emit(hit)
      }
    } catch (error) {
      // 单页失败不该让整趟白跑：记一句，继续下一段
      log(`第 ${offset} 行那页取失败：${error instanceof Error ? error.message : String(error)}`)
    }
    if (written % (PAGE * 10) === 0 || written >= want) log(`  已收集 ${written}/${want}`)
  }

  await new Promise<void>(resolve => { write.end(resolve) })
  fs.renameSync(tmp, file)

  const seconds = Number(((Date.now() - started) / 1000).toFixed(1))
  log(`池子建好：${written} 条 → ${file}（${seconds}s）`)
  return { size: written, seconds, file }
}

/** 池子的规模与时间。 */
export function promptPoolInfo(dataDir?: string): PromptPoolInfo {
  try {
    const file = promptPoolPath(dataDir)
    const stat = fs.statSync(file)
    return { size: fs.readFileSync(file, 'utf8').split('\n').filter(line => line.trim() !== '').length, builtAt: stat.mtimeMs }
  } catch {
    return { size: 0, builtAt: 0 }
  }
}

/** 池子的内存缓存（按 mtime+size 校验，文件变了自动重读）。 */
let poolCache: { key: string; items: PromptHit[] } | null = null

/** 读池子。 */
function readPool(dataDir?: string): PromptHit[] {
  const file = promptPoolPath(dataDir)
  let stat: fs.Stats
  try {
    stat = fs.statSync(file)
  } catch {
    return []
  }
  const key = `${file}:${stat.mtimeMs}:${stat.size}`
  if (poolCache !== null && poolCache.key === key) return poolCache.items

  const items: PromptHit[] = []
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const record = JSON.parse(line) as { text?: unknown; source?: unknown }
        if (typeof record.text !== 'string') continue
        items.push({ text: record.text, source: typeof record.source === 'number' ? record.source : 0 })
      } catch {
        // 单行坏了跳过
      }
    }
  } catch {
    return []
  }
  poolCache = { key, items }
  return items
}

/**
 * 在池子里搜。
 *
 * 子串匹配 + 简单打分（命中词数多的、短一点的排前面）。**不做语义搜索** ——
 * 那需要向量化，与本面板"翻素材"的定位不相称。池子没建时返回空数组，由调用方
 * 决定怎么提示。
 *
 * @param query - 关键词（空格分隔多个，全部命中才算）。
 * @param limit - 最多几条。
 * @param dataDir - 数据目录。
 */
export function searchPrompts(query: string, limit: number, dataDir?: string): PromptHit[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const words = needle.split(/\s+/).filter(word => word !== '')
  const items = readPool(dataDir)
  const hits: Array<{ hit: PromptHit; score: number }> = []
  for (const item of items) {
    const text = item.text.toLowerCase()
    let score = 0
    let all = true
    for (const word of words) {
      const at = text.indexOf(word)
      if (at < 0) { all = false; break }
      // 出现在开头、或前后是词边界，给更高分
      score += at === 0 || /[\s,.(]/.test(text[at - 1] ?? ' ') ? 3 : 1
    }
    if (!all) continue
    // 同样命中时短的更可能是"精准的写法"，长的是拼了一堆风格词的
    hits.push({ hit: item, score: score * 1000 - Math.min(item.text.length, 999) })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits.slice(0, Math.min(Math.max(limit, 1), 50)).map(entry => entry.hit)
}
