import type { ServerResponse } from 'node:http'

import type { Settings } from '../../../shared/host/config.js'
import type { ComfyClient, ComfySupervisor } from '../../../shared/comfy/index.js'
import { availableModels } from '../../../shared/comfy/index.js'
import { sendJson } from '../../../shared/http/respond.js'
import { createConfigHandler } from './config-api.js'
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
  outputSource: 'config' | 'env' | 'service' | 'cwd' | 'data'
  getDiagnostics: () => Record<string, unknown>
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
}

/**
 * 工作流组件的 HTTP 面：执行、服务托管、配置、工作流浏览与导出。
 *
 * 关掉这个组件时，`/run`、`/workflows` 这些路径整体消失，相册不受影响。
 */
export function createWorkflowRoutes(deps: WorkflowRouteDeps): WorkflowRoutes {
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, outputSource, getDiagnostics } = deps


  return {
    exact: {
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
      '/config': createConfigHandler({
        settings,
        outputDir: defaultOutputDir,
        workflowsDir: workflowDir,
        outputSource,
        getDiagnostics,
      }),
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
  }
}
