/**
 * `/run` 的收尾必须**走生产路由**验证。
 *
 * 上一版测试直接 `createRunHandler(deps)` 并注入 fake registry —— 结果是
 * `deps.runs` 在真实链路上根本没接线（`createWorkflowRoutes` 不传、`deps` 类型没这字段），
 * 而测试照样绿。这正是 `runs-wiring.test.mjs` 开头警告过的坑：**测的是构造出来的对象，
 * 不是生产的接线**。
 *
 * 所以这里从 `createWorkflowRoutes` 进去，走的路径与真机一致。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { RunRegistry, createWorkflowRoutes } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 真 1×1 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 造生产路由（走 createWorkflowRoutes，不直接 createRunHandler）。 */
function makeRoutes(historyFor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-'))
  fs.writeFileSync(path.join(dir, 'wf.json'), JSON.stringify(WF))
  const out = path.join(dir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const runs = new RunRegistry(out)
  const routes = createWorkflowRoutes({
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { return 'pid-1' },
      async queue() { return { running: [], pending: [] } },
      async history(promptId) { return historyFor(promptId) },
      async view() { return PNG },
    },
    supervisor: { status: () => ({ running: false }), ensureRunning: async () => undefined },
    workflowDir: dir,
    settings: { pollIntervalMs: 40, outputDir: out, comfyBaseUrl: 'http://127.0.0.1:8188' },
    assertWritable: () => {},
    defaultOutputDir: out,
    runs,
    getExporter: () => undefined,
  })
  return { routes, dir, out, runs }
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

/** 真 Readable（readJsonBody 用 for await）。 */
function fakeReq(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))])
}

/** 等条件成立。 */
async function waitFor(predicate, timeoutMs = 6_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  return false
}

test('生产路由 POST /run：产物落盘 + 注册表收敛 done', async () => {
  const { routes, dir, out, runs } = makeRoutes(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const run = routes.exact['/run']
  assert.equal(typeof run, 'function', '/run 路由要存在')

  const res = fakeRes()
  await run(new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.pending, true, '提交即返回')

  // 关键：注册表里必须有这条记录（上一版这里恒 null）
  const settled = await waitFor(() => runs.get(payload.promptId)?.state === 'done')
  assert.equal(settled, true, `后台要把状态写进注册表，实际 ${JSON.stringify(runs.get(payload.promptId))}`)

  const record = runs.get(payload.promptId)
  assert.ok(typeof record?.finishedAt === 'number', 'finishedAt 要写')
  assert.ok((record?.artifacts?.length ?? 0) >= 1, 'artifacts 要写')

  // 产物也要真在磁盘上
  const files = fs.readdirSync(out).filter(name => name.endsWith('.png'))
  assert.ok(files.length >= 1, `产物要落到插件目录，实际 ${JSON.stringify(fs.readdirSync(out))}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('生产路由：ComfyUI 报错时收敛 failed（不是永远 pending）', async () => {
  const { routes, dir, runs } = makeRoutes(() => ({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
    },
  }))
  const res = fakeRes()
  await routes.exact['/run'](new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))
  const promptId = JSON.parse(res.body).promptId

  const settled = await waitFor(() => runs.get(promptId)?.state === 'failed')
  assert.equal(settled, true, `该收敛 failed，实际 ${runs.get(promptId)?.state}`)
  assert.equal(runs.get(promptId)?.error?.code, 'execution_failed')
  assert.equal(runs.get(promptId)?.error?.kind, 'oom')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('生产路由 POST /run：把有效盯守预算回给调用方（timeoutMs 不是死参数）', async () => {
  // `timeoutMs` 原先被 `submitWorkflow` 丢掉；现在它只放宽 `sweepRun` 的 `maxWaitMs`。
  // 这条断言锁的是**接线**：note 读的就是传给 `sweepRun` 的同一个对象，
  // 摘掉 `maxWaitMs` 字段，note 会变成 0 分钟 → 这条红。
  const { routes, dir } = makeRoutes(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const res = fakeRes()
  await routes.exact['/run'](new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 }, timeoutMs: 60_000 }))
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  const notes = (payload.notes ?? []).join(' ')
  assert.match(notes, /后台盯守 30 分钟/, `要比下限抬到 30 分钟并写回来，实际：${notes}`)
  assert.match(notes, /只放宽不收紧/, `被抬高时要说清，实际：${notes}`)

  // 传得比下限大时照用
  const res2 = fakeRes()
  await routes.exact['/run'](new URL('http://x/run'), res2, fakeReq({ workflowId: 'wf', vars: { seed: 2 }, timeoutMs: 3_600_000 }))
  const notes2 = (JSON.parse(res2.body).notes ?? []).join(' ')
  assert.match(notes2, /后台盯守 60 分钟/, `1 小时照用，实际：${notes2}`)
  assert.ok(!/只放宽不收紧/.test(notes2), `没被抬高时不该有那句，实际：${notes2}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('生产路由：提交失败仍 ok:false', async () => {
  const { routes, dir } = makeRoutes(() => undefined)
  // 让提交直接失败
  const failing = createWorkflowRoutes({
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() { return {} },
      async queuePrompt() {
        const error = new Error('连不上')
        error.code = 'comfy_unreachable'
        throw error
      },
      async queue() { return { running: [], pending: [] } },
      async history() { return undefined },
      async view() { return PNG },
    },
    supervisor: { status: () => ({ running: false }), ensureRunning: async () => undefined },
    workflowDir: dir,
    settings: { pollIntervalMs: 40, outputDir: path.join(dir, 'out'), comfyBaseUrl: 'http://127.0.0.1:8188' },
    assertWritable: () => {},
    defaultOutputDir: path.join(dir, 'out'),
    runs: new RunRegistry(path.join(dir, 'out')),
    getExporter: () => undefined,
  })
  const res = fakeRes()
  await failing.exact['/run'](new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'comfy_unreachable')
  fs.rmSync(dir, { recursive: true, force: true })
  void routes
})
