import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Settings } from '../host/config.js'
import type { AssetIndex, AssetStatus } from '../store/index.js'
import { rebuildFromSidecars } from '../store/index.js'
import type { ComfyClient, ComfySupervisor } from '../comfy/index.js'
import type { HostContext } from '../host/types.js'
import { isAuthorized } from '../assets/authorize.js'
import { rootsOf } from '../assets/roots.js'
import { clearScanCache } from '../assets/scan-cache.js'
import {
  collectWorkflows,
  deleteMany,
  deleteOne,
  queryItems,
  UnknownRootError,
} from '../assets/service.js'
import { ensureThumb } from '../assets/thumbs.js'
import { buildZip } from '../assets/zip.js'
import { mimeOf, readFullSidecar } from '../scan/index.js'
import { pathsFromBody, readJsonBody, sendJson } from './respond.js'
import { createRunHandler } from './run-api.js'
import { handleServiceStatus, handleServiceStop } from './service-api.js'
import { handleWorkflowDetail, handleWorkflowList, workflowIdFromPath } from './workflows-api.js'

/** API 前缀。统一挂在独立前缀下，避免和 SPA fallback 抢路径。 */
export const PREFIX = '/comfyui-workbench/api'

/** 路由处理器签名。 */
type Route = (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>

/** 需要写操作的子路径（其余一律只读）。 */
const WRITABLE = new Set(['/delete', '/delete-many', '/assets/rebuild', '/run', '/service/stop'])

/** 这些只接受 POST（DELETE 语义上没有意义，不该被放行）。 */
const POST_ONLY = new Set(['/run'])

/**
 * 构造请求处理器。
 *
 * 只做三件事：解析输入、调 service、写响应。业务逻辑全在 assets/service 里，
 * 这里不出现"删文件"或"合并副本"这类细节 —— 换 HTTP 框架时这个文件可以整体替换。
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
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const roots = (): ReturnType<typeof rootsOf> => rootsOf(ctx, settings)

  const handleRoots = (_url: URL, res: ServerResponse): void => {
    const list = roots()
    sendJson(res, 200, { ok: true, roots: list.map(root => ({ ...root, id: root.path })) })
  }

  const handleItems = (url: URL, res: ServerResponse): void => {
    const list = roots()
    if (list.length === 0) {
      sendJson(res, 200, { ok: true, items: [], total: 0, truncated: false, roots: [] })
      return
    }
    const query = {
      root: url.searchParams.get('root') ?? 'all',
      q: (url.searchParams.get('q') ?? '').trim().toLowerCase(),
      all: url.searchParams.get('all') === '1',
      refresh: url.searchParams.get('refresh') === '1',
      dedupe: url.searchParams.get('dedupe') !== '0',
      offset: Math.max(0, Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0),
      limit: Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '60', 10) || 60)),
    }

    try {
      const page = queryItems(list, settings, query)
      sendJson(res, 200, { ok: true, ...page })
    } catch (error) {
      if (error instanceof UnknownRootError) {
        sendJson(res, 400, { ok: false, error: 'unknown-root', message: error.message })
        return
      }
      throw error
    }
  }

  const handleMeta = (url: URL, res: ServerResponse): void => {
    const target = url.searchParams.get('path') ?? ''
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: 'forbidden', message: '这个路径不在资产库的白名单里。' })
      return
    }
    const meta = readFullSidecar(target)
    if (meta === undefined) {
      sendJson(res, 404, { ok: false, error: 'no-metadata', message: '这张图片没有可读的元数据（sidecar）。' })
      return
    }
    sendJson(res, 200, { ok: true, meta })
  }

  const handleWorkflow = (url: URL, res: ServerResponse): void => {
    const target = url.searchParams.get('path') ?? ''
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: 'forbidden', message: '这个路径不在资产库的白名单里。' })
      return
    }
    const meta = readFullSidecar(target)
    const workflow = meta?.workflow
    if (workflow === undefined || workflow === null) {
      sendJson(res, 404, { ok: false, error: 'no-workflow', message: '这张图片没有记录工作流。' })
      return
    }
    const body = `${JSON.stringify(workflow, null, 2)}\n`
    const filename = `${path.basename(target, path.extname(target))}.workflow.json`
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Content-Disposition': `attachment; filename="${filename.replace(/["\\]/g, '_')}"`,
      'Cache-Control': 'no-store',
    })
    res.end(body)
  }

  const handleFile = async (url: URL, res: ServerResponse): Promise<void> => {
    const target = url.searchParams.get('path') ?? ''
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: 'forbidden', message: '这个路径不在资产库的白名单里。' })
      return
    }

    let stat: fs.Stats
    try {
      stat = fs.statSync(target)
    } catch {
      sendJson(res, 404, { ok: false, error: 'missing', message: '文件已经不在了。' })
      return
    }
    if (!stat.isFile()) {
      sendJson(res, 400, { ok: false, error: 'not-a-file', message: '路径不是文件。' })
      return
    }

    if (url.searchParams.get('thumb') === '1') {
      const thumb = await ensureThumb(target, stat)
      if (thumb !== undefined) {
        try {
          const thumbStat = fs.statSync(thumb)
          res.writeHead(200, {
            'Content-Type': 'image/webp',
            'Content-Length': thumbStat.size,
            'Cache-Control': 'private, max-age=86400',
          })
          const thumbStream = fs.createReadStream(thumb)
          thumbStream.on('error', () => { res.destroy() })
          thumbStream.pipe(res)
          return
        } catch {
          // 缩略图刚被清掉：回退原图
        }
      }
    }

    res.writeHead(200, {
      'Content-Type': mimeOf(target),
      'Content-Length': stat.size,
      'Cache-Control': 'private, max-age=86400',
    })
    const stream = fs.createReadStream(target)
    stream.on('error', () => { res.destroy() })
    stream.pipe(res)
  }

  const statusForCode = (code: string | undefined): number => {
    if (code === 'forbidden') return 403
    if (code === 'missing') return 404
    if (code === 'delete-failed') return 500
    return 400
  }

  const handleDelete = (url: URL, res: ServerResponse): void => {
    const result = deleteOne(url.searchParams.get('path') ?? '', roots())
    if (result.error !== undefined) {
      sendJson(res, statusForCode(result.code), { ok: false, error: result.code, message: result.error })
      return
    }
    clearScanCache()
    sendJson(res, 200, { ok: true, removed: result.removed })
  }

  const handleDeleteMany = async (_url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> => {
    let body: Record<string, unknown>
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
      return
    }
    const paths = pathsFromBody(body, 500)
    if (paths === undefined) {
      sendJson(res, 400, { ok: false, error: 'bad-paths', message: '请求里需要 1–500 个 paths。' })
      return
    }
    const result = deleteMany(paths, roots())
    clearScanCache()
    sendJson(res, 200, { ok: true, ...result })
  }

  const handleWorkflows = async (_url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> => {
    let body: Record<string, unknown>
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
      return
    }
    const paths = pathsFromBody(body, 500)
    if (paths === undefined) {
      sendJson(res, 400, { ok: false, error: 'bad-paths', message: '请求里需要 1–500 个 paths。' })
      return
    }

    const { entries, skipped } = collectWorkflows(paths, roots(), readFullSidecar)
    if (entries.length === 0) {
      sendJson(res, 404, { ok: false, error: 'no-workflow', message: '选中的图片都没有可导出的工作流。' })
      return
    }

    const zip = buildZip(entries)
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Length': zip.length,
      'Content-Disposition': `attachment; filename="comfyui-workbench-workflows-${stamp}.zip"`,
      'X-Workbench-Skipped': String(skipped),
      'Cache-Control': 'no-store',
    })
    res.end(zip)
  }

  /** 资产检索：索引是派生层，查不到不等于文件不存在（可重建）。 */
  const handleAssets = (url: URL, res: ServerResponse): void => {
    const tags = url.searchParams.getAll('tag').filter(tag => tag !== '')
    const kindRaw = url.searchParams.get('kind') ?? ''
    const statusRaw = url.searchParams.get('status') ?? ''
    const kind = ['image', 'video', 'audio', 'file'].includes(kindRaw)
      ? (kindRaw as 'image' | 'video' | 'audio' | 'file')
      : undefined
    const status = ['present', 'missing', 'archived'].includes(statusRaw) ? (statusRaw as AssetStatus) : undefined

    const page = index.search({
      ...(url.searchParams.get('q') === null ? {} : { q: url.searchParams.get('q') ?? '' }),
      ...(url.searchParams.get('workflow') === null ? {} : { workflow: url.searchParams.get('workflow') ?? '' }),
      ...(tags.length === 0 ? {} : { tag: tags }),
      ...(kind === undefined ? {} : { kind }),
      ...(status === undefined ? {} : { status }),
      ...(url.searchParams.get('since') === null ? {} : { since: url.searchParams.get('since') ?? '' }),
      ...(url.searchParams.get('until') === null ? {} : { until: url.searchParams.get('until') ?? '' }),
      ...(url.searchParams.get('cursor') === null ? {} : { cursor: url.searchParams.get('cursor') ?? '' }),
      limit: Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '60', 10) || 60)),
    })
    sendJson(res, 200, { ok: true, total: page.items.length, items: page.items, next: page.next ?? null })
  }

  /** 从 sidecar 重建索引（不是重新扫描磁盘列表，而是把索引整个换掉）。 */
  const handleRebuild = (url: URL, res: ServerResponse): void => {
    const list = roots()
    if (list.length === 0) {
      sendJson(res, 200, { ok: true, rebuilt: 0, roots: 0 })
      return
    }
    const records = rebuildFromSidecars(list.map(root => root.path), {
      maxDepth: settings.maxDepth,
      maxItems: settings.maxItems,
      includeHidden: settings.includeHidden,
    })
    index.rewrite(records)
    sendJson(res, 200, { ok: true, rebuilt: records.length, roots: list.length })
  }

  const routes: Record<string, Route> = {
    '/assets': handleAssets,
    '/assets/rebuild': handleRebuild,
    '/roots': handleRoots,
    '/items': handleItems,
    '/meta': handleMeta,
    '/workflow': handleWorkflow,
    '/file': handleFile,
    '/delete': handleDelete,
    '/delete-many': handleDeleteMany,
    '/run': createRunHandler({ client, workflowDir, settings, assertWritable }),
    '/service': handleServiceStatus.bind(null, supervisor),
    '/service/stop': handleServiceStop.bind(null, supervisor),
  }

  return async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1')
      const sub = url.pathname.slice(PREFIX.length) || '/'

      // ── 工作流：GET 列表 / POST 批量导出 / GET {id} 单份 ──
      // 放通用分派之前：这里的方法语义与"writable 集合"不一致（同一路径两种方法）。
      if (sub === '/workflows') {
        if (req.method === 'GET' || req.method === 'HEAD') return handleWorkflowList(workflowDir, url, res)
        if (req.method === 'POST') return handleWorkflows(url, res, req)
        sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '/workflows 只接受 GET（列表）或 POST（批量导出）。' })
        return
      }
      const detailId = workflowIdFromPath(sub)
      if (detailId !== undefined) {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '这个接口是只读的。' })
          return
        }
        handleWorkflowDetail(workflowDir, detailId, res)
        return
      }

      const writable = WRITABLE.has(sub)
      const methodOk = POST_ONLY.has(sub)
        ? req.method === 'POST'
        : writable
          ? req.method === 'POST' || req.method === 'DELETE'
          : req.method === 'GET' || req.method === 'HEAD'
      if (!methodOk) {
        sendJson(res, 405, {
          ok: false,
          error: 'method-not-allowed',
          message: writable ? '这个接口只接受 POST / DELETE。' : '这个接口是只读的。',
        })
        return
      }
      if (sub === '/') {
        sendJson(res, 200, { ok: true, plugin: 'dsh-comfyui-workbench' })
        return
      }
      const route = routes[sub]
      if (route === undefined) {
        sendJson(res, 404, { ok: false, error: 'unknown-route', message: `没有这个接口：${sub}` })
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
