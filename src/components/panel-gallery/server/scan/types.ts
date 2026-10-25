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
  negativePrompt?: string
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
  workflow?: boolean
  [key: string]: unknown
}

/** 列表项：文件信息 + 元数据摘要 + 所属根目录。 */
export type ListItem = ImageRecord & SummaryFields & { root: string }
