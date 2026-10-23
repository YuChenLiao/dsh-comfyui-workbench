/**
 * runner 自检：用本地假 ComfyUI 跑完整链路，验证"什么时候发请求、什么时候不发"。
 *
 * 对应验收：
 *   B12 缺变量 / 缺节点都在 POST /prompt **之前**失败
 *   B13 超时必须已发出 /interrupt
 *   B14 无产物时报 no_output
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { ComfyClient } from '../lib/comfy.js'
import { resumeRun, runWorkflow } from '../lib/run.js'

/** 1×1 透明 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 起一个假 ComfyUI。`plan` 决定各端点的行为。 */
async function fakeComfy(plan) {
  const calls = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const key = `${req.method} ${url.pathname}`
    calls.push(key)

    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (url.pathname === '/system_stats') return json(200, { system: {} })
    if (url.pathname === '/object_info') return json(200, plan.nodes ?? {})
    if (url.pathname === '/prompt' && req.method === 'POST') return plan.onPrompt === undefined ? json(200, { prompt_id: 'p1' }) : plan.onPrompt(res, json)
    if (url.pathname.startsWith('/history/')) {
      const entry = plan.onHistory === undefined ? { status: { completed: true }, outputs: {} } : plan.onHistory()
      return json(200, entry === undefined ? {} : { p1: entry })
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    if (url.pathname === '/interrupt') return json(200, {})
    return json(404, {})
  })

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
    has: prefix => calls.some(call => call.startsWith(prefix)),
  }
}

function workflow() {
  return {
    3: {
      class_type: 'KSampler',
      inputs: { seed: 1, steps: 10, cfg: 7, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['5', 0] },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['3', 0] } },
  }
}

/** 取一份能过编译的 slots（直接从 IO 面推断）。 */
async function slotsOf(wf) {
  const { buildSurface } = await import('../lib/workflow.js')
  return buildSurface({ workflowId: 't', workflow: wf }).inputs
}

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-run-'))
}

test('正常链路：预检 → 提交 → 轮询 → 取图 → 落盘 + sidecar', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => ({ status: { completed: true }, outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } }),
  })

  try {
    const outputDir = tmpOut()
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 42 },
      outputDir,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })

    assert.equal(outcome.promptId, 'p1')
    assert.equal(outcome.artifacts.length, 1)
    const artifact = outcome.artifacts[0]
    assert.ok(fs.existsSync(artifact.path), '产物应当落盘')
    assert.equal(artifact.width, 1)
    assert.equal(artifact.height, 1)
    assert.equal(artifact.mime, 'image/png')
    assert.ok(outcome.metadataPath !== undefined && fs.existsSync(outcome.metadataPath), '应当写 sidecar')

    const meta = JSON.parse(fs.readFileSync(outcome.metadataPath, 'utf8'))
    assert.equal(meta.workflowId, 't')
    assert.equal(meta.comfy.promptId, 'p1')
    assert.equal(meta.seed, 42)

    assert.ok(comfy.has('GET /object_info'))
    assert.ok(comfy.has('POST /prompt'))
    assert.ok(!comfy.has('POST /interrupt'))
  } finally {
    await comfy.close()
  }
})

test('缺节点：在提交之前失败（B12）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  // 只声明一部分节点
  const comfy = await fakeComfy({ nodes: { KSampler: {}, SaveImage: {} } })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'node_missing',
    )
    assert.ok(!comfy.has('POST /prompt'), '缺节点时不该提交')
  } finally {
    await comfy.close()
  }
})

test('缺变量：一个请求都不发（B12）', async () => {
  const wf = workflow()
  const slots = (await slotsOf(wf)).map(slot => (slot.name === 'prompt' ? { ...slot, required: true, default: undefined } : slot))
  const comfy = await fakeComfy({ nodes: {} })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: {},
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'variable_unbound',
    )
    assert.equal(comfy.calls.length, 0, '变量不合法时应当一个请求都不发')
  } finally {
    await comfy.close()
  }
})

test('超时：返回可续查的 pending，不中断任务', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => undefined, // 永远不完成
  })

  try {
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat' },
      outputDir: tmpOut(),
      timeoutMs: 300,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    // 出图要几分钟，工具不能一直占着对话：超时是"这次不等了"，不是"放弃这个任务"。
    assert.equal(outcome.pending, true)
    assert.equal(outcome.promptId, 'p1')
    assert.ok(!comfy.has('POST /interrupt'), '不该中断还在跑的任务')
  } finally {
    await comfy.close()
  }
})

test('续查：同一 promptId 第二次查能拿到产物', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  // 用开关控制"什么时候算跑完"：第一次调用期间始终不完成，续查时再放行。
  let allowComplete = false
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => (allowComplete
      ? { status: { completed: true }, outputs: { 9: { images: [{ filename: 'out.png' }] } } }
      : undefined),
  })

  try {
    const first = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat' },
      outputDir: tmpOut(),
      timeoutMs: 200,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    assert.equal(first.pending, true)

    allowComplete = true
    const resumed = await resumeRun(new ComfyClient({ baseUrl: comfy.baseUrl }), first.promptId, { outputDir: tmpOut() })
    assert.equal(resumed.ok, true)
    assert.equal(resumed.pending, undefined)
    assert.equal(resumed.artifacts.length, 1)
    assert.ok(fs.existsSync(resumed.artifacts[0].path))
  } finally {
    await comfy.close()
  }
})

test('提交被拒：透出 node_errors', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onPrompt: (res, json) => json(400, { error: 'bad', node_errors: { 3: { errors: [{ message: 'value out of range', details: 'steps' }] } } }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'submit_rejected' && /节点 3/.test(error.message),
    )
  } finally {
    await comfy.close()
  }
})

test('无产物：报 no_output（B14）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => ({ status: { completed: true }, outputs: {} }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'no_output',
    )
  } finally {
    await comfy.close()
  }
})
