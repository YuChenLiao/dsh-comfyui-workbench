import fs from 'node:fs'
import path from 'node:path'
import type { ServerResponse } from 'node:http'

import type { Settings } from '../../../shared/host/config.js'
import type { Toggles } from '../../../shared/host/toggles.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ComfyClient, ComfySupervisor } from '../../../shared/comfy/index.js'
import { availableModels } from '../../../shared/comfy/index.js'
import { auditWorkflows } from '../../../shared/comfy/audit.js'
import { sendJson } from '../../../shared/http/respond.js'
import { removeWorkflow } from '../../../shared/workflow/index.js'
import { createRerunHandler, createRunHandler } from './run-api.js'
import type { ArtifactIndexSink } from './run-api.js'
import { handleServiceStatus, handleServiceStop } from './service-api.js'
import { handleWorkflowDetail, handleWorkflowImport, handleWorkflowList, handleWorkflowUpdate, workflowIdFromPath } from './workflows-api.js'


/** 路由处理器签名（与相册那份一致，但各自持有，避免组件间互相 import）。 */
type Route = (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => void | Promise<void>

/**
 * `/system_stats` 里与"显存还够不够"有关的那部分。
 *
 * ComfyUI 的返回带一堆 `torch_vram_total` 之类的字段，面板只显示利用率，
 * 所以在这里裁成三个数 —— 把整包透传只会让前端再解析一遍。
 */
function summarizeGpu(raw: unknown): Array<{ name: string; vramTotal: number; vramFree: number; vramUsedPct: number }> {
  const devices = raw !== null && typeof raw === 'object' ? (raw as { devices?: unknown }).devices : undefined
  if (Array.isArray(devices) === false) return []
  const out: Array<{ name: string; vramTotal: number; vramFree: number; vramUsedPct: number }> = []
  for (const device of devices) {
    if (device === null || typeof device !== 'object') continue
    const bag = device as Record<string, unknown>
    const total = Number(bag.vram_total)
    const free = Number(bag.vram_free)
    if (Number.isFinite(total) === false || total <= 0) continue
    // 缺 `vram_free` 时不能当成 0 —— 那会显示"已用 100%"，看起来像显存爆了。
    // 这种设备直接不产出（前端会显示"显存未知"）。
    if (Number.isFinite(free) === false) continue
    const safeFree = Math.max(0, Math.min(free, total))
    out.push({
      name: String(bag.name ?? 'GPU'),
      vramTotal: total,
      vramFree: safeFree,
      vramUsedPct: Math.round(((total - safeFree) / total) * 100),
    })
  }
  return out
}

/** 工作流组件对外提供的路由。 */
export interface WorkflowRouteDeps {
  client: ComfyClient
  supervisor: ComfySupervisor
  workflowDir: string
  settings: Settings
  assertWritable: (dir: string) => void
  defaultOutputDir: string
  /**
   * 运行注册表。
   *
   * `/run` 是"提交即返回 pending"，必须有人在后台收产物与收敛状态 ——
   * 这个字段没接线时 `deps.runs` 恒 undefined，`submit()` 不会被调用，
   * registry 里根本没有这条记录，面板与 `comfyui_runs` 永远看不见。
   */
  runs: {
    submit: (promptId: string, workflowId: string) => void
    update: (promptId: string, patch: object) => void
    /**
     * 查一条记录。
     *
     * 返回类型要给全（不只 `state`）：`/run-status` 要把 error / artifacts /
     * 排队位次一起回给面板，否则前端只能显示"出图中"这三个字。
     * 这里写结构类型而不是 import `RunRecord` —— `shared/run` 的出口没有它，
     * 而 `RunRegistry.get` 的返回结构与此兼容。
     */
    get: (promptId: string) => {
      state: string
      workflowId: string
      submittedAt: number
      startedAt?: number
      finishedAt?: number
      queuePosition?: number
      progress?: { value: number; max: number }
      error?: { code: string; message: string }
      artifacts?: Array<{ path: string; bytes: number; width?: number; height?: number }>
    } | undefined
    /**
     * 列最近的运行。控制条只取前几条。
     *
     * 返回类型放宽成 `unknown[]`：这里只负责把注册表原样透给面板，
     * 字段形状由 `RunRegistry` 与 `comfyui_runs` 那份契约决定（不在本组件重抄一遍）。
     */
    list: (filter?: { state?: string; batchId?: string; limit?: number }) => unknown[]
    /**
     * 取某条运行的最新一帧潜空间预览。
     *
     * 可选：`runs` 只在内存里缓存最新一帧，裁剪过的注册表实现可能没有它 ——
     * 缺了就是 `/run-preview` 永远回 `found:false`，不影响其它接口。
     */
    preview?: (promptId: string) => { mime: string; bytes: Uint8Array } | undefined
  }
  /** 后台 sweep 与进度订阅的日志（不给的话降级与连续失败都留不下痕）。 */
  logger?: LoggerLike | undefined
  /**
   * 资产索引的登记面。
   *
   * `/run` 与 `/rerun` 都是"提交即返回"，产物由后台 `sweepRun` 收 —— 那条路上
   * 只有这个注入点能把产物写进索引。不给的话图还在、相册也扫得到，但按工作流 /
   * 标签筛不出来。
   */
  index?: ArtifactIndexSink | undefined
  /** 面板开关（覆盖配置默认值 'progressStream'）。 */
  toggles?: { read: () => Toggles } | undefined
  /** 批量导出的处理器（相册组件提供）；关掉相册时返回 undefined。 */
  getExporter: () => Route | undefined
}

/** 工作流组件额外暴露的动态路径处理器（`/workflows` 与 `/workflows/:id`）。 */
export interface WorkflowRoutes {
  /** 精确路径。 */
  exact: Record<string, Route>
  /** GET /workflows：列表（附缺模型标注）。 */
  list: (url: URL, res: ServerResponse) => Promise<void>
  /** GET /workflows/:id：单份详情。 */
  detail: (id: string, res: ServerResponse) => void
  /** POST /workflows/:id：改标题 / 备注 / 是否可用。 */
  update: (id: string, res: ServerResponse, req: import('node:http').IncomingMessage) => Promise<void>
  /** 从路径里认出 `/workflows/<id>`。 */
  detailIdOf: (sub: string) => string | undefined
  /** 统一处理 `/workflows/<id>`：GET 看详情，POST 改设置。 */
  byId: (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => Promise<void>
}

/**
 * 工作流组件的 HTTP 面：执行、服务托管、配置、工作流浏览与导出。
 *
 * 关掉这个组件时，`/run`、`/workflows` 这些路径整体消失，相册不受影响。
 */
export function createWorkflowRoutes(deps: WorkflowRouteDeps): WorkflowRoutes {
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, runs, logger, toggles, getExporter, index } = deps


  return {
    exact: {
      // 导入必须注册在 exact 里：否则 `/workflows/import` 会被前缀路由当成 id=`import`
      // 的工作流去读详情，返回 no-workflow 而不是导入结果。
      '/workflows/import': async (_url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '导入只接受 POST。' })
          return
        }
        await handleWorkflowImport({
          dir: workflowDir,
          // UI 格式（界面工程文件）做图转换要用 `/object_info`。3 秒上限、不触发拉起 ——
          // 导入是交互动作，不该为此等 ComfyUI 冷启动；拿不到就退回"请用 Export (API)"。
          objectInfo: async () => {
            const info = await client.objectInfo(false, { timeoutMs: 3_000, skipEnsure: true })
            return info as Record<string, unknown>
          },
        }, res, req)
      },
      // 同一路径两种方法：GET 列出工作流，POST 批量导出（导出由相册组件提供）。
      '/workflows': async (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          // 缺模型标注限制 2 秒且不触发拉起：它不能拖慢列表。
          let available: Set<string> | null = null
          try {
            available = availableModels(await client.objectInfo(false, { timeoutMs: 2_000, skipEnsure: true }))
          } catch {
            available = null
          }
          await handleWorkflowList(workflowDir, url, res, available)
          return
        }
        if (req.method === 'POST') {
          const exporter = getExporter()
          if (exporter === undefined) {
            sendJson(res, 404, { ok: false, error: 'unknown-route', message: '批量导出需要相册组件。' })
            return
          }
          await exporter(url, res, req)
          return
        }
        sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '/workflows 只接受 GET（列表）或 POST（批量导出）。' })
      },
      // 单条运行的状态查询：面板提交完只能弹一句提示，之后看不见进度/结果。
      // 只读，所以独立成 new path 而不是给 `/run` 加 GET —— 后者是 POST_ONLY，
      // 改它的方法语义会牵到别处（WRITABLE 里也登记过 /run，历史遗留）。
      '/run-status': (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const promptId = url.searchParams.get('promptId') ?? ''
        if (promptId === '') {
          sendJson(res, 400, { ok: false, error: 'bad-request', message: '要给 promptId。' })
          return
        }
        const record = runs.get(promptId)
        if (record === undefined) {
          // 重启后内存里的注册表就空了，但 runs.json 还在 —— 这不是错误，是"查不到"
          sendJson(res, 200, { ok: true, found: false, promptId })
          return
        }
        sendJson(res, 200, {
          ok: true,
          found: true,
          promptId,
          state: record.state,
          workflowId: record.workflowId,
          submittedAt: record.submittedAt,
          ...(record.startedAt === undefined ? {} : { startedAt: record.startedAt }),
          ...(record.finishedAt === undefined ? {} : { finishedAt: record.finishedAt }),
          ...(record.queuePosition === undefined ? {} : { queuePosition: record.queuePosition }),
          ...(record.progress === undefined ? {} : { progress: record.progress }),
          ...(record.error === undefined ? {} : { error: record.error }),
          ...(record.artifacts === undefined ? {} : { artifacts: record.artifacts }),
        })
      },
      // 潜空间预览帧：直接回图片字节，`<img src>` 可以直连，不用 JSON 再 base64 一层
      // （base64 会让 40KB 的帧变成 55KB，且浏览器多一次解码）。
      // 只保留最新一帧，运行进终态即清 —— 找不到就是 200 + found:false，不是错误。
      '/run-preview': (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const promptId = url.searchParams.get('promptId') ?? ''
        if (promptId === '') {
          sendJson(res, 400, { ok: false, error: 'bad-request', message: '要给 promptId。' })
          return
        }
        const frame = runs.preview?.(promptId)
        if (frame === undefined) {
          sendJson(res, 200, { ok: true, found: false, promptId })
          return
        }
        res.writeHead(200, {
          'Content-Type': frame.mime,
          'Content-Length': frame.bytes.byteLength,
          'Cache-Control': 'no-store',
        })
        res.end(Buffer.from(frame.bytes))
      },
      '/run': createRunHandler({
        client, workflowDir, settings, assertWritable, defaultOutputDir, runs,
        ...(logger === undefined ? {} : { logger }),
        ...(toggles === undefined ? {} : { toggles }),
        ...(index === undefined ? {} : { index }),
      }),
      // 以产物当时的参数重跑（可选把图当输入）：面板上"再用这张图跑一遍"
      '/rerun': createRerunHandler({
        client, workflowDir, settings, assertWritable, defaultOutputDir, runs,
        ...(logger === undefined ? {} : { logger }),
        ...(toggles === undefined ? {} : { toggles }),
        ...(index === undefined ? {} : { index }),
      }),
      '/free': async (_url: URL, res: ServerResponse) => {
        try {
          await client.free()
          sendJson(res, 200, { ok: true })
        } catch (error) {
          sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
      '/service': handleServiceStatus.bind(null, supervisor),
      '/service/stop': handleServiceStop.bind(null, supervisor),
      // 面板顶部控制条要的两样：显存（够不够）与活跃任务（卡住了没有）。
      // 只读；服务没起来时仍然回活跃任务，面板据此显示"离线"而不是整块消失。
      //
      // **skipEnsure 是必须的**：这条会被面板每 5 秒轮询一次，走 `ensure` 的话
      // 服务没起时会顺手拉起它（"停止托管服务"五秒后又被撤销），拉起失败还没有
      // 失败记忆，每轮重试 —— 面板开着就等于一个拉起循环。
      '/service/stats': async (_url: URL, res: ServerResponse) => {
        let raw: unknown = null
        try {
          raw = await client.systemStats({ timeoutMs: 2_000, skipEnsure: true })
        } catch {
          raw = null
        }
        // `list` 不按状态过滤，直接取前 5 条会把"最近跑完的 5 条"说成"5 个在跑"。
        // 这里自己筛：只有 running / queued 才算活跃。
        const recent = runs.list({ limit: 20 }) as Array<{ state?: unknown }>
        const active = recent.filter(row => row.state === 'running' || row.state === 'queued').slice(0, 5)
        // 外部实例关掉后要能自己回到 unknown：这条是面板每 5 秒的轮询入口，
        // 在这里复查比只在终端页签复查覆盖得更全（supervisor 内部有单飞锁，重复调不贵）。
        if (supervisor.status().state === 'external') await supervisor.recheckExternal()
        sendJson(res, 200, {
          ok: true,
          service: supervisor.status(),
          gpu: summarizeGpu(raw),
          active,
        })
      },
      // 中断当前任务。ComfyUI 那边是 `/interrupt`（取消正在跑的那次执行）。
      // `client.interrupt()` 返回它到底发出去没有 —— 失败必须让面板看见，
      // 否则"已中断"永远是假消息。
      '/interrupt': async (_url: URL, res: ServerResponse) => {
        try {
          const sent = await client.interrupt()
          sendJson(res, 200, sent
            ? { ok: true }
            : { ok: false, message: '中断请求没发出去：ComfyUI 连不上或被拒绝。' })
        } catch (error) {
          sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
      // 模板体检：与 `comfyui_workflow { audit: true }` 共用 shared/comfy/audit.ts。
      // 面板要的是同一份结论 —— 两份实现必然漂，用户会看到互相矛盾的结果。
      //
      // objectInfo 显式给 skipEnsure：体检是面板上的一个按钮，服务没起时应当
      // 立刻回"无法体检"，而不是把请求挂到冷启动结束（最多 readyTimeout）。
      '/workflows/audit': async (_url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '体检只接受 GET。' })
          return
        }
        try {
          sendJson(res, 200, await auditWorkflows({
            workflowsDir: workflowDir,
            client: { objectInfo: () => client.objectInfo(false, { timeoutMs: 5_000, skipEnsure: true }) },
          }))
        } catch (error) {
          sendJson(res, 200, { ok: false, error: error instanceof Error ? error.message : String(error) })
        }
      },
    },
    list: async (url, res) => {
      // 拿不到 object_info（ComfyUI 离线）就不标缺失，避免把"离线"说成"缺模型"；
      // 同时限制 2 秒、不触发自动拉起 —— 缺模型标注不能拖慢列表。
      let available: Set<string> | null = null
      try {
        available = availableModels(await client.objectInfo(false, { timeoutMs: 2_000, skipEnsure: true }))
      } catch {
        available = null
      }
      await handleWorkflowList(workflowDir, url, res, available)
    },
    detail: (id, res) => handleWorkflowDetail(workflowDir, id, res),
    update: (id, res, req) => handleWorkflowUpdate(workflowDir, id, res, req),
    detailIdOf: workflowIdFromPath,
    byId: async (url, res, req) => {
      const sub = url.pathname.slice(url.pathname.indexOf('/workflows'))
      const id = workflowIdFromPath(sub)
      if (id === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-route', message: '缺少工作流 id。' })
        return
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        handleWorkflowDetail(workflowDir, id, res)
        return
      }
      if (req.method === 'POST') {
        await handleWorkflowUpdate(workflowDir, id, res, req)
        return
      }
      // 删模板：连 `.schema.json` / `.meta.json` 一起走（`removeWorkflow` 的实现）。
      // 面板上有二次确认 —— 删掉的是模板本身，不是产物。
      if (req.method === 'DELETE') {
        const removed = removeWorkflow(workflowDir, id)
        // 复核主文件是否真的没了。`removeWorkflow` 的布尔看不出"删掉了几个"，
        // 而把权限失败（被占用 / 只读）当成"不存在"会让用户以为模板已经删了。
        if (fs.existsSync(path.join(workflowDir, `${id}.json`))) {
          sendJson(res, 500, {
            ok: false,
            error: 'delete-failed',
            message: `删不掉 ${id}.json：可能被占用或没有权限。`,
          })
          return
        }
        if (removed === false) {
          sendJson(res, 404, { ok: false, error: 'no-workflow', message: `没有这个工作流：${id}` })
          return
        }
        sendJson(res, 200, { ok: true, workflowId: id })
        return
      }
      sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口只接受 GET / POST / DELETE。' })
    },
  }
}
