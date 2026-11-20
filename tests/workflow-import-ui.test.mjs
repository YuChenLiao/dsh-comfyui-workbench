/**
 * UI 格式与 PNG 导入。
 *
 * 面板原先只收 API 格式：ComfyUI 默认「保存」出来的是 UI 工程文件（`nodes` + `links`），
 * 于是"从 ComfyUI 里导出 → 粘进面板"这条最自然的路径，八成会在第一步就被拒。
 * 底层其实早就有 `convertUiToApi` 与 PNG 文本块解析，缺的只是把它们接进导入接口。
 *
 * 这组用例钉三件事：
 * 1. 有 `/object_info` 时 UI 格式能自动转换并落盘
 * 2. 拿不到 `/object_info`（ComfyUI 没起）时退回可读提示，**不是**抛栈
 * 3. ComfyUI 保存的 PNG 里能取出工作流（优先 `prompt` 块，不用联网）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import zlib from 'node:zlib'
import { test } from 'node:test'

import { handleWorkflowImport, readPngTextChunksFromBuffer } from '../lib/index.js'
import { importWorkflowValue, WorkflowFormatError } from '../lib/workflow.js'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-ui-import-'))
}

/** `/object_info` 的最小形状：只要有 widget 声明就行。 */
const OBJECT_INFO = {
  CheckpointLoaderSimple: { input: { required: { ckpt_name: [['x.safetensors'], {}] } } },
  CLIPTextEncode: { input: { required: { text: ['STRING', {}], clip: ['CLIP', {}] } } },
  KSampler: {
    input: {
      required: {
        model: ['MODEL', {}],
        seed: ['INT', {}],
        steps: ['INT', {}],
        cfg: ['FLOAT', {}],
        sampler_name: [['euler'], {}],
        scheduler: [['normal'], {}],
        positive: ['CONDITIONING', {}],
        negative: ['CONDITIONING', {}],
        latent_image: ['LATENT', {}],
        denoise: ['FLOAT', {}],
      },
    },
  },
  EmptyLatentImage: { input: { required: { width: ['INT', {}], height: ['INT', {}], batch_size: ['INT', {}] } } },
  VAEDecode: { input: { required: { samples: ['LATENT', {}], vae: ['VAE', {}] } } },
  SaveImage: { input: { required: { images: ['IMAGE', {}], filename_prefix: ['STRING', {}] } } },
}

/** 一份 UI 工程文件（ComfyUI 界面保存的那种）。 */
const UI_WORKFLOW = {
  version: 0.4,
  nodes: [
    {
      id: 1,
      type: 'CheckpointLoaderSimple',
      widgets_values: ['x.safetensors'],
      inputs: [],
      outputs: [{ name: 'MODEL', type: 'MODEL', links: [1] }, { name: 'CLIP', type: 'CLIP', links: [2] }, { name: 'VAE', type: 'VAE', links: [5] }],
    },
    {
      id: 2,
      type: 'CLIPTextEncode',
      widgets_values: ['a cat'],
      inputs: [{ name: 'clip', type: 'CLIP', link: 2 }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [3] }],
    },
    {
      id: 3,
      type: 'CLIPTextEncode',
      widgets_values: ['bad hands'],
      inputs: [{ name: 'clip', type: 'CLIP', link: 6 }],
      outputs: [{ name: 'CONDITIONING', type: 'CONDITIONING', links: [4] }],
    },
    {
      id: 4,
      type: 'KSampler',
      widgets_values: [1, 'fixed', 20, 7, 'euler', 'normal', 1],
      inputs: [
        { name: 'model', type: 'MODEL', link: 1 },
        { name: 'positive', type: 'CONDITIONING', link: 3 },
        { name: 'negative', type: 'CONDITIONING', link: 4 },
        { name: 'latent_image', type: 'LATENT', link: 7 },
      ],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [8] }],
    },
    {
      id: 5,
      type: 'EmptyLatentImage',
      widgets_values: [512, 512, 1],
      inputs: [],
      outputs: [{ name: 'LATENT', type: 'LATENT', links: [7] }],
    },
    {
      id: 6,
      type: 'VAEDecode',
      inputs: [{ name: 'samples', type: 'LATENT', link: 8 }, { name: 'vae', type: 'VAE', link: 5 }],
      outputs: [{ name: 'IMAGE', type: 'IMAGE', links: [9] }],
    },
    { id: 7, type: 'SaveImage', widgets_values: ['out'], inputs: [{ name: 'images', type: 'IMAGE', link: 9 }], outputs: [] },
  ],
  links: [
    [1, 1, 0, 4, 0, 'MODEL'],
    [2, 1, 1, 2, 0, 'CLIP'],
    [3, 2, 0, 4, 1, 'CONDITIONING'],
    [4, 3, 0, 4, 2, 'CONDITIONING'],
    [5, 1, 2, 6, 1, 'VAE'],
    [6, 1, 1, 3, 0, 'CLIP'],
    [7, 5, 0, 4, 3, 'LATENT'],
    [8, 4, 0, 6, 0, 'LATENT'],
    [9, 6, 0, 7, 0, 'IMAGE'],
  ],
}

/** 假 ServerResponse。 */
function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body },
  }
}

/** 假 IncomingMessage：headers + 可异步迭代的 body。 */
function fakeReq(buffer, headers = {}) {
  const stream = Readable.from([buffer])
  stream.headers = headers
  return stream
}

/** 手工拼一张带文本块的 PNG（解析只读 chunk 头，不校验 CRC）。 */
function pngWithText(chunks) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(512, 0)
  ihdrData.writeUInt32BE(512, 4)
  ihdrData[8] = 8
  ihdrData[9] = 6
  const parts = [signature]

  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    return Buffer.concat([head, data, Buffer.alloc(4)])
  }

  parts.push(chunk('IHDR', ihdrData))
  for (const [keyword, value] of chunks) {
    parts.push(chunk('tEXt', Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])))
  }
  parts.push(chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

test('importWorkflowValue：有 object_info 时 UI 格式自动转成 API 并落盘', () => {
  const dir = tempDir()
  try {
    const result = importWorkflowValue(dir, UI_WORKFLOW, 'ui-demo', { objectInfo: OBJECT_INFO })
    assert.equal(result.id, 'ui-demo')
    assert.equal(result.replaced, false)

    // 落盘的必须是 API 格式：K 是节点 id，值是 class_type + inputs
    const written = JSON.parse(fs.readFileSync(path.join(dir, 'ui-demo.json'), 'utf8'))
    assert.equal(written['4'].class_type, 'KSampler')
    assert.deepEqual(written['4'].inputs.model, ['1', 0])
    assert.equal(written['2'].inputs.text, 'a cat')
    assert.equal(written['5'].inputs.width, 512)
    // 读回来的输入面能认出来（否则导入成功但面板看不到变量）
    assert.ok(result.surface.inputs.some(slot => slot.name === 'prompt' || slot.name === 'text'), '转换后要能推出输入槽位')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('importWorkflowValue：拿不到 object_info 时退回可读提示，不抛栈', () => {
  const dir = tempDir()
  try {
    assert.throws(
      () => importWorkflowValue(dir, UI_WORKFLOW, 'ui-demo'),
      (error) => error instanceof WorkflowFormatError && /Export \(API\)/.test(error.message),
      '没有 object_info 时必须明确说"去 ComfyUI 里 Export (API)"',
    )
    // 什么都没写下去
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：从 ComfyUI 保存的 PNG 里导入（优先 prompt 块）', async () => {
  const dir = tempDir()
  try {
    const apiFormat = { 1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } } }
    const png = pngWithText([['prompt', JSON.stringify(apiFormat)]])
    const res = fakeRes()
    // 不给 objectInfo：`prompt` 块是 API 格式，不需要联网
    await handleWorkflowImport(
      { dir },
      res,
      fakeReq(png, { 'content-type': 'image/png', 'x-workflow-name': 'from-png' }),
    )

    assert.equal(res.status, 200, `该导入成功，实际 ${res.status} ${res.body}`)
    const payload = JSON.parse(res.body)
    assert.equal(payload.workflowId, 'from-png')
    assert.equal(payload.source, 'png-api')
    assert.ok(fs.existsSync(path.join(dir, 'from-png.json')))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：PNG 里没有工作流块时明说，而不是导入一张空工作流', async () => {
  const dir = tempDir()
  try {
    const png = pngWithText([])
    const res = fakeRes()
    await handleWorkflowImport({ dir }, res, fakeReq(png, { 'content-type': 'image/png' }))
    assert.equal(res.status, 400)
    assert.equal(JSON.parse(res.body).error, 'no-workflow-in-png')
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：UI 格式的 JSON 体在有 object_info 时也能导入', async () => {
  const dir = tempDir()
  try {
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => OBJECT_INFO },
      res,
      fakeReq(Buffer.from(JSON.stringify({ workflow: UI_WORKFLOW, name: 'ui-body' })), { 'content-type': 'application/json' }),
    )
    assert.equal(res.status, 200, `该导入成功，实际 ${res.status} ${res.body}`)
    assert.equal(JSON.parse(res.body).workflowId, 'ui-body')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：object_info 拉取失败降级成 400，而不是 500', async () => {
  const dir = tempDir()
  try {
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => { throw new Error('connect ECONNREFUSED') } },
      res,
      fakeReq(Buffer.from(JSON.stringify({ workflow: UI_WORKFLOW, name: 'offline' })), { 'content-type': 'application/json' }),
    )
    assert.equal(res.status, 400, 'ComfyUI 没起是"环境不满足"，不是服务端 500')
    assert.match(JSON.parse(res.body).message, /Export \(API\)/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：PNG 里只有 UI 块时走转换（source = png-ui）', async () => {
  const dir = tempDir()
  try {
    const png = pngWithText([['workflow', JSON.stringify(UI_WORKFLOW)]])
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => OBJECT_INFO },
      res,
      fakeReq(png, { 'content-type': 'image/png', 'x-workflow-name': encodeURIComponent('从 UI 块导入') }),
    )

    assert.equal(res.status, 200, `该导入成功，实际 ${res.status} ${res.body}`)
    const payload = JSON.parse(res.body)
    assert.equal(payload.source, 'png-ui')
    const written = JSON.parse(fs.readFileSync(path.join(dir, `${payload.workflowId}.json`), 'utf8'))
    assert.equal(written['4'].class_type, 'KSampler', 'UI 块要真的被转换后再落盘')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：object_info 拿到但转不出节点时 400，且不留半成品', async () => {
  const dir = tempDir()
  try {
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => ({}) },
      res,
      fakeReq(Buffer.from(JSON.stringify({ workflow: UI_WORKFLOW, name: 'empty-info' })), { 'content-type': 'application/json' }),
    )
    assert.equal(res.status, 400, '转换失败是"这份 JSON 不对"，不是 500')
    // 「不许塞半成品」的唯一实现就在这里：去掉它会把 {} 写进 workflows/ 再回一句权限问题
    assert.deepEqual(fs.readdirSync(dir), [], '失败的转换不该留下任何文件')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('readPngTextChunksFromBuffer：zTXt 解压、iTXt 取值、过短早退', () => {
  const chunk = (type, data) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length, 0)
    head.write(type, 4, 'ascii')
    return Buffer.concat([head, data, Buffer.alloc(4)])
  }
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(64, 0)
  ihdrData.writeUInt32BE(32, 4)

  const ztxt = chunk('zTXt', Buffer.concat([
    Buffer.from('prompt', 'latin1'),
    Buffer.from([0, 0]),
    zlib.deflateSync(Buffer.from('{"1":{"class_type":"X","inputs":{}}}', 'utf8')),
  ]))
  const itxt = chunk('iTXt', Buffer.concat([
    Buffer.from('workflow', 'latin1'),
    Buffer.from([0, 0, 0]), // compressed=0, lang 结束, translated 结束
    Buffer.from('{"nodes":[],"links":[]}', 'utf8'),
  ]))
  const png = Buffer.concat([signature, chunk('IHDR', ihdrData), ztxt, itxt, chunk('IEND', Buffer.alloc(0))])

  const parsed = readPngTextChunksFromBuffer(png)
  assert.ok(parsed !== undefined)
  assert.equal(parsed.width, 64)
  assert.equal(parsed.height, 32)
  assert.equal(parsed.chunks.find(item => item.keyword === 'prompt')?.value, '{"1":{"class_type":"X","inputs":{}}}')
  assert.equal(parsed.chunks.find(item => item.keyword === 'workflow')?.value, '{"nodes":[],"links":[]}')

  // 过短 / 非 PNG：早退 undefined，不抛
  assert.equal(readPngTextChunksFromBuffer(Buffer.alloc(10)), undefined)
  assert.equal(readPngTextChunksFromBuffer(Buffer.from('not a png at all', 'utf8')), undefined)
})

test('POST /workflows/import：API 格式不该去拉 object_info', async () => {
  const dir = tempDir()
  try {
    let called = 0
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => { called += 1; return OBJECT_INFO } },
      res,
      fakeReq(Buffer.from(JSON.stringify({ workflow: { 1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } } }, name: 'api-only' })), { 'content-type': 'application/json' }),
    )
    assert.equal(res.status, 200, `API 格式该直接导入，实际 ${res.status} ${res.body}`)
    // API 格式是绝大多数导入：每次都为一次探针买单，离线时等于每次白等一轮 3 秒超时
    assert.equal(called, 0, '只有 UI 格式才需要 /object_info')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：畸形 UI 结构回 400，内部异常不外泄', async () => {
  const dir = tempDir()
  try {
    const res = fakeRes()
    await handleWorkflowImport(
      { dir, objectInfo: async () => OBJECT_INFO },
      res,
      fakeReq(Buffer.from(JSON.stringify({ workflow: { nodes: [null, 42, []], links: [] }, name: 'broken-ui' })), { 'content-type': 'application/json' }),
    )
    assert.equal(res.status, 400, '手改坏了的 UI JSON 是"这份 JSON 不对"，不是服务端 500')
    assert.doesNotMatch(JSON.parse(res.body).message, /Cannot read|undefined/, '不许把内部异常文本回给浏览器')
    assert.deepEqual(fs.readdirSync(dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('POST /workflows/import：图片超过上限回 413 并写清上限', async () => {
  const dir = tempDir()
  try {
    const res = fakeRes()
    await handleWorkflowImport(
      { dir },
      res,
      // 声明 100MB：按 Content-Length 预判，不必真的读进来
      fakeReq(Buffer.alloc(16), { 'content-type': 'image/png', 'content-length': String(100 * 1024 * 1024) }),
    )
    assert.equal(res.status, 413, '4K 上采样的无损 PNG 能到 40MB，8MB 上限会挡掉真实图')
    assert.match(JSON.parse(res.body).message, /64MB/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
