/** 资产库认的图片扩展名。 */
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])

/**
 * 扫描时跳过的目录：版本库、依赖、归档区、回收站。
 *
 * `.trash` 必须在里面 —— 否则软删除的图会立刻以"新图"的身份重新出现在列表里，
 * 用户看到的是"删了还在"。
 */
export const SKIP_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  '.dsh',
  '.archive',
  '.trash',
])

/** sidecar 体积上限：自定义工作流可能很大，但读进内存要有界。 */
export const SIDECAR_MAX_BYTES = 8 * 1024 * 1024

/** PNG 元数据只读文件头这一段：文本块都在 IDAT 之前。 */
export const PNG_META_READ_BYTES = 64 * 1024

/** 扩展名 → MIME。 */
export const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
}
