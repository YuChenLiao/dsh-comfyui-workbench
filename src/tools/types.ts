import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'
import type { AssetIndex } from '../store/index.js'

/** 文本块。 */
export interface ToolText {
  type: 'text'
  text: string
}

/** 图片块（MCP 风格：base64 + mimeType）。宿主若不支持会被忽略，文本块仍然有效。 */
export interface ToolImage {
  type: 'image'
  data: string
  mimeType: string
}

/** 工具响应块。 */
export type ToolBlock = ToolText | ToolImage

/** 宿主要求的输出声明。 */
export interface ToolOutput {
  schema: Record<string, unknown>
  render: (args: unknown, value: unknown) => ToolBlock[]
}

/** 工具规格（形状对齐 memory-ledger 的 ToolSpec）。 */
export interface ToolSpec {
  name: string
  description: string
  parameters: Record<string, unknown>
  output: ToolOutput
  execute: (args: Record<string, unknown>) => Promise<unknown>
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
