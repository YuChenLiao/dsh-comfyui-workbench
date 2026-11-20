/**
 * 本机模型盘点（`comfyui_workflow { models: … }`）。
 *
 * 复用 `comfyui_workflow` 而不新增工具名：工具数量本身就是负担，而"我本机有哪些模型"
 * 与"我有哪些模板"是同一个问题域的两面。
 *
 * 三件事要钉住：**分类**（LoRA 不能和 checkpoint 混在一起）、**触发词**（可选文件，
 * 写坏了不能把盘点弄挂）、**离线时不假装"什么模型都没有"**。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { catalogModels, readTriggers, workflowTool } from '../lib/index.js'

/** 一份最小 `/object_info`：每个 loader 只给一个 COMBO 字段。 */
function objectInfo() {
  const combo = (...values) => [[...values], {}]
  return {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: combo('sdxl.safetensors', 'flux.safetensors') } } },
    LoraLoader: { input: { required: { lora_name: combo('my_lora.safetensors', 'detail.safetensors') } } },
    VAELoader: { input: { required: { vae_name: combo('vae-ft.safetensors') } } },
    ControlNetLoader: { input: { required: { control_net_name: combo('canny.safetensors') } } },
    UpscaleModelLoader: { input: { required: { model_name: combo('4x-UltraSharp.pth') } } },
    // 非模型 COMBO：不该进清单
    KSampler: { input: { required: { sampler_name: combo('euler', 'dpmpp_2m'), scheduler: combo('normal') } } },
  }
}

test('分类：每个 loader 的候选各归各位，采样器不进模型清单', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-catalog-'))
  try {
    const catalog = catalogModels(objectInfo(), path.join(dir, 'loras.json'))
    assert.deepEqual(catalog.byKind.checkpoint, ['flux.safetensors', 'sdxl.safetensors'])
    assert.deepEqual(catalog.byKind.lora, ['detail.safetensors', 'my_lora.safetensors'])
    assert.deepEqual(catalog.byKind.vae, ['vae-ft.safetensors'])
    assert.deepEqual(catalog.byKind.controlnet, ['canny.safetensors'])
    assert.deepEqual(catalog.byKind.upscaler, ['4x-UltraSharp.pth'])
    assert.deepEqual(catalog.byKind.other, [], 'sampler_name / scheduler 不该被当成模型')
    assert.equal(catalog.counts.checkpoint, 2)
    assert.equal(catalog.counts.lora, 2)
    // 没有触发词文件时是空对象，不是错误
    assert.deepEqual(catalog.triggers, {})
    assert.equal(catalog.triggerError, undefined)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('触发词：两种写法都认，写坏了只报错不抛', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-triggers-'))
  const file = path.join(dir, 'loras.json')
  try {
    fs.writeFileSync(file, JSON.stringify({
      'my_lora.safetensors': 'my style, soft light',
      'detail.safetensors': { triggers: 'fine detail', note: '不认识的字段忽略' },
      空: 123,
    }))
    const { triggers, error } = readTriggers(file)
    assert.equal(error, undefined)
    assert.equal(triggers['my_lora.safetensors'], 'my style, soft light')
    assert.equal(triggers['detail.safetensors'], 'fine detail')
    assert.equal('空' in triggers, false, '不是字符串也不是 {triggers} 的值要跳过')

    // 坏 JSON：给一句人话，不抛
    fs.writeFileSync(file, '{ not json')
    const broken = readTriggers(file)
    assert.deepEqual(broken.triggers, {})
    assert.match(String(broken.error), /不是合法 JSON/)

    // 形状不对（数组）：同样给提示
    fs.writeFileSync(file, '[1,2,3]')
    const wrong = readTriggers(file)
    assert.match(String(wrong.error), /应该是一个对象/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('工具分支：models: true 走盘点，离线时不假装"没有模型"', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-models-tool-'))
  const base = {
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 1_000,
    pollIntervalMs: 20,
    overrides: new Map(),
    runs: { submit: () => {}, update: () => {}, get: () => undefined, list: () => [], activeCount: () => 0 },
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
  }
  try {
    // 在线：分类清单 + 计数
    const online = workflowTool({ ...base, client: { baseUrl: 'http://127.0.0.1:8188', async objectInfo() { return objectInfo() } } })
    const result = await online.execute({ models: true })
    assert.equal(result.ok, true)
    assert.equal(result.mode, 'models')
    assert.deepEqual(result.models.checkpoint, ['flux.safetensors', 'sdxl.safetensors'])
    assert.equal(result.counts.lora, 2)
    assert.ok(typeof result.triggerFile === 'string' && result.triggerFile.endsWith('loras.json'))

    // 只给类别名：只回那一类
    const onlyLora = await online.execute({ models: 'lora' })
    assert.deepEqual(Object.keys(onlyLora.models), ['lora'])

    // 离线：ok:false + 人话，而不是一份空清单（空清单会被当成"本机没模型"）
    const offline = workflowTool({
      ...base,
      client: { baseUrl: 'http://127.0.0.1:8188', async objectInfo() { throw new Error('connect ECONNREFUSED') } },
    })
    const failed = await offline.execute({ models: true })
    assert.equal(failed.ok, false)
    assert.match(String(failed.message), /无法盘点模型/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('枚举字段不是模型：weight_dtype / upscale_method / config_name 都不进清单', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-enum-'))
  try {
    const combo = (...values) => [[...values], {}]
    // 这些节点的**类型**带关键词，但字段装的是枚举
    const info = {
      UNETLoader: { input: { required: {
        unet_name: combo('flux-dev.safetensors'),
        weight_dtype: combo('default', 'fp8_e4m3fn', 'fp8_e5m2'),
      } } },
      CheckpointLoader: { input: { required: {
        ckpt_name: combo('sdxl.safetensors'),
        config_name: combo('v1-inference.yaml', 'v1-inference_fp16.yaml'),
      } } },
      LatentUpscale: { input: { required: {
        upscale_method: combo('nearest-exact', 'bilinear', 'area', 'bicubic', 'bislerp'),
        crop: combo('disabled', 'center'),
      } } },
      KSampler: { input: { required: {
        sampler_name: combo('euler', 'dpmpp_2m'),
        scheduler: combo('normal'),
      } } },
      // 真实自定义加载器：字段是 *_file，不带 model 字样
      InstantIDModelLoader: { input: { required: { instantid_file: combo('ip-adapter.bin') } } },
      IPAdapterModelLoader: { input: { required: { ipadapter_file: combo('ip.bin') } } },
      GLIGENLoader: { input: { required: { gligen_name: combo('gligen.safetensors') } } },
    }
    const catalog = catalogModels(info, path.join(dir, 'loras.json'))
    assert.deepEqual(catalog.byKind.checkpoint, ['flux-dev.safetensors', 'sdxl.safetensors'],
      '精度档位与 config 不是 checkpoint')
    assert.deepEqual(catalog.byKind.upscaler, [], '插值算法不是放大模型')
    assert.deepEqual(catalog.byKind.other, ['gligen.safetensors', 'ip-adapter.bin', 'ip.bin'],
      '认不出类别的自定义加载器要进 other，不能消失')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('models 参数给错值要报错，不能静默降级成列工作流', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-models-bad-'))
  const deps = {
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 1_000,
    pollIntervalMs: 20,
    overrides: new Map(),
    runs: { submit: () => {}, update: () => {}, get: () => undefined, list: () => [], activeCount: () => 0 },
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
    client: { baseUrl: 'http://127.0.0.1:8188', async objectInfo() { return objectInfo() } },
  }
  try {
    const tool = workflowTool(deps)
    for (const bad of ['loras', 'all', 'checkpoints']) {
      const result = await tool.execute({ models: bad })
      assert.equal(result.ok, false, `「${bad}」该报错，实际 ${JSON.stringify(result).slice(0, 120)}`)
      assert.equal(result.mode, 'models')
      assert.match(String(result.message), /只接受/, `「${bad}」的错误要说清合法值`)
    }
    // 大小写 / 空白归一后仍然有效（写错大小写不算错，只是同义词）
    for (const good of ['LORA', ' checkpoint ', '1 ', 'TRUE', 'True', 1, true]) {
      const result = await tool.execute({ models: good })
      assert.equal(result.ok, true, `「${good}」该进盘点分支`)
    }
    // false / 0 不算"给了 models"：正常列工作流
    const plain = await tool.execute({})
    assert.equal(plain.mode === 'models', false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
