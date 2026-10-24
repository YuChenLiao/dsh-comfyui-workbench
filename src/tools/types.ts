import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'
import type { AssetIndex } from '../store/index.js'

/** 文本块。 */
export interface ToolText {
  type: 'text'
  text: string
}

/**
 * 工具响应块：只有文本。
 *
 * MCP 风格的 `{ type: 'image', data, mimeType }` 块不是宿主认可的模型内容：请求装配按
 * `{ type: 'image', attachment }` 重建请求，裸 base64 块会让它读到空 attachment 而抛错，
 * 被 LLM 适配器包装成 TRANSPORT 失败；该块一旦落进会话历史，之后每次请求都失败。
 * 图片只能以文件路径交付。
 */
export type ToolBlock = ToolText

/** 宿主要求的输出声明。 */
export interface ToolOutput {
  schema: Record<string, unknown>
  render: (args: unknown, value: unknown) => ToolBlock[]
}

/** 执行上下文：宿主在调用时给的会话信息（只用到 agent）。 */
export interface ToolExec {
  /** 发起这次调用的 Agent；有它就能把结果通知回对话。 */
  agent?: unknown
}

/** 工具规格（形状对齐 memory-ledger 的 ToolSpec）。 */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: ToolOutput
  execute: (args: Record<string, unknown>, exec?: ToolExec) => Promise<unknown>
}

/** 一次节点级参数覆盖（只作用于下一次运行，不写模板）。 */
export interface Override {
  nodeId: string
  input: string
  value: string | number | boolean
}

/** 工具执行需要的依赖。 */
export interface ToolDeps {
  client: ComfyClient
  workflowsDir: string
  outputDir: string
  timeoutMs: number
  pollIntervalMs: number
  /** workflowId → 下一次运行要应用的节点级覆盖。进程内有效，重启即清。 */
  overrides: Map<string, Override[]>
  /** 资产索引（运行成功后登记）。 */
  index: AssetIndex
  /** 输出目录校验（注入，避免 tools 直接依赖 assets）。 */
  assertWritable: (dir: string) => void
  logger?: LoggerLike | undefined
}

/** 统一输出：结果按 JSON 文本渲染。 */
export function jsonOutput(): ToolOutput {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [
      { type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) },
    ],
  }
}

/** 取字符串参数。 */
export function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 取数字参数（带上下界）。 */
export function asInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

/** 取对象参数。 */
export function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
