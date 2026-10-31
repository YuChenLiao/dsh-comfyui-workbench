/**
 * `comfyui_workflow_list` 的 `inputs` 过滤。
 *
 * 模型想知道"哪个工作流能吃这张图"时，不该自己翻每个工作流的 `inputKinds`
 * 再猜槽位名 —— 一次过滤直接给出候选与键名。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { workflowListTool } from '../lib/index.js'

/** 吃图的工作流（LoadImage → VAEDecode）。 */
const WITH_IMAGE = {
  1: { class_type: 'LoadImage', inputs: { image: 'x.png' } },
  2: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 0] } },
  3: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['4', 0], latent_image: ['5', 0] } },
  4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  7: { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'x' } },
}

/** 不吃图的工作流。 */
const NO_IMAGE = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  3: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'x' } },
}

/** 造工作流目录。 */
function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfl-'))
  fs.writeFileSync(path.join(dir, 'with-image.json'), JSON.stringify(WITH_IMAGE))
  fs.writeFileSync(path.join(dir, 'no-image.json'), JSON.stringify(NO_IMAGE))
  return {
    deps: {
      client: { baseUrl: 'http://x', async objectInfo() { throw new Error('offline') } },
      workflowsDir: dir,
    },
    dir,
  }
}

test('不给 inputs 时都返回', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowListTool(deps)
  const result = await tool.execute({})
  assert.equal(result.ok, true)
  assert.equal(result.count, 2)
  // 没筛的时候不该塞 imageSlots
  for (const item of result.workflows) assert.equal(item.imageSlots, undefined)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inputs=image 只返回吃图的工作流', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowListTool(deps)
  const result = await tool.execute({ inputs: 'image' })
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(result.workflows[0].workflowId, 'with-image')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('返回槽位名，模型不必再 inspect 一次', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowListTool(deps)
  const result = await tool.execute({ inputs: 'image' })
  const item = result.workflows[0]
  assert.deepEqual(item.imageSlots, ['image'], '要告诉模型该往哪个键里传图')
  assert.equal(item.needsImage, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不带图的工作流不会出现在 image 过滤里', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowListTool(deps)
  const result = await tool.execute({ inputs: 'image' })
  assert.ok(!result.workflows.some(item => item.workflowId === 'no-image'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('inputs 与 q 可以叠加', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowListTool(deps)
  const hit = await tool.execute({ inputs: 'image', q: 'with' })
  assert.equal(hit.count, 1)
  const miss = await tool.execute({ inputs: 'image', q: 'no-image' })
  assert.equal(miss.count, 0, 'q 与 inputs 是 AND')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('没有吃图的工作流时给 hint（不是干巴巴的空数组）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfl2-'))
  fs.writeFileSync(path.join(dir, 'only-text.json'), JSON.stringify(NO_IMAGE))
  const tool = workflowListTool({
    client: { baseUrl: 'http://x', async objectInfo() { throw new Error('offline') } },
    workflowsDir: dir,
  })
  const result = await tool.execute({ inputs: 'image' })
  assert.equal(result.count, 0)
  assert.ok(typeof result.hint === 'string' && result.hint.length > 0)
  assert.match(result.hint, /image/, '要说清"本机没有吃图的工作流"，不是通用那句')
  fs.rmSync(dir, { recursive: true, force: true })
})
