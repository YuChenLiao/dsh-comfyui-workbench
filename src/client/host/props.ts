/**
 * 三个对话流槽位的 props 契约与归一化。
 *
 * 这些函数是**适配层的一半**：`slots.ts` 负责"挂到哪个槽位"，这里负责"组件收到什么"。
 * 分开的原因是组件不该知道宿主 props 的原始形状 —— 宿主改一次字段名，业务组件
 * 全都要跟着改，那还不如不做适配层。
 *
 * 字段以 `cordis_inspect_query` 查到的实机 `ownerProps` 为准：
 * - `tool.call.toolview`（keyed）：`ToolCallCommonProps` = `callId` / `toolName` /
 *   `useDisclosure` / `cwd?` / `home?` / `openFile` / `loadImage` / `inspect?`，
 *   加上 `{ phase: 'preparing' | 'start' | 'result', block }`；
 * - `conversation.input.left`（list）：**没有 ownerProps**，只有标准 props
 *   （`sessionId` / `inputActions` / `useInput` …）；
 * - `conversation.input.dock`（list）：ownerProps 是 `InputZone = { session, input }`。
 *
 * 所有归一化都必须是**容错**的：槽位 props 随宿主版本漂移，缺字段要退化成
 * "能渲染但信息少"，不能抛错把整个对话流打崩。
 */

/** 工具卡片阶段。 */
export type ToolViewPhase = 'preparing' | 'start' | 'result'

/** 宿主交给 `tool.call.toolview` 的 props（只声明我们真正读的字段）。 */
export interface ToolViewHostProps {
  callId?: unknown
  toolName?: unknown
  phase?: unknown
  /** 阶段块：`PreparingToolCall` / `StartedToolCall` / `ToolResultNode`。 */
  block?: unknown
  cwd?: unknown
  home?: unknown
  inspect?: unknown
  [key: string]: unknown
}

/** 我们自己的工具卡片 props（归一化后）。 */
export interface ToolViewProps {
  /** 这次调用的稳定 id。 */
  callId: string
  /** 工具线名。 */
  toolName: string
  /** 阶段。 */
  phase: ToolViewPhase
  /**
   * 结果的纯文本块（多个 text block 用换行拼接）。
   *
   * 我们的工具都走 `jsonOutput()`，所以这里通常就是一串 JSON —— 卡片自己
   * `JSON.parse` 取产物路径，解析失败就退化成显示原文。
   */
  text: string
  /** 这次调用是否失败。 */
  isError: boolean
  /** 宿主给的结构化错误码（有就带上）。 */
  errorCode?: string
  /** 参数原文；`preparing` 阶段可能还不完整。 */
  argsRaw: string
}

/** 输入框左侧控件的 props。 */
export interface ComposerStatusProps {
  /** 当前会话 id（宿主标准 props 里就有）。 */
  sessionId?: string
}

/** 输入框上方整宽停靠区的 props。 */
export interface InputDockProps {
  /** 当前会话 id。 */
  sessionId?: string
  /** 输入框里的草稿文本（宿主没给就是空串）。 */
  draft: string
}

/** 从任意值里安全取字符串。 */
function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 从 content 块数组里拼出纯文本。 */
function textOf(content: unknown): string {
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') continue
    const item = block as { type?: unknown; text?: unknown }
    if (item.type !== 'text') continue
    if (typeof item.text === 'string') parts.push(item.text)
  }
  return parts.join('\n')
}

/**
 * `tool.call.toolview` 的宿主 props → 卡片 props。
 *
 * @param host - 宿主原始 props。
 */
export function toolViewPropsFrom(host: ToolViewHostProps): ToolViewProps {
  const block = (host.block !== null && typeof host.block === 'object' ? host.block : {}) as {
    content?: unknown
    isError?: unknown
    error?: unknown
    argsRaw?: unknown
    call?: unknown
  }

  const phase: ToolViewPhase = host.phase === 'result'
    ? 'result'
    : host.phase === 'start'
      ? 'start'
      : 'preparing'

  const error = (block.error !== null && typeof block.error === 'object' ? block.error : {}) as { code?: unknown }
  const errorCode = str(error.code)
  const call = (block.call !== null && typeof block.call === 'object' ? block.call : {}) as { argsRaw?: unknown }
  // 参数原文两个来源：`started` 阶段的 block.argsRaw，或 `ToolResultNode.call.argsRaw`。
  const argsRaw = str(block.argsRaw) ?? str(call.argsRaw) ?? ''

  return {
    callId: str(host.callId) ?? '',
    toolName: str(host.toolName) ?? '',
    phase,
    text: textOf(block.content) || textOf((host as { content?: unknown }).content),
    isError: block.isError === true,
    ...(errorCode === undefined ? {} : { errorCode }),
    argsRaw,
  }
}

/**
 * `conversation.input.left` 的宿主 props → 控件 props。
 *
 * 这条槽位**没有 ownerProps**，能依赖的只有标准 props 里的 `sessionId`。
 *
 * @param host - 宿主原始 props。
 */
export function composerStatusPropsFrom(host: Record<string, unknown>): ComposerStatusProps {
  const sessionId = str(host.sessionId)
  return { ...(sessionId === undefined ? {} : { sessionId }) }
}

/**
 * `conversation.input.dock` 的宿主 props → 停靠区 props。
 *
 * ownerProps 是 `InputZone = { session, input }`，但宿主也可能把 `input` 直接展开
 * 到顶层 —— 两种都认，认不到就退化成空草稿。
 *
 * @param host - 宿主原始 props。
 */
export function inputDockPropsFrom(host: Record<string, unknown>): InputDockProps {
  const zone = (host.inputZone ?? host.zone ?? host) as { input?: unknown; session?: unknown }
  const input = (zone.input !== null && typeof zone.input === 'object' ? zone.input : {}) as { draft?: unknown; text?: unknown }
  const session = (zone.session !== null && typeof zone.session === 'object' ? zone.session : {}) as { id?: unknown }
  const draft = str(input.draft) ?? str(input.text) ?? str(host.draft) ?? ''
  const sessionId = str(session.id) ?? str(host.sessionId)
  return {
    ...(sessionId === undefined ? {} : { sessionId }),
    draft,
  }
}
