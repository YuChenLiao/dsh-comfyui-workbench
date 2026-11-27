/** 从 sidecar 或 PNG 内嵌块里读出来的元数据（形态与 sidecar 同）。 */
export type MetaRecord = Record<string, unknown>

/** 扫描到的一个图片文件。 */
export interface ImageRecord {
  path: string
  name: string
  dir: string
  size: number
  mtime: number
  /** 是否带 sidecar 或内嵌 prompt 块（即"生成图"）。 */
  generated?: boolean
}

/** 扫描上限。 */
export interface ScanOptions {
  maxDepth: number
  maxItems: number
  includeHidden: boolean
  /**
   * 扫描时额外跳过的目录名（与内置 `SKIP_DIRS` 合并使用）。
   *
   * 给「工作区里有个几百 GB 的素材/模型目录」这种场景留出口：内置名单不可能
   * 猜到每个用户的目录名，而让他去改源码不现实。
   */
  excludeDirs: readonly string[]
}

/** 一次根目录扫描的结果。 */
export interface ScanResult {
  files: ImageRecord[]
  truncated: boolean
  truncatedGenerated: boolean
  truncatedBare: boolean
}

/** 元数据摘要：列表项里来自 sidecar / 内嵌工作流的那些字段。 */
export interface SummaryFields {
  hasMeta: boolean
  metaSource?: string
  prompt?: string
  /** 列表里的 prompt 是否被截断（true 时灯箱与复制动作会回源 `/meta` 取全文）。 */
  promptClipped?: boolean
  negativePrompt?: string
  /** 列表里的 negativePrompt 是否被截断。 */
  negativePromptClipped?: boolean
  mode?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  strength?: number
  samplerName?: string
  scheduler?: string
  checkpoint?: string
  createdAt?: string
  /**
   * sidecar 里那次运行用的工作流 id。
   *
   * 检索要能用它筛：用户记得「这张是那个放大工作流出的」，但不记得 checkpoint。
   */
  workflowId?: string
  /**
   * 那次运行的标识（sidecar 的 `comfy.promptId`）。
   *
   * 列表去重要靠它——同 seed、同提示词跑两次是两张不同的图，不能合并。
   */
  promptId?: string
  workflow?: boolean
  /** 媒体类别：卡片与灯箱据此渲染 img / video / audio。 */
  kind?: 'image' | 'video' | 'audio'
  [key: string]: unknown
}

/** 列表项：文件信息 + 元数据摘要 + 所属根目录。 */
export type ListItem = ImageRecord & SummaryFields & { root: string }
