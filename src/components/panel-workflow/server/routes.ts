import type { ServerResponse } from 'node:http'

import type { Settings } from '../../../shared/host/config.js'
import type { Toggles } from '../../../shared/host/toggles.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ComfyClient, ComfySupervisor } from '../../../shared/comfy/index.js'
import { availableModels } from '../../../shared/comfy/index.js'
import { sendJson } from '../../../shared/http/respond.js'
import { createRerunHandler, createRunHandler } from './run-api.js'
import { handleServiceStatus, handleServiceStop } from './service-api.js'
import { handleWorkflowDetail, handleWorkflowImport, handleWorkflowList, handleWorkflowUpdate, workflowIdFromPath } from './workflows-api.js'


/** 路由处理器签名（与相册那份一致，但各自持有，避免组件间互相 import）。 */
type Route = (url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => void | Promise<void>

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
  }
  /** 后台 sweep 与进度订阅的日志（不给的话降级与连续失败都留不下痕）。 */
  logger?: LoggerLike | undefined
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
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, runs, logger, toggles, getExporter } = deps


  return {
    exact: {
      // 导入必须注册在 exact 里：否则 `/workflows/import` 会被前缀路由当成 id=`import`
      // 的工作流去读详情，返回 no-workflow 而不是导入结果。
      '/workflows/import': async (_url: URL, res: ServerResponse, req: import('node:http').IncomingMessage) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '导入只接受 POST。' })
          return
        }
        await handleWorkflowImport(workflowDir, res, req)
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
      '/run': createRunHandler({
        client, workflowDir, settings, assertWritable, defaultOutputDir, runs,
        ...(logger === undefined ? {} : { logger }),
        ...(toggles === undefined ? {} : { toggles }),
      }),
      // 以产物当时的参数重跑（可选把图当输入）：面板上"再用这张图跑一遍"
      '/rerun': createRerunHandler({
        client, workflowDir, settings, assertWritable, defaultOutputDir, runs,
        ...(logger === undefined ? {} : { logger }),
        ...(toggles === undefined ? {} : { toggles }),
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
      sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口只接受 GET / POST。' })
    },
  }
}
