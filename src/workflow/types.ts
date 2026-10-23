/** 变量类型。enum 只能由 schema 手写 —— API 格式里 combo 值就是字符串，无从推断。 */
export type VarType = 'string' | 'number' | 'boolean' | 'enum' | 'image' | 'mask'

/** 一个输入槽位（用户/模型能改的东西）。 */
export interface IOSlot {
  /** 变量名，同时是 `{{name}}` 占位符。 */
  name: string
  /** `'6.inputs.text'`。有它就按节点路径精确替换；没有则退回全模板文本替换。 */
  bind?: string
  /** 界面上的显示名，默认取节点 title，再退到 `class_type.input`。 */
  label: string
  type: VarType
  required: boolean
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  /** type=enum 时的候选值。 */
  options?: string[]
  /** basic 才默认展示；advanced 折进"更多参数"。 */
  group: 'basic' | 'advanced'
  hint?: string
  /** 展示打码、日志与工具输出里替换为 [redacted]。 */
  secret?: boolean
}

/** 一个输出槽位（运行后产物落在哪）。 */
export interface OutputSlot {
  nodeId: string
  /** outputs 里的键，如 images。 */
  key: string
  kind: 'image' | 'video' | 'audio' | 'file'
  /** 运行前是估计，运行后以 /history 实际产物为准。 */
  count: number | 'dynamic'
  label?: string
}

/** 工作流引用的模型。用户与模型都靠它区分"同名但不同底模"的工作流。 */
export interface ModelRef {
  /** 模型文件名，保留 ComfyUI 里的相对路径原样（basename 化会让同名不同目录分不清）。 */
  name: string
  kind: 'checkpoint' | 'diffusion' | 'lora' | 'vae' | 'upscale' | 'other'
  /** 来源节点 id，便于下钻。 */
  nodeId: string
  /** 列表里只展示 primary；多模型工作流的其余项进 others。 */
  primary?: boolean
}

/** IO 面：UI 渲染它，模型阅读它，宿主内部另有完整配置。 */
export interface WorkflowIOSurface {
  workflowId: string
  title: string
  /** 一句话说明这工作流做什么。缺了它模型面对 prompt 无从下手。 */
  description: string
  /** 与完整配置绑定：模板一变 hash 就变，IO 面缓存同步失效。 */
  workflowHash: string
  models: ModelRef[]
  inputs: IOSlot[]
  outputs: OutputSlot[]
  meta: {
    nodeCount: number
    /** /object_info 预检未命中的 class_type。 */
    missingNodes: string[]
    /** declared = 有人工 schema；inferred = 从模板自动推断。 */
    source: 'declared' | 'inferred'
  }
}

/** API 格式里的一个节点。 */
export interface ApiNode {
  class_type?: unknown
  inputs: Record<string, unknown>
  _meta?: { title?: unknown }
  [key: string]: unknown
}

/** API 格式工作流：节点 id → 节点。 */
export type ApiWorkflow = Record<string, ApiNode>

/** 人工维护的元数据（`<id>.meta.json`，用户与模型都可写）。 */
export interface WorkflowMeta {
  title?: string
  description?: string
  tags?: string[]
  updatedAt?: string
  updatedBy?: 'user' | 'agent'
}

/** 人工维护的变量声明（`<id>.schema.json`）。只写要覆盖的部分。 */
export interface WorkflowSchema {
  title?: string
  description?: string
  vars?: Array<Partial<IOSlot> & { name: string }>
  /** 额外视为"内部参数"的 input 名（不暴露成变量）。 */
  internalInputs?: string[]
  /** 手工指定模型列表（自动提取覆盖不到时）。 */
  models?: Array<Partial<ModelRef> & { name: string }>
}
