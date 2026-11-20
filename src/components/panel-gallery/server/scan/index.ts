/**
 * scan 域：从磁盘与图片内嵌数据里读出"这是什么产物"。
 *
 * 只依赖 `node:*`，不依赖宿主、不依赖 HTTP、不依赖 UI —— 整个插件里最底层的一层，
 * 上层可以 import 它，它不 import 任何人。
 */
export { IMAGE_EXTS, MIME_BY_EXT, SIDECAR_MAX_BYTES, SKIP_DIRS } from './constants.js'
export { collectImages } from './collect.js'
export { extractFromGraph, modelFromWorkflow } from './graph.js'
export { hasEmbeddedPromptHint, readEmbeddedMeta } from './embedded.js'
export { clearMetaCache, forgetMeta, readFullSidecar, readMeta, readSidecar, sidecarPathOf } from './sidecar.js'
export { metaSummary } from './summary.js'
export { toListItem } from './list-item.js'
export { mimeOf } from './mime.js'
// PNG 文本块解析只有一份，在 shared/media 里（工作流导入也要用同一份）；
// 这里转发是为了让相册侧保持 `scan/index.js` 这个入口不变。
export { readPngTextChunks } from '../../../../shared/media/png-text.js'
export type { ExtractedGraph } from './graph.js'
export type { ImageRecord, ListItem, MetaRecord, ScanOptions, ScanResult, SummaryFields } from './types.js'
