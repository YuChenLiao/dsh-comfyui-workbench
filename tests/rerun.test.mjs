/**
 * `comfyui_rerun`：从产物重跑 / 做变体。
 *
 * sidecar 里已有复现材料（workflowId / workflowHash / vars / seed），
 * 这个工具把它变成一步，不必手工抄参数回去调 comfyui_run。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, rerunTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 111, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造依赖；工作流库里有 wf.json 与它的 .meta.json。 */
function makeDeps(options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-'))
  const wfDir = path.join(dir, 'workflows')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(wfDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  fs.writeFileSync(path.join(wfDir, 'wf.json'), JSON.stringify(WF))
  fs.writeFileSync(path.join(wfDir, 'wf.meta.json'), JSON.stringify({ enabled: true }))

  const runs = new RunRegistry(outDir)
  let submitted = 0
  const captured = []
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) {
        submitted += 1
        captured.push(workflow)
        return `pid-${submitted}`
      },
      async queue() { return { running: [], pending: [] } },
      async history() { return options.neverDone === true ? undefined : {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: wfDir,
    outputDir: outDir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    runs,
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
    _dir: dir,
    _outDir: outDir,
    _captured: () => captured,
  }
  return deps
}

/** 造一份 sidecar。 */
function writeSidecar(dir, name, payload) {
  const file = path.join(dir, name)
  fs.writeFileSync(file, JSON.stringify(payload))
  return file
}

test('从 sidecar 复现：参数逐键沿用', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'a.png.json', {
    workflowId: 'wf',
    workflowHash: 'whatever',
    vars: { seed: 111, prompt: 'a cat', steps: 20, width: 512, height: 512 },
  })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar })
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(deps._captured().length, 1)
  assert.equal(deps._captured()[0]['2'].inputs.seed, 111, 'seed 要沿用')
  assert.equal(deps._captured()[0]['3'].inputs.text, 'a cat', 'prompt 要沿用')
  assert.equal(result.staleWorkflow, true, 'hash 不同要给提示')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('只覆盖想改的：vars 合并，其余沿用', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'b.png.json', {
    workflowId: 'wf',
    vars: { seed: 111, prompt: 'a cat' },
  })
  const tool = rerunTool(deps)
  await tool.execute({ from: sidecar, vars: { prompt: 'a dog' } })
  assert.equal(deps._captured()[0]['3'].inputs.text, 'a dog')
  assert.equal(deps._captured()[0]['2'].inputs.seed, 111, '没给的沿用')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('seed 给具体值：count>1 时依次 +1', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'c.png.json', { workflowId: 'wf', vars: { seed: 111 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, seed: 500, count: 3 })
  assert.equal(result.count, 3)
  assert.deepEqual(result.seeds, [500, 501, 502])
  assert.equal(deps._captured()[2]['2'].inputs.seed, 502)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('seed 给 random：每张不同', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'd.png.json', { workflowId: 'wf', vars: { seed: 111 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, seed: 'random', count: 3 })
  assert.equal(result.count, 3)
  const seeds = deps._captured().map(wf => wf['2'].inputs.seed)
  assert.equal(new Set(seeds).size, 3, '三张 seed 应各不相同')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('不给 seed：沿用原值递增', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'e.png.json', { workflowId: 'wf', vars: { seed: 111 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, count: 2 })
  assert.deepEqual(result.seeds, [111, 112])
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('给产物路径也能找到 sidecar', async () => {
  const deps = makeDeps()
  const image = path.join(deps._dir, 'x.png')
  fs.writeFileSync(image, Buffer.from([0x89]))
  writeSidecar(deps._dir, 'x.png.json', { workflowId: 'wf', vars: { seed: 7 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: image })
  assert.equal(result.ok, true)
  assert.equal(deps._captured()[0]['2'].inputs.seed, 7)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('sidecar 不存在：明确报错并说清找过哪', async () => {
  const deps = makeDeps()
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: path.join(deps._dir, 'nope.png') })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'sidecar_missing')
  assert.match(String(result.error), /找不到 sidecar/)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('sidecar 里的工作流已被删：报 workflow_missing', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'f.png.json', { workflowId: 'gone', vars: {} })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'workflow_missing')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('sidecar 不是合法 JSON：报错不崩', async () => {
  const deps = makeDeps()
  const bad = path.join(deps._dir, 'bad.png.json')
  fs.writeFileSync(bad, '{ 坏掉的')
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: bad })
  assert.equal(result.ok, false)
  // 文件存在但内容坏了 → invalid；只有"找不到文件"才是 missing
  assert.equal(result.code, 'sidecar_invalid')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('count 超上限被拒', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'g.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, count: 21 })
  // asInt 会夹到上限，所以不会报错，但实际只提交 20 条
  assert.ok(result.count <= 20, `应被夹到 20，实际 ${result.count}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('每次提交都登记到运行表', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'h.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  const tool = rerunTool(deps)
  await tool.execute({ from: sidecar, count: 2 })
  assert.equal(deps.runs.list({ limit: 10 }).length, 2)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('hash 一致时不给 stale 提示', async () => {
  const deps = makeDeps()
  // 先拿到真实 hash
  const { loadWorkflowForBatch } = await import('../lib/index.js')
  const loaded = await loadWorkflowForBatch(deps, { workflow: { id: 'wf' } })
  const sidecar = writeSidecar(deps._dir, 'i.png.json', {
    workflowId: 'wf',
    workflowHash: loaded.surface.workflowHash,
    vars: { seed: 1 },
  })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar })
  assert.equal(result.staleWorkflow, undefined, 'hash 相同时不该提示')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait: true 真的等，并带回产物、登记索引（tags 有去处）', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'w.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  const added = []
  deps.index.add = entry => { added.push(entry) }
  // 让 history 立刻完成
  deps.client.history = async () => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  })
  deps.client.view = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, wait: true, waitMs: 5_000, tags: ['portrait', 'test'] })

  assert.equal(result.ok, true)
  assert.ok(Array.isArray(result.results), 'wait 时要给每条结果')
  assert.ok((result.results[0].artifacts?.length ?? 0) >= 1, '要带回产物路径')
  assert.ok(added.length >= 1, '索引要登记（否则 tags 无处可去）')
  assert.deepEqual(added[0].tags, ['portrait', 'test'], 'tags 要进索引')
  assert.equal(deps.runs.get(result.promptIds[0])?.state, 'done', '记录要收敛成 done')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait: false 时不登记索引（没有产物可取）', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'w2.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  const added = []
  deps.index.add = entry => { added.push(entry) }
  const tool = rerunTool(deps)
  await tool.execute({ from: sidecar, tags: ['x'] })
  assert.equal(added.length, 0, '异步路径没有产物，不该登记')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('seed 用字符串传也能认（模型常把数字包成字符串）', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'n.png.json', { workflowId: 'wf', vars: { seed: 111 } })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, seed: '500', count: 2 })
  assert.deepEqual(result.seeds, [500, 501], '字符串 seed 不该被静默忽略')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('sidecar 没记 seed 时，出多张要各自随机（否则是同一张的复制）', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'ns.png.json', { workflowId: 'wf', vars: {} })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, count: 3 })
  const seeds = deps._captured().map(wf => wf['2'].inputs.seed)
  assert.equal(new Set(seeds).size, 3, `三张 seed 应各不相同，实际 ${JSON.stringify(seeds)}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('坏 JSON 归 sidecar_invalid，不是 sidecar_missing', async () => {
  const deps = makeDeps()
  const bad = path.join(deps._dir, 'bad2.png.json')
  fs.writeFileSync(bad, '{ 坏掉的')
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: bad })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'sidecar_invalid', `文件存在但内容坏了，应报 invalid，实际 ${result.code}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('from 为空时给 code，不只是 message', async () => {
  const deps = makeDeps()
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: '   ' })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'bad_input')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('seed 槽位叫 noise_seed 的工作流也能跑（不能硬编码 seed）', async () => {
  // 本仓库自己的 infer 就把 noise_seed 当一等命名。硬写 vars.seed 会让
  // applyVariables 抛 variable_unknown，整条 rerun 死。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-ns-'))
  const wfDir = path.join(dir, 'workflows')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(wfDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  const NS_WF = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    2: { class_type: 'KSampler', inputs: { noise_seed: 111, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['1', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['1', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
  }
  fs.writeFileSync(path.join(wfDir, 'ns.json'), JSON.stringify(NS_WF))
  fs.writeFileSync(path.join(wfDir, 'ns.meta.json'), JSON.stringify({ enabled: true }))

  const captured = []
  let submitted = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(NS_WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) {
        submitted += 1
        captured.push(workflow)
        return `pid-ns-${submitted}`
      },
      async queue() { return { running: [], pending: [] } },
      async history() { return {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: wfDir,
    outputDir: outDir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    runs: new RunRegistry(outDir),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  const sidecar = path.join(dir, 'n.png.json')
  fs.writeFileSync(sidecar, JSON.stringify({ workflowId: 'ns', vars: { noise_seed: 111 } }))
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, count: 2 })

  assert.equal(result.ok, true, `noise_seed 工作流不该失败：${JSON.stringify(result)}`)
  assert.equal(result.count, 2)
  const seeds = captured.map(wf => wf['2'].inputs.noise_seed)
  assert.deepEqual(seeds, [111, 112], '要写到 noise_seed 上')
  assert.deepEqual(result.seeds, [111, 112])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('显式给 seed 时也写到正确的槽位上（noise_seed）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-ns2-'))
  const wfDir = path.join(dir, 'workflows')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(wfDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  const NS_WF = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    2: { class_type: 'KSampler', inputs: { noise_seed: 111, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
  }
  fs.writeFileSync(path.join(wfDir, 'ns.json'), JSON.stringify(NS_WF))
  fs.writeFileSync(path.join(wfDir, 'ns.meta.json'), JSON.stringify({ enabled: true }))
  const captured = []
  let submitted = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(NS_WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) { submitted += 1; captured.push(workflow); return `pid-x-${submitted}` },
      async queue() { return { running: [], pending: [] } },
      async history() { return {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: wfDir,
    outputDir: outDir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    runs: new RunRegistry(outDir),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  const sidecar = path.join(dir, 'n.png.json')
  fs.writeFileSync(sidecar, JSON.stringify({ workflowId: 'ns', vars: { noise_seed: 111 } }))
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, seed: 700 })
  assert.equal(result.ok, true)
  assert.deepEqual(captured.map(wf => wf['2'].inputs.noise_seed), [700])
  assert.deepEqual(result.seeds, [700])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('wait 超时后仍挂兜底：迟到的产物会进注册表', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'late.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  let polls = 0
  // 前 30 次都不完成（1 秒内 pollIntervalMs=50 只跑约 20 次）→ 一定超时；
  // 之后才完成 → 验兜底能接住迟到的产物
  deps.client.history = async () => {
    polls += 1
    if (polls < 30) return undefined
    return {
      status: { status_str: 'success', completed: true },
      outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
    }
  }
  deps.client.view = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, wait: true, waitMs: 1_000 })
  assert.equal(result.ok, true)
  assert.equal(result.results[0].pending, true, '先返回 pending')
  // 等待兜底收敛
  const startedAt = Date.now()
  while (Date.now() - startedAt < 4_000) {
    if (deps.runs.get(result.promptIds[0])?.state === 'done') break
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  const record = deps.runs.get(result.promptIds[0])
  assert.equal(record?.state, 'done', `超时后也该被兜底收敛，实际 ${record?.state}`)
  assert.ok((record?.artifacts?.length ?? 0) >= 1, '迟到的产物要登记')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait: true 遇执行失败时记录要标 failed（不是停在 queued）', async () => {
  // 上一版这里用 (error as {promptId}).promptId 取 id，而 RunError 没有这个属性
  // ——那几行从没执行过，记录一直停在 queued。这条测试就是钉住它。
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'fail.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  deps.client.history = async () => ({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
    },
  })
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, wait: true, waitMs: 5_000 })

  // 提交成功了但执行失败：整体 ok 可以是 false，也可能 ok 但 results 里有失败；
  // 无论哪种，登记表那条必须收敛成 failed 并带 error。
  const records = deps.runs.list({ limit: 5 })
  assert.ok(records.length >= 1, '应当有一条记录')
  const record = records[0]
  assert.equal(record.state, 'failed', `执行失败要标 failed，实际 ${record.state}`)
  assert.ok(record.error !== undefined, '要带错误信息')
  assert.match(String(record.error?.message), /out of memory|CUDA/i)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('没有 seed 槽位的工作流：不注入 seed，且在返回里说明被忽略', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rerun-noseed-'))
  const wfDir = path.join(dir, 'workflows')
  const outDir = path.join(dir, 'out')
  fs.mkdirSync(wfDir, { recursive: true })
  fs.mkdirSync(outDir, { recursive: true })
  // KSampler 去掉 seed 与 noise_seed
  const NS = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    2: { class_type: 'KSampler', inputs: { steps: 20, cfg: 7, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
  }
  fs.writeFileSync(path.join(wfDir, 'ns.json'), JSON.stringify(NS))
  fs.writeFileSync(path.join(wfDir, 'ns.meta.json'), JSON.stringify({ enabled: true }))
  const captured = []
  let submitted = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(NS)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) { submitted += 1; captured.push(workflow); return `pid-n-${submitted}` },
      async queue() { return { running: [], pending: [] } },
      async history() { return {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: wfDir,
    outputDir: outDir,
    timeoutMs: 5_000,
    pollIntervalMs: 50,
    overrides: new Map(),
    runs: new RunRegistry(outDir),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  const sidecar = path.join(dir, 'n.png.json')
  fs.writeFileSync(sidecar, JSON.stringify({ workflowId: 'ns', vars: {} }))
  const tool = rerunTool(deps)

  // 不传 seed：不该注入
  const plain = await tool.execute({ from: sidecar, count: 2 })
  assert.equal(plain.ok, true)
  for (const wf of captured) {
    assert.equal('seed' in wf['2'].inputs, false, '没有 seed 槽位就不该注入')
    assert.equal('noise_seed' in wf['2'].inputs, false)
  }

  // 显式传 seed：也不该注入，但要告诉调用方被忽略了（否则模型以为改了参数）
  captured.length = 0
  const explicit = await tool.execute({ from: sidecar, seed: 700 })
  assert.equal(explicit.ok, true)
  assert.equal('seed' in captured[0]['2'].inputs, false, '仍不该注入')
  assert.ok(
    typeof explicit.note === 'string' && /seed/.test(explicit.note),
    `该工作流没有 seed 槽位时要说清 seed 被忽略，实际 ${JSON.stringify(explicit)}`,
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('count>1 时第 2 条提交失败，不能把第 1 条记成 failed（作用域不能泄漏）', async () => {
  // 变异测试证明：把 activePromptId 提到循环外（不重置）能通过其它所有 rerun 测试。
  // 这条就是守它的 —— 第 2 条在"提交阶段"就失败，那时 activePromptId 还没被赋值，
  // 一旦变量没在循环内声明，catch 会误改第 1 条。
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'scope.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  let calls = 0
  deps.client.queuePrompt = async () => {
    calls += 1
    if (calls === 2) {
      const error = new Error('队列已满')
      error.code = 'queue_full'
      throw error
    }
    return 'pid-1'
  }
  const tool = rerunTool(deps)
  const result = await tool.execute({ from: sidecar, count: 2 })

  // 第 2 条提交前就失败 → 只有 1 条记录，且它必须还是 done/queued，不能是 failed
  const records = deps.runs.list({ limit: 10 })
  assert.equal(records.length, 1, `提交阶段失败的那条不该留下记录，实际 ${records.length} 条`)
  assert.equal(records[0].promptId, 'pid-1')
  assert.notEqual(records[0].state, 'failed', `第 1 条不能被第 2 条的错误牵连，实际 ${records[0].state}`)
  assert.equal(result.ok, true)
  assert.equal(result.count, 1)
  assert.equal(result.failures?.length, 1)
  assert.equal(result.failures[0].index, 1)
  assert.equal(result.failures[0].code, 'queue_full', '原始 code 要保留')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('count>1 时第 1 条成功、第 2 条执行失败：各自记各自的状态', async () => {
  const deps = makeDeps()
  const sidecar = writeSidecar(deps._dir, 'scope2.png.json', { workflowId: 'wf', vars: { seed: 1 } })
  let submitted = 0
  deps.client.queuePrompt = async () => {
    submitted += 1
    return `pid-${submitted}`
  }
  // 第 1 条成功、第 2 条执行报错
  deps.client.history = async (promptId) => {
    if (promptId === 'pid-2') {
      return {
        status: {
          status_str: 'error',
          messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
        },
      }
    }
    return {
      status: { status_str: 'success', completed: true },
      outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
    }
  }
  deps.client.view = async () => Buffer.from([0x89, 0x50, 0x4e, 0x47])
  const tool = rerunTool(deps)
  await tool.execute({ from: sidecar, count: 2, wait: true, waitMs: 5_000 })

  const first = deps.runs.get('pid-1')
  const second = deps.runs.get('pid-2')
  assert.equal(first?.state, 'done', `第 1 条该是 done，实际 ${first?.state}`)
  assert.equal(first?.error, undefined, '第 1 条不该带错误')
  assert.equal(second?.state, 'failed', `第 2 条该是 failed，实际 ${second?.state}`)
  assert.ok(second?.error !== undefined)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
