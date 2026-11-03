import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { ensureDir } from '../host/paths.js'
import { readPngTextChunks } from '../media/png-text.js'
import { isFatalRunError, isRetryable, TRANSIENT_LIMIT } from './policy.js'
import type { ComfyClient, HistoryEntry } from '../comfy/index.js'
import {
  asRunError,
  executionFailed,
  materializeImages,
  nodeMissing,
  noOutput,
  outputUnreadable,
  RunError,
} from '../comfy/index.js'
import type { ApiWorkflow, IOSlot } from '../workflow/types.js'
import { applyVariables, VariableError } from '../workflow/variables.js'

/** 一次运行的产物。 */
export interface Artifact {
  path: string
  digest: string
  mime: string
  bytes: number
  width?: number
  height?: number
}

/** 运行完成的结果。 */
export interface RunOutcome {
  ok: true
  promptId: string
  /** 提交时记下的工作流 id（续查时从登记表取回，取不到就是 unknown）。 */
  workflowId: string
  artifacts: Artifact[]
  durationMs: number
  effective: Record<string, unknown>
  notes: string[]
  metadataPath?: string
}

/**
 * 还没跑完。
 *
 * 这不是错误：ComfyUI 出图动辄几分钟，工具调用不能一直占着对话
 * （用户会以为连接断了）。拿到 promptId 后可用同一次调用的 `promptId` 续查。
 */
export interface PendingRun {
  ok: true
  pending: true
  promptId: string
  waitedMs: number
  hint: string
  /**
   * 提交阶段就已经知道的备注（含 200 响应里 `node_errors` 翻出来的警告）。
   *
   * "参数被判非法 → 那条链不产出"的典型后果就是一直等到超时，所以 pending
   * 出口也必须带上它，否则最需要这句话的时刻恰好没有。
   */
  notes?: string[]
}

/** 运行参数。 */
export interface RunOptions {
  client: ComfyClient
  workflow: ApiWorkflow
  slots: readonly IOSlot[]
  vars: Record<string, unknown>
  outputDir: string
  timeoutMs: number
  pollIntervalMs: number
  workflowId: string
  workflowHash: string
  writeMetadata?: boolean
  onStage?: (stage: 'preflight' | 'queued' | 'waiting' | 'fetching') => void
}

/** 提交后仍需记住的上下文（续查时用来写 sidecar）。 */
export interface PendingContext {
  workflowId: string
  workflowHash: string
  outputDir: string
  effective: Record<string, unknown>
  writeMetadata: boolean
  submittedAt: number
  /** 提交时的工作流：续查要靠它区分 SaveImage 与 PreviewImage。 */
  workflow?: ApiWorkflow | undefined
}

/** 进程内登记表：promptId → 上下文。插件重启即丢，丢了不影响 ComfyUI 侧的结果。 */
const pending = new Map<string, PendingContext>()

/**
 * 正在收取的产物：promptId → 那一次的 promise。
 *
 * **这只在同一个 bundle 内有效**：本仓库每条组件 entry 是独立的 esbuild bundle，
 * 本模块会被各内联一份 —— 面板（`lib/index.js`）与工具（`lib/entries/generate.js`）
 * 各持一张表，互不可见。所以它只是**同 bundle 内的并发快速路径**，
 * 真正跨 bundle 的幂等判据是磁盘上的 sidecar（见 `collectedBefore`）。
 *
 * 它仍然值得留着：同一条 entry 内 `sweepRun` 的并发 tick、或 `waitForRun` 与
 * watcher 撞在同一时刻时，能让第二个调用方等第一个的结果，而不是再跑一遍 `view`。
 */
const collecting = new Map<string, Promise<RunOutcome>>()

/** 登记一次提交。 */
export function rememberRun(promptId: string, context: PendingContext): void {
  pending.set(promptId, context)
  if (pending.size > 50) {
    const oldest = [...pending.entries()].sort((a, b) => a[1].submittedAt - b[1].submittedAt)[0]
    if (oldest !== undefined) pending.delete(oldest[0])
  }
}

/** 取回登记；可能来自别处提交或插件重启过，所以允许 undefined。 */
export function recallRun(promptId: string): PendingContext | undefined {
  return pending.get(promptId)
}

/** 忘掉一条。 */
export function forgetRun(promptId: string): void {
  pending.delete(promptId)
}

/** 工作流里用到的全部 class_type。 */
function requiredNodes(workflow: ApiWorkflow): string[] {
  const set = new Set<string>()
  for (const node of Object.values(workflow)) {
    if (node !== null && typeof node === 'object' && typeof node.class_type === 'string' && node.class_type !== '') {
      set.add(node.class_type)
    }
  }
  return [...set]
}

/**
 * 输出节点是"存盘"还是"预览"。
 *
 * 预览节点（`PreviewImage` 之类）在 ComfyUI 里把图写进 temp，只是给你在界面上看一眼——
 * MOSS 图生图就有一个接在"对齐到 1MP"之后，于是**参考图**也被当成产物收了下来。
 * 认不出的节点按"存盘"处理，宁可多收也不要漏。
 */
function outputKindOf(classType: string): 'save' | 'preview' {
  return /^(preview|image\s*comparer)/i.test(classType) ? 'preview' : 'save'
}

/** history.outputs → 文件引用。按节点类型标出存盘/预览，遍历所有键。 */
function fileRefsOf(
  outputs: Record<string, Record<string, unknown>> | undefined,
  workflow?: ApiWorkflow | undefined,
): Array<{ filename: string; subfolder: string; type: string; nodeId: string; kind: 'save' | 'preview' }> {
  const found: Array<{ filename: string; subfolder: string; type: string; nodeId: string; kind: 'save' | 'preview' }> = []
  if (outputs === undefined) return found
  for (const [nodeId, bag] of Object.entries(outputs)) {
    const kind = outputKindOf(String(workflow?.[nodeId]?.class_type ?? ''))
    if (bag === null || typeof bag !== 'object') continue
    for (const value of Object.values(bag)) {
      const list = Array.isArray(value) ? value : [value]
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue
        const ref = item as { filename?: unknown; subfolder?: unknown; type?: unknown }
        if (typeof ref.filename !== 'string' || ref.filename === '') continue
        found.push({
          filename: ref.filename,
          subfolder: typeof ref.subfolder === 'string' ? ref.subfolder : '',
          type: typeof ref.type === 'string' ? ref.type : 'output',
          nodeId,
          kind,
        })
      }
    }
  }
  return found
}

/** 扩展名 → MIME。 */
function mimeOf(file: string): string {
  const table: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
    '.webm': 'video/webm',
    '.mp4': 'video/mp4',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
  }
  return table[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

/** 落盘文件名：保留 ComfyUI 给的名字，冲突时加时间戳前缀而不是覆盖。 */
function targetFor(outputDir: string, filename: string): string {
  const safe = path.basename(filename)
  const first = path.join(outputDir, safe)
  if (!fs.existsSync(first)) return first
  // 毫秒级（17 位）：同一秒内的两次收集会算出同一个名字而不是两份。
  // 小数点要去掉，否则 slice 出来是 `20261101062331.96` —— 带点的文件名在 Windows
  // 上会被当成扩展名的一部分，而 `endsWith('-原名')` 的匹配也会失手。
  const stamp = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 17)
  return path.join(outputDir, `${stamp}-${safe}`)
}

/**
 * 这份产物**是否已经为本 promptId 收过**；收过就直接从盘上复用。
 *
 * 为什么判据必须落在磁盘上：`resumeRun`（面板按 promptId 轮询）与 `sweepRun`
 * （后台兜底）可能先后或同时处理同一个 promptId。而本仓库每条组件 entry 都是
 * **独立 bundle**，esbuild 会把本模块各内联一份 —— 模块级 Map 在 `lib/index.js`
 * 与 `lib/entries/generate.js` 里各有一份，**跨 bundle 不共享**
 * （`runtime.ts` 的注释记过这个坑，`RunRegistry` 也因此挂在 runtime 上）。
 *
 * 没有这层时，顺序的第二次收集会走 `targetFor` 的时间戳分支再落一份图；而且
 * 此时 `forgetRun` 已把上下文清掉（跨 bundle 时 `recallRun` 恒空），那份副本的
 * sidecar 里 `workflowId` 会是 `"unknown"` —— 面板上点「作为输入出图」会直接
 * 报 `no-workflow`，成为死链资产。
 *
 * 判据是产物旁边 sidecar 里的 `comfy.promptId`：同名但不同任务仍会新建副本。
 *
 * **候选文件名要扫一遍目录**：`targetFor` 在原名已存在时会改落 `<时间戳>-原名`，
 * 所以第一次收集可能落在时间戳名下。只查原名的话第二次永远不命中，照样落副本。
 *
 * @param outputDir - 产物目录。
 * @param filename - ComfyUI 给的文件名。
 * @param promptId - 本次运行的 id。
 * @returns 已收过的产物（重新读盘算 digest / 尺寸），没有则 undefined。
 */
function collectedBefore(outputDir: string, filename: string, promptId: string): Artifact | undefined {
  const safe = path.basename(filename)
  let candidates: string[]
  try {
    // 一次 readdir 同时覆盖原名与它的时间戳变体（`<17 位>-原名`）
    candidates = fs.readdirSync(outputDir)
      .filter(name => name === safe || name.endsWith(`-${safe}`))
      .map(name => path.join(outputDir, name))
  } catch {
    return undefined
  }

  for (const target of candidates) {
    let recorded: unknown
    try {
      const meta: unknown = JSON.parse(fs.readFileSync(`${target}.json`, 'utf8'))
      recorded = meta !== null && typeof meta === 'object'
        ? (meta as { comfy?: { promptId?: unknown } }).comfy?.promptId
        : undefined
    } catch {
      continue
    }
    if (recorded !== promptId) continue
    try {
      const bytes = fs.readFileSync(target)
      const artifact: Artifact = { path: target, digest: digestOf(bytes), mime: mimeOf(target), bytes: bytes.length }
      if (path.extname(target).toLowerCase() === '.png') {
        const parsed = readPngTextChunks(target, bytes.length)
        if (parsed !== undefined && parsed.width > 0 && parsed.height > 0) {
          artifact.width = parsed.width
          artifact.height = parsed.height
        }
      }
      return artifact
    } catch {
      // 这个候选读不了就跳过，继续看下一个（原名与时间戳变体都在候选里）
      continue
    }
  }
  return undefined
}

/** sha256 前 12 位。 */
function digestOf(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}

/** 等一小会儿。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 提交一次工作流：变量应用 → 预检 → 送图 → 提交。
 *
 * 预检放在提交之前：缺节点时立刻报错，不要让用户排几十秒队之后才失败。
 *
 * @param options - 运行参数。
 */
export async function submitWorkflow(
  options: RunOptions,
): Promise<{ promptId: string; effective: Record<string, unknown>; notes: string[] }> {
  const { client, slots, vars } = options
  const notes: string[] = []

  let applied
  try {
    applied = applyVariables(options.workflow, slots, vars)
  } catch (error) {
    if (error instanceof VariableError) {
      throw new RunError(error.code, error.message, '检查参数名与类型；不认识的参数不会被静默忽略。', error.detail)
    }
    throw asRunError(error, 'workflow_invalid')
  }

  options.onStage?.('preflight')
  const info = await client.objectInfo()
  const known = new Set(Object.keys(info))
  if (known.size > 0) {
    const missing = requiredNodes(applied.workflow).filter(name => !known.has(name))
    if (missing.length > 0) throw nodeMissing(missing)
  } else {
    notes.push('/object_info 为空，跳过节点预检（可能是刚启动的 ComfyUI）。')
  }

  // 图像类参数要送进 ComfyUI 的 input 目录：LoadImage 只认自己目录里的文件名，
  // 直接写绝对路径会被判成 Invalid image file。
  const imageSlots = slots.filter(slot => slot.type === 'image' || slot.type === 'mask').map(slot => slot.name)
  if (imageSlots.length > 0) {
    const moved = await materializeImages(client, applied.effective, imageSlots)
    notes.push(...moved.notes)
    if (moved.notes.length > 0) {
      applied = applyVariables(options.workflow, slots, { ...moved.vars })
    }
  }

  const submitted = await client.queuePrompt(applied.workflow)
  const promptId = submitted.promptId
  // 200 响应里可能带 node_errors：提交被接受、但某些输出链不会产出文件。
  // 当场说出来，别让用户等十几秒从「没有产物」倒推。
  notes.push(...submitted.warnings)
  options.onStage?.('queued')

  rememberRun(promptId, {
    workflowId: options.workflowId,
    workflowHash: options.workflowHash,
    outputDir: options.outputDir,
    effective: applied.effective,
    writeMetadata: options.writeMetadata !== false,
    submittedAt: Date.now(),
    workflow: options.workflow,
  })

  return { promptId, effective: applied.effective, notes }
}

/** 查一次状态；执行出错时抛 execution_failed。 */
export async function checkRun(client: ComfyClient, promptId: string): Promise<{ done: boolean; entry?: HistoryEntry }> {
  const entry = await client.history(promptId)
  if (entry === undefined) return { done: false }
  if (entry.status?.status_str === 'error') {
    // 把当时那次运行的宽高带上：OOM 的建议要说"从 1312×1840 降到 704×1024"，
    // 只给"长边降到 1024 以内"等于让人自己算。尺寸在 recallRun 的 effective 里。
    const effective = recallRun(promptId)?.effective
    const width = typeof effective?.width === 'number' ? effective.width : undefined
    const height = typeof effective?.height === 'number' ? effective.height : undefined
    throw executionFailed(
      entry,
      promptId,
      width === undefined || height === undefined ? undefined : { width, height },
    )
  }
  const hasOutputs = entry.outputs !== undefined && Object.keys(entry.outputs).length > 0
  return { done: entry.status?.completed === true || hasOutputs, entry }
}

/**
 * 取产物并落盘，顺带写 sidecar。
 *
 * @param client - ComfyUI 客户端。
 * @param promptId - 运行 id。
 * @param entry - 已完成的 history 条目。
 * @param context - 提交时记下的上下文。
 */
export async function collectArtifacts(
  client: ComfyClient,
  promptId: string,
  entry: HistoryEntry,
  context: PendingContext,
): Promise<RunOutcome> {
  const inflight = collecting.get(promptId)
  if (inflight !== undefined) return inflight
  const task = collectArtifactsOnce(client, promptId, entry, context)
  collecting.set(promptId, task)
  try {
    return await task
  } finally {
    // 只清自己那一条：并发时后到的调用方进来又会建一条新的
    if (collecting.get(promptId) === task) collecting.delete(promptId)
  }
}

/**
 * 真正收产物（`collectArtifacts` 的单次实现）。
 *
 * 抽出来是为了让「同一 promptId 复用同一个 promise」这层薄壳不淹没主逻辑。
 */
async function collectArtifactsOnce(
  client: ComfyClient,
  promptId: string,
  entry: HistoryEntry,
  context: PendingContext,
): Promise<RunOutcome> {
  const all = fileRefsOf(entry.outputs, context.workflow)

  // 两类都要排掉：预览节点的产物，以及 type=temp 的文件（ComfyUI 会把 temp 清掉，
  // 拿去下载经常 404）。只有工作流一个正式产物都没有时，才退回来用它们。
  const durable = all.filter(ref => ref.kind === 'save' && ref.type !== 'temp')
  const fallback = all.filter(ref => ref.kind === 'save')
  const refs = durable.length > 0 ? durable : (fallback.length > 0 ? fallback : all)
  const skipped = all.length - refs.length
  if (refs.length === 0) throw noOutput()

  ensureDir(context.outputDir)
  const artifacts: Artifact[] = []
  const unreadable: string[] = []
  /** 这一轮真正落盘的产物路径（复用的不进来）。 */
  const fresh = new Set<string>()
  for (const ref of refs) {
    // 同一个 promptId 已经收过就直接复用，别落第二份 —— 详见 `collectedBefore`。
    const reused = collectedBefore(context.outputDir, ref.filename, promptId)
    if (reused !== undefined) {
      artifacts.push(reused)
      continue
    }
    let bytes: Buffer
    try {
      bytes = await client.view({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type })
    } catch (error) {
      // 单个文件取不到不该拖垮整次运行：ComfyUI 的 temp 会过期，输出目录也可能被清理。
      // 只要还有别的产物能取到，就照常交付，把失败的那些写进说明。
      unreadable.push(`${ref.filename}（${error instanceof Error ? error.message : String(error)}）`)
      continue
    }
    const target = targetFor(context.outputDir, ref.filename)
    fs.writeFileSync(target, bytes)
    fresh.add(target)

    const artifact: Artifact = { path: target, digest: digestOf(bytes), mime: mimeOf(target), bytes: bytes.length }
    if (path.extname(target).toLowerCase() === '.png') {
      const parsed = readPngTextChunks(target, bytes.length)
      if (parsed !== undefined && parsed.width > 0 && parsed.height > 0) {
        artifact.width = parsed.width
        artifact.height = parsed.height
      }
    }
    artifacts.push(artifact)
  }

  if (artifacts.length === 0) {
    throw outputUnreadable(refs[0]?.filename ?? '', new Error(`全部 ${refs.length} 个产物都取不回：${unreadable.join('；')}`))
  }

  const durationMs = Date.now() - context.submittedAt
  const primary = artifacts[0]
  let metadataPath: string | undefined
  // 只给**本轮真正落盘**的主产物写 sidecar。
  //
  // 复用的那条（例如第二次收集命中了第一次的产物）不该被重写：第二次的 context 可能
  // 是跨 bundle 后丢掉的 fallback（`workflowId: 'unknown'`、`effective: {}`），
  // 写下去会把第一份正确的 sidecar 覆盖成死链资产。
  // 注意判据是「primary 自己在不在 fresh 里」，不是「本轮有没有新落盘其它文件」——
  // 后者在"部分复用 + 部分新落盘"时会让复用的 primary 被错写。
  if (context.writeMetadata && primary !== undefined && fresh.has(primary.path)) {
    metadataPath = `${primary.path}.json`
    const meta = {
      plugin: 'dsh-comfyui-workbench',
      createdAt: new Date().toISOString(),
      workflowId: context.workflowId,
      workflowHash: context.workflowHash,
      vars: context.effective,
      prompt: typeof context.effective.prompt === 'string' ? context.effective.prompt : undefined,
      negativePrompt: typeof context.effective.negative_prompt === 'string' ? context.effective.negative_prompt : undefined,
      seed: typeof context.effective.seed === 'number' ? context.effective.seed : undefined,
      width: primary.width,
      height: primary.height,
      durationMs,
      artifacts: artifacts.map(item => ({ path: item.path, digest: item.digest, bytes: item.bytes })),
      comfy: { url: client.baseUrl, promptId },
    }
    try {
      fs.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    } catch {
      metadataPath = undefined
    }
  }

  forgetRun(promptId)
  return {
    ok: true,
    promptId,
    workflowId: context.workflowId,
    artifacts,
    durationMs,
    effective: context.effective,
    notes: [
      ...(skipped > 0 ? [`已跳过 ${skipped} 张预览图：它们来自 PreviewImage 之类的节点，是 ComfyUI 的临时输出，不是产物。`] : []),
      ...(unreadable.length > 0 ? [`有 ${unreadable.length} 个产物取不回，已跳过：${unreadable.join('；')}`] : []),
    ],
    ...(metadataPath === undefined ? {} : { metadataPath }),
  }
}

/**
 * 等一次已提交的运行出结果。
 *
 * 超时**不报错**、也不中断 ComfyUI 侧的任务，只返回 pending。
 *
 * @param client - ComfyUI 客户端。
 * @param promptId - 运行 id。
 * @param options - 等待上限、轮询间隔、以及续查用的回退上下文。
 */
export async function waitForRun(
  client: ComfyClient,
  promptId: string,
  options: {
    timeoutMs: number
    pollIntervalMs: number
    fallback: { outputDir: string; workflowId?: string; workflowHash?: string; effective?: Record<string, unknown> }
    onStage?: (stage: 'waiting' | 'fetching') => void
  },
): Promise<RunOutcome | PendingRun> {
  const startedAt = Date.now()
  options.onStage?.('waiting')
  const deadline = startedAt + options.timeoutMs
  /**
   * 连续的可重试失败次数。
   *
   * 与 watchRun / sweepRun 共用同一套容忍度：ComfyUI 重启窗口里 `/history` 报 5xx
   * 很常见，一次就放弃会让 `wait: true` 在 46ms 内返回 pending，而任务其实还在跑。
   * 确定终态（execution_failed / auth_failed）仍然立即抛。
   */
  let transientFailures = 0
  /**
   * 收集产物失败的次数，与 {@link transientFailures} **分开计**。
   *
   * 共用一个计数器会死循环：`checkRun` 成功后会把计数清零，而 `collectArtifacts`
   * 的 `no_output` 在清零之后才抛 —— 每轮都从 0 开始数，永远到不了上限。
   */
  let collectFailures = 0

  for (;;) {
    let state
    try {
      state = await checkRun(client, promptId)
      transientFailures = 0
    } catch (error) {
      if (isFatalRunError(error)) throw error
      transientFailures += 1
      if (transientFailures >= TRANSIENT_LIMIT) throw error
      // 还没到上限：当作"这次没查到"，继续等
      if (Date.now() > deadline) {
        return {
          ok: true,
          pending: true,
          promptId,
          waitedMs: Date.now() - startedAt,
          hint: `连续 ${transientFailures} 次查询失败（${error instanceof Error ? error.message : String(error)}）。任务可能还在跑，用 comfyui_run 传这个 promptId 续查。`,
        }
      }
      await sleep(options.pollIntervalMs)
      continue
    }

    if (state.done && state.entry !== undefined) {
      options.onStage?.('fetching')
      const context = recallRun(promptId) ?? {
        workflowId: options.fallback.workflowId ?? 'unknown',
        workflowHash: options.fallback.workflowHash ?? '',
        outputDir: options.fallback.outputDir,
        effective: options.fallback.effective ?? {},
        writeMetadata: true,
        submittedAt: startedAt,
      }
      try {
        return await collectArtifacts(client, promptId, state.entry, context)
      } catch (error) {
        // `no_output`（完成了但产物还没落盘）也走"再等等"—— ComfyUI 写 outputs
        // 与 SaveImage 落盘之间有个竞态窗，首次读不到很常见。真正的确定终态
        //（execution_failed / auth_failed）仍立即抛。
        if (!isRetryable(error)) throw error
        collectFailures += 1
        if (collectFailures >= TRANSIENT_LIMIT) throw error
        await sleep(options.pollIntervalMs)
        continue
      }
    }
    if (Date.now() > deadline) {
      return {
        ok: true,
        pending: true,
        promptId,
        waitedMs: Date.now() - startedAt,
        hint: '还在出图。用同一个工具传 promptId 续查；这次调用结束后 ComfyUI 侧不会中断。',
      }
    }
    await sleep(options.pollIntervalMs)
  }
}

/**
 * 跑一次工作流（提交 + 等到超时）。
 *
 * @param options - 运行参数。
 */
export async function runWorkflow(options: RunOptions): Promise<RunOutcome | PendingRun> {
  const submitted = await submitWorkflow(options)
  const outcome = await waitForRun(options.client, submitted.promptId, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    fallback: {
      outputDir: options.outputDir,
      workflowId: options.workflowId,
      workflowHash: options.workflowHash,
      effective: submitted.effective,
    },
    ...(options.onStage === undefined ? {} : { onStage: (stage) => options.onStage?.(stage) }),
  })
  // pending 出口也要带上提交阶段的备注 —— 上一行 `'pending' in outcome` 直接返回的话，
  // 200 响应里的 `node_errors` 警告就丢了，而那正是"等超时"最需要它的时候。
  if ('pending' in outcome) {
    return submitted.notes.length === 0 ? outcome : { ...outcome, notes: submitted.notes }
  }
  return { ...outcome, notes: [...submitted.notes, ...outcome.notes] }
}

/** 续查一次运行：完成就取产物，没完成返回 pending。 */
export async function resumeRun(
  client: ComfyClient,
  promptId: string,
  fallback: { outputDir: string },
): Promise<RunOutcome | PendingRun> {
  const context = recallRun(promptId) ?? {
    workflowId: 'unknown',
    workflowHash: '',
    outputDir: fallback.outputDir,
    effective: {},
    writeMetadata: true,
    submittedAt: Date.now(),
  }
  const state = await checkRun(client, promptId)
  if (!state.done || state.entry === undefined) {
    return {
      ok: true,
      pending: true,
      promptId,
      waitedMs: 0,
      hint: '还在出图。等一会儿再查一次；ComfyUI 侧不会因为调用结束而中断。',
    }
  }
  return await collectArtifacts(client, promptId, state.entry, context)
}
