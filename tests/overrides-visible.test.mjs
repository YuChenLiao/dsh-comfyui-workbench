/**
 * 覆盖提示的**用户可见性**与提交失败时的保留。
 *
 * 前两轮的教训：只在返回对象里加字段不算修 —— 宿主只把 `render()` 的文本交给模型，
 * 所以断言必须打到 render 输出上。同理，`overrides` 的消耗时机要放在提交成功之后，
 * 而不是"应用之后"。
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

/** 造依赖。 */
function makeDeps(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov3-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WORKFLOW))
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WORKFLOW)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() {
        if (options.rejectSubmit === true) throw new Error('ComfyUI 拒收')
        return 'pid-1'
      },
      async history() {
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
    assertWritable: () => {},
    _file: file,
    _dir: dir,
  }
  return deps
}

/** 把工具结果经 render 转成模型真正看到的文本。 */
function visibleText(tool, args, result) {
  const blocks = tool.output.render(args, result)
  return blocks.map(block => (block.type === 'text' ? block.text : `[${block.type}]`)).join('\n')
}

test('wait 超时的 pending：render 文本里必须出现"一次性覆盖"', async () => {
  const deps = makeDeps({ neverDone: true })
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  const args = { workflow: { path: deps._file }, vars: { seed: 1 }, wait: true, waitMs: 1_000 }
  const result = await tool.execute(args)

  assert.equal(result.pending, true)
  const text = visibleText(tool, args, result)
  // 宿主只把这段文本交给模型；只在返回对象里加字段等于没修
  assert.match(text, /一次性覆盖/, `render 文本里必须有覆盖提示，实际：\n${text}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('提交失败（参数名写错）时覆盖不被消耗', async () => {
  const deps = makeDeps()
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  const result = await tool.execute({
    workflow: { path: deps._file },
    // 不认识的参数名 → variable_unknown，提交不会发生
    vars: { not_a_slot: 1 },
  })

  assert.equal(result.ok, false)
  assert.equal(result.code, 'variable_unknown')
  assert.equal(
    deps.overrides.get('wf')?.length,
    1,
    '提交失败时覆盖必须保留 —— 用户改完键名重跑还得用它',
  )
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('ComfyUI 拒收时覆盖也不被消耗', async () => {
  const deps = makeDeps({ rejectSubmit: true })
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 } })

  assert.equal(result.ok, false)
  assert.equal(deps.overrides.get('wf')?.length, 1, '提交被拒时覆盖要留着')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('提交成功后覆盖才被消耗', async () => {
  const deps = makeDeps()
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runTool(deps)
  await tool.execute({ workflow: { path: deps._file }, vars: { seed: 1 } })
  assert.equal(deps.overrides.get('wf'), undefined, '成功后才清')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
