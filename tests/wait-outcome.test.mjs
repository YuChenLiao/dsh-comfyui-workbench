/**
 * `runTool` 的 wait 路径：`no_output` 不能被降级成 pending。
 *
 * 这是同一处错误第二次复发 —— 第一次是手写判据把 no_output 当"可重试"，
 * 第二次是把判据换成 `isRetryable`（二维只取了一维）。所以这条测试直接打
 * 工具层：`waitForRun` 抛出来的已经是"攒满 6 次"的**放弃结论**，工具层
 * 不该再降级，否则记录永久停在 unknown 而 error.code 说 no_output，自相矛盾。
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

/** 造依赖；`outputs` 控制 history 里有没有产物。 */
function makeDeps(historyEntry) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  const runs = new RunRegistry(dir)
  return {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { return { promptId: 'pid-1', warnings: [] } },
      async queue() { return { running: [], pending: [] } },
      async history() { return historyEntry },
      async view() { return Buffer.alloc(0) },
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

test('wait:true 遇 no_output：记录必须是 failed，不能降级成 pending', async () => {
  const deps = makeDeps({ status: { status_str: 'success', completed: true }, outputs: {} })
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 5_000 })

  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'failed', `"完成但没产物"是确定结论，该 failed，实际 ${record?.state}`)
  assert.equal(record?.error?.code, 'no_output')
  // 返回也不该说 pending —— 让用户续查一个永远查不到的结果是撒谎
  assert.notEqual(result.pending, true, `不该返回 pending，实际 ${JSON.stringify(result).slice(0, 200)}`)
  assert.equal(result.ok, false)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait:true 遇网络类错误：仍可 pending 让用户续查', async () => {
  let calls = 0
  const deps = makeDeps(undefined)
  deps.client.history = async () => {
    calls += 1
    const error = new Error('/history 返回 500')
    error.code = 'comfy_unreachable'
    throw error
  }
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 2_000 })

  // 网络类：等满容忍次数后按 unknown 处理，返回 pending 是合理的
  assert.equal(result.pending, true, `网络类该 pending，实际 ${JSON.stringify(result).slice(0, 150)}`)
  assert.equal(deps.runs.get('pid-1')?.state, 'unknown')
  assert.ok(calls >= 2, `不该首次放弃，实际 ${calls} 次`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait:true 遇 execution_failed：立即 failed，不拖到 6 次', async () => {
  const deps = makeDeps({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
    },
  })
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 5_000 })

  const record = deps.runs.get('pid-1')
  assert.equal(record?.state, 'failed')
  assert.equal(record?.error?.code, 'execution_failed')
  assert.equal(record?.error?.kind, 'oom', 'kind 要跟着落盘')
  assert.equal(result.ok, false)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
