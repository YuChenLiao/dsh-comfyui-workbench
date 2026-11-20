/** 资产库认的图片扩展名。 */
export const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.bmp'])

/**
 * 视频扩展名。
 *
 * 出图工作流偶尔会顺带产出视频（AnimateDiff、SVD 这类），把它们排除在资产库之外
 * 意味着"生成了却看不见"—— 而用户往往正是想找那段动图。
 */
export const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov', '.mkv', '.avi'])

/** 音频扩展名。 */
export const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.ogg', '.m4a'])

/** 资产库认的全部媒体扩展名（扫描与删除校验都用它）。 */
export const MEDIA_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, ...AUDIO_EXTS])

/** 一种媒体的类别。 */
export type MediaKind = 'image' | 'video' | 'audio'

/**
 * 扩展名 → 媒体类别；认不出来返回 `undefined`。
 *
 * 卡片与灯箱据此决定渲染 `<img>` / `<video>` / `<audio>` —— 把视频塞进 `<img>`
 * 只会得到一张破图图标，而它本来是可以直接播的。
 */
export function mediaKindOf(ext: string): MediaKind | undefined {
  const lower = ext.toLowerCase()
  if (IMAGE_EXTS.has(lower)) return 'image'
  if (VIDEO_EXTS.has(lower)) return 'video'
  if (AUDIO_EXTS.has(lower)) return 'audio'
  return undefined
}

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
