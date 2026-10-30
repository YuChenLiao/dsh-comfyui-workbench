/**
 * Danbooru 标签库：把角色 / 画师的 Danbooru tag 与中文名对上，供模型查询。
 *
 * 与生图组件分开：它不碰 ComfyUI，只维护一份本地标签库（`<数据目录>/danbooru/*.jsonl`）。
 * 数据来自 Danbooru 的 tags + wiki 两个接口，同步是显式动作（几千次请求，不该被动触发）。
 */
export { createTagCache, danbooruLookupTool, searchOnline, searchOnlineDetailed } from './tools/lookup.js'
export { danbooruLookupBatchTool } from './tools/lookup-batch.js'
export type { DanbooruDeps, TagCache } from './tools/lookup.js'
export { danbooruSyncTool, runSync } from './tools/sync-tool.js'
export type { SyncDefaults } from './tools/sync-tool.js'
export { currentMirrors, fetchJson, getJson, MIRRORS, useMirrors, useTimeout } from './server/api.js'
export { TagIndex, searchTagsLinear } from './server/tag-index.js'
export type { IndexMatch, MatchHow } from './server/tag-index.js'
export { bundledDir, ownStorePath, pickNames, pruneSharedAliases, readStore, searchTags, storePath, worthKeeping, writeStore } from './server/store.js'
export type { Match, TagRecord } from './server/store.js'
export { syncKind } from './server/sync.js'
export type { SyncOptions, SyncProgress } from './server/sync.js'

/** 本组工具在 `disabledComponents` 里的开关名。 */
export const DANBOORU_COMPONENT = 'tool.danbooru'

/** 默认同步参数：先把热门段拉下来，够日常写提示词用。 */
export const DEFAULT_SYNC: { minPostCount: number; pageSize: number; maxTags: number; concurrency: number } = {
  minPostCount: 100,
  pageSize: 1000,
  maxTags: 3000,
  concurrency: 8,
}
