import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ComfyClient } from '../../../shared/comfy/index.js'
import type { Settings } from '../../../shared/host/config.js'
import { resumeRun, submitWorkflow, sweepRun } from '../../../shared/run/index.js'
import { readEntry } from '../../../shared/workflow/index.js'
import { readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** direct 模式的运行参数。 */
interface RunBody {
  workflowId?: unknown
  vars?: unknown
  outputPath?: unknown
  timeoutMs?: unknown
  /** 传它就查那次运行的状态（UI 轮询用）。 */
  promptId?: unknown
}

/**
 * `POST /comfyui-workbench/api/run`：UI 直连运行。
 *
 * 与 `comfyui_run` 工具共用同一个 runner，差别只在谁发起：这条路不消耗模型往返，
 * 但产物不会进对话。`runMode: conversation` 时客户端应当走"发进对话"而不是这里。
 *
 * @param deps - 客户端、工作流目录、配置。
 */
export function createRunHandler(deps: {
  client: ComfyClient
  workflowDir: string
  settings: Settings
  /** 输出目录校验：必须在授权根内，否则等于给任意路径写入开后门。 */
  assertWritable: (dir: string) => void
  /** 默认产物目录（配置没写 outputDir 时用它）。 */
  defaultOutputDir: string
  /** 运行注册表；给了就让后台 sweep 把状态写进去。 */
  runs?: {
    update: (promptId: string, patch: object) => void
    get: (promptId: string) => { state?: string } | undefined
    submit: (promptId: string, workflowId: string) => void
  }
}): (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> {
  return async (_url, res, req) => {
    let body: RunBody
    try {
      body = (await readJsonBody(req)) as RunBody
    } catch (error) {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
      return
    }

    const outputPathOf = (): string =>
      typeof body.outputPath === 'string' && body.outputPath.trim() !== ''
        ? body.outputPath.trim()
        : (deps.settings.outputDir ?? deps.defaultOutputDir)

    // 续查：UI 提交后按 promptId 轮询，避免一个请求挂几分钟。
    const resumeId = typeof body.promptId === 'string' ? body.promptId.trim() : ''
    if (resumeId !== '') {
      try {
        deps.assertWritable(outputPathOf())
      } catch (error) {
        sendJson(res, 400, { ok: false, error: 'forbidden-output', message: error instanceof Error ? error.message : String(error) })
        return
      }
      try {
        const outcome = await resumeRun(deps.client, resumeId, { outputDir: outputPathOf() })
        if ('pending' in outcome) {
          sendJson(res, 200, { ok: true, pending: true, promptId: resumeId })
          return
        }
        sendJson(res, 200, {
          ok: true,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
        })
      } catch (error) {
        const bag = error !== null && typeof error === 'object' ? (error as { code?: unknown; hint?: unknown }) : null
        sendJson(res, 200, {
          ok: false,
          code: typeof bag?.code === 'string' ? bag.code : 'execution_failed',
          message: error instanceof Error ? error.message : String(error),
          ...(typeof bag?.hint === 'string' ? { hint: bag.hint } : {}),
        })
      }
      return
    }

    const workflowId = typeof body.workflowId === 'string' ? body.workflowId.trim() : ''
    if (workflowId === '') {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: '需要 workflowId。' })
      return
    }

    const entry = readEntry(deps.workflowDir, workflowId)
    if (entry === undefined) {
      sendJson(res, 404, { ok: false, error: 'no-workflow', message: `没有这个工作流：${workflowId}` })
      return
    }

    const vars = body.vars !== null && typeof body.vars === 'object' && !Array.isArray(body.vars)
      ? (body.vars as Record<string, unknown>)
      : {}
    const outputPath = outputPathOf()
    const timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
      ? Math.min(3_600_000, Math.max(1_000, Math.round(body.timeoutMs)))
      : deps.settings.timeoutMs

    try {
      deps.assertWritable(outputPath)
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: 'forbidden-output',
        message: error instanceof Error ? error.message : String(error),
      })
      return
    }

    try {
      // 提交即返回：前端按 promptId 轮询，请求不会一挂几分钟。
      const submitted = await submitWorkflow({
        client: deps.client,
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs,
        pollIntervalMs: deps.settings.pollIntervalMs,
        workflowId,
        workflowHash: entry.surface.workflowHash,
      })
      // 先登记：sweep 要更新这条记录，update 对不存在的 promptId 是 no-op ——
      // 不 submit 的话后台收了也写不进去。
      try {
        deps.runs?.submit(submitted.promptId, workflowId)
      } catch {
        // 登记失败不影响任务本身
      }

      // 提交后必须有人收尾。原来靠"前端按 promptId 轮询"，但前端从不轮
      // （pollRun 全仓零调用方），服务端也没有 watcher —— 于是 ComfyUI 跑完，
      // 产物留在它自己的 output 目录，插件不落盘、不写 sidecar、registry 停在
      // pending。这里挂一个后台 sweep：它只写注册表、不投递消息，产物到手即收。
      try {
        sweepRun({
          client: deps.client,
          promptId: submitted.promptId,
          workflowId,
          outputDir: outputPath,
          intervalMs: deps.settings.pollIntervalMs,
          ...(deps.runs === undefined ? {} : { registry: deps.runs }),
        })
      } catch {
        // 收尾失败不该让"已提交"变成失败：任务在 ComfyUI 那边照跑
      }

      sendJson(res, 200, {
        ok: true,
        pending: true,
        promptId: submitted.promptId,
        effectiveVars: submitted.effective,
        notes: submitted.notes,
      })
    } catch (error) {
      const bag = error !== null && typeof error === 'object' ? (error as { code?: unknown; hint?: unknown }) : null
      sendJson(res, 200, {
        ok: false,
        code: typeof bag?.code === 'string' ? bag.code : 'execution_failed',
        message: error instanceof Error ? error.message : String(error),
        ...(typeof bag?.hint === 'string' ? { hint: bag.hint } : {}),
      })
    }
  }
}
