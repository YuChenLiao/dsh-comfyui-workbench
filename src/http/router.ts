import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../shared/http/respond.js'
import { mergedRoutes } from '../runtime.js'

/** API 前缀。统一挂在独立前缀下，避免和 SPA fallback 抢路径。 */
export const PREFIX = '/comfyui-workbench/api'

/** 这些路径接受写方法（其余一律只读）。 */
const WRITABLE = new Set(['/delete', '/delete-many', '/assets/rebuild', '/run', '/service/stop', '/upload'])

/** 这些只接受 POST。 */
const POST_ONLY = new Set(['/run', '/free'])

const READ_ONLY = new Set(['GET', 'HEAD'])

/**
 * 构造分派器。
 *
 * 只做三件事：解析 URL、校验方法、查表交给组件。
 * 路由表由各组件 entry 在自己上线时挂进来（`mountRoutes`）——
 * 关掉某个组件，它的路径就查不到，访问得到 404。
 *
 * 这个前缀只注册一次（runtime 初始化时），不随组件增删。
 */
export function createDispatch(): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(PREFIX.length) || '/'

      if (sub === '/') {
        sendJson(res, 200, { ok: true, plugin: 'dsh-comfyui-workbench' })
        return
      }

      const { exact, prefix } = mergedRoutes()
      let route = exact[sub]
      if (route === undefined && prefix !== undefined) {
        // 动态段：/workflows/<id> 这类，最长前缀优先
        const hit = [...prefix].sort((a, b) => b.base.length - a.base.length).find(item => sub.startsWith(item.base))
        if (hit !== undefined) route = hit.handle
      }
      if (route === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-route', message: `没有这个接口：${sub}` })
        return
      }

      // /workflows 同一路径有两种方法（GET 列表 / POST 批量导出），
      // 由组件自己判断，通用方法校验不管它。
      const selfManaged = sub === '/workflows' || sub.startsWith('/workflows/')
      const writable = WRITABLE.has(sub)
      const methodOk = POST_ONLY.has(sub)
        ? req.method === 'POST'
        : writable
          ? req.method === 'POST' || req.method === 'DELETE'
          : READ_ONLY.has(req.method ?? '')
      if (!selfManaged && !methodOk) {
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
