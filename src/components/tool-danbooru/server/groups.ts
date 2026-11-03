/**
 * Danbooru 的 tag 分组（语义分类）抓取。
 *
 * **分类的权威来源是 wiki，不是 API**：`tag_groups` 不是 Danbooru 的 API 资源
 * （直接请求 `/tag_groups.json` 是 404），它是一篇 wiki 文章，列出 91 个
 * `Tag group:XXX` 子页面；每个子页面用 DText 的 `[[tag]]` 链接列成员。
 *
 * 所以流程是两层：抓索引页拿组名 → 逐个抓子页面拿成员。
 *
 * 覆盖率是有上限的：这 91 组共 15064 个 tag，对 `general` 的 30693 条只直接覆盖
 * **26.9%**（8261 条），其余落「其它」。wiki 是人工精选，`Hair styles` 205 个链接里
 * 连 `ponytail`、`braid` 都没有 —— 所以分类是**增强维度**，不是主检索路径。
 */
import fs from 'node:fs'
import path from 'node:path'

import { bundledDir, ownStorePath } from './store.js'
import { foldPathCase } from '../../../shared/host/paths.js'

/** wiki 索引页的标题。 */
export const GROUP_INDEX_TITLE = 'tag_groups'

/** 一条 tag 的分组归属。 */
export interface GroupRecord {
  /** Danbooru tag（下划线形式）。 */
  tag: string
  /** 它所属的组名（不带 `Tag group:` 前缀），一个 tag 可能属于多个组。 */
  groups: string[]
}

/**
 * 从索引页正文里取出 91 个组名。
 *
 * 正文形如 `* [[Tag group:Artistic license]]`，也有 `** [[Tag group:Backgrounds]]`
 * 这类嵌套 —— 缩进层级是给人看的，这里一律拍平（分组之间的关系不进数据）。
 *
 * @param body - wiki 索引页的 DText 正文。
 */
export function parseGroupIndex(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(/\[\[(Tag group:[^\]|]+?)\s*(?:\|[^\]]*)?\]\]/gi)) {
    const name = (match[1] ?? '').trim()
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(name)
  }
  return out
}

/**
 * 从某个组页面的正文里取出成员 tag。
 *
 * 要处理三种写法：
 * - `[[Arm behind back]]` —— 空格分词的人类可读名，规范成 `arm_behind_back`
 * - `[[Arm behind back]] / [[Arms behind back]]` —— 别名对，两个都收
 * - `[[Ponytail|ponytail]]` —— 带管道时取左边（显示名），右边是链接目标
 *
 * 还要排掉 `[[tag group:gestures]]` 这类跨组引用（那是"参见"，不是成员）与
 * 页面开头的 `[[tag groups]]` 导航链接。
 *
 * @param body - 组页面的 DText 正文。
 */
export function parseGroupPage(body: string): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const match of body.matchAll(/\[\[([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/g)) {
    const raw = (match[1] ?? '').trim()
    // 跨组引用与导航链接不是成员
    if (/^tag[ _]groups?$/i.test(raw) || /^tag[ _]group:/i.test(raw)) continue
    const tag = normalizeTag(raw)
    if (tag === '') continue
    if (seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
  }
  return out
}

/**
 * 把 wiki 里的人类可读名规范成 Danbooru tag。
 *
 * 空格与下划线等价，统一成下划线；转小写；去掉首尾的下划线。
 *
 * **字符集不能收窄**：早期版本只留 `[a-z0-9_\-().]`，结果把 `^_^`（15.5 万帖）、
 * `>_<`（9.3 万帖）、`!`（5.6 万帖）、`6+girls`、`moe_moe_kyun!`、
 * `so_moe_i'm_gonna_die!` 全剔了 —— 同一页里 `._.`、`0_0` 进来、`^_^` 却丢掉，
 * 纯属白名单在造数据缺口。这里只挡真正的结构性字符（空白已在上一步处理、
 * `[ ] |` 是 DText 语法、`" \\` 会破坏 JSONL）。
 *
 * @param raw - wiki 链接里的文本。
 */
export function normalizeTag(raw: string): string {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/^_+|_+$/g, '')
  // 不给 `:` 开口子：Danbooru 的 tag 不用冒号，而 wiki 正文里混着 `help:autotags`、
  // `howto:copyright`、`tag_group:body_parts` 这类命名空间链接 —— 放进白名单就会
  // 变成"tag"，清一次就多 150 多条假数据。
  return /^[a-z0-9_\-.()!'&+/^~<>@#*]+$/.test(cleaned) ? cleaned : ''
}

/**
 * 把抓失败的组从旧快照里搬回来。
 *
 * 91 个页面 × 3 次重试，偶发一两页失败很正常 —— 但失败的组如果不补，那些 tag
 * 就静默从分类里消失了（用户看到的是"筛不到"，而不是"这次没抓到"）。
 *
 * @param records - 本次抓到的记录（**原地**合并）。
 * @param failed - 抓失败的组名。
 * @param file - 旧快照路径。
 * @returns 补回的记录条数（新增与合并进已有记录的都算）。
 */
function mergeFailedGroups(records: GroupRecord[], failed: readonly string[], file: string): number {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return 0
  }
  const keep = new Set(failed)
  const index = new Map<string, number>()
  records.forEach((record, i) => index.set(record.tag, i))

  let added = 0
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let record: { tag?: unknown; groups?: unknown }
    try {
      record = JSON.parse(line) as typeof record
    } catch {
      continue
    }
    if (typeof record.tag !== 'string' || !Array.isArray(record.groups)) continue
    const carried = record.groups.filter((group): group is string => typeof group === 'string' && keep.has(group))
    if (carried.length === 0) continue

    const at = index.get(record.tag)
    if (at === undefined) {
      index.set(record.tag, records.length)
      records.push({ tag: record.tag, groups: [...carried].sort() })
      added += 1
    } else {
      const target = records[at] as GroupRecord
      target.groups = [...new Set([...target.groups, ...carried])].sort()
      added += 1
    }
  }
  return added
}

/** 一次分组同步的结果。 */export interface GroupsResult {
  /** 组数（成功的）。 */
  groups: number
  /** 抓取失败的组名。 */
  failed: string[]
  /** 唯一 tag 数。 */
  tags: number
  /** 一个 tag 属于多个组的条数。 */
  shared: number
  /** 落盘路径。 */
  file: string
  seconds: number
  /** 是否用了上一次的快照（全部抓失败时）。 */
  fromCache: boolean
}

/**
 * 抓取全部组并写到随包数据目录。
 *
 * **幂等**：每次都全量重建。抓失败的组**从旧快照里取回**（`failed` 只作报告）——
 * 91 个页面 × 3 次重试，偶发一两页失败就让整组静默从分类里消失是不可接受的。
 * 只有全部失败时才完全不写盘，并把 `fromCache` 置真。
 *
 * @param options - 目标目录、日志、网络参数。
 */
export async function syncGroups(options: {
  /** 数据目录。必填：写随包要显式 `allowBundled`，避免误覆盖分发的数据。 */
  dataDir: string
  /** 目标是随包 `data/danbooru/` 时必须显式置真。 */
  allowBundled?: boolean
  log?: (message: string) => void
  fetchImpl?: typeof fetch
  /** 单页超时。 */
  timeoutMs?: number
  /** 页间间隔，礼貌起见默认 1.2 秒。 */
  delayMs?: number
}): Promise<GroupsResult> {
  const started = Date.now()
  const doFetch = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? 60_000
  const delayMs = options.delayMs ?? 1_200

  const file = groupsPath(options.dataDir)
  // 与 `writeStore` 同一道护栏：不显式允许就不许往随包数据里写
  // 与 writeStore 用同一套折叠大小写比较：裸 resolve 在 Windows 上挡不住 data/Danbooru 这类变体
  const target = foldPathCase(path.resolve(path.dirname(file)))
  const bundled = foldPathCase(path.resolve(bundledDir()))
  if (options.allowBundled !== true && (target === bundled || target.startsWith(bundled + path.sep))) {
    throw new Error(`拒绝写入随包数据目录：${file}（要更新随包分组请显式传 allowBundled: true）`)
  }

  const getPage = async (title: string): Promise<string | null> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await doFetch(
          `https://danbooru.donmai.us/wiki_pages.json?search%5Btitle%5D=${encodeURIComponent(title)}`,
          { headers: { 'User-Agent': 'dsh-comfyui-workbench' }, signal: AbortSignal.timeout(timeoutMs) },
        )
        if (res.ok) {
          const arr = await res.json()
          if (Array.isArray(arr) && arr.length > 0) return String((arr[0] as { body?: unknown }).body ?? '')
          return null
        }
      } catch {
        // 网络抖动：重试
      }
      // 最后一次失败就别再等了
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 2_000))
    }
    return null
  }

  const indexBody = await getPage(GROUP_INDEX_TITLE)
  if (indexBody === null) throw new Error('抓不到 tag_groups 索引页，无法确定分组列表。')
  const names = parseGroupIndex(indexBody)
  if (names.length === 0) throw new Error('索引页里没有解析出任何组名，页面结构可能变了。')
  options.log?.(`索引页给出 ${names.length} 个组`)

  const byTag = new Map<string, Set<string>>()
  const failed: string[] = []
  for (const [i, name] of names.entries()) {
    const body = await getPage(name)
    const group = name.replace(/^Tag group:/i, '').trim()
    if (body === null) {
      failed.push(group)
    } else {
      for (const tag of parseGroupPage(body)) {
        const set = byTag.get(tag) ?? new Set<string>()
        set.add(group)
        byTag.set(tag, set)
      }
    }
    if ((i + 1) % 20 === 0 || i + 1 === names.length) {
      options.log?.(`  抓取 ${i + 1}/${names.length}（失败 ${failed.length}，累计 tag ${byTag.size}）`)
    }
    if (i + 1 < names.length && delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs))
  }

  // 一个都没抓到时别覆盖旧数据：半份分类比过期分类更糟
  if (failed.length === names.length) {
    options.log?.('全部组抓取失败，保留上一次的快照。')
    return { groups: 0, failed, tags: 0, shared: 0, file, seconds: 0, fromCache: true }
  }

  const records: GroupRecord[] = [...byTag].map(([tag, groups]) => ({ tag, groups: [...groups].sort() }))
  // 抓失败的组从旧快照里搬回来：91 页里偶发一页 403/超时，不该让整组分类凭空消失
  if (failed.length > 0) {
    const merged = mergeFailedGroups(records, failed, file)
    if (merged > 0) options.log?.(`从上一份快照补回 ${failed.length} 个失败组（${merged} 条记录）`)
  }

  records.sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, records.map(record => JSON.stringify(record)).join('\n') + '\n', 'utf8')
  fs.renameSync(tmp, file)

  const result: GroupsResult = {
    groups: names.length - failed.length,
    failed,
    tags: records.length,
    shared: records.filter(record => record.groups.length > 1).length,
    file,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    fromCache: false,
  }
  options.log?.(`分组落盘：${result.groups} 组 / ${result.tags} 个 tag（跨组 ${result.shared}），${result.seconds}s`)
  return result
}

/**
 * 分组数据的路径。
 *
 * 与 tag 数据不同，这里**没有"运行时优先"**：分组是一份可重建的派生数据，
 * 写哪读哪即可。传 `dataDir` 时落运行时的 `danbooru/`，不传则落随包目录。
 *
 * @param dataDir - 插件数据目录；省略表示随包。
 */
export function groupsPath(dataDir?: string): string {
  return dataDir === undefined
    ? path.join(bundledDir(), 'groups.jsonl')
    : ownStorePath(dataDir, 'general').replace(/[^\\/]+$/, 'groups.jsonl')
}

/**
 * 读分组表，返回 `tag → 组[]`。
 *
 * 读不到就返回空 Map（分类是增强维度，缺了搜索照样能用）。
 *
 * @param dataDir - 插件数据目录；省略表示随包。
 */
export function readGroups(dataDir?: string): Map<string, string[]> {
  const candidates = dataDir === undefined
    ? [groupsPath()]
    : [groupsPath(dataDir), groupsPath()]
  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8')
      const out = new Map<string, string[]>()
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          const record = JSON.parse(line) as { tag?: unknown; groups?: unknown }
          if (typeof record.tag !== 'string' || !Array.isArray(record.groups)) continue
          out.set(record.tag, record.groups.filter((g): g is string => typeof g === 'string'))
        } catch {
          // 单行坏了不影响其它行
        }
      }
      if (out.size > 0) return out
    } catch {
      // 试下一个
    }
  }
  return new Map()
}

/** 大类表：`组名 → 大类 key`，外加 key 的中文名。 */
export interface CategoryMap {
  /** 大类 key（`action` / `clothing` …）→ 中文名。 */
  labels: Record<string, string>
  /** Danbooru 组名 → 大类 key。 */
  groups: Record<string, string>
  /** 多组冲突时的裁决顺序（先出现的优先）。 */
  priority: string[]
}

/** 大类表的路径（与 groups.jsonl 同目录）。 */
export function categoryMapPath(dataDir?: string): string {
  return groupsPath(dataDir).replace(/[^\\/]+$/, 'category-map.json')
}

/**
 * 读大类映射表。
 *
 * **对不上的组不抛错**：Danbooru 会新增/改名组，那时该组的 tag 落 `other`
 * 并记一条日志 —— 分类是增强维度，不能因为 Danbooru 改了个名字就让查询挂掉。
 *
 * @param dataDir - 插件数据目录；省略表示随包。
 * @param log - 记录未映射的组名。
 */
export function readCategoryMap(dataDir?: string, log?: (message: string) => void): CategoryMap {
  const empty: CategoryMap = { labels: {}, groups: {}, priority: [] }
  const candidates = dataDir === undefined
    ? [categoryMapPath()]
    : [categoryMapPath(dataDir), categoryMapPath()]
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        categories?: unknown
        groups?: unknown
        priority?: unknown
      }
      const labels = raw.categories !== null && typeof raw.categories === 'object'
        ? Object.fromEntries(Object.entries(raw.categories as Record<string, unknown>).filter(([, v]) => typeof v === 'string'))
        : {}
      const groups = raw.groups !== null && typeof raw.groups === 'object'
        ? Object.fromEntries(Object.entries(raw.groups as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>
        : {}
      if (Object.keys(groups).length === 0) continue
      const priority = Array.isArray(raw.priority)
        ? raw.priority.filter((key): key is string => typeof key === 'string')
        : []
      return { labels: labels as Record<string, string>, groups, priority }
    } catch {
      // 试下一个
    }
  }
  return empty
}

/** 大类的默认优先级（`category-map.json` 的 `priority` 可覆盖）。 */
const DEFAULT_PRIORITY = ['explicit', 'clothing', 'appearance', 'action', 'object', 'composition', 'theme']

/**
 * 一个 tag 归到哪个大类。
 *
 * 一个 tag 可能属于多个组（15064 个里有 1478 个跨组）。**按优先级裁决，不按组名顺序**：
 * 组名在数据里是字母序，早期版本照抄它就出了「`ahegao` 因为 `Face tags` 排在 `Sex acts`
 * 前面被归成外貌」这种结果 —— 用户筛 `explicit` 会看不到它，还以为分类没覆盖。
 *
 * 优先级写在 `category-map.json` 的 `priority` 里（数据而非代码），缺省用 {@link DEFAULT_PRIORITY}。
 * 全都没命中就落 `other`。
 *
 * @param groups - 该 tag 所属的组名。
 * @param map - 大类映射表。
 */
export function categoryOf(groups: readonly string[], map: CategoryMap): string {
  const priority = map.priority.length > 0 ? map.priority : DEFAULT_PRIORITY
  const rank = new Map(priority.map((key, i) => [key, i]))
  let best: string | undefined
  let bestRank = Number.POSITIVE_INFINITY
  for (const group of groups) {
    const category = map.groups[group]
    if (category === undefined) continue
    const at = rank.get(category) ?? priority.length
    if (at < bestRank) {
      best = category
      bestRank = at
    }
  }
  return best ?? 'other'
}
