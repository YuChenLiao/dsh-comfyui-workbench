/**
 * 执行相关的错误分类。
 *
 * 为什么专门定义：DSH 会把抛出的 `message` 直接给模型看，模型据此决定下一步。
 * 所以每条错误都要有「分类 + 一句人话 + 可执行的下一步」。
 */
import { adviceFor, classifyFailure } from './failure-kind.js'
import type { FailureKind } from './failure-kind.js'

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
  /**
   * 执行失败的细分类型（只有 `execution_failed` 会带）。
   *
   * 单独一个字段而不改 `code`：调用方可能按 `code` 分支，
   * 而 `kind` 是用来区分"该降分辨率"还是"该去装模型"的。
   */
  kind?: FailureKind

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

/**
 * `POST /prompt` 被拒（400）。
 *
 * 按 ComfyUI 的 `error.type` 分化，别一律说"检查被点名的节点参数"：
 * `prompt_no_outputs` 的 body 里 `node_errors` 是**空对象**（execution.py:1187-1194
 * 的 error 不带节点信息，server.py:1238 原样回传），一句"看被点名的节点"点不到任何东西。
 */
export function submitRejected(body: unknown): RunError {
  const bag = body !== null && typeof body === 'object'
    ? (body as { node_errors?: unknown; error?: { type?: unknown } })
    : {}
  const type = typeof bag.error?.type === 'string' ? bag.error.type : ''
  const first = formatNodeErrors(bag.node_errors)
  const hint = type === 'prompt_no_outputs'
    ? '这份工作流没有输出节点（ComfyUI 的 prompt_no_outputs），跑完不会产生任何产物。接一个 SaveImage / PreviewImage 之类的输出节点再提交。'
    : type === 'prompt_outputs_failed_validation'
      ? '所有输出链的参数都被判为非法。按被点名的节点逐个改，或先用 comfyui_workflow_inspect 对一遍槽位。'
      : '检查被点名的节点参数（类型、取值范围），或先用 inspect 看该节点的输入。'
  return new RunError(
    'submit_rejected',
    `ComfyUI 拒绝了这次提交${first === '' ? '' : `：${first}`}`,
    hint,
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

export function executionFailed(
  entry: unknown,
  promptId: string,
  size?: { width?: number; height?: number },
): RunError {
  const failure = failureDetail(entry)
  const ctx = { text: failure.text, nodeId: failure.nodeId, nodeType: failure.nodeType }
  const kind = classifyFailure(ctx)
  const advice = adviceFor(kind, ctx, size ?? {})
  const error = new RunError(
    'execution_failed',
    `ComfyUI 执行失败（prompt ${promptId}）${failure.text === '' ? '' : `：${failure.text}`}`,
    // 建议按类给，不再是同一句"通常是参数不匹配或显存不足"
    advice,
    entry,
  )
  // 分类单独带出去：code 保持 execution_failed（调用方可能按 code 分支），
  // kind 让上层能区分该降分辨率还是该去装模型。
  error.kind = kind
  return error
}

/**
 * 从 history 的 status.messages 里挖出第一条 execution_error。
 *
 * 返回结构体而不只是字符串：分类需要 `nodeId` / `nodeType`，
 * 只拼成一句话就丢了。
 */
function failureDetail(entry: unknown): { text: string; nodeId?: string; nodeType?: string } {
  if (entry === null || typeof entry !== 'object') return { text: '' }
  const status = (entry as { status?: unknown }).status
  const messages = status !== null && typeof status === 'object' ? (status as { messages?: unknown }).messages : undefined
  if (!Array.isArray(messages)) return { text: '' }
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
      if (detail.trim() !== '') {
        return {
          text: detail.trim(),
          ...(typeof bag.node_id === 'string' || typeof bag.node_id === 'number' ? { nodeId: String(bag.node_id) } : {}),
          ...(type === '' ? {} : { nodeType: type }),
        }
      }
    }
  }
  return { text: '' }
}

/**
 * 执行完成但没有产物。
 *
 * 成因只有两种，都是「执行成功、但没有写出文件」。对照本机 ComfyUI 源码核实过
 * （`execution.py:1187-1194`、`:1232-1300`、`server.py:1234-1238`）：
 * ① 后端没回传任何带 `filename` 的产物引用（末端只连纯文本/纯数据节点最常见；
 *    自定义节点把文件写到 ComfyUI 目录外、不回传 filename 也落这里）；
 * ② 原本要写文件的那条输出链参数被 validate 拒掉，而剩下能跑完的链都不写文件。
 *
 * ② 不能简化成"某条链被 validate 拒了"：只有那条链被拒、别的链仍在写文件时，
 * 产物照样有，根本不会走到这里。全部链都被拒时 ComfyUI 直接回 400
 * `prompt_outputs_failed_validation`，走 `submit_rejected`，也到不了这里。
 *
 * 所以文案**不能**写"末端缺少 SaveImage / PreviewImage 节点"：一个 OUTPUT_NODE
 * 都没有的模板在提交阶段就被 `prompt_no_outputs` 拒了，同样到不了这里。
 *
 * 原来这里有个 `hintTerminal` 参数给两种措辞，但全仓唯一调用点是
 * `runner.ts` 硬编码的 `true` —— false 分支永远不会显示给任何人，已删。
 */
export function noOutput(): RunError {
  return new RunError(
    'no_output',
    '执行完成了，但没有拿到任何产物文件。',
    '两种成因：① 后端没有回传任何带 filename 的产物引用 —— 常见是末端只连了纯文本/纯数据节点，而不是 SaveImage / PreviewImage 这类写文件的节点（自定义节点把文件写到 ComfyUI 目录外、不回传 filename 也会这样）；② 原本要写文件的那条输出链参数被判为非法（validate 失败只让那条链被忽略），剩下能跑完的链都不写文件，所以整体仍算"成功" —— 在终端面板搜 "Failed to validate prompt" 可确认是哪一种（外部启动的 ComfyUI 读不到日志时，去它自己的控制台搜）。',
  )
}

export function outputUnreadable(filename: string, cause?: unknown): RunError {
  const detail = cause instanceof Error ? `（${cause.message}）` : ''
  return new RunError('output_unreadable', `取不回产物字节：${filename}${detail}`, '重试一次；持续失败就用 GET /view 手工下载验证。')
}

/**
 * 等待超时。
 *
 * **不发 `POST /interrupt`**：出图实测中位 115 秒、最长 336 秒，超时只说明"我们不再等"，
 * 任务本身通常还在正常跑 —— 中断它等于把已经算了一半的图扔掉。全仓 `client.interrupt()`
 * 零调用，保留给未来的显式取消。
 *
 * @param waitedMs - 等了多久。
 * @param promptId - 运行 id。
 */
export function timedOut(waitedMs: number, promptId: string): RunError {
  return new RunError(
    'timeout',
    `等了 ${Math.round(waitedMs / 1000)} 秒仍未完成（prompt ${promptId}）。`,
    '任务没有被取消，可能还在 ComfyUI 那边跑 —— 用同一个 promptId 续查。也可以调大等待上限，或降低分辨率/步数。',
  )
}
