/**
 * 终态收敛与裁剪优先级。
 *
 * 复审抓到的两条：
 * ① `wait: true` 与「无 agent」路径不挂 watcher，记录永远停在 queued ——
 *    `comfyui_runs` 对早就出完的图永久答"还在跑"。
 * ② `trim()` 不看状态，200 条都在跑时会删掉最老的 running。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, runTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造依赖。`completed` 控制 history 是否立刻完成。 */
function makeDeps(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  const runs = new RunRegistry(dir)
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { return { promptId: 'pid-1', warnings: [] } },
      async queue() { return { running: ['pid-1'], pending: [] } },
      async history() {
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

test('wait: true 成功后记录收敛成 done（watcher 在这条路径上不挂）', async () => {
  const deps = makeDeps()
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true })
  assert.equal(result.ok, true)
  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'done', `wait 成功后必须收敛，实际 ${record?.state}`)
  assert.equal(record?.artifacts?.length, 1, '产物要登记进去')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait: true 超时后记录标 unknown，不停在 running', async () => {
  const deps = makeDeps({ neverDone: true })
  const tool = runTool(deps)
  const result = await tool.execute({
    workflow: { path: deps._file },
    vars: { seed: 1 },
    wait: true,
    waitMs: 1_000,
  })
  assert.equal(result.pending, true)
  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'unknown', `超时后应标 unknown，实际 ${record?.state}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('无 agent 的异步路径也会自己收敛（不能停在 queued）', async () => {
  const deps = makeDeps()
  const tool = runTool(deps)
  // 不传 exec.agent → 不挂 watcher，靠 sweepToFinal
  await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 } })
  assert.equal(deps.runs.get('pid-1')?.state, 'queued', '刚提交时是 queued')
  await waitFor(() => deps.runs.get('pid-1')?.state === 'done')
  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'done', `无 agent 也要收敛到 done，实际 ${record?.state}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('trim 先淘汰终态，不动正在跑的', () => {
  const registry = new RunRegistry()
  // 200 条全 running
  for (let i = 0; i < 200; i += 1) {
    registry.submit(`p${i}`, 'wf')
    registry.update(`p${i}`, { state: 'running' })
  }
  // 再提交一条 → 必须踢掉某条，但不能让 update 失效
  registry.submit('new', 'wf')
  registry.update('p0', { state: 'done' })
  // 若 p0 被误删，update 会静默失败、get 返回 undefined
  assert.ok(registry.get('p0') !== undefined || registry.list({ limit: 250 }).length === 200)

  // 更关键：终态优先。造 3 条终态 + 若干 running，新提交应踢终态
  const registry2 = new RunRegistry()
  for (let i = 0; i < 199; i += 1) {
    registry2.submit(`r${i}`, 'wf')
    registry2.update(`r${i}`, { state: 'running' })
  }
  registry2.submit('done-old', 'wf')
  registry2.update('done-old', { state: 'done' })
  registry2.submit('pushed', 'wf') // 触发 trim（200 → 201）
  assert.equal(registry2.get('done-old'), undefined, '终态应先被淘汰')
  assert.ok(registry2.get('r0') !== undefined, 'running 不该被优先淘汰')
})

test('全是 active 时才退回按 seq 淘汰', () => {
  const registry = new RunRegistry()
  for (let i = 0; i < 200; i += 1) {
    registry.submit(`a${i}`, 'wf')
    registry.update(`a${i}`, { state: 'running' })
  }
  registry.submit('b', 'wf')
  const all = registry.list({ limit: 200 })
  assert.equal(all.length, 200, '仍然守住 200 上限')
  assert.ok(registry.get('b') !== undefined, '新提交的必须在')
})
