import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { ensureDir } from '../host/paths.js'
import { readPngTextChunks } from '../scan/index.js'
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
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return path.join(outputDir, `${stamp}-${safe}`)
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

  const promptId = await client.queuePrompt(applied.workflow)
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
  if (entry.status?.status_str === 'error') throw executionFailed(entry, promptId)
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
  const all = fileRefsOf(entry.outputs, context.workflow)

  // 两类都要排掉：预览节点的产物，以及 type=temp 的文件（ComfyUI 会把 temp 清掉，
  // 拿去下载经常 404）。只有工作流一个正式产物都没有时，才退回来用它们。
  const durable = all.filter(ref => ref.kind === 'save' && ref.type !== 'temp')
  const fallback = all.filter(ref => ref.kind === 'save')
  const refs = durable.length > 0 ? durable : (fallback.length > 0 ? fallback : all)
  const skipped = all.length - refs.length
  if (refs.length === 0) throw noOutput(true)

  ensureDir(context.outputDir)
  const artifacts: Artifact[] = []
  const unreadable: string[] = []
  for (const ref of refs) {
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
  if (context.writeMetadata && primary !== undefined) {
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

  for (;;) {
    const state = await checkRun(client, promptId)
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
      return await collectArtifacts(client, promptId, state.entry, context)
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
  return 'pending' in outcome ? outcome : { ...outcome, notes: [...submitted.notes, ...outcome.notes] }
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
