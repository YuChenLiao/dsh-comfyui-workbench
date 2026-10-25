import { readStore, searchTags, storePath } from '../server/store.js'
import type { TagRecord } from '../server/store.js'
import { asString } from '../../../shared/tools/types.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'

/** 本组工具的依赖：只要数据目录，不碰 ComfyUI。 */
export interface DanbooruDeps {
  /** 插件数据目录（标签库落在其下的 danbooru/）。 */
  dataDir: string
  logger?: LoggerLike | undefined
}

/** 带缓存地读两类标签库。 */
export interface TagCache {
  read: (kind: 'character' | 'artist') => TagRecord[]
  invalidate: (kind?: 'character' | 'artist') => void
}

/**
 * 建一个简单的内存缓存。
 *
 * 两份 JSONL 加起来几 MB，查询是纯字符串匹配 —— 每轮工具调用都重读磁盘没必要，
 * 但同步完必须失效，所以留一个 invalidate。
 *
 * @param dataDir - 插件数据目录。
 */
export function createTagCache(dataDir: string): TagCache {
  const cache = new Map<string, TagRecord[]>()
  return {
    read: kind => {
      const hit = cache.get(kind)
      if (hit !== undefined) return hit
      const loaded = readStore(storePath(dataDir, kind))
      cache.set(kind, loaded)
      return loaded
    },
    invalidate: kind => {
      if (kind === undefined) cache.clear()
      else cache.delete(kind)
    },
  }
}

const BASE = 'https://danbooru.donmai.us'
const UA = 'dsh-comfyui-workbench (+https://github.com/YuChenLiao/dsh-comfyui-workbench)'
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/
const CATEGORY = { character: 4, artist: 1 } as const

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
 * @param kind - 限定角色或画师；不传则两类都试。
 */
export async function searchOnline(
  query: string,
  limit: number,
  kind?: 'character' | 'artist',
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
 * @param kind - 限定角色或画师。
 */
export async function searchOnlineDetailed(
  query: string,
  limit: number,
  kind?: 'character' | 'artist',
): Promise<OnlineResult> {
  const trimmed = query.trim()
  if (trimmed === '') return { tags: [], throttled: false }
  const kinds: Array<'character' | 'artist'> = kind === undefined ? ['character', 'artist'] : [kind]
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
        const res = await fetch(`${BASE}/wiki_pages.json?search[other_names_match]=${encodeURIComponent(trimmed)}&limit=5`, { headers: { 'User-Agent': UA } })
        if (res.status === 429) throttled = true
        if (res.ok) {
          const body = (await res.json()) as Array<{ title?: unknown }>
          const titles = (Array.isArray(body) ? body : [])
            .map(page => page.title)
            .filter((title): title is string => typeof title === 'string' && title !== '')
          const ranked: Array<{ title: string; postCount: number; category: unknown }> = []
          for (const title of titles.slice(0, 5)) {
            try {
              const check = await fetch(`${BASE}/tags.json?search[name]=${encodeURIComponent(title)}&limit=1`, { headers: { 'User-Agent': UA } })
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
        const res = await fetch(
          `${BASE}/tags.json?search[name_matches]=*${encodeURIComponent(trimmed)}*&search[category]=${CATEGORY[one]}&search[order]=count&limit=${limit}`,
          { headers: { 'User-Agent': UA } },
        )
        if (res.status === 429) throttled = true
        if (res.ok) {
          const body = (await res.json()) as RawTag[]
          if (Array.isArray(body)) for (const tag of body) push(tag.name)
        } else if (res.status === 404) {
          const exact = await fetch(`${BASE}/tags.json?search[name]=${encodeURIComponent(trimmed)}&limit=${limit}`, { headers: { 'User-Agent': UA } })
          if (exact.ok) {
            const body = (await exact.json()) as RawTag[]
            if (Array.isArray(body)) for (const tag of body) push(tag.name)
          }
        }
      }
    } catch {
      // 网络失败就用已有的
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
      + '返回可直接写进提示词的 tag 列表。写提示词前用它对齐名字，能显著减少生图时角色跑偏。',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: '要查的名字：中文名、日文名或 Danbooru tag，如「甘雨」「初音ミク」「hatsune_miku」。',
        },
        kind: {
          type: 'string',
          enum: ['character', 'artist', 'all'],
          description: '查角色还是画师，默认 all。',
        },
        limit: { type: 'integer', description: '最多返回几个 tag，默认 5，上限 20。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args) => {
      const query = asString(args.query)
      const kindArg = asString(args.kind, 'all')
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20)
      if (query === '') return { ok: false, error: 'query 不能为空' }

      const kinds: Array<'character' | 'artist'> = kindArg === 'character' ? ['character'] : kindArg === 'artist' ? ['artist'] : ['character', 'artist']
      const found: string[] = []
      const rank = { exact: 0, prefix: 1, contains: 2 } as Record<string, number>

      for (const kind of kinds) {
        const records = deps.cache.read(kind)
        const matches = searchTags(records, query, limit).sort((a, b) => {
          const byHow = (rank[a.how] ?? 3) - (rank[b.how] ?? 3)
          return byHow !== 0 ? byHow : b.record.postCount - a.record.postCount
        })
        for (const match of matches) found.push(match.record.tag)
      }

      // 本地没命中（或压根没同步过）→ 直接问 Danbooru
      let source: 'local' | 'online' = 'local'
      let throttled = false
      if (found.length === 0) {
        source = 'online'
        const only = kindArg === 'character' ? 'character' : kindArg === 'artist' ? 'artist' : undefined
        const online = await searchOnlineDetailed(query, limit, only)
        throttled = online.throttled
        found.push(...online.tags)
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
