import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Settings } from '../shared/host/config.js'
import type { AssetIndex } from '../components/panel-gallery/server/store/index.js'
import type { ComfyClient, ComfySupervisor } from '../shared/comfy/index.js'
import type { HostContext } from '../shared/host/types.js'
import { sendJson } from '../shared/http/respond.js'
import { createGalleryRoutes } from '../components/panel-gallery/server/routes.js'
import type { Route } from '../components/panel-gallery/server/routes.js'
import { createWorkflowRoutes } from '../components/panel-workflow/server/routes.js'

/** API 前缀。统一挂在独立前缀下，避免和 SPA fallback 抢路径。 */
export const PREFIX = '/comfyui-workbench/api'

/** 这些路径接受写方法（其余一律只读）。 */
const WRITABLE = new Set(['/delete', '/delete-many', '/assets/rebuild', '/run', '/service/stop', '/upload'])

/** 这些只接受 POST。 */
const POST_ONLY = new Set(['/run', '/free'])

const READ_ONLY = new Set(['GET', 'HEAD'])

/**
 * 构造请求处理器。
 *
 * 这一层只做三件事：解析 URL、校验方法、把请求交给组件自己的路由表。
 * 业务 handler 分别在 `panel-gallery/server/routes` 与 `panel-workflow/server/routes` ——
 * 关掉哪个组件，它那份路由就不存在，访问得到 404。
 *
 * @param ctx - 宿主上下文。
 * @param settings - 归一化配置。
 */
export function createHandler(
  ctx: HostContext,
  settings: Settings,
  index: AssetIndex,
  /** 工作流目录（可注入，测试用临时目录）。 */
  workflowDir: string,
  /** ComfyUI 客户端（direct 运行与预检用）。 */
  client: ComfyClient,
  /** 服务托管（状态与停止）。 */
  supervisor: ComfySupervisor,
  /** 输出目录校验（由 index 注入，依赖授权根）。 */
  assertWritable: (dir: string) => void,
  /** 上传目录（参考图落这里）。 */
  uploadsDir: string,
  /** 默认产物目录。 */
  defaultOutputDir: string,
  /** 产物目录的来源（配置 / 工作区 / 数据目录），只用于展示与诊断。 */
  outputSource: 'config' | 'env' | 'service' | 'cwd' | 'data' = 'config',
  /** 启用的组件：关掉哪个，它那组路由就不注册（访问即 404）。 */
  components: { gallery: boolean; workflow: boolean } = { gallery: true, workflow: true },
  /** 诊断信息，透给 /config。惰性求值：工具注册在路由之后。 */
  diagnostics: () => {
    components?: Record<string, boolean>
    tools?: { registered: string[]; failed: Array<{ name: string; message: string }>; skipped: string[] }
  } = () => ({}),
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const routes: Record<string, Route> = {}

  const workflowRoutes = components.workflow
    ? createWorkflowRoutes({
        client,
        supervisor,
        workflowDir,
        settings,
        assertWritable,
        defaultOutputDir,
        uploadsDir,
        outputSource,
        getDiagnostics: diagnostics as unknown as () => Record<string, unknown>,
      })
    : undefined

  // 相册组件的路由整体归它自己；关掉时这些路径连表都没有。
  Object.assign(routes, components.gallery
    ? createGalleryRoutes({ ctx, settings, index, uploadsDir, defaultOutputDir })
    : {})

  if (workflowRoutes !== undefined) Object.assign(routes, workflowRoutes.exact)

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(PREFIX.length) || '/'

      if (sub === '/') {
        sendJson(res, 200, { ok: true, plugin: 'dsh-comfyui-workbench' })
        return
      }

      // ── 工作流：GET 列表 / POST 批量导出 / GET {id} 单份 ──
      // 同一路径两种方法，且 {id} 是动态段，所以先于通用查表处理。
      if (workflowRoutes !== undefined) {
        if (sub === '/workflows') {
          if (READ_ONLY.has(req.method ?? '')) {
            await workflowRoutes.list(url, res)
            return
          }
          if (req.method === 'POST') {
            // 批量导出由相册组件提供（要读图、sidecar、打包），走通用查表
            const exporter = routes['/workflows']
            if (exporter === undefined) {
              sendJson(res, 404, { ok: false, error: 'unknown-route', message: '批量导出需要相册组件。' })
              return
            }
            await exporter(url, res, req)
            return
          }
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '/workflows 只接受 GET（列表）或 POST（批量导出）。' })
          return
        }
        const detailId = workflowRoutes.detailIdOf(sub)
        if (detailId !== undefined) {
          if (!READ_ONLY.has(req.method ?? '')) {
            sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口是只读的。' })
            return
          }
          workflowRoutes.detail(detailId, res)
          return
        }
      }

      const route = routes[sub]
      if (route === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-route', message: `没有这个接口：${sub}` })
        return
      }

      const writable = WRITABLE.has(sub)
      const methodOk = POST_ONLY.has(sub)
        ? req.method === 'POST'
        : writable
          ? req.method === 'POST' || req.method === 'DELETE'
          : READ_ONLY.has(req.method ?? '')
      if (!methodOk) {
        sendJson(res, 405, {
          ok: false,
          error: 'method-not-allowed',
          message: writable ? '这个接口只接受 POST / DELETE。' : '这个接口是只读的。',
        })
        return
      }

      await route(url, res, req)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal', message })
      else res.destroy()
    }
  }
}
