import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { ensureDir } from '../host/paths.js'
import { readPngTextChunks } from '../scan/index.js'
import type { ComfyClient, FileRef } from '../comfy/index.js'
import { asRunError, executionFailed, nodeMissing, noOutput, outputUnreadable, RunError, timedOut } from '../comfy/index.js'
import type { ApiWorkflow, IOSlot } from '../workflow/types.js'
import { applyVariables, VariableError } from '../workflow/variables.js'

/** 一次运行的产物。 */
export interface Artifact {
  path: string
  /** sha256 前 12 位，用于跨 run 判重。 */
  digest: string
  mime: string
  bytes: number
  width?: number
  height?: number
}

/** 运行结果。 */
export interface RunOutcome {
  promptId: string
  artifacts: Artifact[]
  durationMs: number
  /** 实际生效的变量（含默认值补全），回给调用方做"表单 vs 实际"的比对。 */
  effective: Record<string, unknown>
  notes: string[]
  /** 写出的 sidecar 路径（未开启时 undefined）。 */
  metadataPath?: string
}

/** 运行参数。 */
export interface RunOptions {
  client: ComfyClient
  workflow: ApiWorkflow
  slots: readonly IOSlot[]
  vars: Record<string, unknown>
  /** 产物落盘目录。 */
  outputDir: string
  timeoutMs: number
  pollIntervalMs: number
  /** 供调用方记录进度（UI 轮询用）。 */
  onStage?: (stage: 'preflight' | 'queued' | 'running' | 'fetching') => void
  /** 写 sidecar 时用的标识。 */
  workflowId: string
  workflowHash: string
  /** 是否写 sidecar，默认 true。 */
  writeMetadata?: boolean
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

/** history.outputs → 文件引用列表。不按节点名匹配，遍历所有键。 */
function fileRefsOf(outputs: Record<string, Record<string, unknown>> | undefined): Array<{ ref: FileRef; nodeId: string }> {
  const found: Array<{ ref: FileRef; nodeId: string }> = []
  if (outputs === undefined) return found
  for (const [nodeId, bag] of Object.entries(outputs)) {
    if (bag === null || typeof bag !== 'object') continue
    for (const value of Object.values(bag)) {
      const list = Array.isArray(value) ? value : [value]
      for (const item of list) {
        if (item === null || typeof item !== 'object') continue
        const bag2 = item as { filename?: unknown; subfolder?: unknown; type?: unknown }
        if (typeof bag2.filename !== 'string' || bag2.filename === '') continue
        found.push({
          nodeId,
          ref: {
            filename: bag2.filename,
            ...(typeof bag2.subfolder === 'string' ? { subfolder: bag2.subfolder } : {}),
            ...(typeof bag2.type === 'string' ? { type: bag2.type } : {}),
          },
        })
      }
    }
  }
  return found
}

/** 扩展名 → MIME（产物可能是图也可能是视频/音频）。 */
function mimeOf(file: string): string {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  if (ext === '.webm') return 'video/webm'
  if (ext === '.mp4') return 'video/mp4'
  if (ext === '.mp3') return 'audio/mpeg'
  if (ext === '.wav') return 'audio/wav'
  return 'application/octet-stream'
}

/** 落盘文件名：保留 ComfyUI 给的名字，冲突时加时间戳前缀而不是覆盖。 */
function targetFor(outputDir: string, filename: string): string {
  const safe = path.basename(filename)
  const first = path.join(outputDir, safe)
  if (!fs.existsSync(first)) return first
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  return path.join(outputDir, `${stamp}-${safe}`)
}

/** 等一小会儿。 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 跑一次工作流：预检 → 提交 → 轮询 → 取产物 → 写 sidecar。
 *
 * 预检放在提交之前：缺节点时立刻报错，不要让用户排 40 秒队之后才失败。
 *
 * @param options - 运行参数。
 */
export async function runWorkflow(options: RunOptions): Promise<RunOutcome> {
  const { client, slots, vars, outputDir, timeoutMs, pollIntervalMs } = options
  const notes: string[] = []
  const startedAt = Date.now()

  // 1. 变量应用（可能抛 variable-*）
  let applied
  try {
    applied = applyVariables(options.workflow, slots, vars)
  } catch (error) {
    if (error instanceof VariableError) {
      throw new RunError(error.code, error.message, '检查参数名与类型；不认识的参数不会被静默忽略。', error.detail)
    }
    throw asRunError(error, 'workflow_invalid')
  }

  // 2. 节点预检
  options.onStage?.('preflight')
  const info = await client.objectInfo()
  const known = new Set(Object.keys(info))
  if (known.size > 0) {
    const missing = requiredNodes(applied.workflow).filter(name => !known.has(name))
    if (missing.length > 0) throw nodeMissing(missing)
  } else {
    notes.push('/object_info 为空，跳过节点预检（可能是刚启动的 ComfyUI）。')
  }

  // 3. 提交
  const promptId = await client.queuePrompt(applied.workflow)
  options.onStage?.('queued')

  // 4. 轮询
  options.onStage?.('running')
  const deadline = startedAt + timeoutMs
  let entry
  let done = false
  while (!done) {
    if (Date.now() > deadline) {
      await client.interrupt()
      throw timedOut(Date.now() - startedAt, promptId)
    }
    await sleep(pollIntervalMs)
    entry = await client.history(promptId)
    if (entry === undefined) continue

    const status = entry.status
    if (status?.status_str === 'error') throw executionFailed(entry, promptId)
    const hasOutputs = entry.outputs !== undefined && Object.keys(entry.outputs).length > 0
    if (status?.completed === true || hasOutputs) done = true
  }

  // 5. 取产物
  options.onStage?.('fetching')
  const refs = fileRefsOf(entry?.outputs)
  if (refs.length === 0) throw noOutput(true)

  ensureDir(outputDir)
  const artifacts: Artifact[] = []
  for (const { ref } of refs) {
    let bytes: Buffer
    try {
      bytes = await client.view(ref)
    } catch (error) {
      throw outputUnreadable(ref.filename, error)
    }
    const target = targetFor(outputDir, ref.filename)
    fs.writeFileSync(target, bytes)

    const digest = digestOf(bytes)
    const artifact: Artifact = {
      path: target,
      digest,
      mime: mimeOf(target),
      bytes: bytes.length,
    }
    // 尺寸只对 PNG 可靠（读 IHDR）；其它格式留给后续版本。
    if (path.extname(target).toLowerCase() === '.png') {
      const parsed = readPngTextChunks(target, bytes.length)
      if (parsed !== undefined && parsed.width > 0 && parsed.height > 0) {
        artifact.width = parsed.width
        artifact.height = parsed.height
      }
    }
    artifacts.push(artifact)
  }

  const durationMs = Date.now() - startedAt

  // 6. sidecar（与 dsh-comfyui-image 字段兼容的超集）
  let metadataPath: string | undefined
  const primary = artifacts[0]
  if (options.writeMetadata !== false && primary !== undefined) {
    metadataPath = `${primary.path}.json`
    const meta = {
      plugin: 'dsh-comfyui-workbench',
      createdAt: new Date().toISOString(),
      workflowId: options.workflowId,
      workflowHash: options.workflowHash,
      vars: applied.effective,
      prompt: typeof applied.effective.prompt === 'string' ? applied.effective.prompt : undefined,
      negativePrompt: typeof applied.effective.negative_prompt === 'string' ? applied.effective.negative_prompt : undefined,
      seed: typeof applied.effective.seed === 'number' ? applied.effective.seed : undefined,
      width: primary.width,
      height: primary.height,
      durationMs,
      artifacts: artifacts.map(item => ({ path: item.path, digest: item.digest, bytes: item.bytes })),
      comfy: { url: client.baseUrl, promptId },
      notes,
      workflow: applied.workflow,
    }
    try {
      fs.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
    } catch {
      metadataPath = undefined
      notes.push('sidecar 写入失败（产物已存在，仅缺元数据）。')
    }
  }

  return { promptId, artifacts, durationMs, effective: applied.effective, notes, ...(metadataPath === undefined ? {} : { metadataPath }) }
}

/** sha256 前 12 位。 */
function digestOf(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 12)
}
