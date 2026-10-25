import { syncKind } from '../server/sync.js'
import type { SyncOptions, SyncProgress } from '../server/sync.js'
import { readStore, storePath } from '../server/store.js'
import { asString, jsonOutput } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { DanbooruDeps, TagCache } from './lookup.js'

/** 同步默认参数，可在调用时覆盖。 */
export interface SyncDefaults {
  minPostCount: number
  pageSize: number
  maxTags: number
  concurrency: number
}

/**
 * 跑一次同步并给出可读结果。
 *
 * 同步是长活（几千条 × 每条约 150ms），所以工具层限制单次规模：默认只拉热门段，
 * 想全量就让用户显式抬 `minPostCount` 反过来（越低越多）。
 *
 * @param deps - 依赖。
 * @param defaults - 默认参数。
 * @param kinds - 要同步哪几类。
 * @param overrides - 调用方覆盖。
 */
export async function runSync(
  deps: DanbooruDeps & { cache?: TagCache | undefined },
  defaults: SyncDefaults,
  kinds: Array<'character' | 'artist'>,
  overrides: { minPostCount?: number; maxTags?: number },
): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {}
  for (const kind of kinds) {
    let failed = 0
    const options: SyncOptions = {
      dataDir: deps.dataDir,
      minPostCount: overrides.minPostCount ?? defaults.minPostCount,
      pageSize: defaults.pageSize,
      maxTags: overrides.maxTags ?? defaults.maxTags,
      concurrency: defaults.concurrency,
      log: message => deps.logger?.info?.(`[danbooru] ${message}`),
      onProgress: (progress: SyncProgress) => { failed = progress.failed },
    }
    const records = await syncKind(kind, options)
    result[kind] = {
      total: records.length,
      withNames: records.filter(record => record.names.length > 0).length,
      // 真实失败数（wiki 查询没成功）。不要用"没有别名的条数"代替 —— 画师类
      // 天生没有别名，那样报出来会让模型以为"全量查询失败"并重跑一次。
      failed,
      top: records.slice(0, 3).map(record => record.tag),
    }
    deps.cache?.invalidate(kind)
  }
  return result
}

/**
 * `danbooru_sync`：把角色 / 画师标签抓到本地。
 *
 * 只让模型在用户明确要求时调用 —— 这是几千次网络请求，不该被顺手触发。
 *
 * @param deps - 依赖（数据目录 + 缓存）。
 * @param defaults - 默认参数。
 */
export function danbooruSyncTool(deps: DanbooruDeps & { cache: TagCache }, defaults: SyncDefaults): ToolSpec {
  return {
    name: 'danbooru_sync',
    description:
      '从 Danbooru 同步角色 / 画师标签与它们的其它写法（含中文名）到本地库，让 danbooru_lookup 更快、更准。'
      + '这是一次几千条网络请求的耗时操作，**只在用户明确要求或需要批量查询时调用**。'
      + '注意：不同步 danbooru_lookup 也能用（它会自动走在线查询），只是每次都要联网、慢一些。',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['character', 'artist', 'all'],
          description: '同步哪一类，默认 all。',
        },
        minPostCount: {
          type: 'integer',
          description: `热度下限，低于它的 tag 不收录（越少越快）。默认 ${defaults.minPostCount}。`,
        },
        maxTags: { type: 'integer', description: `单类最多收录多少条，默认 ${defaults.maxTags}，0 表示不限。` },
      },
      additionalProperties: false,
    },
    output: jsonOutput(),
    execute: async (args) => {
      const kindArg = asString(args.kind, 'all')
      const kinds: Array<'character' | 'artist'> = kindArg === 'character' ? ['character'] : kindArg === 'artist' ? ['artist'] : ['character', 'artist']
      // 0 是合法值（不限热度），不能用 `|| ` 兜底 —— 那会把 0 吞成默认值
      const rawMin = typeof args.minPostCount === 'number' ? args.minPostCount : defaults.minPostCount
      const minPostCount = Number.isFinite(rawMin) ? Math.max(rawMin, 0) : defaults.minPostCount
      // 非法值退回默认，而不是兜成 0（0 = 不限，方向正好相反）
      const rawMax = typeof args.maxTags === 'number' ? args.maxTags : defaults.maxTags
      const maxTags = Number.isFinite(rawMax) ? Math.max(rawMax, 0) : defaults.maxTags

      try {
        const synced = await runSync(deps, defaults, kinds, { minPostCount, maxTags })
        return { ok: true, minPostCount, synced }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { ok: false, error: `同步失败：${message}` }
      }
    },
  }
}

