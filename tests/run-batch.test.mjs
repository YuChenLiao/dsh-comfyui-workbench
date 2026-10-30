/**
 * `comfyui_run_batch` 的工具壳。
 *
 * 这里只测"批量"这层语义 —— 提交本身的正确性由 runner 的测试覆盖。
 * 关键是：**一条失败不能拖垮其它条**，以及上限、promptId 收集。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { runBatchTool } from '../lib/index.js'

/** 一份最小的 API 格式工作流：两个可调槽位。 */
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

/**
 * 造一个假 ComfyUI 客户端。
 *
 * `failOn` 可以让第 N 次提交失败，用来验"部分失败不中断"。
 */
function fakeClient(options = {}) {
  let submitted = 0
  let historyCalls = 0
  return {
    baseUrl: 'http://127.0.0.1:8188',
    async objectInfo() {
      // 让 preflight 认得出所有节点
      const info = {}
      for (const node of Object.values(WORKFLOW)) {
        info[node.class_type] = { input: {}, output: [], output_node: false }
      }
      return info
    },
    async queuePrompt() {
      submitted += 1
      if (options.failOn !== undefined && submitted === options.failOn) {
        throw new Error('模拟提交失败')
      }
      // 真实 ComfyClient.queuePrompt 返回字符串，不是 {prompt_id}
      return `pid-${submitted}`
    },
    async history() {
      historyCalls += 1
      // wait 路径要能看到"已完成 + 有产物"，所以给一份 minimal 的 history 条目
      return {
        status: { status_str: 'success', completed: true },
        outputs: { 7: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } },
      }
    },
    get historyCalls() {
      return historyCalls
    },
    async view() {
      // 真实 ComfyClient.view 返回 Buffer，不是 Response
      return Buffer.from([0x89, 0x50, 0x4e, 0x47])
    },
  }
}

/** 造依赖。 */
function makeDeps(workflows = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rb-'))
  return {
    client: fakeClient(),
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 30_000,
    pollIntervalMs: 100,
    overrides: new Map(),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
    _dir: dir,
  }
}

/** 写一个工作流文件并返回路径。 */
function writeWorkflow(dir, id) {
  const file = path.join(dir, `${id}.json`)
  fs.writeFileSync(file, JSON.stringify(WORKFLOW))
  return file
}

test('批量提交：空清单与超上限被拒', async () => {
  const deps = makeDeps()
  const tool = runBatchTool(deps)
  assert.equal((await tool.execute({ runs: [] })).ok, false)
  const tooMany = Array.from({ length: 21 }, () => ({}))
  const result = await tool.execute({ runs: tooMany })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /最多提交 20/)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量提交：逐条收集 promptId', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }, { vars: { seed: 3 } }],
  })
  assert.equal(result.ok, true)
  assert.equal(result.submitted, 3)
  assert.equal(result.failed, 0)
  assert.equal(result.promptIds.length, 3)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量提交：一条参数名写错不影响其它条', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [
      { vars: { seed: 10 } },
      // 不认识的参数名：`vars` 会报错，这条应当失败
      { vars: { not_a_real_slot: 1 } },
      { vars: { seed: 30 } },
    ],
  })
  assert.equal(result.results.length, 3)
  assert.equal(result.results[0].ok, true)
  assert.equal(result.results[1].ok, false)
  assert.ok(result.results[1].error !== undefined)
  assert.equal(result.results[2].ok, true, '第 1 条失败不该让第 3 条也发不出去')
  assert.equal(result.submitted, 2)
  assert.equal(result.failed, 1)
  // 只要有一条成功，整体 ok 就是 true（部分成功也是有产出）
  assert.equal(result.ok, true)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量提交：全部失败时整体 ok:false', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { nope1: 1 } }, { vars: { nope2: 2 } }],
  })
  assert.equal(result.ok, false)
  assert.equal(result.submitted, 0)
  assert.equal(result.failed, 2)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量提交：每条可各自指定工作流', async () => {
  const deps = makeDeps()
  const fileA = writeWorkflow(deps._dir, 'a')
  const fileB = writeWorkflow(deps._dir, 'b')
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    runs: [
      { workflow: { path: fileA }, vars: { seed: 1 } },
      { workflow: { path: fileB }, vars: { seed: 2 } },
    ],
  })
  assert.equal(result.ok, true)
  assert.equal(result.submitted, 2)
  assert.equal(result.results[0].workflowId, 'a')
  assert.equal(result.results[1].workflowId, 'b')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait: true 会真的等待并带回产物（不是提交完就返回）', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { seed: 1 } }],
    wait: true,
    timeoutMs: 5_000,
  })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].ok, true)
  // 关键：wait=true 不能是"提交完立刻返回" —— 要么等到产物，要么标 pending
  const item = result.results[0]
  assert.ok(
    item.pending === true || (Array.isArray(item.artifacts) && item.artifacts.length > 0) || item.artifacts !== undefined,
    `wait=true 必须等到产物或标 pending，实际：${JSON.stringify(item)}`,
  )
  assert.ok(deps.client.historyCalls > 0, 'wait=true 必须真的轮询过 history')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量会应用并清掉一次性参数覆盖（overrides）', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  // 预置一条一次性覆盖：把 steps 改成 777
  deps.overrides.set('wf', [{ nodeId: '2', input: 'steps', value: 777 }])
  const tool = runBatchTool(deps)
  let captured = null
  const originalQueue = deps.client.queuePrompt.bind(deps.client)
  deps.client.queuePrompt = async (workflow) => {
    captured = workflow
    return originalQueue(workflow)
  }
  await tool.execute({ workflow: { path: file }, runs: [{ vars: { seed: 1 } }] })
  assert.equal(captured?.['2']?.inputs?.steps, 777, '一次性覆盖必须被应用到提交的工作流上')
  assert.equal(deps.overrides.get('wf'), undefined, '应用后必须清掉，不能留着影响下一次')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait=true 的每条结果也带覆盖提示（不能静默改参数）', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { seed: 1 } }],
    wait: true,
    timeoutMs: 5_000,
  })
  assert.equal(result.ok, true)
  const first = result.results[0]
  const notes = Array.isArray(first.notes) ? first.notes : []
  assert.ok(
    notes.some(note => /一次性覆盖/.test(note)),
    `wait=true 的结果也要提示已应用覆盖，实际：${JSON.stringify(first)}`,
  )
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量 wait=true 超时（pending）分支也带覆盖提示', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  // 让 history 永不完成 → 走 pending 分支
  deps.client.history = async () => undefined
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { seed: 1 } }],
    wait: true,
    timeoutMs: 1_000,
  })
  const first = result.results[0]
  assert.equal(first.pending, true)
  const notes = Array.isArray(first.notes) ? first.notes : []
  assert.ok(
    notes.some(note => /一次性覆盖/.test(note)),
    `pending 分支也要提示，实际：${JSON.stringify(first)}`,
  )
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait=false 只有第一条带覆盖提示（用完即清）', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runBatchTool(deps)
  const result = await tool.execute({
    workflow: { path: file },
    runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }, { vars: { seed: 3 } }],
  })
  const withNotes = result.results.filter(item => Array.isArray(item.notes) && item.notes.length > 0)
  assert.equal(withNotes.length, 1, '只有第一条该带 notes')
  assert.equal(withNotes[0].index, 0)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('批量的提示在 render 文本里也可见（模型只看到这段）', async () => {
  const deps = makeDeps()
  const file = writeWorkflow(deps._dir, 'wf')
  deps.overrides.set('wf', [{ nodeId: '7', input: 'filename_prefix', value: 'zzz' }])
  const tool = runBatchTool(deps)
  const args = { workflow: { path: file }, runs: [{ vars: { seed: 1 } }] }
  const result = await tool.execute(args)
  const text = tool.output.render(args, result)
    .map(block => (block.type === 'text' ? block.text : ''))
    .join(String.fromCharCode(10))
  assert.match(text, /一次性覆盖/, `render 文本要能看见覆盖提示，实际：${text.slice(0, 300)}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
