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
export type ActionKind = 'copyImage' | 'copyPrompt' | 'exportWorkflow' | 'addToChat' | 'describe' | 'remove'

/** 工作流列表项（GET /workflows 的 items）。 */
export interface WorkflowListItem {
  workflowId: string
  title: string
  description: string
  undescribed?: boolean
  model: string
  modelKind: string
  otherModels: string[]
  inputKinds: string[]
  inputCount: number
  basicCount: number
  outputs: Array<{ kind: string; count: number | string }>
  nodes: number
  workflowHash: string
}

/** 一个输入槽位（GET /workflows/{id} 的 surface.inputs）。 */
export interface SurfaceSlot {
  name: string
  bind?: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'image' | 'mask'
  required: boolean
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  options?: string[]
  group: 'basic' | 'advanced'
  hint?: string
  secret?: boolean
}

/** 单份工作流的 IO 面。 */
export interface WorkflowSurface {
  workflowId: string
  title: string
  description: string
  workflowHash: string
  models: Array<{ name: string; kind: string; primary?: boolean }>
  inputs: SurfaceSlot[]
  outputs: Array<{ nodeId: string; key: string; kind: string; count: number | string; label?: string }>
  meta: { nodeCount: number; missingNodes: string[]; source: 'declared' | 'inferred' }
}

/** 直接运行的结果（direct 模式）。 */
export interface DirectRunResult {
  ok: boolean
  promptId?: string
  durationMs?: number
  artifacts?: Array<{ path: string; digest: string; mime: string; bytes: number; width?: number; height?: number }>
  effectiveVars?: Record<string, unknown>
  notes?: string[]
  message?: string
  hint?: string
  code?: string
}

/** 每个请求要拿多少条。 */
export const PAGE = 60
