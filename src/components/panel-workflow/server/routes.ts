import type { ServerResponse } from 'node:http'

import type { Settings } from '../../../shared/host/config.js'
import type { ComfyClient, ComfySupervisor } from '../../../shared/comfy/index.js'
import { availableModels } from '../../../shared/comfy/index.js'
import { sendJson } from '../../../shared/http/respond.js'
import { createRunHandler } from './run-api.js'
import { handleServiceStatus, handleServiceStop } from './service-api.js'
import { handleWorkflowDetail, handleWorkflowList, handleWorkflowUpdate, workflowIdFromPath } from './workflows-api.js'


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
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, getExporter } = deps


  return {
    exact: {
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
      '/run': createRunHandler({ client, workflowDir, settings, assertWritable, defaultOutputDir }),
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
