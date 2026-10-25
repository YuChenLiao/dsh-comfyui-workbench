import fs from 'node:fs'
import path from 'node:path'

import { resumeRun, submitWorkflow, waitForRun, watchRun } from '../../../shared/run/index.js'
import type { NotifyTarget } from '../../../shared/run/index.js'
import type { PendingRun, RunOutcome } from '../../../shared/run/index.js'
import type { Artifact } from '../../../shared/run/index.js'
import { buildSurface, readEntry } from '../../../shared/workflow/index.js'
import type { ApiWorkflow, WorkflowIOSurface } from '../../../shared/workflow/types.js'
import { asInt, asRecord, asString } from '../../../shared/tools/types.js'
import type { ToolBlock, ToolDeps, ToolSpec } from '../../../shared/tools/types.js'

/**
 * 图片产物只以文件路径交付。
 *
 * 宿主把工具结果的每个块都当结构化内容重建模型请求：`{ type: 'image' }` 必须携带
 * 附件引用（attachment），裸 base64 的 MCP 风格图片块会让请求装配读到 undefined
 * 的 attachment 而抛错，并被 LLM 适配器包装成不可恢复的 TRANSPORT 失败。该失败会
 * 永久留在会话历史里，之后每次请求都失败。因此这里不再产出图片块。
 */

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
    // 停用的工作流不该被执行：管理员关掉它通常是有原因的（吃显存、只在特定机器上能跑）。
    if (!entry.surface.enabled) {
      throw new Error(`工作流 ${id} 已被停用，不能执行。需要的话在工作流管理面板里重新启用。`)
    }
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
 * 产物只以路径 + 原始像素尺寸的文本交付：宿主的工具结果不能承载二进制图片，
 * 而尺寸必须写清楚 —— 只给压缩图会让模型以为原图就那么大，下一轮按错的尺寸设参数，
 * 产物必然糊。
 *
 * @param deps - 依赖。
 */
export function runTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_run',
    description:
      '执行一个 ComfyUI 工作流。参数用 vars 传（键必须是该工作流声明过的输入名，可用 comfyui_workflow_list / inspect 查）。返回值包含产物路径与原始像素尺寸；宿主不回传图片本身，需要看图时按返回的路径读取原图。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        promptId: {
          type: 'string',
          description: '续查一次已提交但还没出完的运行（上一次返回里给的 promptId）。传了它就不用再给 workflow。',
        },
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
        wait: {
          type: 'boolean',
          description: '是否同步等到出图。默认 false：提交后立刻返回 promptId，出完图插件会主动通知对话；传 true 则本次调用等到产物落盘或超时。',
        },
        waitMs: { type: 'integer', description: 'wait=true 时的等待上限（毫秒），默认取配置的 timeoutMs' },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: '产物标签，登记进资产索引便于之后筛选。注意只有 wait:true 同步取回产物时才会登记；默认异步路径由后台通知落盘，不写索引。',
        },
        timeoutMs: { type: 'integer', description: '已弃用：请用 waitMs' },
        returnImages: {
          type: 'string',
          enum: ['first', 'all', 'none'],
          description: '已弃用：工具结果不能承载二进制图片，图片一律只给路径。保留该参数只为兼容旧调用。',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => {
        const blocks: ToolBlock[] = []
        const bag = value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
        const artifacts = Array.isArray(bag.artifacts) ? (bag.artifacts as Artifact[]) : []

        const lines: string[] = []
        if (bag.pending === true) {
          lines.push(String(bag.message ?? '已提交，还在出图。'))
          if (typeof bag.hint === 'string' && bag.hint !== '') lines.push(String(bag.hint))
          lines.push(`promptId：${String(bag.promptId)}`)
          blocks.push({ type: 'text', text: lines.join(String.fromCharCode(10)) })
          return blocks
        }
        if (bag.ok === true) {
          lines.push(`工作流 ${String(bag.workflowId)} 执行完成，用时 ${String(bag.durationMs)} ms。`)
          for (const item of artifacts) {
            const size = item.width !== undefined && item.height !== undefined ? `，原图 ${item.width}×${item.height}` : ''
            lines.push(`- ${item.path}（${item.mime}，${Math.round(item.bytes / 1024)} KB${size}）`)
          }
          if (Array.isArray(bag.notes) && bag.notes.length > 0) lines.push(`备注：${bag.notes.join('；')}`)
          lines.push('图片只给路径：需要看图或继续处理时，用上面的路径读取原图；响应里没有图片副本。')
        } else {
          lines.push(String(bag.message ?? '执行失败。'))
          if (typeof bag.hint === 'string' && bag.hint !== '') lines.push(`下一步：${bag.hint}`)
        }
        blocks.push({ type: 'text', text: lines.join('\n') })
        return blocks
      },
    },
    async execute(args, exec) {
      // 续查：上一次调用超时返回 pending 后，用 promptId 回来问结果。
      const resumeId = asString(args.promptId).trim()
      if (resumeId !== '') {
        try {
          const outcome = await resumeRun(deps.client, resumeId, { outputDir: deps.outputDir })
          return formatOutcome(outcome, deps)
        } catch (error) {
          return failureOf(error)
        }
      }

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
        deps.assertWritable(outputDir)
      } catch (error) {
        return { ok: false, code: 'forbidden_output', message: error instanceof Error ? error.message : String(error) }
      }

      try {
        const submitted = await submitWorkflow({
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

        // 默认异步：提交完就把控制权交回对话。出图要几分钟，
        // 让工具调用一直挂着会让用户以为连接断了。
        if (args.wait !== true) {
          // 有 agent 就挂一个后台等待者：出图后由它调 Agent.followup 把结果塞回
          // 这个会话（与子代理回传同一条通道），用户不用再问一次。
          const agent = exec?.agent as NotifyTarget | undefined
          const canNotify = agent !== undefined && typeof agent.followup === 'function'
          if (canNotify) {
            watchRun({
              client: deps.client,
              target: agent,
              promptId: submitted.promptId,
              outputDir,
              ...(deps.logger === undefined ? {} : { logger: deps.logger }),
            })
          }
          return {
            ok: true,
            pending: true,
            promptId: submitted.promptId,
            waitedMs: 0,
            message: `已提交（promptId ${submitted.promptId}），ComfyUI 正在出图。`,
            hint: canNotify
              ? '出图完成后我会在这个对话里主动通知你（含产物路径）；也可以随时用 comfyui_run 传 promptId 手动查。'
              : '出图要几分钟。稍后用 comfyui_run 传 promptId 就能取结果；这次调用结束后任务不会中断。',
            notes: submitted.notes,
          }
        }

        const outcome = await waitForRun(deps.client, submitted.promptId, {
          timeoutMs: asInt(args.waitMs, deps.timeoutMs, 1_000, 1_800_000),
          pollIntervalMs: deps.pollIntervalMs,
          fallback: {
            outputDir,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash,
            effective: submitted.effective,
          },
        })

        if ('pending' in outcome) return formatOutcome(outcome, deps)

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


        return {
          ok: true,
          workflowId: outcome.workflowId !== '' ? outcome.workflowId : loaded.workflowId,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
          notes: outcome.notes,
        }
      } catch (error) {
        return failureOf(error)
      }
    },
  }
}

/** 把完成/未完成两种结果统一成工具返回值。 */
function formatOutcome(
  outcome: RunOutcome | PendingRun,
  _deps: ToolDeps,
): Record<string, unknown> {
  if ('pending' in outcome) {
    return {
      ok: true,
      pending: true,
      promptId: outcome.promptId,
      waitedMs: outcome.waitedMs,
      message: `已提交，等了 ${Math.round(outcome.waitedMs / 1000)} 秒还在出图。`,
      hint: outcome.hint,
    }
  }
  return {
    ok: true,
    promptId: outcome.promptId,
    workflowId: outcome.workflowId,
    durationMs: outcome.durationMs,
    artifacts: outcome.artifacts,
    effectiveVars: outcome.effective,
    notes: outcome.notes,
  }
}

/** 失败统一出口。 */
function failureOf(error: unknown): Record<string, unknown> {
  const bag = error !== null && typeof error === 'object' ? (error as { code?: unknown; hint?: unknown }) : null
  return {
    ok: false,
    code: typeof bag?.code === 'string' ? bag.code : 'execution_failed',
    message: error instanceof Error ? error.message : String(error),
    ...(typeof bag?.hint === 'string' ? { hint: bag.hint } : {}),
  }
}
