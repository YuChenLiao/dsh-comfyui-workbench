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
/**
 * 池子默认上限。
 *
 * **5000 不是随便定的**：`rows` 接口一次最多 100 条，2 万条要 200 次请求，
 * 而 HF 的 datasets-server 对匿名请求限流很紧 —— 实测一路 429，池子根本建不起来。
 * 50 次请求（配合 400ms 间隔，约 20 秒 + 网络）能稳定跑完。
 * 对"翻灵感 + 关键词搜索"这个用途，5 千条足够；想要更多可以显式传 `count`。
 */
export const DEFAULT_POOL = 5_000

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
 * 取一页。**遇到 429 会退避重试**。
 *
 * HuggingFace 的 datasets-server 对匿名请求限流很紧，而建池要串行几十上百次请求——
 * 不退避的话第一次 429 就会让整趟失败（用户看到的就是"建池一跑就报 429"）。
 *
 * 字段是 `row.text` 而不是 `prompt` —— HF 的 features 里那条叫 `text`。
 *
 * @param offset - 起始行号。
 * @param length - 要几条（上限 100）。
 * @param fetchImpl - 注入给测试。
 * @param timeoutMs - 单次超时。
 * @param retries - 429 时最多再试几次。
 */
async function fetchPage(
  offset: number,
  length: number,
  fetchImpl: typeof fetch,
  timeoutMs: number,
  retries = 3,
): Promise<Page> {
  let attempt = 0
  for (;;) {
    const res = await fetchImpl(rowsUrl(offset, Math.min(length, PAGE)), {
      headers: { 'User-Agent': 'dsh-comfyui-workbench' },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (res.ok) {
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
    // 429 = 限流。按 Retry-After（秒）或 2^n 秒退避，重试几次仍不行才抛。
    if (res.status === 429 && attempt < retries) {
      const header = Number(res.headers.get('retry-after') ?? '')
      const waitMs = Number.isFinite(header) && header > 0 ? header * 1_000 : Math.min(2 ** attempt * 1_500, 15_000)
      attempt += 1
      await new Promise(resolve => setTimeout(resolve, waitMs))
      continue
    }
    throw new Error(
      res.status === 429
        ? '取提示词失败：HuggingFace 在限流（HTTP 429）。等一会儿再试，或先把目标条数调小。'
        : `取提示词失败：HTTP ${res.status}`,
    )
  }
}

/** 数据集总行数的模块级缓存：第一次拿到之后就不用再为它打一枪。 */
let totalCache: { total: number; at: number } | null = null
/** 总行数多久当一次准（数据集几乎不变，一小时足够）。 */
const TOTAL_TTL_MS = 60 * 60_000

/**
 * 取一页，失败重试一次。
 *
 * HF 的深页 offset 属于冷区，偶发 5xx/超时很常见；随机模式是**主路径**，
 * 一次抖动就白屏不可接受。
 */
async function fetchPageWithRetry(offset: number, fetchImpl: typeof fetch, timeoutMs: number): Promise<Page> {
  try {
    return await fetchPage(offset, PAGE, fetchImpl, timeoutMs)
  } catch (first) {
    try {
      return await fetchPage(offset, PAGE, fetchImpl, timeoutMs)
    } catch {
      // 重试也失败：抛第一次的原因（更能说明是上游的问题）
      throw first
    }
  }
}

/**
 * 随机抽几条。
 *
 * 不依赖本地池：随机挑一个 offset 拉一页，再从中随机取。**这是"翻灵感"的主路径**，
 * 第一次打开面板就能用。
 *
 * 总行数缓存在模块级：不缓存的话每次都要先拉一页 offset=0 拿 total 再丢掉，
 * 等于恒定两次请求，而那一页的内容也用不上。
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

  const cached = totalCache
  if (cached !== null && Date.now() - cached.at < TOTAL_TTL_MS) {
    // 已知总行数：直接随机挑一页，稳态只打一次网络
    const offset = Math.floor(Math.random() * Math.max(cached.total - PAGE, 1))
    const page = await fetchPageWithRetry(offset, fetchImpl, timeoutMs)
    return shuffle(page.items).slice(0, take)
  }

  // 第一次：拉一页 offset=0，既拿总行数、也把这一页当兜底结果
  const first = await fetchPage(0, PAGE, fetchImpl, timeoutMs)
  if (first.total > 0) totalCache = { total: first.total, at: Date.now() }
  if (first.total <= PAGE) return first.items.slice(0, take)

  // 总行数已知后再随机挑一页：offset 落在 [0, total-PAGE] 区间才不会越界
  const offset = Math.floor(Math.random() * Math.max(first.total - PAGE, 1))
  const page = offset === 0 ? first : await fetchPageWithRetry(offset, fetchImpl, timeoutMs)
  return shuffle(page.items.length > 0 ? page.items : first.items).slice(0, take)
}

/** 打散一页，避免每次都拿到同一批的开头几条。 */
function shuffle(items: readonly PromptHit[]): PromptHit[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = out[i] as PromptHit
    out[i] = out[j] as PromptHit
    out[j] = a
  }
  return out
}

/**
 * 建（或补）本地池。
 *
 * 池子是"搜索模式"的前提。默认 2 万条——再往上边际收益很小。
 *
 * **两条硬约束**（都是踩出来的）：
 * - **请求要限速**：HF 的 datasets-server 对匿名请求限流很紧，串行狂打会一路 429。
 *   默认每次之间隔 `intervalMs`，并给 `fetchPage` 配了 429 退避。
 * - **临时文件不能撞名**：原来用 `${file}.${pid}.tmp`，同一进程里连点两次建池会写同一个
 *   临时文件，两个流交错 → rename 出一份坏文件，看起来就是"建池失败把原来的池炸了"。
 *   加时间戳与随机后缀，并且**失败时删掉临时文件、绝不动原文件**。
 *
 * @param options - 目标条数、数据目录、日志、网络与限速参数。
 */
export async function syncPromptPool(options: {
  dataDir?: string
  count?: number
  log?: (message: string) => void
  fetchImpl?: typeof fetch
  timeoutMs?: number
  /** 两次请求之间的间隔（毫秒）。默认 400ms。 */
  intervalMs?: number
  /** 单页 429 的重试次数（测试里传 0 免得等退避）。 */
  maxPageRetries?: number
} = {}): Promise<{ size: number; seconds: number; file: string }> {
  const started = Date.now()
  const file = promptPoolPath(options.dataDir)
  const want = Math.min(Math.max(options.count ?? DEFAULT_POOL, PAGE), 100_000)
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const intervalMs = Math.max(options.intervalMs ?? 400, 0)
  const maxPageRetries = Math.max(options.maxPageRetries ?? 3, 0)
  const log = options.log ?? (() => {})

  const first = await fetchPage(0, PAGE, fetchImpl, timeoutMs)
  const total = first.total
  if (total === 0) throw new Error('数据集总行数为 0，接口可能变了。')

  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 临时文件名带时间戳与随机后缀：同一进程连开两次也不会撞到同一个文件
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const write = fs.createWriteStream(tmp, { encoding: 'utf8' })
  /**
   * 异步写错误。
   *
   * `createWriteStream` 的失败（磁盘满、权限、句柄失效）是**异步 emit** 的，
   * 没有监听器就是 uncaught exception —— 宿主进程直接崩，`catch` 里的清理也跑不到。
   */
  let writeError: Error | null = null
  write.on('error', error => {
    writeError = error instanceof Error ? error : new Error(String(error))
  })

  const seen = new Set<string>()
  let written = 0
  const emit = (hit: PromptHit): void => {
    if (writeError !== null) return
    // 数据集里同一句话可能重复出现，池子里留一份就够
    const key = hit.text
    if (seen.has(key)) return
    seen.add(key)
    write.write(`${JSON.stringify(hit)}\n`)
    written += 1
  }

  try {
    for (const hit of first.items) emit(hit)

    // 均匀铺开取：等距抽样比连续取更能代表全库（连续取会集中在某个 offset 附近）
    const step = Math.max(Math.floor(total / Math.ceil(want / PAGE)), PAGE)
    for (let offset = step; offset < total && written < want; offset += step) {
      if (writeError !== null) throw writeError
      if (intervalMs > 0) await new Promise(resolve => setTimeout(resolve, intervalMs))
      try {
        const page = await fetchPage(offset, PAGE, fetchImpl, timeoutMs, maxPageRetries)
        for (const hit of page.items) {
          if (written >= want) break
          emit(hit)
        }
      } catch (error) {
        // 单页失败不该让整趟白跑：记一句，继续下一段
        log(`第 ${offset} 行那页取失败：${error instanceof Error ? error.message : String(error)}`)
      }
      if (written > 0 && written % 500 < PAGE) log(`  已收集 ${written}/${want}`)
    }
    if (writeError !== null) throw writeError

    // **不能只看 `written === 0`**：限流下"首页成功、后续几十页全 429"会得到
    // written=100 —— 照样 rename 覆盖原池，池子从 5000 缩到 100。那正是用户报的
    // "建池失败把原池炸了"的另一种形态。用原池大小的一半当及格线。
    const previous = promptPoolInfo(options.dataDir).size
    const floor = Math.min(want, Math.max(previous, PAGE)) * 0.5
    if (written < floor) {
      throw new Error(
        `只取到 ${written} 条（目标 ${want}，原有 ${previous} 条），看着像被限流。原有的池没有被改动。`,
      )
    }

    await new Promise<void>((resolve, reject) => {
      write.end((error?: Error | null) => (error === null || error === undefined ? resolve() : reject(error)))
    })
    fs.renameSync(tmp, file)
  } catch (error) {
    // 失败路径：关流、删临时文件。**原文件一个字都不动**。
    await new Promise<void>(resolve => { write.end(() => resolve()) })
    try {
      fs.unlinkSync(tmp)
    } catch {
      // 临时文件可能已经不存在
    }
    throw error
  }

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
