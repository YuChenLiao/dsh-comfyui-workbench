/**
 * 覆盖的生命周期与提示可见性。
 *
 * 两个只在边缘路径才会暴露的问题：
 * - 本次被拒（目录没权限）时不该消耗覆盖 —— 否则用户改完权限重跑，参数静默回模板
 * - wait 超时走 pending 分支时，"已应用覆盖"这句不能消失
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { runTool } from '../lib/index.js'

const WORKFLOW = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造依赖；`denied` 为真时 assertWritable 抛错。 */
function makeDeps(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov2-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WORKFLOW))
  let captured = null
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WORKFLOW)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) {
        captured = workflow
        return 'pid-1'
      },
      async history() {
        // 让 wait 路径永远等不到完成，走到 pending
        return options.neverDone === true ? undefined : {}
      },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable() {
      if (options.denied === true) throw new Error('这个目录不可写')
    },
    _file: file,
    _dir: dir,
    _captured: () => captured,
    _overrides: () => deps.overrides,
  }
  return deps
}

test('本次被拒时不该消耗一次性覆盖（否则重跑参数静默回模板）', async () => {
  const deps = makeDeps({ denied: true })
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 } })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'forbidden_output')
  assert.equal(deps._captured(), null, '被拒时不该提交')
  assert.equal(
    deps.overrides.get('wf')?.length,
    1,
    '被拒时覆盖必须保留 —— 用户改完权限重跑还得用它',
  )
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('正常执行完才消耗覆盖', async () => {
  const deps = makeDeps()
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 } })

  assert.equal(deps._captured()?.['7']?.inputs?.filename_prefix, 'zzz', '覆盖应生效')
  assert.equal(deps.overrides.get('wf'), undefined, '跑完才清')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait 超时的 pending 分支也带"已应用覆盖"提示', async () => {
  const deps = makeDeps({ neverDone: true })
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  const result = await tool.execute({
    workflow: { path: deps._file },
    vars: { seed: 1 },
    wait: true,
    waitMs: 1_000,
  })

  assert.equal(result.ok, true)
  assert.equal(result.pending, true, '应当走 pending 分支')
  const notes = Array.isArray(result.notes) ? result.notes : []
  assert.ok(
    notes.some(note => /一次性覆盖/.test(note)),
    `pending 分支也要提示已应用覆盖，实际：${JSON.stringify(notes)}`,
  )
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
