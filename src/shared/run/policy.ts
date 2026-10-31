/**
 * 失败容忍策略：哪些错误该继续等，哪些该放弃，放弃时终态写什么。
 *
 * 这块原来散在四处，各推各的：
 * - `watchRun` 计累计（成功但未完成的 tick 不复位）
 * - `sweepRun` 只特判 `execution_failed`（`auth_failed` 也要等 6 次），且把"恒 500"写成 failed
 * - `waitForRun` 零容忍（首次 5xx 就在 46ms 内放弃）
 * - `run.ts` 又手写了一遍 `code !== 'execution_failed' && code !== 'auth_failed'`
 *
 * 同一份 `client.history()` 抛出的同一个错误，四个消费者给出四种结论。所以集中到这里。
 *
 * **两条判据是独立的**，不能合成一个布尔：
 * - `isRetryable`：还要不要继续等
 * - `finalStateOf`：放弃时这条记录写成什么状态
 *
 * 典型的分叉是 `no_output`（执行完成了但没有产物文件）：它还值得继续等 ——
 * 产物可能稍后才被收集到（竞态窗）；但真的放弃时终态必须是 **failed** 而不是
 * unknown ——"完成了但没产物"是个确定的结论，说"不知道"会让用户一直等。
 */

/** 连续多少次可重试失败才放弃。三处共用这一个值（文案里也引用它）。 */
export const TRANSIENT_LIMIT = 6

/**
 * 可重试失败攒够次数后，记录该写成什么状态。
 *
 * 一般写 `unknown` —— 连续查不到 `/history` 只说明我们观测不到，不代表任务失败。
 * 但 `no_output` 例外：它是个确定结论，见 {@link finalStateOf}。
 */
export const TRANSIENT_FINAL_STATE = 'unknown' as const

/** 从错误上取 code；对 null / 非对象一律返回空串（不能直接 .code，会 TypeError）。 */
export function codeOf(error: unknown): string {
  if (error === null || typeof error !== 'object') return ''
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : ''
}

/**
 * 还要不要继续等。
 *
 * 只有 ComfyUI **明确告知**的失败（`execution_failed`）与凭据错误（`auth_failed`）
 * 才立即放弃。网络 / 5xx / `no_output` 都继续等 —— ComfyUI 重启窗口里那些很常见，
 * 而 `no_output` 的产物可能稍后才到。
 *
 * @param error - 抛出来的错误（任何值，包括 null）。
 */
export function isRetryable(error: unknown): boolean {
  const code = codeOf(error)
  return code !== 'execution_failed' && code !== 'auth_failed'
}

/**
 * 放弃时，这条记录该写成什么终态。
 *
 * - `execution_failed` / `auth_failed` / `no_output` → `failed`（都是确定结论）
 * - 其余（网络、5xx）→ `unknown`（我们只是观测不到，没有证据说任务失败）
 *
 * @param error - 抛出来的错误（任何值）。
 */
export function finalStateOf(error: unknown): 'failed' | 'unknown' {
  const code = codeOf(error)
  // `output_unreadable` 也是确定结论：执行完了，但产物读不出来（权限/磁盘/截断）。
  // 漏了它就会落 unknown，而 giveUpMessage 早已按确定语气写"检查权限与磁盘"——
  // 同一处判据缺口换个 code 复发。
  if (
    code === 'execution_failed'
    || code === 'auth_failed'
    || code === 'no_output'
    || code === 'output_unreadable'
  ) return 'failed'
  return TRANSIENT_FINAL_STATE
}

/**
 * 取 code，空时用兜底值。
 *
 * 兜底**不能是 `execution_failed`** —— 无 code 的错误（比如 TypeError）会被记成
 * "执行失败"而 state 可能是 unknown，按 code 分支的消费方会误判。
 *
 * @param error - 任意错误值。
 * @param fallback - code 为空时用什么。
 */
export function codeOrDefault(error: unknown, fallback = 'wait_failed'): string {
  const code = codeOf(error)
  return code === '' ? fallback : code
}

/**
 * 是否确定失败（= 不值得继续等）。
 *
 * @param error - 抛出来的错误（任何值）。
 */
export function isFatalRunError(error: unknown): boolean {
  return !isRetryable(error)
}

/**
 * 放弃时给用户看的那句话。
 *
 * **按错误类型分开写**：`no_output` 说"执行完成了但没有产物"，
 * 网络类说"连续 N 次查不到 /history"。两者说反了就是撒谎。
 *
 * @param error - 抛出来的错误。
 * @param promptId - 运行 id。
 * @param failures - 已经连续失败了几次。
 */
export function giveUpMessage(error: unknown, promptId: string, failures: number): string {
  const code = codeOf(error)
  const detail = error instanceof Error ? error.message : String(error)

  if (code === 'no_output') {
    return `工作流执行完成了，但没有拿到任何产物文件（promptId ${promptId}）。检查末端是否有 SaveImage / PreviewImage 节点，或该节点是否被 bypass。`
  }
  if (code === 'output_unreadable') {
    return `执行完成了，但产物文件读不出来（promptId ${promptId}）：${detail}。检查输出目录的权限与磁盘空间。`
  }
  if (code === 'execution_failed') {
    return `工作流执行失败（promptId ${promptId}）：${detail}`
  }
  if (code === 'auth_failed') {
    return `ComfyUI 认证失败（promptId ${promptId}）：${detail}。检查 baseUrl 与凭据配置。`
  }
  return `连续 ${failures} 次查不到 /history（promptId ${promptId}）：${detail}\n任务可能还在 ComfyUI 那边跑。稍后用 comfyui_run 传这个 promptId 续查。`
}
