import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../shared/http/respond.js'
import type { HostContext } from '../shared/host/types.js'
import { mergedRoutes } from '../runtime.js'

/** API 前缀。统一挂在独立前缀下，避免和 SPA fallback 抢路径。 */
export const PREFIX = '/comfyui-workbench/api'

/**
 * 这些路径接受写方法（其余一律只读）。
 *
 * 这张表漏一条的后果是**整条路由在真机上恒 405**，而单测仍然全绿 —— 因为单测
 * 常常直接调路由表里的 handler，根本不经过这里。
 *
 * 踩坑史（同一张表，三次）：
 * 1. `POST /terminal`（清屏）漏登记 → 恒 405；
 * 2. 于是把 `/terminal` 塞进下面这个集合 → GET 也被封死，面板整整瞎掉一轮。
 *    教训：本集合的语义是"**整条路径只接受写方法**"，GET 也要用的路径必须走
 *    `selfManaged`，不能塞这里；
 * 3. `POST /rerun`（面板"以原参数重跑"）漏登记 → 真机恒 405。它只有 POST 语义，
 *    所以按 `selfManaged` 之外最贴切的先例登记进 `POST_ONLY`，不碰本集合 ——
 *    与第 2 条同一个理由。
 */
const WRITABLE = new Set(['/delete', '/delete-many', '/assets/rebuild', '/run', '/service/stop', '/upload'])

/** 这些只接受 POST（GET 也没有语义）。 */
const POST_ONLY = new Set(['/run', '/rerun', '/free'])

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
export function createDispatch(ctx: HostContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(PREFIX.length) || '/'

      if (sub === '/') {
        sendJson(res, 200, { ok: true, plugin: 'dsh-comfyui-workbench' })
        return
      }

      const { exact, prefix } = mergedRoutes(ctx)
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

      // 同一路径有不同方法语义的，由组件自己判断（通用方法校验不管它）：
      // /workflows     —— GET 列表 / POST 批量导出
      // /terminal      —— GET 拉增量 / POST 清屏或启动
      // /config        —— GET 读配置 / POST 切面板开关（progressStream 等）
      // /tags/…        —— 面板的写操作（/tags/sync 更新数据）
      // /poses/…       —— 姿势库的写操作（/poses/fetch 把线稿落盘给工作流当输入图）
      // /costumes/…    —— 服装库的写操作（同上）
      //                   用**前缀**判断而不是逐条列举：子路径以后还会加，列举就会漏，
      //                   而漏的后果是"单测全绿、真机 405"。
      // 注意不能把这类路径塞进 WRITABLE：那个集合的语义是"整条路径只接受 POST/DELETE"，
      // 塞进去会把 GET 也一起拦成 405（终端面板因此整整瞎掉一轮）。
      // 这个坑踩过四次了 —— 前三次的测试都是直接调组件 handler，绕过了这一层。
      // 新加这类路径请顺手在 tests/api.test.mjs 里补一条走真实 boot() 的用例。
      const selfManaged = sub === '/workflows' || sub.startsWith('/workflows/')
        || sub === '/terminal' || sub === '/config'
        || sub.startsWith('/tags/') || sub.startsWith('/poses/') || sub.startsWith('/costumes/')
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
