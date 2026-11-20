/**
 * 预设（presets）与参数网格（grid）。
 *
 * 预设挂在 `<id>.meta.json` 的 `presets`：`comfyui_run { preset: '夜景' }` 把它铺底，
 * 同时传的 `vars` 覆盖同名键。网格挂在 `comfyui_run_batch { grid: {...} }`：
 * 按给出的维度笛卡尔展开，共用外层 workflow 与同一个 batchId。
 *
 * 两者都容易"看起来生效、实际没进参数"，所以断言落在**真正交给 client 的那份 workflow** 上。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, runBatchTool, runTool, workflowEditTool, workflowTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 假 client：把每次提交的 workflow 记下来，供断言"参数到底有没有进去"。 */
function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preset-grid-'))
  fs.writeFileSync(path.join(dir, 'wf.json'), JSON.stringify(WF))
  fs.writeFileSync(path.join(dir, 'wf.meta.json'), JSON.stringify({
    enabled: true,
    presets: {
      // 预设只覆盖两个字段，其余沿用模板
      night: { steps: 30, cfg: 5 },
      broken: 'not-an-object',
    },
  }))
  const submitted = []
  let seq = 0
  const deps = {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt(workflow) {
        submitted.push(workflow)
        seq += 1
        return { promptId: `pid-${seq}`, warnings: [] }
      },
      async queue() { return { running: [], pending: [] } },
      async history() { return {} },
      async view() { return Buffer.alloc(0) },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 30_000,
    pollIntervalMs: 20,
    overrides: new Map(),
    runs: new RunRegistry(dir),
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  return { deps, dir, submitted }
}

test('预设：套用一组默认 vars，显式 vars 覆盖同名键', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    const result = await runTool(deps).execute({
      workflow: { id: 'wf' },
      preset: 'night',
      // 显式给 cfg：预设里的 cfg 应被覆盖，steps 仍沿用预设
      vars: { cfg: 9, seed: 42 },
      wait: false,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(submitted.length, 1)
    const sampler = submitted[0]['2'].inputs
    assert.equal(sampler.steps, 30, '预设里的 steps 要进去')
    assert.equal(sampler.cfg, 9, '显式 vars 覆盖预设')
    assert.equal(sampler.seed, 42)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('预设不存在：报 preset_unknown 并列出可用预设', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    const result = await runTool(deps).execute({ workflow: { id: 'wf' }, preset: 'nope', wait: false })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'preset_unknown')
    assert.match(String(result.message), /night/, '可用预设要列出来（用 message：render 只读它）')
    assert.equal(submitted.length, 0, '没提交任何东西')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('预设形状不对（值是字符串）当作不存在，而不是运行时崩', async () => {
  const { deps, dir } = makeDeps()
  try {
    const result = await runTool(deps).execute({ workflow: { id: 'wf' }, preset: 'broken', wait: false })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'preset_unknown')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('网格：按维度笛卡尔展开，每条参数组合都真的提交了', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    const result = await runBatchTool(deps).execute({
      workflow: { id: 'wf' },
      grid: { steps: [10, 20], cfg: [5, 7] },
      wait: false,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    // 2 × 2 = 4 条
    assert.equal(submitted.length, 4, `该提交 4 条，实际 ${submitted.length}`)
    const combos = submitted.map(workflow => `${workflow['2'].inputs.steps}x${workflow['2'].inputs.cfg}`).sort()
    assert.deepEqual(combos, ['10x5', '10x7', '20x5', '20x7'], '四种组合都要出现')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('网格的边界：超上限 / 非数组 / 空数组都明确报错', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    // 6 个维度各 2 个值 = 64 > 20
    const tooMany = await runBatchTool(deps).execute({
      workflow: { id: 'wf' },
      grid: { a: [1, 2], b: [1, 2], c: [1, 2], d: [1, 2], e: [1, 2], f: [1, 2] },
      wait: false,
    })
    assert.equal(tooMany.ok, false)
    assert.match(String(tooMany.error), /超过 20 条/)

    const bad = await runBatchTool(deps).execute({ workflow: { id: 'wf' }, grid: { steps: 20 }, wait: false })
    assert.equal(bad.ok, false)
    assert.match(String(bad.error), /必须是数组/)

    const empty = await runBatchTool(deps).execute({ workflow: { id: 'wf' }, grid: { steps: [] }, wait: false })
    assert.equal(empty.ok, false)
    assert.match(String(empty.error), /空数组/)

    assert.equal(submitted.length, 0, '报错的批次一条都不该提交')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('preset_unknown 的文案能到模型：render 只读 message，不读 error', async () => {
  const { deps, dir } = makeDeps()
  try {
    const tool = runTool(deps)
    const result = await tool.execute({ workflow: { id: 'wf' }, preset: 'nope', wait: false })
    assert.equal(result.ok, false)
    // 直接跑渲染：宿主只把 render 的文本交给模型，返回对象里的字段它看不到。
    // 用 `error:` 的话这句会是"执行失败。"，可用预设列表一个字都到不了。
    const blocks = tool.output.render({}, result)
    const text = blocks.map(block => block.text ?? '').join('\n')
    assert.match(text, /night/, `可用预设要出现在渲染结果里，实际：${text}`)
    assert.doesNotMatch(text, /^执行失败。$/m, '不能只剩一句"执行失败。"')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('列表与运行对预设的判定一致：形状不对的预设两边都不认', async () => {
  const { deps, dir } = makeDeps()
  try {
    // 造一份带坏预设的模板
    fs.writeFileSync(path.join(dir, 'wf.meta.json'), JSON.stringify({
      enabled: true,
      presets: { good: { steps: 12 }, broken: 'not-an-object', nope: null, arr: [1, 2] },
    }))
    const listed = await workflowTool(deps).execute({})
    const row = (listed.workflows ?? []).find(item => item.workflowId === 'wf')
    assert.ok(row !== undefined, '列表里该有 wf')
    assert.deepEqual(row.presets, ['good'], `列表只该列出形状正确的预设，实际 ${JSON.stringify(row.presets)}`)

    // 运行侧同样只认 good
    const okRun = await runTool(deps).execute({ workflow: { id: 'wf' }, preset: 'good', wait: false })
    assert.equal(okRun.ok, true, JSON.stringify(okRun))
    const badRun = await runTool(deps).execute({ workflow: { id: 'wf' }, preset: 'broken', wait: false })
    assert.equal(badRun.ok, false)
    assert.equal(badRun.code, 'preset_unknown')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('原型链上的名字不算预设（toString / constructor）', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    for (const name of ['toString', 'constructor', 'hasOwnProperty']) {
      const result = await runTool(deps).execute({ workflow: { id: 'wf' }, preset: name, wait: false })
      assert.equal(result.ok, false, `${name} 不该被当成预设`)
      assert.equal(result.code, 'preset_unknown')
    }
    assert.equal(submitted.length, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('runs 与 grid 同时给时以 runs 为准（grid 被忽略）', async () => {
  const { deps, dir, submitted } = makeDeps()
  try {
    const result = await runBatchTool(deps).execute({
      workflow: { id: 'wf' },
      runs: [{ vars: { steps: 15 } }],
      grid: { steps: [10, 20], cfg: [5, 7] },
      wait: false,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(submitted.length, 1, `该只提交 runs 那一条，实际 ${submitted.length}`)
    assert.equal(submitted[0]['2'].inputs.steps, 15)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('改备注不会抹掉预设与别的 meta 字段', async () => {
  const { deps, dir } = makeDeps()
  try {
    const before = JSON.parse(fs.readFileSync(path.join(dir, 'wf.meta.json'), 'utf8'))
    assert.ok(before.presets !== undefined)

    const result = await workflowEditTool(deps).execute({
      workflowId: 'wf',
      notes: { description: '新说明' },
    })
    assert.equal(result.ok, true, JSON.stringify(result))

    const after = JSON.parse(fs.readFileSync(path.join(dir, 'wf.meta.json'), 'utf8'))
    assert.equal(after.description, '新说明')
    // 预设住同一份文件里：从零重建 meta 的话，"改一句备注"就会把它静默抹掉
    assert.deepEqual(after.presets, before.presets, 'presets 不能被抹掉')
    // `enabled` 也是既有字段，同样不该丢（这是修之前的既有缺陷）
    assert.equal(after.enabled, true, 'enabled 不能被抹掉')
    assert.equal(after.updatedBy, 'agent')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
