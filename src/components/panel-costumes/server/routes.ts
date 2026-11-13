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
  /**
   * 动画版（1320 套二次元风）。给了面板才能切过去；不给就只有写实版。
   *
   * 与写实版**原站、路径白名单、缓存目录、uploads 子目录全部分开** ——
   * 两库 id 都是 `SPR-xxxx`，混用会拿到同号的另一套衣服。
   */
  anime?: { index: CostumesIndex; images: PoseImages; uploadsDir: () => string } | undefined
}

/** 一条路由要用的三件东西（按 source 选一套）。 */
interface Store { index: CostumesIndex; images: PoseImages; uploadsDir: () => string }

/**
 * 按 `?source=` 选库。
 *
 * 认不出的 source 一律回写实版（面板只会在两个值之间切），
 * 但 `anime` 没挂上时返回 `undefined` —— 那种情况要明确报错，不能悄悄给写实版。
 */
function pickStore(deps: CostumeRoutesDeps, raw: string | null): Store | undefined {
  if (raw !== 'anime') return { index: deps.index, images: deps.images, uploadsDir: deps.uploadsDir }
  return deps.anime
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
  /** 拿不到库时统一回一句可读的 404，别让面板显示"空库"。 */
  const missing = (res: ServerResponse): void => {
    sendJson(res, 404, { ok: false, error: 'no-anime-library', message: '这个安装没接动画版衣装库。' })
  }

  return {
    exact: {
      '/costumes': (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '服装库是只读的，只接受 GET。' })
          return
        }
        const params = url.searchParams
        const store = pickStore(deps, params.get('source'))
        if (store === undefined) { missing(res); return }
        try {
          const result = store.index.search({
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
        const store = pickStore(deps, _url.searchParams.get('source'))
        if (store === undefined) { missing(res); return }
        try {
          sendJson(res, 200, { ok: true, ...store.index.stats() })
        } catch (error) {
          sendJson(res, 500, { ok: false, error: 'index-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },

      '/costumes/image': async (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const store = pickStore(deps, url.searchParams.get('source'))
        if (store === undefined) { missing(res); return }
        const item = store.index.get(url.searchParams.get('id') ?? '')
        if (item === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-costume', message: '没有这套服装。' })
          return
        }
        const size = sizeOf(url.searchParams.get('size'))
        try {
          const image = await store.images.fetch(fileOf(item, size))
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
        const store = pickStore(deps, typeof body.source === 'string' ? body.source : null)
        if (store === undefined) { missing(res); return }
        const item = store.index.get(typeof body.id === 'string' ? body.id : '')
        if (item === undefined) {
          sendJson(res, 404, { ok: false, error: 'unknown-costume', message: '没有这套服装。' })
          return
        }
        const size = sizeOf(typeof body.size === 'string' ? body.size : undefined)
        try {
          const { file, mediaType } = await store.images.materialize(fileOf(item, size), store.uploadsDir())
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

      '/costumes/cache': (url, res, req) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 GET。' })
          return
        }
        const store = pickStore(deps, url.searchParams.get('source'))
        if (store === undefined) { missing(res); return }
        sendJson(res, 200, { ok: true, ...store.images.stats() })
      },
    },
  }
}
