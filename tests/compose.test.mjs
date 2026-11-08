/**
 * `comfyui_compose`：把素材整理成一次可直接交给 comfyui_run 的调用。
 *
 * 三层：槽位匹配（纯函数）→ 提示词拼接（纯函数）→ 工具端到端。
 *
 * 两份 fixture 工作流是刻意的：
 * - `two-image` 两个图槽的**语义与顺序相反**（costume_ref 在前、pose_ref 在后），
 *   这样"只看顺序"的实现会给出不同结果 —— 否则测不出默认文件名那一轮到底有没有生效
 * - `img2img` 同时有正向 `prompt` 与 `negative_prompt` 槽，用来钉住"不许把正向写进负向"
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { buildPrompt, composeTool, planSlots } from '../lib/index.js'

// ── 槽位匹配 ──

test('槽位匹配：label 有语义时优先用它', () => {
  const plan = planSlots(
    [
      { name: 'image', label: '原图' },
      { name: 'image_8', label: '蒙版图（白色=重绘区）' },
    ],
    ['base', 'mask'],
  )
  assert.deepEqual(plan.assignments, [
    { slot: 'image', role: 'base', why: 'label「原图」指向待处理的底图' },
    { slot: 'image_8', role: 'mask', why: 'label「蒙版图（白色=重绘区）」指向重绘蒙版' },
  ])
  assert.deepEqual(plan.assumptions, [], '线索充分时不该产生假设')
})

test('槽位匹配：默认文件名压过槽位顺序（语义与顺序相反也认对）', () => {
  // 槽位顺序是 costume_ref 在前，但角色顺序是先 pose —— 只看顺序会配反
  const plan = planSlots(
    [
      { name: 'first', label: 'LoadImage', default: 'costume_ref.png' },
      { name: 'second', label: 'LoadImage', default: 'pose_ref_bath2.png' },
    ],
    ['pose', 'costume'],
  )
  const byRole = Object.fromEntries(plan.assignments.map(item => [item.role, item.slot]))
  assert.deepEqual(
    byRole,
    { pose: 'second', costume: 'first' },
    'pose 必须落在 pose_ref 那个槽，而不是按顺序落在第一个',
  )
  assert.ok(
    plan.assignments.every(item => item.why.startsWith('默认文件名')),
    '两个都应该由默认文件名决定',
  )
  assert.deepEqual(plan.assumptions, [], '靠语义匹配上的不该产生"按顺序推断"的假设')
})

test('槽位匹配：完全没有线索时按顺序，并且必须写进 assumptions', () => {
  const plan = planSlots([{ name: 'image' }, { name: 'image_1' }], ['costume', 'pose'])
  assert.equal(plan.assignments.length, 2)
  assert.equal(plan.assignments[0].role, 'costume')
  assert.equal(plan.assumptions.length, 2, '每个按顺序推断的槽位都要说出来')
  assert.match(plan.assumptions[0], /没有语义线索/)
  assert.match(plan.assumptions[0], /不对就改 vars 覆盖/)
})

test('槽位匹配：槽位不够时多出来的角色进 dropped，不静默丢', () => {
  const plan = planSlots([{ name: 'image' }], ['pose', 'costume'])
  assert.equal(plan.assignments.length, 1)
  assert.deepEqual(plan.dropped, ['costume'])
})

test('槽位匹配：type=mask 的槽直配蒙版角色，不靠文字线索', () => {
  const plan = planSlots(
    [{ name: 'image', type: 'image' }, { name: 'noise_mask', type: 'mask' }],
    ['base', 'mask'],
  )
  const maskSlot = plan.assignments.find(item => item.role === 'mask')?.slot
  assert.equal(maskSlot, 'noise_mask', 'mask 槽必须接蒙版，而不是挤进图片槽')
  assert.match(plan.assignments.find(item => item.role === 'mask')?.why ?? '', /类型是 mask/)
})

test('槽位匹配：一个槽位不重复分配', () => {
  const plan = planSlots([{ name: 'image', label: '姿势参考' }], ['pose', 'pose'])
  assert.equal(plan.assignments.length, 1, '同一个槽位不能被两个角色占')
})

// ── 提示词拼接 ──

test('提示词：服装关键词 → 标签 → 自由描述', () => {
  const prompt = buildPrompt({
    keywords: 'ivory frill knit dress',
    tags: ['long_hair', 'white_background'],
    prompt: '站在窗边，傍晚',
  })
  assert.equal(prompt, 'ivory frill knit dress, long_hair, white_background, 站在窗边, 傍晚')
})

test('提示词：大小写不敏感去重', () => {
  const prompt = buildPrompt({ keywords: 'White Dress', tags: ['white dress', 'blue_sky'] })
  assert.equal(prompt, 'White Dress, blue_sky')
})

test('提示词：不给东西就是空串，不发明质量词', () => {
  const prompt = buildPrompt({})
  assert.equal(prompt, '')
  assert.doesNotMatch(prompt, /masterpiece|best quality/i)
})

// ── 工具端到端 ──

/** 两个图槽，语义与顺序相反 + 一个正向提示词槽。 */
const TWO_IMAGE = {
  10: { class_type: 'LoadImage', inputs: { image: 'costume_ref.png' }, _meta: { title: 'LoadImage' } },
  11: { class_type: 'LoadImage', inputs: { image: 'pose_ref.png' }, _meta: { title: 'LoadImage' } },
  12: { class_type: 'CLIPTextEncode', inputs: { prompt: 'a cat', clip: ['13', 1] } },
  13: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  14: { class_type: 'KSampler', inputs: { seed: 1, model: ['13', 0], positive: ['12', 0], latent_image: ['15', 0] } },
  15: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  16: { class_type: 'SaveImage', inputs: { images: ['14', 0], filename_prefix: 'x' } },
}

/** 纯文生图：没有图槽。 */
const TXT2IMG = {
  12: { class_type: 'CLIPTextEncode', inputs: { prompt: 'a cat', clip: ['13', 1] } },
  13: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  14: { class_type: 'KSampler', inputs: { seed: 1, model: ['13', 0], positive: ['12', 0], latent_image: ['15', 0] } },
  15: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  16: { class_type: 'SaveImage', inputs: { images: ['14', 0], filename_prefix: 'x' } },
}

/** 有负向槽的 img2img：用来钉住"正向不许写进 negative"。 */
const IMG2IMG = {
  10: { class_type: 'LoadImage', inputs: { image: 'inpaint_source.png' }, _meta: { title: 'LoadImage' } },
  12: { class_type: 'CLIPTextEncode', inputs: { prompt: 'a cat', clip: ['13', 1] } },
  17: { class_type: 'CLIPTextEncode', inputs: { negative_prompt: 'bad', clip: ['13', 1] } },
  13: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  14: {
    class_type: 'KSampler',
    inputs: { seed: 1, model: ['13', 0], positive: ['12', 0], negative: ['17', 0], latent_image: ['15', 0] },
  },
  15: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  16: { class_type: 'SaveImage', inputs: { images: ['14', 0], filename_prefix: 'x' } },
}

/** 只有负向文本槽的工作流：正向提示词宁可不写，也不许塞进 negative。 */
const NEGATIVE_ONLY = {
  10: { class_type: 'LoadImage', inputs: { image: 'inpaint_source.png' }, _meta: { title: 'LoadImage' } },
  17: { class_type: 'CLIPTextEncode', inputs: { negative_prompt: 'bad', clip: ['13', 1] } },
  13: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  14: { class_type: 'KSampler', inputs: { seed: 1, model: ['13', 0], negative: ['17', 0], latent_image: ['15', 0] } },
  15: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  16: { class_type: 'SaveImage', inputs: { images: ['14', 0], filename_prefix: 'x' } },
}

function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-'))
  const workflowsDir = path.join(dir, 'workflows')
  fs.mkdirSync(workflowsDir, { recursive: true })
  for (const [name, workflow] of [
    ['two-image', TWO_IMAGE],
    ['txt2img', TXT2IMG],
    ['img2img', IMG2IMG],
    ['negative-only', NEGATIVE_ONLY],
  ]) {
    fs.writeFileSync(path.join(workflowsDir, `${name}.json`), JSON.stringify(workflow))
    fs.writeFileSync(path.join(workflowsDir, `${name}.meta.json`), JSON.stringify({ enabled: true }))
  }

  const materials = {
    costume: id => (id === 'SPR-0001' ? { id, name: '象牙白荷叶边针织衫', keywords: 'ivory frill knit' } : undefined),
    pose: id => (id === 'full_single_P012_front' ? { id, name: '坐姿' } : undefined),
    fetchCostume: async id => `/uploads/${id}.webp`,
    fetchPose: async id => `/uploads/${id}.png`,
  }
  return { dir, workflowsDir, materials }
}

test('工具：两个素材按语义落槽，提示词写进正向槽', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  const result = await tool.execute({
    costumeId: 'SPR-0001',
    poseId: 'full_single_P012_front',
    tags: ['long_hair'],
    prompt: '窗边',
  })

  assert.equal(result.ok, true)
  assert.equal(result.call.workflow.id, 'two-image')
  // 语义与顺序相反：pose 必须落在 pose_ref 那个槽
  const poseSlot = result.filled.find(item => item.from.startsWith('pose:'))?.slot
  const costumeSlot = result.filled.find(item => item.from.startsWith('costume:'))?.slot
  assert.equal(result.call.vars[poseSlot], '/uploads/full_single_P012_front.png')
  assert.equal(result.call.vars[costumeSlot], '/uploads/SPR-0001.webp')
  assert.notEqual(poseSlot, costumeSlot)

  const promptText = String(result.call.vars.prompt)
  assert.match(promptText, /ivory frill knit/)
  assert.match(promptText, /long_hair/)
  assert.match(promptText, /窗边/)
  assert.doesNotMatch(promptText, /masterpiece/i)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：正向提示词绝不写进 negative 槽', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  const result = await tool.execute({ workflowId: 'img2img', prompt: '一个女孩站在雨中' })

  assert.equal(result.ok, true)
  assert.match(String(result.call.vars.prompt), /一个女孩站在雨中/)
  assert.doesNotMatch(String(result.call.vars.negative_prompt), /一个女孩站在雨中/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：只有负向槽时宁可不写，并在 assumptions 里说出来', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  const result = await tool.execute({ workflowId: 'negative-only', prompt: '一个女孩站在雨中' })

  assert.equal(result.ok, true)
  assert.equal(result.call.vars.negative_prompt, undefined, '正向内容不许落到负向槽')
  assert.equal(result.call.vars.prompt, undefined)
  assert.ok(
    result.assumptions.some(item => item.includes('没有识别到明确的正向提示词槽')),
    '没写进去要明说',
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：只给 prompt 时选没有图槽的文生图模板', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  const result = await tool.execute({ prompt: '一个女孩站在雨中' })
  assert.equal(result.ok, true)
  assert.equal(result.call.workflow.id, 'txt2img', '不该挑一个等着默认 LoadImage 的 img2img')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：给素材但工作流没有对应语义槽时报错，不硬塞', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  // 只有 mask 角色，而 fixture 的图槽里没有 label/默认文件名指向蒙版的
  const result = await tool.execute({ maskImage: '/tmp/mask.png' })
  assert.equal(result.ok, false, '没有任何工作流能语义匹配上时应当明确失败')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：extraVars 覆盖任何推断', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  const result = await tool.execute({
    workflowId: 'two-image',
    costumeId: 'SPR-0001',
    prompt: '用户给的',
    extraVars: { seed: 424242, prompt: '我指定的' },
  })
  assert.equal(result.call.vars.seed, 424242)
  assert.equal(result.call.vars.prompt, '我指定的', 'extraVars 必须最后落，覆盖拼好的提示词')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工具：素材 id 不存在时给出下一步，不猜', async () => {
  const { dir, workflowsDir, materials } = makeDeps()
  const tool = composeTool({ workflowsDir, getMaterials: () => materials, outputDir: dir })
  await assert.rejects(() => tool.execute({ costumeId: 'NO-SUCH-0001' }), /comfyui_costume_search/)
  fs.rmSync(dir, { recursive: true, force: true })
})
