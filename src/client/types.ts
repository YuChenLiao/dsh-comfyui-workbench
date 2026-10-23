/** 资产库列表里的一条。字段来自宿主 /items，未列出的是 sidecar 里的可选字段。 */
export interface GalleryItem {
  path: string
  name: string
  dir?: string
  root?: string
  size?: number
  mtime?: number
  hasMeta?: boolean
  prompt?: string
  negativePrompt?: string
  seed?: number
  width?: number
  height?: number
  steps?: number
  cfgScale?: number
  strength?: number
  samplerName?: string
  scheduler?: string
  checkpoint?: string
  mode?: string
  createdAt?: string
  duplicateCount?: number
  duplicates?: string[]
  [key: string]: unknown
}

/** 一个授权根目录（宿主 /roots 返回）。 */
export interface RootEntry {
  path: string
  label: string
  kind?: string
  id?: string
}

/** 轻提示。 */
export interface Notice {
  kind: 'ok' | 'err'
  text: string
}

/** 卡片与灯箱上的动作。 */
export type ActionKind = 'copyImage' | 'copyPrompt' | 'exportWorkflow' | 'addToChat' | 'remove'

/** 每个请求要拿多少条。 */
export const PAGE = 60
