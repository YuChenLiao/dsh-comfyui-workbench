/**
 * `danbooru_lookup_batch`：一次查多个名字。
 *
 * 单个 `danbooru_lookup` 每次都要走一遍"两次 kind 查询 + 跨 kind 排序"，而索引建好
 * 之后单次查询只要 0.5 ms 上下。批量查询把这层固定开销摊销掉 —— 查 10 个名字几乎
 * 和查 1 个同价。
 *
 * 与 `danbooru_lookup` 的另一个差别：**批量时不走在线兜底**。一次查 20 个名字，
 * 每个都去网上找一遍会很慢、而且容易被限流；批量只给本地结果，缺哪些由调用方
 * 自己用单条工具补。
 */
import { asString } from '../../../shared/tools/types.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { TagCache } from './lookup.js'

/** 一次最多查几个名字。 */
const MAX_QUERIES = 50

/** 单个名字的查询结果。 */
interface BatchHit {
  query: string
  tags: string[]
  /** 命中的档位（第一个 tag 的匹配方式）。 */
  how?: string
  /** 该名字是否命中。 */
  found: boolean
}

/**
 * 造工具。
 *
 * @param deps - 数据目录与缓存。
 */
export function danbooruLookupBatchTool(deps: { cache: TagCache; logger?: LoggerLike | undefined }): ToolSpec {
  return {
    name: 'danbooru_lookup_batch',
    description:
      '一次查多个角色 / 画师名字，返回每个名字对应的 Danbooru tag。'
      + '适合写提示词前批量对齐名字（一次 5~20 个）。'
      + '**只查本地库，不联网兜底** —— 缺哪个再用单条的 danbooru_lookup 补（那个会自动走在线）。'
      + `每次最多 ${MAX_QUERIES} 个名字。`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['queries'],
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          description: `要查的名字列表（中文名 / 日文名 / tag 都行），最多 ${MAX_QUERIES} 个。`,
        },
        kind: {
          type: 'string',
          enum: ['character', 'artist', 'all'],
          description: '查角色还是画师，默认 all。',
        },
        limit: { type: 'integer', description: '每个名字最多返回几个 tag，默认 3，上限 10。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const raw = Array.isArray(args.queries) ? args.queries : []
      const queries = raw
        .map(item => asString(item).trim())
        .filter(query => query !== '')
        // 去重但保持顺序：同一个名字查两遍没有意义，且会让输出翻倍
        .filter((query, index, all) => all.indexOf(query) === index)

      if (queries.length === 0) return { ok: false, error: 'queries 不能为空，至少要给一个名字。' }
      if (queries.length > MAX_QUERIES) {
        return { ok: false, error: `一次最多查 ${MAX_QUERIES} 个名字，收到 ${queries.length} 个。请分批。` }
      }

      const kindArg = asString(args.kind, 'all')
      const kinds: Array<'character' | 'artist'> = kindArg === 'character'
        ? ['character']
        : kindArg === 'artist' ? ['artist'] : ['character', 'artist']
      const limit = Math.min(Math.max(Number(args.limit ?? 3) || 3, 1), 10)
      const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 } as Record<string, number>

      const results: BatchHit[] = []
      for (const query of queries) {
        const hits: Array<{ tag: string; how: string; postCount: number }> = []
        for (const kind of kinds) {
          for (const match of deps.cache.search(kind, query, limit)) {
            hits.push({ tag: match.record.tag, how: match.how, postCount: match.record.postCount })
          }
        }
        // 与单条工具同一套排序规则：档位优先，同档按热度
        hits.sort((a, b) => {
          const byHow = (rank[a.how] ?? 4) - (rank[b.how] ?? 4)
          return byHow !== 0 ? byHow : b.postCount - a.postCount
        })
        const seen = new Set<string>()
        const tags: string[] = []
        for (const hit of hits) {
          if (seen.has(hit.tag)) continue
          seen.add(hit.tag)
          tags.push(hit.tag)
          if (tags.length >= limit) break
        }
        results.push({
          query,
          tags,
          ...(hits[0] === undefined ? {} : { how: hits[0].how }),
          found: tags.length > 0,
        })
      }

      const missing = results.filter(item => !item.found).map(item => item.query)
      return {
        ok: true,
        count: results.length,
        found: results.length - missing.length,
        results,
        ...(missing.length === 0
          ? {}
          : {
            missing,
            hint: `这 ${missing.length} 个名字本地库里没有。用单条 danbooru_lookup 查会自动走在线，或先跑 danbooru_sync。`,
          }),
      }
    },
  }
}
