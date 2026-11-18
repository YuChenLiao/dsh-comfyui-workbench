/**
 * 角色库的 HTTP 路由。
 *
 * 五条，与姿势库 / 服装库同构：
 * - `GET /characters`        搜索（`q` / `brand` / `limit` / `offset`）
 * - `GET /characters/stats`  数量与品牌分布
 * - `GET /characters/image`  图代理（`id` + `slot`）
 * - `POST /characters/fetch` 落盘到 uploads，返回绝对路径 —— 给工作流当参考图
 * - `GET /characters/cache`  缓存状态，排查用
 *
 * `/characters/fetch` 是写接口，在 `src/http/router.ts` 里走 `selfManaged` 前缀
 * （与 `/poses/`、`/costumes/` 同处理）。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

import { sendJson } from '../../../shared/http/respond.js'
import type { PoseImages } from '../../panel-poses/server/images.js'
import type { CharactersIndex } from './catalog.js'

export interface CharacterRoutesDeps {
  index: CharactersIndex
  /** 与姿势库共用同一份实现，只是换了 origin、路径白名单与缓存目录。 */
  images: PoseImages
  /** uploads 目录。调用时取，配置可以在运行中改。 */
  uploadsDir: () => string
}

export interface CharacterRoutes {
  exact: Record<string, (url: URL, res: ServerResponse, req: IncomingMessage) => Promise<void> | void>
}

/** 槽位名只认这五个，别的一律 400（避免拼出任意路径）。 */
const SLOTS = new Set(['preview', 'sheet', 'turnaround', 'expression', 'outfit', 'props'])

/** 落盘文件名：`<id>_<slot>.<ext>`。不带角色名——路径里的中文不适合当文件名。 */
function targetNameOf(id: string, slot: string, relativePath: string): string {
  const ext = /\.(png|jpe?g|webp)$/i.exec(relativePath)?.[1]?.toLowerCase() ?? 'png'
  return `${id}_${slot}.${ext}`
}

export function createCharacterRoutes(deps: CharacterRoutesDeps): CharacterRoutes {
  const requireSlot = (id: string, slot: string, res: ServerResponse): string | undefined => {
    if (SLOTS.has(slot) === false) {
      sendJson(res, 400, { ok: false, error: 'bad-slot', message: `slot 只接受 ${[...SLOTS].join(' / ')}。` })
      return undefined
    }
    const found = deps.index.get(id)
    if (found === undefined) {
      sendJson(res, 404, { ok: false, error: 'not-found', message: `没有这个角色：${id}` })
      return undefined
    }
    const rel = slot === 'preview' ? found.preview : found.slots[slot]?.path
    if (rel === undefined) {
      sendJson(res, 404, { ok: false, error: 'no-slot', message: `${found.name} 没有 ${slot} 这一槽` })
      return undefined
    }
    return rel
  }

  return {
    exact: {
      '/characters': (url, res) => {
        const result = deps.index.search({
          query: url.searchParams.get('q') ?? '',
          brand: url.searchParams.get('brand') ?? '',
          limit: Number(url.searchParams.get('limit') ?? 40),
          offset: Number(url.searchParams.get('offset') ?? 0),
        })
        sendJson(res, 200, { ok: true, ...result })
      },
      '/characters/stats': (_url, res) => {
        sendJson(res, 200, { ok: true, ...deps.index.stats() })
      },
      '/characters/image': async (url, res) => {
        const id = (url.searchParams.get('id') ?? '').trim()
        const slot = (url.searchParams.get('slot') ?? 'preview').trim()
        const rel = requireSlot(id, slot, res)
        if (rel === undefined) return
        try {
          const image = await deps.images.fetch(rel)
          res.writeHead(200, {
            'Content-Type': image.mediaType,
            'Content-Length': String(image.buffer.length),
            'Cache-Control': 'public, max-age=86400',
          })
          res.end(image.buffer)
        } catch (error) {
          sendJson(res, 502, { ok: false, error: 'fetch-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },
      '/characters/fetch': async (url, res, req) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这条只接受 POST。' })
          return
        }
        const id = (url.searchParams.get('id') ?? '').trim()
        const slot = (url.searchParams.get('slot') ?? 'turnaround').trim()
        const rel = requireSlot(id, slot, res)
        if (rel === undefined) return
        try {
          const dir = deps.uploadsDir()
          // 角色图的 basename 全都一样（`横版完整设定图_01_三视图_查看用.jpg`），
          // 必须指定落盘名，否则 20 个角色互相覆盖。
          const out = await deps.images.materialize(rel, dir, targetNameOf(id, slot, rel))
          sendJson(res, 200, { ok: true, file: out.file, mediaType: out.mediaType, id, slot })
        } catch (error) {
          sendJson(res, 502, { ok: false, error: 'fetch-failed', message: error instanceof Error ? error.message : String(error) })
        }
      },
      '/characters/cache': (_url, res) => {
        sendJson(res, 200, { ok: true, ...deps.images.stats() })
      },
    },
  }
}
