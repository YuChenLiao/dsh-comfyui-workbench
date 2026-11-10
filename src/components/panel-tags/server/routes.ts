/**
 * 标签面板的 HTTP 路由。
 *
 * 两条：
 * - `GET /tags?q=&kind=&category=&offset=&limit=` —— 搜索/浏览
 * - `GET /tags/stats` —— 四类与大类的计数（面板首屏要，用来画筛选按钮）
 *
 * 只读，所以 `POST` / `PUT` / `DELETE` 一律 405。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../../../shared/http/respond.js'
import type { TagsIndex } from './api.js'
import type { SyncJob } from './sync-job.js'

/** 面板路由表（挂到 runtime 的 `/comfyui-workbench/api` 下）。 */
export interface TagsRoutes {
  exact: Record<string, (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> | void>
}

/**
 * 建路由。
 *
 * @param index - 面板索引（由 entry 建一次，routes 与它共享缓存）。
 * @param job - 「更新标签」的后台任务；不给就没有这条路由（测试里不需要真抓网络）。
 */
export function createTagsRoutes(index: TagsIndex, job?: SyncJob): TagsRoutes {
  return {
    exact: {
      // 「更新标签」：POST 开跑、GET 轮进度。两分多钟的活不能同步等。
      ...(job === undefined ? {} : {
        '/tags/sync': (_url: URL, res: ServerResponse, req: IncomingMessage) => {
          if (req.method === 'POST') {
            sendJson(res, 200, { ok: true, ...job.start() })
            return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, { ok: true, ...job.status() })
            return
          }
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 POST（开始）与 GET（查进度）。' })
        },
      }),
      '/tags': (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '标签面板是只读的，只接受 GET。' })
          return
        }
        const params = url.searchParams
        try {
          const result = index.search({
            query: params.get('q') ?? '',
            kind: params.get('kind') ?? '',
            category: params.get('category') ?? '',
            ...(params.get('offset') === null ? {} : { offset: Number(params.get('offset')) }),
            ...(params.get('limit') === null ? {} : { limit: Number(params.get('limit')) }),
          })
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          // 索引建不起来（数据文件坏了/不可读）：说清，不要给个空列表假装成功
          sendJson(res, 500, {
            ok: false,
            error: 'index-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      '/tags/stats': (_url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '标签面板是只读的，只接受 GET。' })
          return
        }
        try {
          sendJson(res, 200, { ok: true, ...index.stats() })
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: 'index-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
    },
  }
}
