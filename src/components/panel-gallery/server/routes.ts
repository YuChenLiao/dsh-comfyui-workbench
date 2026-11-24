import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

import type { Settings } from '../../../shared/host/config.js'
import type { AssetIndex, AssetStatus } from './store/index.js'
import { rebuildFromSidecars } from './store/index.js'
import type { HostContext } from '../../../shared/host/types.js'
import { foldPathCase } from '../../../shared/host/paths.js'
import { isAuthorized } from './assets/authorize.js'
import { rootsOf } from './assets/roots.js'
import { clearScanCache } from './assets/scan-cache.js'
import { collectWorkflows, deleteMany, deleteOne, queryItems, UnknownRootError } from './assets/service.js'
import { emptyTrash, listTrash, restoreTrash } from './assets/trash.js'
import { ensureThumb } from './assets/thumbs.js'
import { buildZip } from './assets/zip.js'
import { mimeOf, readFullSidecar } from './scan/index.js'
import { createUploadHandler } from './upload-api.js'
import { pathsFromBody, readJsonBody, sendJson } from '../../../shared/http/respond.js'

/** 路由处理器签名。 */
export type Route = (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>

/** 相册组件对外提供的路由（全部是精确路径）。 */
export interface GalleryRouteDeps {
  /** 额外的授权根（会话级产物目录），在 rootsOf 的缓存之外追加。 */
  extraRoots?: () => readonly string[]
  ctx: HostContext
  settings: Settings
  index: AssetIndex
  uploadsDir: string
  defaultOutputDir: string
}

/**
 * 相册组件的 HTTP 面：列表、元数据、字节、缩略图、删除、索引、上传。
 *
 * 这些 handler 只服务相册面板，所以跟着组件走 —— 关掉相册时它们连同路由一起消失。
 */
export function createGalleryRoutes(deps: GalleryRouteDeps): Record<string, Route> {
  const { ctx, settings, index, uploadsDir, defaultOutputDir } = deps
  // 产物目录已经由 index 解析好（默认在工作区下），传进来让授权根也包含它。
  const roots = (): ReturnType<typeof rootsOf> => {
    const base = rootsOf(ctx, { ...settings, resolvedOutputDir: defaultOutputDir })
    // 会话级产物目录：产物落在 <会话>/comfyui-output，而 rootsOf 只认 registry 与默认目录。
    // 不追加的话，出图成功了相册却列不出来、/file 还 403 —— 比落错地方更难查。
    const extras = deps.extraRoots?.() ?? []
    // 折叠大小写再判重：Windows 下 D:\ws 与 d:\ws 是同一处，原文比较会出两条同样的根。
    const seen = new Set(base.map(root => foldPathCase(root.path)))
    const merged = [...base]
    for (const dir of extras) {
      if (dir === '') continue
      const key = foldPathCase(dir)
      if (seen.has(key)) continue
      seen.add(key)
      merged.push({ path: dir, label: 'session-output', kind: 'workspace' })
    }
    return merged
  }

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
      // 结构化筛选（与 `q` 互补）：只要这一类，而不是模糊搜。
      // `checkpoint` 折成小写：底模文件名大小写混排（`SDXL_*` / `Realistic_Vision_*`），
      // 而占位提示让人打的是 `sdxl` —— 不折的话"照着提示打 → 空结果"。
      workflow: (url.searchParams.get('workflow') ?? '').trim(),
      checkpoint: (url.searchParams.get('checkpoint') ?? '').trim().toLowerCase(),
      aspect: ((): '' | 'landscape' | 'portrait' | 'square' => {
        const raw = (url.searchParams.get('aspect') ?? '').trim()
        return raw === 'landscape' || raw === 'portrait' || raw === 'square' ? raw : ''
      })(),
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

  const handleFile = async (url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> => {
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

    /**
     * **Range 支持**是两个具体问题的解药，不是"顺手加的规范"：
     *
     * - 灯箱里的 `<video controls>` 在服务端不认 `Range` 时**拖不动进度条** ——
     *   用户看到的是"播放器坏了"。
     * - 卡片网格一页 60 张，每个 `<video preload="metadata">` 都会发一次请求；
     *   不认 Range 就是从字节 0 起把整个文件（动辄几十 MB）流一遍。
     *
     * 只支持单区间 `bytes=start-end`（浏览器播放器只用这一种），多区间回 416 太绕，
     * 这里直接忽略 Range 回整份 —— 播放器能接受。
     */
    const range = req.headers.range
    const mime = mimeOf(target)
    const match = typeof range === 'string' ? /^bytes=(\d*)-(\d*)$/.exec(range.trim()) : null
    if (match !== null) {
      const rawStart = match[1] ?? ''
      const rawEnd = match[2] ?? ''
      // `bytes=-500` 是"最后 500 字节"；`bytes=100-` 是"从 100 到结尾"
      let start = rawStart === '' ? Number.NaN : Number.parseInt(rawStart, 10)
      let end = rawEnd === '' ? stat.size - 1 : Number.parseInt(rawEnd, 10)
      if (rawStart === '' && rawEnd !== '') {
        start = Math.max(0, stat.size - Number.parseInt(rawEnd, 10))
        end = stat.size - 1
      }
      if (Number.isFinite(start) && Number.isFinite(end) && start >= 0 && start <= end && start < stat.size) {
        const stop = Math.min(end, stat.size - 1)
        res.writeHead(206, {
          'Content-Type': mime,
          'Content-Length': stop - start + 1,
          'Content-Range': `bytes ${start}-${stop}/${stat.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'private, max-age=86400',
        })
        const ranged = fs.createReadStream(target, { start, end: stop })
        ranged.on('error', () => { res.destroy() })
        ranged.pipe(res)
        return
      }
      // 区间不合法：416 并告诉对方文件多大（播放器会自己退回从头请求）
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' })
      res.end()
      return
    }

    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, max-age=86400',
    })
    const stream = fs.createReadStream(target)
    stream.on('error', () => { res.destroy() })
    stream.pipe(res)
  }

  const statusForCode = (code: string | undefined): number => {
    if (code === 'forbidden') return 403
    if (code === 'missing') return 404
    // 落到磁盘上的失败（删不掉 / 移不进回收站 / 恢复失败）都是服务端问题
    if (code === 'delete-failed' || code === 'trash-failed' || code === 'restore-failed') return 500
    return 400
  }

  const handleDelete = (url: URL, res: ServerResponse): void => {
    // `soft=0` 才是物理删除；默认软删除 —— 产物旁的 sidecar 是"再来一张"的唯一凭据，
    // 而面板上删除是一次点击，至少要能撤回一次。
    const soft = url.searchParams.get('soft') !== '0'
    const result = deleteOne(url.searchParams.get('path') ?? '', roots(), { soft })
    if (result.error !== undefined) {
      sendJson(res, statusForCode(result.code), { ok: false, error: result.code, message: result.error })
      return
    }
    clearScanCache()
    sendJson(res, 200, { ok: true, removed: result.removed, ...(result.trashed === undefined ? {} : { trashed: result.trashed }) })
  }

  /** 回收站内容：恢复靠 `dir`（`/trash/restore` 要它）。 */
  const handleTrashList = (_url: URL, res: ServerResponse): void => {
    const entries = listTrash(roots())
    sendJson(res, 200, { ok: true, total: entries.length, entries })
  }

  const handleTrashRestore = async (_url: URL, res: ServerResponse, req: IncomingMessage): Promise<void> => {
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '恢复只接受 POST。' })
      return
    }
    let body: Record<string, unknown>
    try {
      body = await readJsonBody(req)
    } catch (error) {
      sendJson(res, 400, { ok: false, error: 'bad-body', message: error instanceof Error ? error.message : String(error) })
      return
    }
    const dir = typeof body.dir === 'string' ? body.dir : ''
    const result = restoreTrash(dir, roots())
    if (result.ok !== true) {
      sendJson(res, statusForCode(result.code), { ok: false, error: result.code, message: result.error })
      return
    }
    clearScanCache()
    sendJson(res, 200, { ok: true, restored: result.restored })
  }

  const handleTrashEmpty = (_url: URL, res: ServerResponse, req: IncomingMessage): void => {
    // 与 `/trash/restore` 统一：方法校验写在 handler 里，而不是靠 `WRITABLE` 表
    // （那张表对 POST_ONLY 之外的写路由是"POST 或 DELETE 都放行"，清空不该接受 DELETE 之外的花样）
    if (req.method !== 'POST') {
      sendJson(res, 405, { ok: false, error: 'method-not-allowed', message: '清空只接受 POST。' })
      return
    }
    const result = emptyTrash(roots())
    clearScanCache()
    sendJson(res, 200, {
      ok: true,
      removed: result.removed,
      ...(result.skipped === 0 ? {} : { skipped: result.skipped, message: `另有 ${result.skipped} 项不是本插件放进来的，没有动。` }),
    })
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
    // 与 `/delete` 同一套语义：默认软删除，`soft=0` 才是物理删除
    const soft = _url.searchParams.get('soft') !== '0'
    const result = deleteMany(paths, roots(), { soft })
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
      excludeDirs: settings.excludeDirs,
    })
    index.rewrite(records)
    sendJson(res, 200, { ok: true, rebuilt: records.length, roots: list.length })
  }

  return {
    '/assets': handleAssets,
    '/assets/rebuild': handleRebuild,
    '/roots': handleRoots,
    '/items': handleItems,
    '/meta': handleMeta,
    '/workflow': handleWorkflow,
    '/file': handleFile,
    '/delete': handleDelete,
    '/delete-many': handleDeleteMany,
    // 回收站：软删除的图在这里，可以恢复或彻底清空
    '/trash': handleTrashList,
    '/trash/restore': handleTrashRestore,
    '/trash/empty': handleTrashEmpty,
    '/upload': createUploadHandler(uploadsDir),
    // 导出的实现在相册这边（要读图、sidecar、打包），但**不挂在相册的路由表里**：
    // 同一路径的 GET（列表）属于工作流组件，两边都注册会互相覆盖。
    // 相册 entry 取出它交给 runtime，工作流组件的 POST /workflows 转发过来。
    '/workflows': handleWorkflows,

  }
}
