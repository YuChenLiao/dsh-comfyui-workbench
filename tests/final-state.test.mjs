/**
 * 终态记录的字段完整度。
 *
 * 两次复审都抓到同一类：`state` 与 `error.code` 判对了，但 `finishedAt` 漏写。
 * 后果不是洁癖 —— `runs.ts` 的 `elapsedMs` 用 `(finishedAt ?? now)`，
 * 一条 failed 记录的"耗时"会在面板上一直涨。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, runBatchTool, runTool, runsTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造依赖。 */
function makeDeps(historyFor = () => ({ status: { status_str: 'success', completed: true }, outputs: {} })) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  const runs = new RunRegistry(dir)
  let submitted = 0
  return {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { submitted += 1; return { promptId: `pid-${submitted}`, warnings: [] } },
      async queue() { return { running: [], pending: [] } },
      async history(promptId) { return historyFor(promptId) },
      async view() { return Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 5_000,
    pollIntervalMs: 20,
    overrides: new Map(),
    runs,
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
    _file: file,
    _dir: dir,
  }
}

test('wait:true 的 no_output 终态带 finishedAt（elapsedMs 不会永涨）', async () => {
  const deps = makeDeps()
  const tool = runTool(deps)
  await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 5_000 })

  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'failed')
  assert.ok(typeof record?.finishedAt === 'number', `终态必须有 finishedAt，实际 ${record?.finishedAt}`)

  // elapsedMs 必须冻结：等一会再查，值不该变
  const runsToolInstance = runsTool({ runs: deps.runs })
  const before = (await runsToolInstance.execute({}))?.runs?.[0]?.elapsedMs
  await new Promise(resolve => setTimeout(resolve, 80))
  const after = (await runsToolInstance.execute({}))?.runs?.[0]?.elapsedMs
  assert.equal(after, before, `终态记录的 elapsedMs 不该继续涨（${before} → ${after}）`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait:true 的超时未知态也带 finishedAt 与 error', async () => {
  const deps = makeDeps(() => undefined) // 永不完成
  const tool = runTool(deps)
  await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 1_000 })

  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'unknown')
  assert.ok(typeof record?.finishedAt === 'number', '超时也要写 finishedAt')
  assert.equal(record?.error?.code, 'wait_timeout', '超时要有 error 说明')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('run_batch 的 wait 遇 execution_failed 要收敛终态（不留僵尸）', async () => {
  const deps = makeDeps(() => ({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
    },
  }))
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: deps._file },
    runs: [{ vars: { seed: 1 } }],
    wait: true,
    timeoutMs: 5_000,
  })

  const records = deps.runs.list({ limit: 10 })
  assert.equal(records.length, 1, '应当有一条记录')
  const record = records[0]
  assert.equal(record.state, 'failed', `批次失败也要收敛，实际 ${record.state}`)
  assert.ok(typeof record.finishedAt === 'number', '终态要有 finishedAt')
  assert.ok(record.error !== undefined, '要带错误信息')
  // activeCount 不能虚高（僵尸记录的直接后果）
  assert.equal(deps.runs.activeCount(), 0, `不该留僵尸，activeCount=${deps.runs.activeCount()}`)
  assert.ok(result.ok === false || result.failed === 1)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('run_batch 的异步提交成功后再失败，也要收敛', async () => {
  const deps = makeDeps(() => ({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'boom', node_id: '2', node_type: 'KSampler' }]],
    },
  }))
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }] })
  // 异步路径靠 sweep 收敛
  const startedAt = Date.now()
  while (Date.now() - startedAt < 3_000) {
    const state = deps.runs.list({ limit: 1 })[0]?.state
    if (state === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  const record = deps.runs.list({ limit: 1 })[0]
  assert.equal(record?.state, 'failed')
  assert.ok(typeof record?.finishedAt === 'number')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
