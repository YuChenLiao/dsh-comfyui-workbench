import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ComfyClient } from '../../../shared/comfy/index.js'
import type { Settings } from '../../../shared/host/config.js'
import { resumeRun, submitWorkflow, sweepRun } from '../../../shared/run/index.js'
import { readEntry } from '../../../shared/workflow/index.js'
import { readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** `submitWorkflow` 的入参形状，避免在这里手抄字段。 */
type SubmitWorkflowInput = Parameters<typeof submitWorkflow>[0]

/** `submitAndTrack` 需要的依赖。 */
interface SubmitDeps {
  client: ComfyClient
  settings: Settings
  runs?: {
    submit: (promptId: string, workflowId: string) => void
    update: (promptId: string, patch: object) => void
    get: (promptId: string) => { state?: string } | undefined
  } | undefined
}

/**
 * 提交一次运行并挂上后台收尾。
 *
 * `/run` 与 `/rerun` 共用这一段：**提交即返回**，收产物与收敛状态全靠
 * 后台 `sweepRun`。抽出来是为了不让两处各写一遍 —— 上一轮 `/run` 就是因为
 * "只提交、没人收"而留下了永远 pending 的记录。
 *
 * @param deps - 路由依赖（要有 client / settings / runs）。
 * @param options - 已加载的工作流、变量与产物目录。
 * @returns 提交结果。
 */
async function submitAndTrack(
  deps: SubmitDeps,
  options: {
    workflow: SubmitWorkflowInput['workflow']
    slots: SubmitWorkflowInput['slots']
    vars: Record<string, unknown>
    outputDir: string
    timeoutMs: number
    workflowId: string
    workflowHash: string
  },
): Promise<{ promptId: string; effective: Record<string, unknown>; notes: string[] }> {
  const submitted = await submitWorkflow({
    client: deps.client,
    workflow: options.workflow,
    slots: options.slots,
    vars: options.vars,
    outputDir: options.outputDir,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: deps.settings.pollIntervalMs,
    workflowId: options.workflowId,
    workflowHash: options.workflowHash,
  })
  // 先登记：`registry.update` 对不存在的 promptId 是 no-op，
  // 不 submit 的话后台收了也写不进去。
  try {
    deps.runs?.submit(submitted.promptId, options.workflowId)
  } catch {
    // 登记失败不影响任务本身
  }
  // 后台收尾：只写注册表、不投递消息，产物到手即收。
  try {
    sweepRun({
      client: deps.client,
      promptId: submitted.promptId,
      workflowId: options.workflowId,
      outputDir: options.outputDir,
      intervalMs: deps.settings.pollIntervalMs,
      ...(deps.runs === undefined ? {} : { registry: deps.runs }),
    })
  } catch {
    // 收尾失败不该让"已提交"变成失败：任务在 ComfyUI 那边照跑
  }
  return {
    promptId: submitted.promptId,
    effective: submitted.effective as Record<string, unknown>,
    notes: submitted.notes,
  }
}

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
    // /run 允许调用方指定输出目录（越权会被下面的 assertWritable 拦下）。
    // 注意别写成固定的 settings.outputDir —— 那样传进来的 outputPath 会被静默忽略，
    // 越权校验永远通过，测试会真的去连 ComfyUI 跑一遍。
    const outputPath = typeof body.outputPath === 'string' && body.outputPath.trim() !== ''
      ? body.outputPath.trim()
      : (deps.settings.outputDir ?? deps.defaultOutputDir)
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
      const submitted = await submitAndTrack(deps, {
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs,
        workflowId,
        workflowHash: entry.surface.workflowHash,
      })

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

/**
 * `POST /comfyui-workbench/api/rerun`：**以这张图当时的参数再跑一遍**。
 *
 * 面板上"拿这张图去出图"原来只把图路径传进一个**用户挑的工作流**，
 * 别的参数（prompt / seed / 步数 / 模型…）全走默认值 —— 等于把 original
 * 的一半信息丢了。正确的语义是：读 sidecar 里的 `workflowId` 与 `vars`，
 * 原样重跑，只把图片输入换成这一张。
 *
 * 请求体：`{ path: string, asInput?: boolean }`
 * - `asInput` 为真时，找该工作流的第一个 `image` 槽位，把 `vars[slot]` 换成这张图；
 *   工作流不吃图就明确拒绝（不静默降级成"空参数重跑"）。
 * - 不给 `asInput` 时就是普通重跑（参数全保留，不换图）。
 */
export function createRerunHandler(deps: {
  client: ComfyClient
  workflowDir: string
  settings: Settings
  assertWritable: (dir: string) => void
  defaultOutputDir: string
  runs?: SubmitDeps['runs']
}): (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> {
  return async (_url, res, req) => {
    let body: { path?: unknown; asInput?: unknown; timeoutMs?: unknown }
    try {
      body = await readJsonBody(req) as typeof body
    } catch {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: '读不了请求体。' })
      return
    }

    const imagePath = typeof body.path === 'string' ? body.path.trim() : ''
    if (imagePath === '') {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: '需要 path。' })
      return
    }

    // sidecar 与图同名，只差一个 .json
    const sidecarPath = `${imagePath}.json`
    let sidecar: { workflowId?: unknown; vars?: unknown }
    try {
      sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as typeof sidecar
    } catch {
      sendJson(res, 200, {
        ok: false,
        error: 'no-sidecar',
        message: `这张图没有 sidecar（${sidecarPath}），读不到当时的参数。用面板的工作流页手动跑。`,
      })
      return
    }

    const workflowId = typeof sidecar.workflowId === 'string' ? sidecar.workflowId : ''
    const vars = sidecar.vars !== null && typeof sidecar.vars === 'object' && !Array.isArray(sidecar.vars)
      ? { ...(sidecar.vars as Record<string, unknown>) }
      : undefined
    if (workflowId === '' || vars === undefined) {
      sendJson(res, 200, {
        ok: false,
        error: 'bad-sidecar',
        message: 'sidecar 里没有 workflowId 或 vars，无法按原参数重跑。',
      })
      return
    }

    const entry = readEntry(deps.workflowDir, workflowId)
    if (entry === undefined) {
      sendJson(res, 200, {
        ok: false,
        error: 'no-workflow',
        message: `这张图来自工作流 ${workflowId}，但它已经不在本机了。`,
      })
      return
    }

    // 需要图片输入时，找槽位并替换
    if (body.asInput === true) {
      const slot = entry.surface.inputs.find(input => input.type === 'image')
      if (slot === undefined) {
        sendJson(res, 200, {
          ok: false,
          error: 'no-image-slot',
          message: `工作流 ${workflowId} 不吃图片输入，没法把它当输入图。用普通重跑（asInput 不传）可以照原参数再跑一遍。`,
        })
        return
      }
      vars[slot.name] = imagePath
    }

    // rerun 没有 outputPath 入参，用配置默认值
    const outputPath = deps.settings.outputDir ?? deps.defaultOutputDir
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
      const submitted = await submitAndTrack(deps, {
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs,
        workflowId,
        workflowHash: entry.surface.workflowHash,
      })
      sendJson(res, 200, {
        ok: true,
        pending: true,
        promptId: submitted.promptId,
        workflowId,
        effectiveVars: submitted.effective,
        notes: submitted.notes,
      })
    } catch (error) {
      const bag = error !== null && typeof error === 'object' ? (error as { code?: unknown }) : null
      sendJson(res, 200, {
        ok: false,
        code: typeof bag?.code === 'string' ? bag.code : 'execution_failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
