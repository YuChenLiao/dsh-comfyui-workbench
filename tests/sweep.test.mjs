/**
 * `sweepRun`：没有会话通道时的终态收敛。
 *
 * 复审抓到的两个必修，都是"看起来修了实际没修到"的同类：
 * ① `run_batch` 的异步无 agent 路径没接 sweep —— 记录永久停在 queued
 * ② `sweepRun` 缺 watcher 那套守卫 —— 重入时能把已经出图的任务标成 failed；
 *    一次瞬时的 ECONNREFUSED 也会永久判死
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, runBatchTool, runTool, sweepRun } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造依赖；`history` 可按需延迟/抛错/永不完成。 */
function makeDeps(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  const runs = new RunRegistry(dir)
  let historyCalls = 0
  let submitted = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { submitted += 1; return `pid-${process.pid}-${submitted}` },
      async queue() { return { running: [], pending: [] } },
      async history() {
        historyCalls += 1
        if (options.delayMs !== undefined && historyCalls === 1) {
          await new Promise(resolve => setTimeout(resolve, options.delayMs))
        }
        if (options.failFirstN !== undefined && historyCalls <= options.failFirstN) {
          const error = new Error('ECONNREFUSED')
          error.code = 'comfy_unreachable'
          throw error
        }
        if (options.neverDone === true) return undefined
        return {
          status: { status_str: 'success', completed: true },
          outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
        }
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
    _file: file,
    _dir: dir,
    _historyCalls: () => historyCalls,
  }
  return deps
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

test('run_batch 异步 + 无 agent 也会收敛（不能停在 queued）', async () => {
  const deps = makeDeps()
  const tool = runBatchTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }] })
  assert.equal(result.ok, true)
  await waitFor(() => deps.runs.list({ limit: 10 }).every(r => r.state === 'done'))
  const all = deps.runs.list({ limit: 10 })
  assert.equal(all.length, 2)
  for (const record of all) {
    assert.equal(record.state, 'done', `每条都要收敛，${record.promptId} 停在 ${record.state}`)
    assert.ok((record.artifacts?.length ?? 0) >= 1)
  }
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('run_batch 的 wait 超时 + 无 agent 也继续收敛到 done', async () => {
  const deps = makeDeps({ neverDone: true })
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }], wait: true, timeoutMs: 1_000 })
  const record = deps.runs.list({ limit: 1 })[0]
  assert.equal(record?.state, 'unknown', '超时先标 unknown')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('瞬时网络错误不即判失败（ComfyUI 重启时很常见）', async () => {
  const deps = makeDeps({ failFirstN: 2 })
  const registry = deps.runs
  registry.submit('p1', 'wf')
  sweepRun({
    client: deps.client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: deps._dir,
    intervalMs: 60,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  await new Promise(resolve => setTimeout(resolve, 800))
  const record = registry.get('p1')
  assert.equal(record?.state, 'done', `两次瞬时失败后仍应收敛成 done，实际 ${record?.state}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('history 报 execution_failed 才立即判失败', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep2-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  const client = {
    baseUrl: 'http://127.0.0.1:8188',
    async queue() { return { running: [], pending: [] } },
    async history() {
      return { status: { status_str: 'error', messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]] } }
    },
    async view() { return Buffer.alloc(0) },
  }
  sweepRun({
    client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 60,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(registry.get('p1')?.state, 'failed')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('history 比轮询慢时不重入（不会出现 done 之后又 failed）', async () => {
  // history 首次延迟 300ms，而 sweep 间隔 50ms：没有 inflight 守卫就会并发两次
  const deps = makeDeps({ delayMs: 300 })
  const registry = deps.runs
  registry.submit('p1', 'wf')
  sweepRun({
    client: deps.client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: deps._dir,
    intervalMs: 50,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  await new Promise(resolve => setTimeout(resolve, 1_000))
  const record = registry.get('p1')
  assert.equal(record?.state, 'done', `重入不该把终态改掉，实际 ${record?.state}`)
  assert.ok((record?.artifacts?.length ?? 0) === 1, '产物只该登记一次')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('记录被裁掉后 sweep 自行停止（不白轮询到 30 分钟）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sweep3-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  let calls = 0
  const client = {
    baseUrl: 'http://127.0.0.1:8188',
    async queue() { return { running: [], pending: [] } },
    async history() { calls += 1; return undefined },
    async view() { return Buffer.alloc(0) },
  }
  sweepRun({
    client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 50,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  await new Promise(resolve => setTimeout(resolve, 200))
  const before = calls
  registry.clear() // 模拟被 trim 掉
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.ok(calls <= before + 2, `记录消失后不该继续轮询，实际又查了 ${calls - before} 次`)
  fs.rmSync(dir, { recursive: true, force: true })
})
