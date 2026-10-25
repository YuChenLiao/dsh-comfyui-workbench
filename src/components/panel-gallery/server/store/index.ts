/**
 * store 域：资产索引（追加式 JSONL，可删可重建）。
 *
 * 索引是**派生**：真源是产物旁边的 `<文件>.json` sidecar。所以这里不需要事务、
 * 不需要迁移，坏了删掉重建即可。
 */
export { AssetIndex, indexPath } from './index-file.js'
export type { AssetQuery, AssetRecord, AssetStatus } from './index-file.js'
export { rebuildFromSidecars } from './rebuild.js'
