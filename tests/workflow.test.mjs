/**
 * workflow 域自检：格式判定、IO 面推断、变量应用、schema 覆盖。
 *
 * 这一组直接对应设计文档的验收项：
 *   B21 IO 面自动推断     —— basic 段只收提示词与图像，内部参数不出现
 *   B22 连线不当旋钮       —— 任何 `[nodeId, slot]` 都不在 inputs 里
 *   B23 bind 路径替换保类型 —— 数字仍是数字
 *   B26 IO 面随模板失效     —— hash 变化
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  applyVariables,
  buildSurface,
  detectFormat,
  hashWorkflow,
  importWorkflowFile,
  listEntries,
  sanitizeId,
  VariableError,
} from '../lib/workflow.js'

/** 一份典型的 SDXL text2img（API 格式）。 */
function sdxlWorkflow() {
  return {
    3: {
      class_type: 'KSampler',
      _meta: { title: '采样器' },
      inputs: {
        seed: 12345,
        steps: 20,
        cfg: 7,
        sampler_name: 'euler',
        scheduler: 'normal',
        denoise: 1,
        model: ['4', 0],
        positive: ['6', 0],
        negative: ['7', 0],
        latent_image: ['5', 0],
      },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 1024, height: 1024, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', _meta: { title: '正向提示词' }, inputs: { text: 'a lighthouse', clip: ['4', 1] } },
    7: { class_type: 'CLIPTextEncode', _meta: { title: '负向提示词' }, inputs: { text: 'blurry', clip: ['4', 1] } },
    8: { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['4', 2] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'dsh', images: ['8', 0] } },
  }
}

test('detectFormat 区分 API / UI / 脏数据', () => {
  assert.equal(detectFormat(sdxlWorkflow()), 'api')
  assert.equal(detectFormat({ nodes: [], links: [] }), 'ui')
  assert.equal(detectFormat([1, 2]), 'invalid')
  assert.equal(detectFormat({}), 'invalid')
  assert.equal(detectFormat({ a: { foo: 1 } }), 'invalid')
})

test('IO 面：正负提示词按连线命名，内部参数不出现', () => {
  const surface = buildSurface({ workflowId: 'sdxl', workflow: sdxlWorkflow() })
  const names = surface.inputs.map(slot => slot.name)

  // 语义命名：不是笼统的 text，而是 prompt / negative_prompt
  assert.ok(names.includes('prompt'), '应当有 prompt')
  assert.ok(names.includes('negative_prompt'), '应当有 negative_prompt')

  // 内部参数（模型名、batch_size、filename_prefix）不该成为用户旋钮
  for (const hidden of ['ckpt_name', 'batch_size', 'filename_prefix']) {
    assert.ok(!names.includes(hidden), `${hidden} 不该出现在 inputs 里`)
  }

  // 尺寸与采样参数在 advanced
  const width = surface.inputs.find(slot => slot.name === 'width')
  assert.equal(width?.group, 'advanced')
  assert.equal(width?.default, 1024)
})

test('IO 面：连线不进 inputs（B22）', () => {
  const surface = buildSurface({ workflowId: 'sdxl', workflow: sdxlWorkflow() })
  for (const slot of surface.inputs) {
    assert.equal(typeof slot.bind, 'string', `${slot.name} 应当有 bind`)
    // bind 指向的原始值不是数组（数组代表连线）
    const [nodeId, , key] = slot.bind.split('.')
    const raw = sdxlWorkflow()[nodeId].inputs[key]
    assert.ok(!Array.isArray(raw), `${slot.name} 指向的是连线，不该被当成旋钮`)
  }
})

test('IO 面：basic 段只有提示词，模型与输出被提取', () => {
  const surface = buildSurface({ workflowId: 'sdxl', workflow: sdxlWorkflow() })
  const basic = surface.inputs.filter(slot => slot.group === 'basic').map(slot => slot.name)
  assert.deepEqual(basic.sort(), ['negative_prompt', 'prompt'])

  assert.equal(surface.models.length, 1)
  assert.equal(surface.models[0].name, 'sd_xl_base_1.0.safetensors')
  assert.equal(surface.models[0].kind, 'checkpoint')
  assert.equal(surface.models[0].primary, true)

  assert.equal(surface.outputs.length, 1)
  assert.equal(surface.outputs[0].nodeId, '9')
  assert.equal(surface.outputs[0].kind, 'image')

  assert.equal(surface.meta.nodeCount, 7)
  assert.equal(surface.meta.source, 'inferred')
  assert.equal(surface.description, '')
})

test('变量：bind 路径写入且数字保类型（B23）', () => {
  const workflow = sdxlWorkflow()
  const surface = buildSurface({ workflowId: 'sdxl', workflow })
  const applied = applyVariables(workflow, surface.inputs, { prompt: 'misty cliff', seed: 777, steps: 30 })

  assert.equal(applied.workflow['6'].inputs.text, 'misty cliff')
  assert.equal(applied.workflow['3'].inputs.seed, 777)
  assert.equal(typeof applied.workflow['3'].inputs.seed, 'number')
  assert.equal(applied.workflow['3'].inputs.steps, 30)
  assert.equal(typeof applied.workflow['3'].inputs.steps, 'number')
  assert.equal(applied.effective.prompt, 'misty cliff')
})

test('变量：缺必填 / 未知参数 / 类型错误分别报错', () => {
  const workflow = sdxlWorkflow()
  const surface = buildSurface({ workflowId: 'sdxl', workflow })

  assert.throws(
    () => applyVariables(workflow, surface.inputs, { seed: 'not-a-number' }),
    (error) => error instanceof VariableError && error.code === 'variable_type',
  )
  assert.throws(
    () => applyVariables(workflow, surface.inputs, { nope: 1 }),
    (error) => error instanceof VariableError && error.code === 'variable_unknown',
  )

  // 必填：把 prompt 的空字符串当"未提供"
  // 同时去掉默认值：有默认值就不算"缺"，这里要测的是真的没给。
  const required = surface.inputs.map(slot => (slot.name === 'prompt' ? { ...slot, required: true, default: undefined } : slot))
  assert.throws(
    () => applyVariables(workflow, required, {}),
    (error) => error instanceof VariableError && error.code === 'variable_unbound',
  )
})

test('变量：{{var}} 文本占位符按值替换，不被字符串化', () => {
  const workflow = {
    1: { class_type: 'X', inputs: { width: '{{width}}', note: 'size={{width}}', other: 1 } },
  }
  const applied = applyVariables(workflow, [
    { name: 'width', bind: undefined, label: 'w', type: 'number', required: false, default: 256, group: 'advanced' },
  ], { width: 256 })
  assert.equal(applied.workflow['1'].inputs.width, 256, '整串占位符应保持数字类型')
  assert.equal(applied.workflow['1'].inputs.note, 'size=256', '嵌在句子里只能是字符串')
})

test('schema 覆盖：声明的槽位改变 source 与字段', () => {
  const surface = buildSurface({
    workflowId: 'sdxl',
    workflow: sdxlWorkflow(),
    schema: {
      title: 'SDXL 基础出图',
      description: '一句话出图。',
      vars: [
        { name: 'prompt', label: '画面描述', hint: '越具体越好' },
        { name: 'seed', group: 'basic', min: 0, max: 4294967295 },
      ],
      internalInputs: ['scheduler'],
    },
    meta: { title: '元数据标题优先' },
  })

  assert.equal(surface.title, '元数据标题优先', 'meta.title 优先于 schema.title')
  assert.equal(surface.description, '一句话出图。')
  assert.equal(surface.meta.source, 'declared')

  const prompt = surface.inputs.find(slot => slot.name === 'prompt')
  assert.equal(prompt?.label, '画面描述')
  assert.equal(prompt?.hint, '越具体越好', 'schema 应覆盖推断出的 label/hint')

  const seed = surface.inputs.find(slot => slot.name === 'seed')
  assert.equal(seed?.group, 'basic')
  assert.equal(seed?.max, 4294967295)

  assert.ok(!surface.inputs.some(slot => slot.name === 'scheduler'), 'internalInputs 应把 scheduler 排除')
})

test('hash 随模板变化（B26）', () => {
  const a = sdxlWorkflow()
  const b = sdxlWorkflow()
  b['3'].inputs.steps = 28
  assert.notEqual(hashWorkflow(a), hashWorkflow(b))
  assert.equal(hashWorkflow(a), hashWorkflow(sdxlWorkflow()))
})

test('导入：拒绝 UI 格式并给出可执行指引', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-import-'))
  const src = path.join(base, 'downloads')
  const dir = path.join(base, 'workflows')
  fs.mkdirSync(src, { recursive: true })

  const uiFile = path.join(src, 'ui.json')
  fs.writeFileSync(uiFile, JSON.stringify({ nodes: [], links: [] }), 'utf8')

  assert.throws(
    () => importWorkflowFile(dir, uiFile),
    (error) => /Export \(API\)/.test(String(error.message)),
  )

  const apiFile = path.join(src, 'My SDXL.json')
  fs.writeFileSync(apiFile, JSON.stringify(sdxlWorkflow()), 'utf8')
  const { id, surface } = importWorkflowFile(dir, apiFile)
  assert.equal(id, 'my-sdxl', 'id 应净化为小写短横线')
  assert.ok(surface.inputs.some(slot => slot.name === 'prompt'))
  assert.equal(sanitizeId('a b/c.json'), 'c', 'id 取自文件名而非路径')
  // 中文必须保留：只留 ASCII 会让"文生图/图生图/局部重绘"撞成同一个 id 互相覆盖
  assert.equal(sanitizeId('MOSS-Image_文生图.json'), 'moss-image_文生图')
  assert.notEqual(sanitizeId('MOSS-Image_文生图.json'), sanitizeId('MOSS-Image_图生图.json'))
  assert.equal(listEntries(dir).entries.length, 1)
})
