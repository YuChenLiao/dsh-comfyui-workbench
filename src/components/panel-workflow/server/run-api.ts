import fs from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { ComfyClient } from '../../../shared/comfy/index.js'
import type { Settings } from '../../../shared/host/config.js'
import { effectiveProgressStream } from '../../../shared/host/toggles.js'
import type { Toggles } from '../../../shared/host/toggles.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import { recallRun, resumeRun, recordArtifacts, submitWorkflow, sweepBudgetOf, sweepRun } from '../../../shared/run/index.js'
import { readEntry } from '../../../shared/workflow/index.js'
import { readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** `submitWorkflow` 的入参形状，避免在这里手抄字段。 */
type SubmitWorkflowInput = Parameters<typeof submitWorkflow>[0]

/**
 * 资产索引的登记面（只用到 `add`）。
 *
 * 类型从 `recordArtifacts` 的形参推导，不另 import 一份
 * `panel-gallery/server/store` —— 组件之间只经由 `shared` 的公共形状接触。
 */
export type ArtifactIndexSink = NonNullable<Parameters<typeof recordArtifacts>[1]['index']>

/** `submitAndTrack` 需要的依赖。 */
interface SubmitDeps {
  client: ComfyClient
  settings: Settings
  /** 可选日志：后台 sweep 的降级与连续失败都靠它留痕。 */
  logger?: LoggerLike | undefined
  /** 面板开关（覆盖配置默认值）；每次提交时读，所以改完下一次就生效。 */
  toggles?: { read: () => Toggles } | undefined
  runs?: {
    submit: (promptId: string, workflowId: string) => void
    update: (promptId: string, patch: object) => void
    get: (promptId: string) => { state?: string } | undefined
  } | undefined
  /**
   * 资产索引。给了就在后台收完产物时登记一行。
   *
   * 面板提交走的是"提交即返回"，产物由 `sweepRun` 在后台收 —— 这条路径原来只写
   * 运行注册表，索引里永远没有这一行：图在磁盘上、相册列表里也在（相册扫目录），
   * 但按工作流或标签筛不出来，而且没有 sidecar 之外的 `tags` 可依。
   * 类型用 `recordArtifacts` 的形参推导，避免这里再 import 一份组件的类型宿。
   */
  index?: ArtifactIndexSink | undefined
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
  //
  // 参数先落成一个对象，**note 读的就是这里传给 `sweepRun` 的同一个值** ——
  // 这样「接线被删掉」不是只有阅读才能发现：摘掉 `maxWaitMs`，note 会变成 0 分钟，
  // route 级测试立刻变红。直接内联字面量的话，note 与接线可以各自漂移。
  // 收窄提到对象字面量之前：TS 的属性收窄不进入回调，
  // 写在外面才不会在闭包里再判一次 undefined（也不用 `as`）。
  const index = deps.index
  const onCollected = index === undefined
    ? undefined
    : (outcome: Parameters<typeof recordArtifacts>[0]): void => {
      recordArtifacts(outcome, {
        index,
        workflowId: options.workflowId,
        workflowHash: options.workflowHash,
        ...(deps.logger === undefined ? {} : { warn: message => deps.logger?.warn?.(message) }),
      })
    }

  const sweepOptions = {
    client: deps.client,
    promptId: submitted.promptId,
    workflowId: options.workflowId,
    outputDir: options.outputDir,
    intervalMs: deps.settings.pollIntervalMs,
    // 调用方的 `timeoutMs` 只放宽盯守时长，不收紧 —— 见 `sweepBudgetOf` 的说明。
    maxWaitMs: sweepBudgetOf(options.timeoutMs),
    // 进度默认关；面板开关覆盖配置默认值（改完下一次提交就生效）。
    progressStream: effectiveProgressStream(deps.settings, deps.toggles?.read() ?? {}),
    // 不传 logger 的话，订阅降级（Node 20 无全局 WebSocket）与连续失败都零日志 ——
    // 用户设了 `COMFYUI_PROGRESS_WS=1` 却永远 0 事件时无从发现。
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
    ...(deps.runs === undefined ? {} : { registry: deps.runs }),
    // 面板提交的产物是后台收的，索引登记只能在这里补。
    ...(onCollected === undefined ? {} : { onCollected }),
  }
  try {
    sweepRun(sweepOptions)
  } catch {
    // 收尾失败不该让"已提交"变成失败：任务在 ComfyUI 那边照跑
  }
  const effectiveBudgetMs = sweepOptions.maxWaitMs ?? 0
  return {
    promptId: submitted.promptId,
    effective: submitted.effective as Record<string, unknown>,
    // 把**实际生效**的盯守预算回给调用方：不然 `timeoutMs` 传 60000 与传 1800000
    // 行为完全一样，调用方无从知道自己的意愿被抬高了。
    notes: [
      ...submitted.notes,
      `后台盯守 ${Math.round(effectiveBudgetMs / 60_000)} 分钟${effectiveBudgetMs > options.timeoutMs ? '（timeoutMs 只放宽不收紧）' : ''}`,
    ],
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
  /** 后台 sweep 的日志（进度降级、连续失败都靠它留痕）。 */
  logger?: LoggerLike | undefined
  /** 面板开关（覆盖配置默认值 'progressStream'）。 */
  toggles?: { read: () => Toggles } | undefined
  /**
   * 资产索引：后台收完产物时登记一行。
   *
   * **必须写在这个导出的入参类型上**，不能只写在内部 `SubmitDeps` 里。
   * 只写在内部时，`routes.ts` 用属性展开传进来，TS 不做多余属性检查 —— `tsc` 不会报错，
   * 而运行时能通完全是靠"同一个对象引用被原样交给 `submitAndTrack`"。
   * 一旦有人把那里改成 `submitAndTrack({ client: deps.client, … }, …)`，
   * 面板的登记就静默消失，类型检查和用例都不会红（与 `run-route-wiring` 记录的那个坑同型）。
   */
  index?: ArtifactIndexSink | undefined
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
        // 面板轮询拿到产物时也补一次索引（后台 sweep 可能已经死在重启前）。
        // 同一 promptId+path 只会登记一次，与仍然活着的 sweep 撞车也不会双行。
        if (deps.index !== undefined) {
          const known = recallRun(resumeId)
          recordArtifacts(outcome, {
            index: deps.index,
            workflowId: outcome.workflowId,
            workflowHash: known?.workflowHash ?? '',
            ...(known?.tags === undefined ? {} : { tags: known.tags }),
            ...(deps.logger === undefined ? {} : { warn: message => deps.logger?.warn?.(message) }),
          })
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
 * `POST /comfyui-workbench/api/rerun`：**拿这张图的参数再跑一遍**。
 *
 * 面板上"拿这张图去出图"原来只把图路径传进一个**用户挑的工作流**，
 * 别的参数（prompt / seed / 步数 / 模型…）全走默认值 —— 等于把 original
 * 的一半信息丢了。现在的语义是：读 sidecar 里的 `workflowId` 与 `vars`，
 * 其余参数照搬，**换图时换 seed**（见下）。
 *
 * 请求体：`{ path: string, asInput?: boolean, seed?: number }`
 * - `asInput` 为真时，找该工作流的第一个 `image` 槽位，把 `vars[slot]` 换成这张图；
 *   工作流不吃图就明确拒绝（不静默降级成"空参数重跑"）。**同时换一个新 seed** ——
 *   换了参考图还沿用原 seed 等于「同一张图 + 同一个 seed」，而这条链路位级确定，
 *   每次点都会得到一模一样的一张。`seed` 显式给了就用它，否则随机。
 * - 不给 `asInput` 时就是普通重跑（参数全保留、不换图、不动 seed），那才是「完全复现」。
 */
export function createRerunHandler(deps: {
  client: ComfyClient
  workflowDir: string
  settings: Settings
  assertWritable: (dir: string) => void
  defaultOutputDir: string
  runs?: SubmitDeps['runs']
  /** 后台 sweep 的日志。 */
  logger?: LoggerLike | undefined
  /** 面板开关（覆盖配置默认值 'progressStream'）。 */
  toggles?: SubmitDeps['toggles']
  /**
   * 资产索引（与 `createRunHandler` 同一个理由写在导出类型上：
   * 只写在内部 `SubmitDeps` 里时，属性展开能绕过 TS 的多余属性检查）。
   */
  index?: ArtifactIndexSink | undefined
}): (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> {
  return async (_url, res, req) => {
    let body: { path?: unknown; asInput?: unknown; seed?: unknown; timeoutMs?: unknown }
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
    //
    // **同时换一个新的 seed**：换了输入图还沿用 sidecar 里的 seed，等于「同一张参考图
    // + 同一个 seed」，而这条链路是位级确定的（实测三次，清缓存重算也逐字节相同）——
    // 于是每次点「作为输入图」都会得到一模一样的一张，看起来像按钮没反应。
    // 注意只对 asInput 生效：普通重跑（不传 asInput）的语义就是"完全复现"，seed 必须留着。
    let usedSeed: number | undefined
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

      // 槽位名不硬编码：本仓库的 infer 就把 noise_seed 当一等命名（与 comfyui_rerun 同一条规则）
      const seedSlot = entry.surface.inputs.find(input => /^(noise_)?seed$/i.test(input.name))?.name
      if (seedSlot !== undefined) {
        // **接受数字字符串**（`"654321"`）：模型很常把数字包成字符串，`comfyui_rerun` 那边
        // 早就放宽了（见 `rerun.ts` 的 seed 解析）。两个入口同一语义，不能一个接受、
        // 另一个静默忽略 —— 静默忽略会让用户拿到的图和预期完全不同（这里就变成随机了）。
        const raw = body.seed
        const explicit = typeof raw === 'number' && Number.isFinite(raw)
          ? Math.round(raw)
          : typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))
            ? Math.round(Number(raw))
            : undefined
        const next = explicit ?? Math.floor(Math.random() * 0x7fffffff)
        vars[seedSlot] = next
        usedSeed = next
      }
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
        // asInput 时换了新 seed，得把它回给调用方 —— 否则用户既不知道这次用的是哪个 seed，
        // 也没法拿它去复现
        ...(usedSeed === undefined ? {} : { seed: usedSeed }),
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
