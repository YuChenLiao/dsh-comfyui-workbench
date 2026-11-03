import * as prompts from './prompts.js'
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
import { fetchPostRefs } from './danbooru-posts.js'
import type { TagsIndex } from './api.js'
import type { PoolJob } from './pool-job.js'
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
 * @param pool - 「建提示词池」的后台任务；同上。
 * @param dataDir - 数据目录（提示词池落在其下；测试要能指到临时目录）。
 */
export function createTagsRoutes(index: TagsIndex, job?: SyncJob, pool?: PoolJob, dataDir?: string): TagsRoutes {
  return {
    exact: {
      // 参考图的代理。
      //
      // **必须代理，不能让前端直连**：`cdn.donmai.us` 明确拒绝浏览器 UA（实测
      // `Mozilla/5.0 …` → 403，而 `dsh-comfyui-workbench` 或 curl 的 UA → 200），
      // 所以 `<img src="https://cdn.donmai.us/…">` 一定加载不出来。
      // 这里用插件自己的 UA 取，**流式转发不落盘**。
      //
      // 只允许 cdn.donmai.us：不校验就是给任意 URL 开一个 SSRF 出口。
      '/tags/refs/image': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const raw = url.searchParams.get('u') ?? ''
        let target: URL
        try {
          target = new URL(raw)
        } catch {
          sendJson(res, 400, { ok: false, error: 'bad-url', message: '要给 u=<图片地址>。' })
          return
        }
        if (target.protocol !== 'https:' || target.hostname !== 'cdn.donmai.us') {
          sendJson(res, 400, { ok: false, error: 'bad-host', message: '只代理 cdn.donmai.us 的图片。' })
          return
        }
        try {
          const upstream = await fetch(target, {
            headers: { 'User-Agent': 'dsh-comfyui-workbench' },
            signal: AbortSignal.timeout(20_000),
          })
          if (!upstream.ok) {
            sendJson(res, 502, { ok: false, error: 'upstream-failed', message: `图片取不到：HTTP ${upstream.status}` })
            return
          }
          const buffer = Buffer.from(await upstream.arrayBuffer())
          res.writeHead(200, {
            'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg',
            // 图是内容寻址的（文件名就是 hash），缓存一天没问题
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': String(buffer.length),
          })
          res.end(buffer)
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: 'upstream-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      // 参考提示词：**实时从 Danbooru 取，不落盘**。
      // 一次请求同时给图、tag 串（已按 general/character/copyright/artist 分类）与服务端
      // 搜索，所以没有池子要建、没有缓存要失效、也不会"建池跑到一半被限流把原池写坏"。
      '/tags/refs': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const query = url.searchParams.get('q') ?? ''
        const limit = Math.min(Math.max(Number(url.searchParams.get('limit') ?? 12) || 12, 1), 20)
        const rating = url.searchParams.get('rating') === 'all' ? 'all' : 'general'
        try {
          const items = await fetchPostRefs({ query, limit, rating })
          sendJson(res, 200, { ok: true, items, query, rating })
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: 'upstream-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      // 提示词参考：随机（走 HF，不依赖池）与搜索（在本地池里过滤）
      '/tags/prompts': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。建池走 POST /tags/prompts/sync。' })
          return
        }
        const params = url.searchParams
        const mode = params.get('mode') ?? 'random'
        const limit = Math.min(Math.max(Number(params.get('limit') ?? 5) || 5, 1), 20)
        try {
            const items = mode === 'search'
              ? prompts.searchPrompts(params.get('q') ?? '', limit, dataDir)
              : await prompts.fetchRandomPrompts(limit)
          sendJson(res, 200, { ok: true, mode, items, pool: prompts.promptPoolInfo(dataDir) })
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: 'upstream-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },
      ...(pool === undefined ? {} : {
        '/tags/prompts/sync': (_url: URL, res: ServerResponse, req: IncomingMessage) => {
          if (req.method === 'POST') {
            sendJson(res, 200, { ok: true, ...pool.start() })
            return
          }
          if (req.method === 'GET' || req.method === 'HEAD') {
            sendJson(res, 200, { ok: true, ...pool.status() })
            return
          }
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 POST（开始）与 GET（查进度）。' })
        },
      }),
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
