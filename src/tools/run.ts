import fs from 'node:fs'
import path from 'node:path'

import { runWorkflow } from '../run/index.js'
import type { Artifact } from '../run/index.js'
import { buildSurface, readEntry } from '../workflow/index.js'
import type { ApiWorkflow, WorkflowIOSurface } from '../workflow/types.js'
import { asInt, asRecord, asString } from './types.js'
import type { ToolBlock, ToolDeps, ToolSpec } from './types.js'

/** 单张图直接塞进响应的体积上限。超了就只给路径 —— 上下文比带宽更贵。 */
const MAX_INLINE_BYTES = 2 * 1024 * 1024
/** `all` 模式下最多回几张。 */
const MAX_INLINE_COUNT = 3

/** 哪些产物可以当图片回给模型。 */
function isImageArtifact(artifact: Artifact): boolean {
  return artifact.mime.startsWith('image/')
}

/** 已解析并备好 IO 面的工作流。 */
interface LoadedWorkflow {
  workflowId: string
  workflow: ApiWorkflow
  surface: WorkflowIOSurface
}

/** 从 workflow 参数里取模板：优先 { id }，其次 { path }。 */
function loadWorkflow(deps: ToolDeps, args: Record<string, unknown>): LoadedWorkflow {
  const spec = asRecord(args.workflow)
  const id = asString(spec.id).trim()
  if (id !== '') {
    const entry = readEntry(deps.workflowsDir, id)
    if (entry === undefined) throw new Error(`没有这个工作流：${id}。先用 comfyui_workflow_list 看有哪些。`)
    return { workflowId: id, workflow: entry.workflow, surface: entry.surface }
  }

  const filePath = asString(spec.path).trim()
  if (filePath === '') throw new Error('需要 workflow：{"id":"…"} 或 {"path":"…"}。')

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    throw new Error(`读不了工作流文件：${error instanceof Error ? error.message : String(error)}`)
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('工作流文件不是 JSON 对象。')
  const workflow = raw as ApiWorkflow
  const workflowId = path.basename(filePath, path.extname(filePath))
  // 单文件模式：临时算一份 IO 面，保证变量校验与模板走同一套规则。
  return { workflowId, workflow, surface: buildSurface({ workflowId, workflow }) }
}

/**
 * `comfyui_run`：跑一次工作流。
 *
 * 图片随响应返回（image 块），模型不必再 read 一次文件 —— 那会多一次磁盘读取、
 * 一次解码，并在会话里留下资产目录之外的中间副本。**同时**在文本里声明原始像素尺寸：
 * 只给压缩图会让模型以为原图就那么大，下一轮按错的尺寸设参数，产物必然糊。
 *
 * @param deps - 依赖。
 */
export function runTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_run',
    description:
      '执行一个 ComfyUI 工作流。参数用 vars 传（键必须是该工作流声明过的输入名，可用 comfyui_workflow_list / inspect 查）。返回值包含产物路径、原始像素尺寸与图片本身；图片已经给你了，不要再 read 文件。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workflow'],
      properties: {
        workflow: {
          type: 'object',
          description: '工作流标识：{"id":"sdxl"} 指向工作流目录，或 {"path":"D:/某处/workflow.json"} 指向单文件',
          properties: {
            id: { type: 'string' },
            path: { type: 'string' },
          },
        },
        vars: {
          type: 'object',
          description: '变量绑定。键必须是该工作流的输入名；不认识的键会报错而不是被忽略。',
          additionalProperties: true,
        },
        outputPath: { type: 'string', description: '产物落盘目录；不传用配置的 outputDir' },
        timeoutMs: { type: 'integer', description: '等待上限（毫秒），默认取配置' },
        returnImages: { type: 'string', enum: ['first', 'all', 'none'], description: '响应里带几张图，默认 first' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const blocks: ToolBlock[] = []
        const bag = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const artifacts = Array.isArray(bag.artifacts) ? (bag.artifacts as Artifact[]) : []

        const lines: string[] = []
        if (bag.ok === true) {
          lines.push(`工作流 ${String(bag.workflowId)} 执行完成，用时 ${String(bag.durationMs)} ms。`)
          for (const item of artifacts) {
            const size = item.width !== undefined && item.height !== undefined ? `，原图 ${item.width}×${item.height}` : ''
            lines.push(`- ${item.path}（${item.mime}，${Math.round(item.bytes / 1024)} KB${size}）`)
          }
          if (Array.isArray(bag.notes) && bag.notes.length > 0) lines.push(`备注：${bag.notes.join('；')}`)
          lines.push('图片已随响应返回；需要再次处理时请用上面的路径指向原图，不要用响应里的副本。')
        } else {
          lines.push(String(bag.message ?? '执行失败。'))
          if (typeof bag.hint === 'string' && bag.hint !== '') lines.push(`下一步：${bag.hint}`)
        }
        blocks.push({ type: 'text', text: lines.join('\n') })

        for (const item of (Array.isArray(bag.inlineImages) ? (bag.inlineImages as Array<{ data: string; mimeType: string }>) : [])) {
          blocks.push({ type: 'image', data: item.data, mimeType: item.mimeType })
        }
        return blocks
      },
    },
    async execute(args) {
      const loaded = loadWorkflow(deps, args)

      const outputDir = asString(args.outputPath).trim() !== '' ? asString(args.outputPath).trim() : deps.outputDir
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1_000, 3_600_000)

      // 一次性覆盖：来自 comfyui_workflow_edit（persist=false）。用完即清。
      const pending = deps.overrides.get(loaded.workflowId)
      const preNotes: string[] = []
      if (pending !== undefined && pending.length > 0) {
        for (const patch of pending) {
          const node = loaded.workflow[patch.nodeId]
          if (node !== undefined && node.inputs !== null && typeof node.inputs === 'object') node.inputs[patch.input] = patch.value
        }
        deps.overrides.delete(loaded.workflowId)
        preNotes.push(`已应用 ${pending.length} 处一次性参数覆盖（未写入模板）。`)
      }

      try {
        const outcome = await runWorkflow({
          client: deps.client,
          workflow: loaded.workflow,
          slots: loaded.surface.inputs,
          vars: asRecord(args.vars),
          outputDir,
          timeoutMs,
          pollIntervalMs: deps.pollIntervalMs,
          workflowId: loaded.workflowId,
          workflowHash: loaded.surface.workflowHash,
        })

        const mode = asString(args.returnImages, 'first')
        const inline: Array<{ data: string; mimeType: string }> = []
        if (mode !== 'none') {
          const limit = mode === 'all' ? MAX_INLINE_COUNT : 1
          for (const artifact of outcome.artifacts.filter(isImageArtifact).slice(0, limit)) {
            if (artifact.bytes > MAX_INLINE_BYTES) continue
            try {
              inline.push({ data: fs.readFileSync(artifact.path).toString('base64'), mimeType: artifact.mime })
            } catch {
              // 读不到就只给路径
            }
          }
        }

        // 登记索引：索引是派生（真源是 sidecar），登记失败不该让本次运行算失败。
        const createdAt = new Date().toISOString()
        const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []
        for (const artifact of outcome.artifacts) {
          try {
            deps.index.add({
              digest: artifact.digest,
              path: artifact.path,
              bytes: artifact.bytes,
              mime: artifact.mime,
              ...(artifact.width === undefined ? {} : { width: artifact.width }),
              ...(artifact.height === undefined ? {} : { height: artifact.height }),
              workflowId: loaded.workflowId,
              workflowHash: loaded.surface.workflowHash,
              promptId: outcome.promptId,
              createdAt,
              tags,
              status: 'present',
            })
          } catch {
            deps.logger?.warn?.('资产索引登记失败（产物已落盘）')
          }
        }

        const notes = [...preNotes, ...outcome.notes]
        const skipped = outcome.artifacts.filter(isImageArtifact).length - inline.length
        if (skipped > 0 && mode !== 'none') {
          notes.push(`${skipped} 张图超过 ${Math.round(MAX_INLINE_BYTES / 1024 / 1024)} MB 或超出张数上限，只给了路径。`)
        }

        return {
          ok: true,
          workflowId: loaded.workflowId,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
          inlineImages: inline,
          notes,
        }
      } catch (error) {
        const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
        const hint = error !== null && typeof error === 'object' ? (error as { hint?: unknown }).hint : undefined
        return {
          ok: false,
          code: typeof code === 'string' ? code : 'execution_failed',
          message: error instanceof Error ? error.message : String(error),
          ...(typeof hint === 'string' ? { hint } : {}),
        }
      }
    },
  }
}
