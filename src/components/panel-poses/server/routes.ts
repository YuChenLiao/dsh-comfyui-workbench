/**
 * 姿势库的 HTTP 路由。
 *
 * 五条：
 * - `GET /poses`        搜索（`q` / `system` / `category` / `adult` / `limit` / `offset`）
 * - `GET /poses/stats`  体系与分类计数（面板首屏画筛选按钮要）
 * - `GET /poses/image`  线稿代理（`id` + `size=thumb|full`）
 * - `POST /poses/fetch` 把某张线稿落盘到 uploads，返回绝对路径 —— 给工作流当输入图
 * - `GET /poses/cache`  缓存状态（内存条数 / 磁盘占用 / 冷却剩余），排查用
 *
 * `/poses/fetch` 是**写**接口：它会在磁盘上留下文件。它在 router 里走
 * `selfManaged` 前缀（与 `/tags/` 同处理），所以方法校验不在这张表拦；
 * 但它必须有走真实入口的测试 —— `tests/api.test.mjs` 里那条 `api/poses` 就是。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../../../shared/http/respond.js'
import type { PosesIndex } from './catalog.js'
import type { PoseImages } from './images.js'

export interface PosesRoutesDeps {
  index: PosesIndex
  images: PoseImages
  /** uploads 目录。取的是调用时的实际值，配置可以在运行中改。 */
  uploadsDir: () => string
}

export interface PosesRoutes {
  exact: Record<string, (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> | void>
}

/** 请求体上限：这个接口只接收两个字段。 */
const MAX_BODY = 4 * 1024

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string)
    bytes += buffer.byteLength
    if (bytes > MAX_BODY) throw new Error('请求过大')
    chunks.push(buffer)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const parsed: unknown = JSON.parse(text)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('请求体要是 JSON 对象')
  return parsed as Record<string, unknown>
}

export function createPosesRoutes(deps: PosesRoutesDeps): PosesRoutes {
  const { index, images, uploadsDir } = deps

  return {
    exact: {
      '/poses': (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '姿势库是只读的，只接受 GET。' })
          return
        }
        const params = url.searchParams
        try {
          const result = index.search({
            query: params.get('q') ?? '',
            systemId: params.get('system') ?? '',
            category: params.get('category') ?? '',
            // 面板的勾选与工具的默认值走同一个语义：不显式要，就不给成人向
            includeAdult: params.get('adult') === '1' || params.get('adult') === 'true',
            limit: Number(params.get('limit') ?? '') || undefined,
            offset: Number(params.get('offset') ?? '') || undefined,
          })
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'index-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/poses/stats': (_url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        try {
          sendJson(res, 200, { ok: true, ...index.stats() })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'index-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/poses/image': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const found = index.findView(url.searchParams.get('id') ?? '')
        if (found === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-pose', message: '没有这个姿势视角。' })
          return
        }
        const size = url.searchParams.get('size') === 'full' ? 'full' : 'thumb'
        const relativePath = size === 'full' ? found.view.full : found.view.thumb
        try {
          const image = await images.fetch(relativePath)
          res.writeHead(200, {
            'Content-Type': image.mediaType,
            // 图是内容稳定的（文件名带姿势编号与角度），缓存一天足够
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': String(image.buffer.length),
          })
          res.end(image.buffer)
        } catch (error) {
          // 上游读不到是**正常的外部状态**，不是本插件的 500。
          // 面板据此显示"线稿暂时取不到"，而不是当成崩溃。
          sendJson(res, 502, {
            ok: false,
            error: 'upstream-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },

      '/poses/fetch': async (_url, res, req) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 POST。' })
          return
        }
        let body: Record<string, unknown>
        try {
          body = await readJson(req)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
          return
        }
        const found = index.findView(typeof body.id === 'string' ? body.id : '')
        if (found === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-pose', message: '没有这个姿势视角。' })
          return
        }
        const size = body.size === 'full' ? 'full' : 'thumb'
        const relativePath = size === 'full' ? found.view.full : found.view.thumb
        try {
          const { file, mediaType } = await images.materialize(relativePath, uploadsDir())
          sendJson(res, 200, {
            ok: true,
            file,
            mediaType,
            pose: { id: found.pose.id, name: found.pose.name, angle: found.view.angle, viewId: found.view.id },
          })
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: 'upstream-failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
      },

      '/poses/cache': (_url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        sendJson(res, 200, { ok: true, ...images.stats() })
      },
    },
  }
}
