/**
 * 服装库的 HTTP 路由。
 *
 * 五条，与姿势库同构：
 * - `GET /costumes`        搜索（`q` / `category` / `safe` / `limit` / `offset`）
 * - `GET /costumes/stats`  分类计数
 * - `GET /costumes/image`  服装图代理（`id` + `size=thumb|preview|full`）
 * - `POST /costumes/fetch` 落盘到 uploads，返回绝对路径 —— 给工作流当参考图
 * - `GET /costumes/cache`  缓存状态，排查用
 *
 * `/costumes/fetch` 是写接口，在 router 里走 `selfManaged` 前缀（与 `/poses/` 同处理），
 * `tests/api.test.mjs` 里有走真实入口的用例。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../../../shared/http/respond.js'
import type { CostumeItem, CostumesIndex } from './catalog.js'
import type { PoseImages } from '../../panel-poses/server/images.js'

export interface CostumeRoutesDeps {
  index: CostumesIndex
  /** 取图器与姿势库共用同一个实现，只是换了路径白名单与缓存目录。 */
  images: PoseImages
  /** uploads 目录。调用时取，配置可以在运行中改。 */
  uploadsDir: () => string
}

export interface CostumeRoutes {
  exact: Record<string, (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> | void>
}

const MAX_BODY = 4 * 1024

/** 三种尺寸对应的字段名。 */
type Size = 'thumb' | 'preview' | 'full'

function fileOf(item: CostumeItem, size: Size): string {
  if (size === 'thumb') return item.thumb
  if (size === 'preview') return item.preview
  return item.full
}

function sizeOf(value: string | null | undefined): Size {
  return value === 'full' ? 'full' : value === 'preview' ? 'preview' : 'thumb'
}

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

export function createCostumeRoutes(deps: CostumeRoutesDeps): CostumeRoutes {
  const { index, images, uploadsDir } = deps

  return {
    exact: {
      '/costumes': (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '服装库是只读的，只接受 GET。' })
          return
        }
        const params = url.searchParams
        try {
          const result = index.search({
            query: params.get('q') ?? '',
            category: params.get('category') ?? '',
            // 默认全给；`safe=1` 才收窄。筛选是使用者的选择。
            onlySafe: params.get('safe') === '1' || params.get('safe') === 'true',
            limit: Number(params.get('limit') ?? '') || undefined,
            offset: Number(params.get('offset') ?? '') || undefined,
          })
          sendJson(res, 200, { ok: true, ...result })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'index-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/costumes/stats': (_url, res, req) => {
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

      '/costumes/image': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const item = index.get(url.searchParams.get('id') ?? '')
        if (item === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-costume', message: '没有这套服装。' })
          return
        }
        const size = sizeOf(url.searchParams.get('size'))
        try {
          const image = await images.fetch(fileOf(item, size))
          res.writeHead(200, {
            'Content-Type': image.mediaType,
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': String(image.buffer.length),
          })
          res.end(image.buffer)
        } catch (error) {
          // 上游读不到是正常的外部状态，不是本插件的 500
          sendJson(res, 502, { ok: false, error: 'upstream-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/costumes/fetch': async (_url, res, req) => {
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
        const item = index.get(typeof body.id === 'string' ? body.id : '')
        if (item === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-costume', message: '没有这套服装。' })
          return
        }
        const size = sizeOf(typeof body.size === 'string' ? body.size : undefined)
        try {
          const { file, mediaType } = await images.materialize(fileOf(item, size), uploadsDir())
          sendJson(res, 200, {
            ok: true,
            file,
            mediaType,
            costume: { id: item.id, name: item.name, category: item.category, keywords: item.keywords },
          })
        } catch (error) {
          sendJson(res, 502, { ok: false, error: 'upstream-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/costumes/cache': (_url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        sendJson(res, 200, { ok: true, ...images.stats() })
      },
    },
  }
}
