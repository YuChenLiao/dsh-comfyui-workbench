/**
 * 一次性参数覆盖（`comfyui_workflow_edit` 的 `persist: false`）。
 *
 * 这块的核心陷阱：**不能直接改 workflow**。`applyVariables` 会按 `slot.default`
 * 重写每个槽位绑定的路径，直改的值立刻被冲掉；无 `default` 的必填槽位（image/mask）
 * 更会直接抛 `variable_unbound`。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { applyOverrides, overrideNotes, runTool } from '../lib/index.js'

/** 一份最小 API 工作流。 */
const WORKFLOW = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: {
    class_type: 'KSampler',
    inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] },
  },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造 surface（用真实的推断逻辑）。 */
async function surfaceOf(workflow) {
  const { buildSurface } = await import('../lib/workflow.js')
  return buildSurface({ workflowId: 'wf', workflow }).inputs
}

test('覆盖目标是槽位时转成 vars，值生效', async () => {
  const workflow = structuredClone(WORKFLOW)
  const slots = await surfaceOf(workflow)
  const steps = slots.find(slot => slot.name === 'steps')
  assert.ok(steps?.bind !== undefined, 'steps 应当是个带 bind 的槽位')

  const outcome = applyOverrides(workflow, { inputs: slots }, { seed: 1 }, [
    { nodeId: '2', input: 'steps', value: 777 },
  ])
  assert.equal(outcome.vars.steps, 777, '覆盖应进 vars')
  assert.equal(outcome.viaVars, 1)
  assert.equal(outcome.internal, 0)
  assert.equal(workflow[2].inputs.steps, 20, '不该直接改 workflow（会被 applyVariables 冲掉）')
})

test('覆盖目标不是槽位时直接改 workflow', async () => {
  const workflow = structuredClone(WORKFLOW)
  const slots = await surfaceOf(workflow)
  const outcome = applyOverrides(workflow, { inputs: slots }, {}, [
    { nodeId: '7', input: 'filename_prefix', value: 'zzz' },
  ])
  assert.equal(outcome.internal, 1)
  assert.equal(outcome.viaVars, 0)
  assert.equal(workflow[7].inputs.filename_prefix, 'zzz', '内部参数应直接落到 workflow')
})

test('覆盖值优先于调用方传的 vars', async () => {
  const workflow = structuredClone(WORKFLOW)
  const slots = await surfaceOf(workflow)
  const outcome = applyOverrides(workflow, { inputs: slots }, { steps: 5 }, [
    { nodeId: '2', input: 'steps', value: 777 },
  ])
  // 覆盖是"我刚改了这个参数，下一次就这么跑"，比随手传的 vars 更明确
  assert.equal(outcome.vars.steps, 777)
})

test('没有覆盖时不改动任何东西', async () => {
  const workflow = structuredClone(WORKFLOW)
  const slots = await surfaceOf(workflow)
  const outcome = applyOverrides(workflow, { inputs: slots }, { seed: 9 }, undefined)
  assert.deepEqual(outcome.vars, { seed: 9 })
  assert.equal(outcome.internal, 0)
  assert.equal(outcome.viaVars, 0)
  assert.deepEqual(overrideNotes(outcome), [])
})

test('note 说明覆盖了几处，且区分槽位与内部参数', async () => {
  const workflow = structuredClone(WORKFLOW)
  const slots = await surfaceOf(workflow)
  const outcome = applyOverrides(workflow, { inputs: slots }, {}, [
    { nodeId: '2', input: 'steps', value: 30 },
    { nodeId: '7', input: 'filename_prefix', value: 'y' },
  ])
  const notes = overrideNotes(outcome)
  assert.equal(notes.length, 1)
  assert.match(notes[0], /1 处参数槽位/)
  assert.match(notes[0], /1 处内部参数/)
})

test('端到端：comfyui_run 的覆盖真的到达提交的工作流（单次路径）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ov-'))
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
      async history() { return {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  deps.overrides.set('wf', [{ nodeId: '2', input: 'steps', value: 777 }])
  const tool = runTool(deps)
  const result = await tool.execute({ workflow: { path: file }, vars: { seed: 1 } })

  assert.equal(captured?.['2']?.inputs?.steps, 777, '提交出去的工作流里 steps 必须是 777')
  assert.equal(deps.overrides.get('wf'), undefined, '用完即清')
  const notes = Array.isArray(result.notes) ? result.notes : []
  assert.ok(notes.some(note => /一次性覆盖/.test(note)), `应当提示已应用覆盖，实际：${JSON.stringify(notes)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})
