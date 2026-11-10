import { fetchJson } from '../server/api.js'
import { readStore, storePath, TAG_KINDS } from '../server/store.js'
import { categoryOf, readCategoryMap, readGroups } from '../server/groups.js'
import { TagIndex } from '../server/tag-index.js'
import type { TagKind, TagRecord } from '../server/store.js'
import type { CategoryMap } from '../server/groups.js'
import type { MatchHow } from '../server/tag-index.js'
import { asString } from '../../../shared/tools/types.js'
import { batchLookup, MAX_BATCH_QUERIES } from './lookup-batch.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'

/** 本组工具的依赖：只要数据目录，不碰 ComfyUI。 */
export interface DanbooruDeps {
  /** 插件数据目录（标签库落在其下的 danbooru/）。 */
  dataDir: string
  logger?: LoggerLike | undefined
}

/** 带缓存地读四类标签库（角色 / 画师 / 作品 / 通用）。 */
export interface TagCache {
  /** 原始记录（诊断与测试用）。 */
  read: (kind: TagKind) => TagRecord[]
  /**
   * 带索引的搜索。
   *
   * 建索引一次约 87 ms，之后每次查询 0.1 ms 级 —— 比每次全扫 19 ms，
   * 多查几次就回本。索引按 kind 各自缓存，invalidate 时一并丢弃。
   */
  search: (kind: TagKind, query: string, limit?: number) => Array<{ record: TagRecord; how: MatchHow }>
  invalidate: (kind?: TagKind) => void
  /**
   * tag → 所属 Danbooru 组（语义分组）。懒加载一次，`invalidate()` 后重读。
   *
   * 分组表是 15064 行的派生数据，只有按大类筛时才需要 —— 不带 `category`
   * 的查询不该为它付解析成本。
   */
  groups: () => Map<string, string[]>
  /** 组 → 大类映射。与 `groups()` 一起懒加载。 */
  categoryMap: () => CategoryMap
}

/**
 * 建一个简单的内存缓存。
 *
 * 四类 JSONL 加起来约 20 MB，查询是纯字符串匹配 —— 每轮工具调用都重读磁盘没必要，
 * 但同步完必须失效，所以留一个 invalidate。
 *
 * @param dataDir - 插件数据目录。
 */
export function createTagCache(dataDir: string): TagCache {
  const cache = new Map<string, { records: TagRecord[]; index: TagIndex<TagRecord> }>()
  let groupCache: Map<string, string[]> | null = null
  let mapCache: CategoryMap | null = null
  const load = (kind: TagKind): { records: TagRecord[]; index: TagIndex<TagRecord> } => {
    const hit = cache.get(kind)
    if (hit !== undefined) return hit
    const records = readStore(storePath(dataDir, kind))
    const entry = { records, index: new TagIndex(records) }
    cache.set(kind, entry)
    return entry
  }
  return {
    read: kind => load(kind).records,
    search: (kind, query, limit = 10) => load(kind).index.search(query, limit).map(match => ({ record: match.record as TagRecord, how: match.how })),
    invalidate: kind => {
      if (kind === undefined) cache.clear()
      else cache.delete(kind)
      // 分组表与 tag 数据是两条同步线，但分类依赖 tag 名，一并丢弃更省心
      groupCache = null
      mapCache = null
    },
    groups: () => {
      groupCache ??= readGroups(dataDir)
      return groupCache
    },
    categoryMap: () => {
      mapCache ??= readCategoryMap(dataDir)
      return mapCache
    },
  }
}

const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/
const CATEGORY = { character: 4, artist: 1, copyright: 3, general: 0 } as const

interface RawTag { name?: unknown; post_count?: unknown; category?: unknown }

/**
 * 本地库没有命中时，直接问 Danbooru。
 *
 * 两条入口，按 query 形态分流：
 * - 含中文/日文 → `search[other_names_match]`：Danbooru 唯一能按别名反查的字段
 *   （`body_matches` 会匹配 wiki 正文，实测返回不相干条目）。wiki 返回顺序不代表热度，
 *   所以拿候选后回查 `post_count` 取最热的那条 —— 否则同一个名字本地查和在线查会给出不同答案。
 * - 纯 ASCII → `search[name_matches]=*q*` 模糊匹配 tag 名；被拒时退回精确 `search[name]`。
 *
 * @param query - 用户给的名字。
 * @param limit - 最多几条。
 * @param kind - 限定某一类；不传则四类都试。
 */
export async function searchOnline(
  query: string,
  limit: number,
  kind?: TagKind,
): Promise<string[]> {
  return (await searchOnlineDetailed(query, limit, kind)).tags
}

/** 在线查询结果：区分"查无此人"与"被限流"，两者对用户的含义完全不同。 */
export interface OnlineResult {
  tags: string[]
  /** 是否遇到过 429 —— 此时"没找到"其实可能是"没查成"。 */
  throttled: boolean
}

/**
 * 同 {@link searchOnline}，但把限流状态一并带出来。
 *
 * @param query - 用户给的名字。
 * @param limit - 最多几条。
 * @param kind - 限定某一类。
 */
export async function searchOnlineDetailed(
  query: string,
  limit: number,
  kind?: TagKind,
): Promise<OnlineResult> {
  const trimmed = query.trim()
  if (trimmed === '') return { tags: [], throttled: false }
  const kinds: readonly TagKind[] = kind === undefined ? TAG_KINDS : [kind]
  const out: string[] = []
  const seen = new Set<string>()
  const push = (name: unknown): void => {
    if (typeof name !== 'string' || name === '' || seen.has(name)) return
    seen.add(name)
    out.push(name)
  }

  let throttled = false
  for (const one of kinds) {
    try {
      if (CJK.test(trimmed)) {
        const res = await fetchJson(`/wiki_pages.json?search[other_names_match]=${encodeURIComponent(trimmed)}&limit=5`)
        if (res.status === 429) throttled = true
        if (res.ok) {
          const body = (await res.json()) as Array<{ title?: unknown }>
          const titles = (Array.isArray(body) ? body : [])
            .map(page => page.title)
            .filter((title): title is string => typeof title === 'string' && title !== '')
          const ranked: Array<{ title: string; postCount: number; category: unknown }> = []
          for (const title of titles.slice(0, 5)) {
            try {
              const check = await fetchJson(`/tags.json?search[name]=${encodeURIComponent(title)}&limit=1`)
              if (check.status === 429) throttled = true
              if (!check.ok) continue
              const rows = (await check.json()) as RawTag[]
              const row = Array.isArray(rows) ? rows[0] : undefined
              if (row === undefined) continue
              ranked.push({ title, postCount: typeof row.post_count === 'number' ? row.post_count : 0, category: row.category })
            } catch {
              // 单条查不到就跳过
            }
          }
          ranked.sort((a, b) => b.postCount - a.postCount)
          // wiki 页不带分类；指定了 kind 就必须过滤，否则查画师会返回角色
          const best = ranked.find(row => kind === undefined || row.category === CATEGORY[one])
          if (best !== undefined) push(best.title)
        }
      } else {
        const res = await fetchJson(
          `/tags.json?search[name_matches]=*${encodeURIComponent(trimmed)}*&search[category]=${CATEGORY[one]}&search[order]=count&limit=${limit}`,
        )
        if (res.status === 429) throttled = true
        if (res.ok) {
          const body = (await res.json()) as RawTag[]
          if (Array.isArray(body)) for (const tag of body) push(tag.name)
        } else if (res.status === 404) {
          const exact = await fetchJson(`/tags.json?search[name]=${encodeURIComponent(trimmed)}&limit=${limit}`)
          if (exact.ok) {
            const body = (await exact.json()) as RawTag[]
            if (Array.isArray(body)) for (const tag of body) push(tag.name)
          }
        }
      }
    } catch (error) {
      // 所有镜像都失败：429 是限流（换个时间就好），其余是网络问题
      if ((error as { status?: unknown }).status === 429) throttled = true
    }
  }

  // 全局再排一次：kind=all 时两类各查一轮，只在循环内排序会被循环次序打乱
  // （`wlop` 的精确 tag 属于画师，会被角色的 `black-haired_girl_(wlop)` 顶到后面）。
  // 比较前把空格与下划线归一：`hatsune miku` 与 `hatsune_miku` 算同一个。
  const norm = (value: string): string => value.trim().toLowerCase().replace(/[\s_]+/g, '_')
  const target = norm(trimmed)
  out.sort((a, b) => Number(norm(b) === target) - Number(norm(a) === target))
  return { tags: out.slice(0, limit), throttled }
}

/**
 * `danbooru_lookup`：按中文名或 Danbooru tag 查角色 / 画师，**只返回 tag**。
 *
 * 输出刻意压到最小：模型要的是"这个名字对应哪个 tag"，多给字段只是占上下文。
 * 本地库为空或没命中时自动走 Danbooru 在线查询，所以没同步过也能用。
 *
 * @param deps - 依赖（数据目录 + 缓存）。
 */
export function danbooruLookupTool(deps: DanbooruDeps & { cache: TagCache }): ToolSpec {
  return {
    name: 'danbooru_lookup',
    description:
      '把角色 / 画师的名字转成 Danbooru 能认的 tag。给中文名（甘雨、初音未来）、日文名（初音ミク）或 tag 本身都行，'
      + '返回可直接写进提示词的 tag 列表。写提示词前用它对齐名字，能显著减少生图时角色跑偏。'
      + '**给 query 查一个（会联网兜底），给 queries 查一批（只查本地）** —— 两件事合在一个工具里，'
      + '因为"查名字"这个动作没有"先查一个再查一批"的顺序。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要查的**单个**名字：中文名、日文名或 Danbooru tag，如「甘雨」「初音ミク」「hatsune_miku」。没命中会自动联网兜底。给 queries 时忽略。',
        },
        queries: {
          type: 'array',
          items: { type: 'string' },
          description:
            `要查的**一批**名字，最多 ${MAX_BATCH_QUERIES} 个，且**只查本地库、不联网** ——`
            + '一次查几十个还逐个联网会慢且容易限流；缺哪个再用单个 query 补（那条会自动走在线）。',
        },
        kind: {
          type: 'string',
          enum: ['character', 'artist', 'copyright', 'general', 'all'],
          description: '限定类别：角色 / 画师 / 作品 / 通用（动作、服装、外貌等）。默认 all 查全部四类。',
        },
        category: {
          type: 'string',
          enum: ['action', 'clothing', 'appearance', 'composition', 'object', 'theme', 'explicit', 'other'],
          description: '按语义大类筛（只对 general 有效，且**只对单个 query 生效**）：action 动作 / clothing 服装 / appearance 外貌 / composition 构图 / object 物件 / theme 主题 / explicit 性相关 / other 其它。分类来自 Danbooru 的 tag group，覆盖 30693 个通用标签里的约 26.9%（8261 条），筛不到时去掉这个参数重试。',
        },
        limit: {
          type: 'integer',
          description: '每个名字最多返回几个 tag：单个 query 默认 5、上限 20；批量 queries 默认 3、上限 10。',
        },
      },
      required: [],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args) => {
      // 批量路径先分派：给了 queries 就是批量（只查本地，不联网）
      const queries = Array.isArray(args.queries) ? args.queries : []
      if (queries.length > 0) {
        // category 的筛选逻辑只在单条路径实现（要读 tag group）。批量时静默忽略它，
        // 会得到"看起来筛过了其实没筛"的结果 —— 那比报错更误导，单条路径的注释里也写着这句。
        if (asString(args.category, '').trim() !== '') {
          return {
            ok: false,
            error: 'category 只对单个 query 生效（批量只查本地库，不按语义大类筛）。'
              + '要按 category 筛就逐个查；批量时去掉这个参数即可。',
          }
        }
        return batchLookup(deps, args)
      }

      const query = asString(args.query)
      const kindArg = asString(args.kind, 'all')
      const categoryArg = asString(args.category, '').trim()
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20)
      if (query === '') {
        return { ok: false, error: '要查什么？给 query（单个名字，会联网兜底）或 queries（一批名字，只查本地）。' }
      }

      const kinds: readonly TagKind[] = TAG_KINDS.includes(kindArg as TagKind) ? [kindArg as TagKind] : TAG_KINDS

      // 枚举要校验：否则 `clothingx` 会被当合法类名回显，用户以为筛过了
      const knownCategories = Object.keys(deps.cache.categoryMap().labels)
      if (categoryArg !== '' && knownCategories.length > 0 && !knownCategories.includes(categoryArg)) {
        return {
          ok: false,
          error: `category 只能是 ${knownCategories.join(' / ')}，收到「${categoryArg}」。`,
        }
      }

      const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 } as Record<string, number>
      // 收集时带上档位：跨 kind 要统一排序，只留 tag 名会把档位信息丢掉 ——
      // 查 `wlop` 时角色库里某个"别名含 wlop"的会压过画师库里 tag 名就叫 wlop 的那个。
      const hits: Array<{ tag: string; how: string; postCount: number }> = []

      // 带 category 时先多取候选**再**筛：按 limit 截断在前会造出假筛空
      // （实测 limit=1 时 long/clothing 报"没有匹配"，limit=3 立刻有 long_sleeves）
      const searchLimit = categoryArg === '' ? limit : Math.max(limit * 10, 100)
      for (const kind of kinds) {
        for (const match of deps.cache.search(kind, query, searchLimit)) {
          hits.push({ tag: match.record.tag, how: match.how, postCount: match.record.postCount })
        }
      }
      hits.sort((a, b) => {
        const byHow = (rank[a.how] ?? 4) - (rank[b.how] ?? 4)
        return byHow !== 0 ? byHow : b.postCount - a.postCount
      })

      // 按语义大类筛。分类只来自 Danbooru 的 tag group，只覆盖 `general` 的一部分
      // （直接命中 8261/30693 ≈ 26.9%）—— 所以筛不到时要**说清是筛掉的**，
      // 不能让它掉进"没找到"或"去问在线"（在线结果根本没有分类信息）。
      let kept = hits
      if (categoryArg !== '') {
        const groupMap = deps.cache.groups()
        const categoryMap = deps.cache.categoryMap()
        const label = categoryMap.labels[categoryArg] ?? categoryArg
        kept = hits.filter(hit => categoryOf(groupMap.get(hit.tag) ?? [], categoryMap) === categoryArg)
        if (kept.length === 0) {
          // 只查了角色 / 画师 / 作品时，问题不在"分类覆盖不全"而在"这几类根本没有分类"
          const generalOnly = !kinds.includes('general')
          return {
            ok: false,
            error: generalOnly
              ? `「${label}」这个分类只作用于通用（general）标签，而这次查的是角色 / 画师 / 作品 —— 它们本身已经是分类，没有更细的组。去掉 category 或加 kind:'general' 再试。`
              : `「${query.trim()}」在「${label}」类里没有匹配。分类来自 Danbooru 的 tag group，`
                + `只覆盖 30693 个通用标签里的约 26.9%（ponytail、braid 这种最常见的词都不在 wiki 分组里）；`
                + `去掉 category 参数再查一次通常就有了。`,
          }
        }
      }

      const found: string[] = kept.map(hit => hit.tag)

      // 本地没命中（或压根没同步过）→ 直接问 Danbooru。
      // **带 category 时不走在线**：Danbooru 的 tags 接口没有分组维度，回来的一批
      // 会绕过筛选 —— 那比"查不到"更误导（用户以为筛过了）。
      let source: 'local' | 'online' = 'local'
      let throttled = false
      if (found.length === 0 && categoryArg === '') {
        source = 'online'
        const only = TAG_KINDS.includes(kindArg as TagKind) ? (kindArg as TagKind) : undefined
        const online = await searchOnlineDetailed(query, limit, only)
        throttled = online.throttled
        found.push(...online.tags)
      }
      if (found.length === 0 && categoryArg !== '') {
        return {
          ok: false,
          error: `本地库里没有「${query.trim()}」，而带 category 时不会去问在线接口（它没有分组维度）。`
            + `要么去掉 category，要么先跑一次 npm run danbooru:zh 把标签库更新到最新。`,
        }
      }

      const tags = [...new Set(found)].slice(0, limit)
      if (tags.length === 0) {
        // 被限流和查无此人对用户是两件事：前者该重试，后者该换个写法
        return {
          ok: false,
          error: throttled
            ? `Danbooru 正在限流，这次没查成（不是名字的问题）。稍后再试，或先跑一次 danbooru_sync 把常用标签落到本地。`
            : `没找到「${query.trim()}」。试试日文原名或只用一部分名字。`,
        }
      }
      return { ok: true, tags, source }
    },
  }
}
