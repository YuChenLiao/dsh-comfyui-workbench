/**
 * 本地自检：用真实 HTTP 请求验证宿主 API 的契约（不启动 DSH）。
 *
 * 覆盖：/items（含元数据摘要与筛选）、/meta、/workflow 下载头、/file 字节、
 * PNG 内嵌工作流（没有 sidecar 的 ComfyUI 直出图）、路径越权 403、未知路由 404、
 * 非 GET 405、以及删除的全部边界。
 */
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { listenSafe } from './helpers.mjs'



/** CRC32（PNG chunk 需要）。 */
function crc32(buffer) {
  const table = crc32.table ?? (crc32.table = (() => {
    const values = new Int32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
      values[n] = c
    }
    return values
  })())
  let crc = -1
  for (let i = 0; i < buffer.length; i += 1) crc = (crc >>> 8) ^ table[(crc ^ buffer[i]) & 0xff]
  return (crc ^ -1) >>> 0
}

/** 拼一个带 tEXt 块的 PNG（模拟 ComfyUI SaveImage 的产物）。 */
function buildPng(textGraph, width = 1, height = 1) {
  const chunk = (type, data) => {
    const length = Buffer.alloc(4)
    length.writeUInt32BE(data.length)
    const typeBuffer = Buffer.from(type, 'ascii')
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))
    return Buffer.concat([length, typeBuffer, data, crc])
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc((width * 3 + 1) * height)
  const text = Buffer.concat([
    Buffer.from('prompt\0', 'latin1'),
    Buffer.from(JSON.stringify(textGraph), 'latin1'),
  ])
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('tEXt', text),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cfa-smoke-'))
// 插件的数据目录由 USERPROFILE 决定；不隔离的话 roots 会扫到本机真实产物
process.env.USERPROFILE = root
process.env.HOME = root

const { applyAll } = await import('../lib/index.js')
const nested = path.join(root, 'out')
fs.mkdirSync(nested, { recursive: true })

// 1×1 透明 PNG
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const imagePath = path.join(nested, 'comfyui-20260101-000000-abcd.png')
fs.writeFileSync(imagePath, png)
fs.writeFileSync(`${imagePath}.json`, JSON.stringify({
  plugin: 'dsh-comfyui-image',
  prompt: 'a lighthouse on a cliff, dusk',
  negativePrompt: 'blurry',
  seed: 42,
  width: 1,
  height: 1,
  steps: 20,
  cfgScale: 7,
  checkpoint: 'sd_xl_base_1.0.safetensors',
  samplerName: 'euler',
  scheduler: 'normal',
  mode: 'text2img',
  createdAt: '2026-01-01T00:00:00.000Z',
  workflow: { '3': { class_type: 'KSampler' } },
}, null, 2))

// 同目录下没有 sidecar 的图片：默认不出现，all=1 时出现
fs.writeFileSync(path.join(root, 'bare.png'), png)
// 越权目录
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'cfa-outside-'))
const outsideImage = path.join(outside, 'secret.png')
fs.writeFileSync(outsideImage, png)

let route = null
const ctx = {
  get(name) {
    if (name === 'webServer') {
      return {
        register(candidate) {
          route = candidate
          return () => { route = null }
        },
      }
    }
    if (name === 'workingDirectory') return { defaultDirectory: root }
    return undefined
  },
  effect(callback) {
    callback()
    return () => {}
  },
}

// 宿主会把进程 cwd 也算作一个根目录。这里把 cwd 切到临时目录，
// 免得插件自己目录里的图片（例如 README 截图）污染计数断言。
const previousCwd = process.cwd()
process.chdir(root)

// roots 现在还会并入插件数据目录（uploads / 默认 outputs），测试必须把它们也指到临时目录，
// 否则会扫到本机真实的 ~/.dsh-comfyui-workbench 里的图。
const isoDir = path.join(root, 'iso')
fs.mkdirSync(isoDir, { recursive: true })
applyAll(ctx, {
  roots: [],
  maxDepth: 2,
  maxItems: 100,
  cacheMs: 0,
  outputDir: isoDir,
  uploadsDir: isoDir,
})

assert.ok(route, 'webServer.register 应当被调用')
assert.equal(route.kind, 'prefix')
assert.equal(route.path, '/comfyui-workbench/api')

const server = http.createServer(route.handler)
const port = await listenSafe(server)
const origin = `http://127.0.0.1:${port}`
const get = async (pathname) => {
  const res = await fetch(origin + pathname)
  const type = res.headers.get('content-type') || ''
  const body = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, body }
}

try {
  const rootsRes = await get('/comfyui-workbench/api/roots')
  assert.equal(rootsRes.status, 200)
  assert.equal(rootsRes.body.roots[0].path, fs.realpathSync.native(root))

  const list = await get('/comfyui-workbench/api/items?limit=10')
  assert.equal(list.status, 200)
  assert.equal(list.body.total, 1, '默认只列带 sidecar 的图')
  const item = list.body.items[0]
  assert.equal(item.path, imagePath)
  assert.equal(item.hasMeta, true)
  assert.equal(item.prompt, 'a lighthouse on a cliff, dusk')
  assert.equal(item.seed, 42)
  assert.equal(item.workflow, true)

  const withBare = await get('/comfyui-workbench/api/items?limit=10&all=1')
  assert.equal(withBare.body.total, 2, 'all=1 时包含没有元数据的图')

  const filtered = await get('/comfyui-workbench/api/items?limit=10&q=lighthouse')
  assert.equal(filtered.body.total, 1)
  const miss = await get('/comfyui-workbench/api/items?limit=10&q=not-there')
  assert.equal(miss.body.total, 0)

  // 越界 offset 必须返回空批次（客户端据此停手，否则底部会无限重拉）
  const pastEnd = await get('/comfyui-workbench/api/items?limit=10&offset=999')
  assert.equal(pastEnd.body.total, 1)
  assert.deepEqual(pastEnd.body.items, [])

  const meta = await get('/comfyui-workbench/api/meta?path=' + encodeURIComponent(imagePath))
  assert.equal(meta.status, 200)
  assert.equal(meta.body.meta.seed, 42)

  const workflow = await get('/comfyui-workbench/api/workflow?path=' + encodeURIComponent(imagePath))
  assert.equal(workflow.status, 200)
  assert.match(workflow.headers.get('content-disposition') || '', /attachment; filename="comfyui-20260101-000000-abcd\.workflow\.json"/)
  assert.deepEqual(workflow.body, { '3': { class_type: 'KSampler' } })

  const file = await get('/comfyui-workbench/api/file?path=' + encodeURIComponent(imagePath))
  assert.equal(file.status, 200)
  assert.equal(file.headers.get('content-type'), 'image/png')
  assert.equal(file.body.length, png.length)

  // 缩略图：sharp 可用时是 webp，不可用时安静回退原图 —— 两种都算过。
  const thumb = await get('/comfyui-workbench/api/file?thumb=1&path=' + encodeURIComponent(imagePath))
  assert.equal(thumb.status, 200)
  assert.match(thumb.headers.get('content-type') || '', /^image\/(webp|png)$/)

  const forbidden = await get('/comfyui-workbench/api/file?path=' + encodeURIComponent(outsideImage))
  assert.equal(forbidden.status, 403)
  const traversal = await get('/comfyui-workbench/api/file?path=' + encodeURIComponent(path.join(root, '..', '..', 'etc', 'passwd')))
  assert.equal(traversal.status, 403)

  const missingRoute = await get('/comfyui-workbench/api/nope')
  assert.equal(missingRoute.status, 404)

  const post = await fetch(origin + '/comfyui-workbench/api/items', { method: 'POST' })
  assert.equal(post.status, 405)

  const noMeta = await get('/comfyui-workbench/api/meta?path=' + encodeURIComponent(path.join(root, 'bare.png')))
  assert.equal(noMeta.status, 404)

  // ── 删除 ──
  const delForbidden = await fetch(origin + '/comfyui-workbench/api/delete?path=' + encodeURIComponent(outsideImage), { method: 'POST' })
  assert.equal(delForbidden.status, 403)

  const delViaGet = await get('/comfyui-workbench/api/delete?path=' + encodeURIComponent(imagePath))
  assert.equal(delViaGet.status, 405)

  const textFile = path.join(root, 'note.txt')
  fs.writeFileSync(textFile, 'x')
  const delNotImage = await fetch(origin + '/comfyui-workbench/api/delete?path=' + encodeURIComponent(textFile), { method: 'POST' })
  assert.equal(delNotImage.status, 400)
  assert.equal(fs.existsSync(textFile), true, '非图片文件不该被删')

  // 预置一份缩略图缓存，验证删除会把它一起清掉（不留残影）
  const thumbDir = path.join(os.tmpdir(), 'dsh-comfyui-workbench-thumbs')
  fs.mkdirSync(thumbDir, { recursive: true })
  const imageStat = fs.statSync(imagePath)
  const thumbKey = crypto.createHash('sha1')
    .update(`${imagePath.toLowerCase()}|${imageStat.mtimeMs}|${imageStat.size}|360`)
    .digest('hex')
  const thumbFile = path.join(thumbDir, `${thumbKey}.webp`)
  fs.writeFileSync(thumbFile, 'stale')

  const del = await fetch(origin + '/comfyui-workbench/api/delete?path=' + encodeURIComponent(imagePath), { method: 'POST' })
  assert.equal(del.status, 200)
  const delBody = await del.json()
  assert.deepEqual(delBody.removed.slice().sort(), [imagePath, `${imagePath}.json`].sort())
  assert.equal(fs.existsSync(imagePath), false, '图片应被删除')
  assert.equal(fs.existsSync(`${imagePath}.json`), false, 'sidecar 应一并删除')
  assert.equal(fs.existsSync(thumbFile), false, '缩略图缓存应一并清掉')

  const listAfterDelete = await get('/comfyui-workbench/api/items?limit=10&refresh=1')
  assert.equal(listAfterDelete.body.total, 0, '删除后不该再列出')
  const bareStill = await get('/comfyui-workbench/api/items?limit=10&all=1')
  assert.equal(bareStill.body.total, 1, '没有 sidecar 的图片不受影响')

  const delAgain = await fetch(origin + '/comfyui-workbench/api/delete?path=' + encodeURIComponent(imagePath), { method: 'POST' })
  assert.equal(delAgain.status, 404)

  // ── PNG 内嵌工作流：没有 sidecar 的 ComfyUI 直出图，也要算「生成图」 ──
  const graph = {
    1: { class_type: 'UNETLoader', inputs: { unet_name: 'moss_image_base_int8_convrot.safetensors' } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: 'whale-chan by the window, soft light' } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'blurry, lowres' } },
    4: { class_type: 'EmptyLatentImage', inputs: { width: 832, height: 1216 } },
    5: {
      class_type: 'KSampler',
      inputs: {
        seed: 123456, steps: 12, cfg: 1.5, sampler_name: 'euler', scheduler: 'normal',
        positive: ['2', 0], negative: ['3', 0], model: ['1', 0],
      },
    },
  }
  const embeddedPath = path.join(root, 'whalechan_embedded.png')
  fs.writeFileSync(embeddedPath, buildPng(graph, 4, 4))

  const embeddedList = await get('/comfyui-workbench/api/items?limit=10&refresh=1')
  assert.equal(embeddedList.body.total, 1, '内嵌工作流的图应出现在「仅生成图」里')
  const embedded = embeddedList.body.items[0]
  assert.equal(embedded.name, 'whalechan_embedded.png')
  assert.equal(embedded.metaSource, 'embedded', '元数据来源应标为 embedded')
  assert.equal(embedded.prompt, 'whale-chan by the window, soft light', '应取 KSampler 的 positive 节点文本')
  assert.equal(embedded.negativePrompt, 'blurry, lowres', '应取 KSampler 的 negative 节点文本')
  assert.equal(embedded.seed, 123456)
  assert.equal(embedded.steps, 12)
  assert.equal(embedded.cfgScale, 1.5)
  // 尺寸取 PNG 的 IHDR（4x4），而不是工作流里 EmptyLatentImage 声明的 832x1216：
  // 内嵌场景没有 sidecar，真实像素才是可信来源。
  assert.equal(embedded.width, 4)
  assert.equal(embedded.height, 4)
  assert.equal(embedded.checkpoint, 'moss_image_base_int8_convrot.safetensors')
  assert.equal(embedded.workflow, true)

  const embeddedMeta = await get('/comfyui-workbench/api/meta?path=' + encodeURIComponent(embeddedPath))
  assert.equal(embeddedMeta.status, 200)
  assert.equal(embeddedMeta.body.meta.seed, 123456)

  const embeddedWorkflow = await get('/comfyui-workbench/api/workflow?path=' + encodeURIComponent(embeddedPath))
  assert.equal(embeddedWorkflow.status, 200)
  assert.deepEqual(embeddedWorkflow.body, graph, '导出的工作流应与内嵌的一致')

  // ── 去重：同一张图的两份副本（sidecar 一份 + ComfyUI 直出一份）只出现一次 ──
  const duplicatePath = path.join(root, 'whalechan_duplicate.png')
  fs.writeFileSync(duplicatePath, buildPng(graph, 4, 4))
  fs.writeFileSync(`${duplicatePath}.json`, JSON.stringify({
    plugin: 'dsh-comfyui-image',
    prompt: 'whale-chan by the window, soft light',
    seed: 123456,
    width: 4,
    height: 4,
    steps: 12,
    checkpoint: 'moss_image_base_int8_convrot.safetensors',
    workflow: graph,
  }))

  const mergedList = await get('/comfyui-workbench/api/items?limit=10&refresh=1')
  assert.equal(mergedList.body.total, 1, '同签名的两份副本应合并成一条')
  assert.equal(mergedList.body.items[0].metaSource, 'sidecar', '主项应优先选有 sidecar 的那份')
  assert.equal(mergedList.body.items[0].duplicateCount, 2)
  assert.ok(mergedList.body.items[0].duplicates.includes(embeddedPath), '副本路径要能被展开')

  const rawList = await get('/comfyui-workbench/api/items?limit=10&refresh=1&dedupe=0')
  assert.equal(rawList.body.total, 2, 'dedupe=0 时两份都应列出')

  // ── 批量导出工作流：一个 ZIP，内含每张图一份 JSON ──
  const zipRes = await fetch(origin + '/comfyui-workbench/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [embeddedPath, duplicatePath] }),
  })
  assert.equal(zipRes.status, 200)
  assert.match(zipRes.headers.get('content-type') || '', /application\/zip/)
  assert.match(zipRes.headers.get('content-disposition') || '', /comfyui-workbench-workflows-\d{14}\.zip/)
  const zipBuffer = Buffer.from(await zipRes.arrayBuffer())
  assert.equal(zipBuffer.subarray(0, 2).toString('latin1'), 'PK', '应当是 ZIP 文件')
  assert.ok(zipBuffer.includes(Buffer.from('whalechan_embedded.workflow.json')), '压缩包里要有第一份工作流')
  assert.ok(zipBuffer.includes(Buffer.from('whalechan_duplicate.workflow.json')), '压缩包里要有第二份工作流')
  assert.equal(zipRes.headers.get('x-workbench-skipped'), '0')

  // 没有任何工作流时明确报错，而不是给一个空包
  const emptyZip = await fetch(origin + '/comfyui-workbench/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [path.join(root, 'bare.png')] }),
  })
  assert.equal(emptyZip.status, 404)

  // ── 批量删除：一次删多条，越权项单独失败，不影响其它项 ──
  const bulk = await fetch(origin + '/comfyui-workbench/api/delete-many', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ paths: [embeddedPath, duplicatePath, outsideImage] }),
  })
  assert.equal(bulk.status, 200)
  const bulkBody = await bulk.json()
  assert.equal(bulkBody.failed.length, 1, '越权路径应当单独失败')
  assert.equal(bulkBody.failed[0].error, 'forbidden')
  assert.equal(bulkBody.removed.length, 3, '两张图 + 一个 sidecar')
  assert.equal(fs.existsSync(embeddedPath), false)
  assert.equal(fs.existsSync(duplicatePath), false)
  assert.equal(fs.existsSync(`${duplicatePath}.json`), false)
  assert.equal(fs.existsSync(outsideImage), true, '白名单外的文件不能被删')

  console.log('smoke: 全部通过（列表/筛选/分页/元数据/工作流/图片/缩略图/内嵌工作流/去重/批量导出/批量删除 + 删除边界）')
} finally {
  server.close()
  process.chdir(previousCwd)
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
}
