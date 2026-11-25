/**
 * 环境自检（Doctor）与开箱模板生成。
 *
 * 这两件事错了都不会报错：诊断漏一项 = 用户继续"点了没反应"；模板覆盖已有文件 =
 * 用户改过的模板被悄悄换掉。所以三类断言都要有 —— 诊断分级、生成幂等、失败可读。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, test } from 'node:test'

const {
  runDoctor,
  bootstrapWorkflows,
  txt2imgWorkflow,
  img2imgWorkflow,
  inpaintWorkflow,
  enumOf,
  gpuSummary,
} = await import('../lib/index.js')

const cleanup = []
after(() => {
  for (const dir of cleanup) fs.rmSync(dir, { recursive: true, force: true })
})

/** 造一个临时目录。 */
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-doctor-'))
  cleanup.push(dir)
  return dir
}

/** 一份能跑通全部 ok 项的 deps。 */
function healthyDeps(overrides = {}) {
  return {
    baseUrl: 'http://127.0.0.1:8188',
    systemStats: async () => ({ devices: [{ name: 'RTX 4090', vram_total: 24 * 1024 ** 3 }] }),
    objectInfo: async () => ({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors', 'sd15.safetensors']] } } },
    }),
    workflowCount: () => 3,
    outputDir: 'D:/out',
    assertWritable: () => {},
    ...overrides,
  }
}

test('enumOf / gpuSummary：只取该取的字段，脏数据不抛', () => {
  const info = {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['a.safetensors']] } } },
    Other: { input: { optional: { model: [['b.pt']] } } },
  }
  assert.deepEqual(enumOf(info, 'CheckpointLoaderSimple', 'ckpt_name'), ['a.safetensors'])
  assert.deepEqual(enumOf(info, 'Other', 'model'), ['b.pt'], 'optional 段也要认')
  assert.deepEqual(enumOf(info, 'Nope', 'ckpt_name'), [])
  assert.deepEqual(enumOf(null, 'X', 'y'), [])
  assert.deepEqual(enumOf({ CheckpointLoaderSimple: {} }, 'CheckpointLoaderSimple', 'ckpt_name'), [])

  assert.deepEqual(gpuSummary({ devices: [{ name: 'RTX', vram_total: 24 * 1024 ** 3 }] }), { name: 'RTX', vramGb: 24 })
  assert.equal(gpuSummary({ devices: [] }), undefined)
  assert.equal(gpuSummary(null), undefined)
})

test('runDoctor：一切正常时五项全 ok 且整体通过', async () => {
  const report = await runDoctor(healthyDeps())
  assert.equal(report.ok, true)
  assert.deepEqual(report.items.map(item => item.id), ['service', 'models', 'workflows', 'output', 'gpu'])
  assert.equal(report.items.every(item => item.level === 'ok'), true, JSON.stringify(report.items))
})

test('runDoctor：服务连不上 → service=fail 且整体不通过，但不影响其它项照常出结论', async () => {
  const report = await runDoctor(healthyDeps({
    systemStats: async () => { throw new Error('ECONNREFUSED') },
  }))
  assert.equal(report.ok, false)
  const service = report.items.find(item => item.id === 'service')
  assert.equal(service.level, 'fail')
  assert.match(service.detail, /连不上/)
  assert.ok(service.fix !== undefined, 'fail 项必须给出下一步')
  // 其它项仍要有结论（不能因为一项挂了就整体中断）
  assert.equal(report.items.length, 5)
  assert.equal(report.items.find(item => item.id === 'workflows').level, 'ok')
})

test('runDoctor：没有模型 → fail，工作流空库只算 warn', async () => {
  const report = await runDoctor(healthyDeps({
    objectInfo: async () => ({ CheckpointLoaderSimple: { input: { required: { ckpt_name: [[]] } } } }),
    workflowCount: () => 0,
  }))
  assert.equal(report.ok, false, '没有模型是硬阻塞')
  assert.equal(report.items.find(item => item.id === 'models').level, 'fail')
  const workflows = report.items.find(item => item.id === 'workflows')
  assert.equal(workflows.level, 'warn', '空工作流库不该判 fail')
  assert.match(workflows.fix, /一键生成/)
})

test('runDoctor：拿不到节点定义时模型项降级成 warn（不是 fail）', async () => {
  const report = await runDoctor(healthyDeps({
    objectInfo: async () => { throw new Error('timeout') },
  }))
  assert.equal(report.items.find(item => item.id === 'models').level, 'warn')
  assert.equal(report.ok, true, 'warn 不该让整体不通过')
})

test('runDoctor：输出目录不可写 → fail，且带具体路径', async () => {
  const report = await runDoctor(healthyDeps({
    outputDir: 'D:/readonly',
    assertWritable: () => { throw new Error('denied') },
  }))
  const output = report.items.find(item => item.id === 'output')
  assert.equal(output.level, 'fail')
  assert.match(output.detail, /D:\/readonly/)
})

test('runDoctor：显存偏小只警告，不影响能否出图', async () => {
  const report = await runDoctor(healthyDeps({
    systemStats: async () => ({ devices: [{ name: 'GTX 1650', vram_total: 4 * 1024 ** 3 }] }),
  }))
  const gpu = report.items.find(item => item.id === 'gpu')
  assert.equal(gpu.level, 'warn')
  assert.match(gpu.detail, /4 GB/)
  assert.ok(gpu.fix !== undefined)
  assert.equal(report.ok, true)
})

test('bootstrapWorkflows：没有模型时拒绝生成并说清原因', () => {
  const dir = tmpDir()
  const result = bootstrapWorkflows({ dir, checkpoints: [] })
  assert.deepEqual(result.created, [])
  assert.match(result.blocked, /checkpoint/)
  assert.equal(fs.existsSync(path.join(dir, 'quick-txt2img.json')), false, '不该留下半成品')
})

test('bootstrapWorkflows：按 checkpoint 生成三份模板 + meta，且可指定子集', () => {
  const dir = tmpDir()
  const all = bootstrapWorkflows({ dir, checkpoints: ['sdxl.safetensors'] })
  assert.deepEqual(all.created.sort(), ['quick-img2img', 'quick-inpaint', 'quick-txt2img'])

  const txt2img = JSON.parse(fs.readFileSync(path.join(dir, 'quick-txt2img.json'), 'utf8'))
  assert.equal(txt2img['4'].inputs.ckpt_name, 'sdxl.safetensors', '模型名要写进 CheckpointLoaderSimple')
  assert.equal(txt2img['3'].class_type, 'KSampler')

  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'quick-txt2img.meta.json'), 'utf8'))
  assert.equal(meta.enabled, true)
  assert.ok(typeof meta.title === 'string' && meta.title.length > 0)

  // 只生成一个种类
  const dir2 = tmpDir()
  const partial = bootstrapWorkflows({ dir: dir2, checkpoints: ['a.ckpt'], kinds: ['inpaint'] })
  assert.deepEqual(partial.created, ['quick-inpaint'])
})

test('bootstrapWorkflows：已存在的模板绝不覆盖（用户可能改过）', () => {
  const dir = tmpDir()
  const file = path.join(dir, 'quick-txt2img.json')
  fs.writeFileSync(file, '{"mine":true}\n', 'utf8')

  const result = bootstrapWorkflows({ dir, checkpoints: ['sdxl.safetensors'] })
  assert.deepEqual(result.skipped, ['quick-txt2img'])
  assert.equal(fs.readFileSync(file, 'utf8'), '{"mine":true}\n', '已有文件必须原样保留')
  assert.equal(result.created.includes('quick-img2img'), true, '其余模板照常生成')
})

test('三种模板的图结构与关键参数', () => {
  const txt = txt2imgWorkflow('m.ckpt')
  assert.equal(txt['5'].class_type, 'EmptyLatentImage')
  assert.equal(txt['3'].inputs.denoise, 1)

  const i2i = img2imgWorkflow('m.ckpt')
  assert.equal(i2i['10'].class_type, 'LoadImage')
  assert.equal(i2i['3'].inputs.denoise, 0.6)
  assert.deepEqual(i2i['3'].inputs.latent_image, ['11', 0], '图生图的 latent 来自 VAEEncode')

  const inpaint = inpaintWorkflow('m.ckpt')
  assert.equal(inpaint['13'].class_type, 'SetLatentNoiseMask')
  assert.deepEqual(inpaint['3'].inputs.latent_image, ['13', 0], '局部重绘的 latent 要过噪声蒙版')
  assert.equal(inpaint['3'].inputs.denoise, 0.85)
})
