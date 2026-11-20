/**
 * 兼容层：图片相关的常量以 `shared/media/constants.ts` 为唯一实现。
 *
 * **这里曾经是一份完整副本**（`IMAGE_EXTS` / `SKIP_DIRS` / 体积上限全抄一遍），
 * 于是「给 `SKIP_DIRS` 加 `.trash`」加在了 shared 那份上，而扫描实际用的是这份 ——
 * 默认配置看不出来（`.trash` 以点开头，被"隐藏目录"规则顺手挡住了），
 * 一旦 `includeHidden: true`，软删除的图会重新出现在列表里，还会被索引重建收进去。
 * 与 `assets/authorize.ts`、`assets/roots.ts` 是同一个教训：只保留一个实现。
 */
export { AUDIO_EXTS, IMAGE_EXTS, MEDIA_EXTS, MIME_BY_EXT, SKIP_DIRS, SIDECAR_MAX_BYTES, VIDEO_EXTS, PNG_META_READ_BYTES, mediaKindOf } from '../../../../shared/media/constants.js'
export type { MediaKind } from '../../../../shared/media/constants.js'
