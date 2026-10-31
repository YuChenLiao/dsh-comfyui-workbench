/**
 * 运行注册表与 `comfyui_runs`。
 *
 * 守四件事：状态流转、落盘与重启后的 stale、进度绝不进对话、按状态/批次筛。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, runsTool } from '../lib/index.js'

/** 造一个带产物目录的注册表（会写 runs.json）。 */
function makeRegistry() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-'))
  const registry = new RunRegistry(dir)
  return { registry, dir }
}


/** 轮询等待条件成立，避免固定 sleep 在慢机器上偶发失败。 */
async function waitFor(predicate, { timeoutMs = 4_000, intervalMs = 40 } = {}) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, intervalMs))
  }
  return false
}

test('提交登记为 queued，更新后流转', () => {
  const { registry, dir } = makeRegistry()
  registry.submit('p1', 'wf-a')
  assert.equal(registry.get('p1')?.state, 'queued')

  registry.update('p1', { state: 'running', startedAt: Date.now() })
  assert.equal(registry.get('p1')?.state, 'running')

  registry.update('p1', { state: 'done', finishedAt: Date.now(), artifacts: [{ path: '/x.png', bytes: 100 }] })
  const record = registry.get('p1')
  assert.equal(record?.state, 'done')
  assert.equal(record?.artifacts?.length, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('activeCount 只算 queued 与 running', () => {
  const { registry, dir } = makeRegistry()
  registry.submit('a', 'wf')
  registry.submit('b', 'wf')
  registry.submit('c', 'wf')
  registry.update('c', { state: 'done' })
  assert.equal(registry.activeCount(), 2)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('按状态与批次筛选，按时间倒序', () => {
  const { registry, dir } = makeRegistry()
  registry.submit('a', 'wf', 'batch-1')
  registry.submit('b', 'wf', 'batch-1')
  registry.submit('c', 'wf', 'batch-2')
  registry.update('a', { state: 'done' })

  assert.equal(registry.list({ state: 'queued' }).length, 2)
  assert.equal(registry.list({ batchId: 'batch-1' }).length, 2)
  assert.equal(registry.list({ batchId: 'batch-2' }).length, 1)
  // 倒序：最后提交的在前
  assert.equal(registry.list()[0]?.promptId, 'c')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('落盘后重启：在跑的标成 unknown 并带 stale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs2-'))
  const first = new RunRegistry(dir)
  first.submit('running-1', 'wf')
  first.update('running-1', { state: 'running', startedAt: Date.now() })
  first.submit('done-1', 'wf')
  first.update('done-1', { state: 'done', finishedAt: Date.now() })
  first.flush()

  // 模拟进程重启
  const second = new RunRegistry(dir)
  const running = second.get('running-1')
  assert.equal(running?.state, 'unknown', '重启后原来在跑的不能留在 running 让人干等')
  assert.equal(running?.stale, true)
  assert.equal(second.get('done-1')?.state, 'done', '已完成的保持原状')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('runs.json 损坏时当作空表，不抛', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs3-'))
  fs.writeFileSync(path.join(dir, 'runs.json'), '{ 这不是 JSON', 'utf8')
  const registry = new RunRegistry(dir)
  assert.deepEqual(registry.list(), [])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('最多保留 200 条', () => {
  const { registry, dir } = makeRegistry()
  for (let i = 0; i < 250; i += 1) registry.submit(`p${i}`, 'wf')
  registry.flush()
  const raw = JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'))
  assert.ok(raw.length <= 200, `落盘不该超过 200 条，实际 ${raw.length}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('comfyui_runs：按状态查，返回 active 计数', async () => {
  const { registry, dir } = makeRegistry()
  registry.submit('a', 'wf')
  registry.update('a', { state: 'running' })
  registry.submit('b', 'wf')
  const tool = runsTool({ runs: registry })
  const result = await tool.execute({ state: 'running' })
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(result.runs[0].promptId, 'a')
  assert.equal(result.active, 2, 'active 含排队中的 b')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('comfyui_runs：state 不合法时报错', async () => {
  const { registry, dir } = makeRegistry()
  const tool = runsTool({ runs: registry })
  const result = await tool.execute({ state: 'bogus' })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /state 只能是/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('comfyui_runs：空结果给 hint 而不是干巴巴的空数组', async () => {
  const { registry, dir } = makeRegistry()
  const tool = runsTool({ runs: registry })
  const result = await tool.execute({})
  assert.equal(result.ok, true)
  assert.equal(result.count, 0)
  assert.ok(typeof result.hint === 'string' && result.hint.length > 0)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('stale 记录在工具输出里带说明', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs4-'))
  const first = new RunRegistry(dir)
  first.submit('x', 'wf')
  first.update('x', { state: 'running' })
  first.flush()
  const second = new RunRegistry(dir)
  const tool = runsTool({ runs: second })
  const result = await tool.execute({})
  assert.equal(result.runs[0].state, 'unknown')
  assert.equal(result.runs[0].stale, true)
  assert.match(String(result.runs[0].note), /重启/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('端到端：提交后注册表从 queued 走到 done，且产物登记进去', async () => {
  const { runTool } = await import('../lib/index.js')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runs-e2e-'))
  const runs = new RunRegistry(dir)
  const WF = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
  }
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  let histCalls = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { return 'p1' },
      async queue() { return { running: ['p1'], pending: [] } },
      async history() {
        histCalls += 1
        return histCalls < 2
          ? {}
          : { status: { status_str: 'success', completed: true }, outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } }
      },
      async view() { return Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    runs,
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  const tool = runTool(deps)
  await tool.execute({ workflow: { path: file }, vars: { seed: 1 } }, { agent: { followup: () => {} } })

  assert.equal(runs.get('p1')?.state, 'queued', '刚提交时为 queued')
  await waitFor(() => runs.get('p1')?.state === 'done')
  const record = runs.get('p1')
  assert.equal(record?.state, 'done', `应当走到 done，实际 ${record?.state}`)
  assert.equal(record?.artifacts?.length, 1, '产物要登记进注册表')

  runs.flush()
  assert.ok(fs.existsSync(path.join(dir, 'runs.json')), '落盘文件要存在')
  fs.rmSync(dir, { recursive: true, force: true })
})
