/**
 * 执行相关的错误分类。
 *
 * 为什么专门定义：DSH 会把抛出的 `message` 直接给模型看，模型据此决定下一步。
 * 所以每条错误都要有「分类 + 一句人话 + 可执行的下一步」。
 */
export type RunErrorCode =
  | 'comfy_unreachable'
  | 'auth_failed'
  | 'workflow_invalid'
  | 'variable_unbound'
  | 'variable_type'
  | 'variable_unknown'
  | 'node_missing'
  | 'submit_rejected'
  | 'execution_failed'
  | 'no_output'
  | 'output_unreadable'
  | 'timeout'
  | 'cancelled'

/** 带分类与提示的执行错误。 */
export class RunError extends Error {
  readonly code: RunErrorCode
  readonly hint: string | undefined
  readonly detail: unknown

  constructor(code: RunErrorCode, message: string, hint?: string, detail?: unknown) {
    super(message)
    this.name = 'RunError'
    this.code = code
    this.hint = hint
    this.detail = detail
  }

  /** 给模型看的完整文案：结论 + 下一步。 */
  render(): string {
    return this.hint === undefined ? this.message : `${this.message}\n下一步：${this.hint}`
  }
}

/** 非 RunError 的异常包成 RunError，避免模型看到裸 TypeError。 */
export function asRunError(error: unknown, fallback: RunErrorCode = 'execution_failed'): RunError {
  if (error instanceof RunError) return error
  const message = error instanceof Error ? error.message : String(error)
  return new RunError(fallback, message)
}

export function comfyUnreachable(baseUrl: string, cause?: unknown): RunError {
  const detail = cause instanceof Error ? `（${cause.message}）` : ''
  return new RunError(
    'comfy_unreachable',
    `连不上 ComfyUI：${baseUrl}${detail}`,
    '确认 ComfyUI 在跑；地址在设置里（baseUrl），也可以先用 GET /system_stats 手工验证。',
  )
}

export function authFailed(baseUrl: string, status: number): RunError {
  return new RunError(
    'auth_failed',
    `ComfyUI 拒绝了请求：HTTP ${status}（${baseUrl}）`,
    '服务前面可能有反向代理或鉴权。把需要的请求头填到配置的 headers 里。',
  )
}

export function nodeMissing(missing: string[]): RunError {
  return new RunError(
    'node_missing',
    `工作流需要这些节点，但 ComfyUI 里没有：${missing.join('、')}`,
    '先安装对应的自定义节点包，或换成只含内置节点的工作流。',
    { missing },
  )
}

export function submitRejected(body: unknown): RunError {
  const detail = body !== null && typeof body === 'object' ? (body as { node_errors?: unknown }).node_errors : undefined
  const first = formatNodeErrors(detail)
  return new RunError(
    'submit_rejected',
    `ComfyUI 拒绝了这次提交${first === '' ? '' : `：${first}`}`,
    '检查被点名的节点参数（类型、取值范围），或先用 inspect 看该节点的输入。',
    body,
  )
}

/** 把 `node_errors` 压成一句话。 */
function formatNodeErrors(nodeErrors: unknown): string {
  if (nodeErrors === null || typeof nodeErrors !== 'object') return ''
  const parts: string[] = []
  for (const [nodeId, value] of Object.entries(nodeErrors as Record<string, unknown>)) {
    const errors = value !== null && typeof value === 'object' ? (value as { errors?: unknown }).errors : undefined
    if (!Array.isArray(errors) || errors.length === 0) continue
    const first = errors[0] as { message?: unknown; details?: unknown }
    const message = typeof first.message === 'string' ? first.message : ''
    const details = typeof first.details === 'string' ? ` ${first.details}` : ''
    parts.push(`节点 ${nodeId}${message === '' ? '' : `：${message}${details}`}`)
  }
  return parts.join('；')
}

export function executionFailed(entry: unknown, promptId: string): RunError {
  const detail = failureDetail(entry)
  return new RunError(
    'execution_failed',
    `ComfyUI 执行失败（prompt ${promptId}）${detail === '' ? '' : `：${detail}`}`,
    '通常是模型/节点参数不匹配或显存不足。降分辨率或换底模后重试。',
    entry,
  )
}

/** 从 history 的 status.messages 里挖出第一条 execution_error。 */
function failureDetail(entry: unknown): string {
  if (entry === null || typeof entry !== 'object') return ''
  const status = (entry as { status?: unknown }).status
  const messages = status !== null && typeof status === 'object' ? (status as { messages?: unknown }).messages : undefined
  if (!Array.isArray(messages)) return ''
  for (const message of messages) {
    if (!Array.isArray(message) || message.length < 2) continue
    if (message[0] !== 'execution_error') continue
    const payload = message[1]
    if (payload !== null && typeof payload === 'object') {
      const bag = payload as { exception_message?: unknown; node_id?: unknown; node_type?: unknown }
      const text = typeof bag.exception_message === 'string' ? bag.exception_message : ''
      const node = bag.node_id === undefined ? '' : `节点 ${String(bag.node_id)}`
      const type = typeof bag.node_type === 'string' ? bag.node_type : ''
      const head = [node, type].filter(part => part !== '').join(' ')
      const detail = `${head}${head === '' ? '' : '：'}${text}`
      if (detail.trim() !== '') return detail.trim()
    }
  }
  return ''
}

export function noOutput(hintTerminal: boolean): RunError {
  return new RunError(
    'no_output',
    '执行完成了，但没有拿到任何产物文件。',
    hintTerminal
      ? '工作流末端缺少 SaveImage / PreviewImage 节点，产物不会被保存。补一个输出节点再试。'
      : '检查输出节点是否被 ComfyUI 跳过（缓存或条件分支）。',
  )
}

export function outputUnreadable(filename: string, cause?: unknown): RunError {
  const detail = cause instanceof Error ? `（${cause.message}）` : ''
  return new RunError('output_unreadable', `取不回产物字节：${filename}${detail}`, '重试一次；持续失败就用 GET /view 手工下载验证。')
}

export function timedOut(waitedMs: number, promptId: string): RunError {
  return new RunError(
    'timeout',
    `等了 ${Math.round(waitedMs / 1000)} 秒仍未完成（prompt ${promptId}）。`,
    '已向 ComfyUI 发出取消。可以调大 timeoutMs，或降低分辨率/步数。',
  )
}
