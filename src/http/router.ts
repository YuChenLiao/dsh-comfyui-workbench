import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Settings } from '../shared/host/config.js'
import type { ComfyClient, ComfySupervisor } from '../shared/comfy/index.js'
import type { HostContext } from '../shared/host/types.js'
import { sendJson } from '../shared/http/respond.js'
import { createWorkflowRoutes } from '../components/panel-workflow/server/routes.js'
import { createGalleryRoutes } from '../components/panel-gallery/server/routes.js'

/** API 前缀。统一挂在独立前缀下，避免和 SPA fallback 抢路径。 */
export const PREFIX = '/comfyui-workbench/api'

/** 这些路径接受写方法（其余一律只读）。 */
const WRITABLE = new Set(['/delete', '/delete-many', '/assets/rebuild', '/run', '/service/stop', '/upload'])

/** 这些只接受 POST。 */
const POST_ONLY = new Set(['/run', '/free'])

const READ_ONLY = new Set(['GET', 'HEAD'])

/** 路由处理器签名（与组件内部一致）。 */
type Route = (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>

/**
 * 构造请求处理器。
 *
 * 只做三件事：解析 URL、校验方法、把请求交给工作流组件的路由表。
 * 面板本身是"工作流管理"，业务 handler 在 `panel-workflow/server/routes`。
 */
export function createHandler(
  ctx: HostContext,
  settings: Settings,
  /** 资产索引（相册组件用）。 */
  index: import('../components/panel-gallery/server/store/index.js').AssetIndex,
  /** 工作流目录（可注入，测试用临时目录）。 */
  workflowDir: string,
  /** ComfyUI 客户端（运行与预检用）。 */
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
  /** 启用的组件：关掉工作流面板后，它那组路由就不注册（访问即 404）。 */
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

      // ── 工作流：GET 列表 / GET {id} 单份 / POST {id} 改设置 ──
      // 同一路径多种方法且 {id} 是动态段，先于通用查表处理。
      // ── /workflows：GET 归工作流组件（列表），POST 归相册组件（批量导出）──
      // 两种能力分属不同组件，必须分别判断：关掉工作流面板后 GET 就该 404。
      if (sub === '/workflows') {
        if (READ_ONLY.has(req.method ?? '')) {
          if (workflowRoutes === undefined) {
            sendJson(res, 404, { ok: false, error: 'unknown-route', message: '工作流面板已关闭，没有列表接口。' })
            return
          }
          await workflowRoutes.list(url, res)
          return
        }
        if (req.method === 'POST') {
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

      if (workflowRoutes !== undefined) {
        const detailId = workflowRoutes.detailIdOf(sub)
        if (detailId !== undefined) {
          if (READ_ONLY.has(req.method ?? '')) {
            workflowRoutes.detail(detailId, res)
            return
          }
          if (req.method === 'POST') {
            await workflowRoutes.update(detailId, res, req)
            return
          }
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口只接受 GET / POST。' })
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
