import type { AssetIndex } from '../../components/panel-gallery/server/store/index.js'
import type { ComfyClient } from '../comfy/index.js'
import type { LoggerLike } from '../host/types.js'

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

/**
 * 运行表的最小面。
 *
 * 与 `shared/run/registry.ts` 的 `RunRegistry` 结构相同，但这里不 import 它 ——
 * `shared/tools` 不允许依赖 `shared/run`（同级单向约束，见 tests/arch.mjs）。
 * TS 的结构化类型让两者可以直接互传。
 */
export interface RunsLike {
  submit: (promptId: string, workflowId: string, batchId?: string) => void
  update: (promptId: string, patch: object) => void
  get: (promptId: string) => RunRecordLike | undefined
  list: (filter?: { state?: string; batchId?: string; limit?: number }) => RunRecordLike[]
  activeCount: () => number
  flush: () => void
}

/** 一条运行记录的读出形状（只声明工具层用到的字段）。 */
export interface RunRecordLike {
  promptId: string
  workflowId: string
  state: string
  batchId?: string
  submittedAt: number
  startedAt?: number
  finishedAt?: number
  queuePosition?: number
  progress?: { value: number; max: number; node?: string }
  artifacts?: Array<{ path: string; bytes: number; width?: number; height?: number }>
  error?: { code: string; message: string; kind?: string }
  stale?: boolean
}

/** 一件能塞进工作流的素材（姿势线稿 / 衣装图）。 */
export interface MaterialItem {
  /** 库 id（衣装 `SPR-0001`、姿势视角 `full_single_P012_front`）。 */
  id: string
  /** 中文名，给模型认人用。 */
  name: string
  /** 可直接拼进提示词的关键词串（衣装有，姿势通常没有）。 */
  keywords?: string
}

/**
 * 素材取用面：姿势库与衣装库两个 entry **各自注册自己那一半**。
 *
 * 为什么不直接 import 那两个组件：`components/*` 之间不该互相依赖（只有装配层可以）。
 * 这里只留一个接口，`Runtime.materials` 由各自 entry 在 apply 时填，工具侧通过
 * `getMaterials()` 惰性取 —— 不依赖 entry 的加载顺序。
 *
 * 两个半面都可缺省：关掉某个库时 compose 只少一种素材来源，不会整体失效。
 */
export interface MaterialSource {
  pose?: (id: string) => MaterialItem | undefined
  costume?: (id: string) => MaterialItem | undefined
  /** 取素材图并落盘到 uploads，返回绝对路径；找不到素材时抛错。 */
  fetchPose?: (id: string, size: 'full' | 'thumb') => Promise<string>
  fetchCostume?: (id: string, size: 'full' | 'thumb') => Promise<string>
}

/** 工具执行需要的依赖。 */
export interface ToolDeps {
  client: ComfyClient
  workflowsDir: string
  outputDir: string
  /** 按会话解析产物目录（多工作区）；拿不到会话信息就回退 outputDir。 */
  resolveOutputDirFor?: (agent: unknown) => string
  timeoutMs: number
  pollIntervalMs: number
  /** 运行注册表：提交后把状态写进去，供面板与 comfyui_runs 读。 */
  runs: RunsLike
  /** workflowId → 下一次运行要应用的节点级覆盖。进程内有效，重启即清。 */
  overrides: Map<string, Override[]>
  /** 资产索引（运行成功后登记）。 */
  /** 输出目录校验（注入，避免 tools 直接依赖 assets）。 */
  /** 资产索引：产物落盘后登记，相册面板据此列出。 */
  index: AssetIndex
  assertWritable: (dir: string, agent?: unknown) => void
  logger?: LoggerLike | undefined
  /** 素材取用面（惰性取：两条素材 entry 的 apply 可能晚于本工具注册）。 */
  getMaterials?: () => MaterialSource | undefined
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

/** 同步等待的下限/上限（毫秒）。下限 1 秒：更短的等待没有意义，轮询一次就过去了。 */
export const WAIT_MIN_MS = 1_000
export const WAIT_MAX_MS = 1_800_000

/**
 * 解析 `wait` 参数：**布尔表示等不等，数字表示等多久**。
 *
 * 三处（`run` / `rerun` / `run_batch`）共用这一份，因为语义必须一致 —— 三份各写一遍时
 * 已经出现过跑偏：`run_batch` 解析出了数字却没拿它决定同步与否，等于参数是摆设。
 *
 * 规则：
 * - 数字 `<= 0` → 当作 **不等**。`wait: 0` 最可能表达"别等"，把它变成"同步等 1 秒"是反直觉的。
 * - 数字夹到 `[WAIT_MIN_MS, WAIT_MAX_MS]`。
 * - 只给 `true` 时用 `defaultMs`，**同样夹上限** —— 否则配置里把 `timeoutMs` 调到 60 分钟时，
 *   `wait: true` 的同步等待会跟着翻倍到 60 分钟。
 * - 字符串数字也认（模型偶尔给 `"120000"`）。
 *
 * @param value - 原始参数值。
 * @param defaultMs - 只给 `true` 时用的默认等待上限（取自配置）。
 */
export function parseWait(value: unknown, defaultMs: number): { shouldWait: boolean; waitMs: number } {
  const clampDefault = (): number => Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, defaultMs))
  const numeric = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : undefined

  if (numeric !== undefined) {
    if (numeric <= 0) return { shouldWait: false, waitMs: clampDefault() }
    return { shouldWait: true, waitMs: Math.min(WAIT_MAX_MS, Math.max(WAIT_MIN_MS, numeric)) }
  }
  if (value === true) return { shouldWait: true, waitMs: clampDefault() }
  return { shouldWait: false, waitMs: clampDefault() }
}
