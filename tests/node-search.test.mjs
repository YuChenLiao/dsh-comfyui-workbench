/**
 * 节点索引。
 *
 * 守四件事：四档排序、组合过滤、空条件拒绝、判定与 `matches` 字段一致。
 * 用假的 `/object_info` 造数据，不依赖 ComfyUI 在线。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NodeIndex } from '../lib/index.js'

/** 一份最小但覆盖各种形状的 object_info。 */
const OBJECT_INFO = {
  ImageUpscaleWithModel: {
    input: { required: { upscale_model: [['RealESRGAN_x4plus_anime_6B.pth', '4x-UltraSharp.pth']] } },
    output: ['IMAGE'],
    display_name: 'Upscale Image (using Model)',
    description: 'Upscale an image using an upscale model.',
    category: 'image/upscale',
    python_module: 'nodes',
    search_aliases: ['upscale', 'resize', 'enlarge'],
    output_node: false,
  },
  UpscaleModelLoader: {
    input: { required: { model_name: [['RealESRGAN_x4plus_anime_6B.pth']] } },
    output: ['UPSCALE_MODEL'],
    display_name: 'Load Upscale Model',
    description: 'Loads an upscale model.',
    category: 'loaders',
    python_module: 'nodes',
    search_aliases: ['upscale model'],
    output_node: false,
  },
  SaveImage: {
    input: { required: { images: ['IMAGE'], filename_prefix: ['STRING', { default: 'ComfyUI' }] } },
    output: [],
    display_name: 'Save Image',
    description: 'Save the image to disk.',
    category: 'image',
    python_module: 'nodes',
    output_node: true,
  },
  AnySwitch: {
    input: { required: { a: ['IMAGE'], b: ['IMAGE'] }, optional: { sel: ['INT', { default: 0 }] } },
    output: ['IMAGE'],
    display_name: 'Any Switch (rgthree)',
    description: 'Switch between inputs.',
    category: 'utils',
    python_module: 'custom_nodes.rgthree-comfy',
    output_node: false,
  },
  ImpactDetector: {
    input: { required: { image: ['IMAGE'] } },
    output: ['MASK'],
    display_name: 'Impact Detector',
    description: 'Detect regions for inpainting.',
    category: 'impact',
    python_module: 'custom_nodes.comfyui-impact-pack',
    output_node: false,
  },
}

test('四档排序：类名精确 > 类名前缀 > 显示名/别名 > 描述', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ query: 'upscale' })
  const order = result.nodes.map(node => node.classType)
  // UpscaleModelLoader 类名前缀命中，排在 ImageUpscaleWithModel（显示名命中）之前
  assert.equal(order[0], 'UpscaleModelLoader')
  assert.equal(result.nodes[0]?.matches, 'name')
  assert.ok(order.includes('ImageUpscaleWithModel'))
  assert.equal(result.nodes.find(n => n.classType === 'ImageUpscaleWithModel')?.matches, 'display')
})

test('类名精确命中排在最前', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ query: 'SaveImage' })
  assert.equal(result.nodes[0]?.classType, 'SaveImage')
  assert.equal(result.nodes[0]?.matches, 'name')
})

test('空格与下划线等价', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const spaced = index.search({ query: 'upscale model' })
  assert.equal(spaced.nodes[0]?.classType, 'UpscaleModelLoader')
  const underscored = index.search({ query: 'upscale_model' })
  assert.equal(underscored.nodes[0]?.classType, 'UpscaleModelLoader')
})

test('按输出类型过滤', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const masks = index.search({ produces: 'MASK' })
  assert.deepEqual(masks.nodes.map(n => n.classType), ['ImpactDetector'])
  const latents = index.search({ produces: 'LATENT' })
  assert.equal(latents.total, 0)
})

test('按输入类型过滤：谁能吃 IMAGE', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ accepts: 'IMAGE' })
  const names = result.nodes.map(n => n.classType).sort()
  assert.deepEqual(names, ['AnySwitch', 'ImpactDetector', 'SaveImage'])
})

test('按模型文件名反查：哪个节点能加载它', () => {
  // 这条是修 suggestModels 猜错场景的关键能力
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ hasModel: 'RealESRGAN_x4plus_anime_6B' })
  const names = result.nodes.map(n => n.classType).sort()
  assert.deepEqual(names, ['ImageUpscaleWithModel', 'UpscaleModelLoader'])
})

test('只搜自定义节点', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ customOnly: true })
  const names = result.nodes.map(n => n.classType).sort()
  assert.deepEqual(names, ['AnySwitch', 'ImpactDetector'])
  // core 与自定义包的 pack 名要分得开
  const anySwitch = result.nodes.find(n => n.classType === 'AnySwitch')
  assert.equal(anySwitch?.pack, 'rgthree-comfy')
})

test('按分类前缀过滤', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ category: 'image' })
  const names = result.nodes.map(n => n.classType).sort()
  assert.deepEqual(names, ['ImageUpscaleWithModel', 'SaveImage'], 'image/upscale 属于 image 之下')
})

test('空条件被拒绝（避免"列出全部节点"挤爆上下文）', () => {
  const index = new NodeIndex(OBJECT_INFO)
  assert.equal(index.search({}).total, 0)
  assert.deepEqual(index.search({}).nodes, [])
})

test('limit 有上限，超了要提示还有多少', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ accepts: 'IMAGE', limit: 2 })
  assert.equal(result.shown, 2)
  assert.equal(result.total, 3)
})

test('detail 模式给输入输出与类型', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ query: 'SaveImage', detail: true })
  const detail = result.details?.SaveImage
  assert.ok(detail !== undefined)
  assert.deepEqual(detail.inputs.required.map(i => i.name).sort(), ['filename_prefix', 'images'])
  assert.ok(detail.inputs.required.find(i => i.name === 'filename_prefix')?.type.startsWith('STRING'))
})

test('终端节点排在同类前面（用户通常找产出环节）', () => {
  const index = new NodeIndex(OBJECT_INFO)
  // 两个都是 type 命中（只给分类），SaveImage 是 output_node
  const result = index.search({ category: 'image' })
  assert.equal(result.nodes[0]?.classType, 'SaveImage')
  assert.equal(result.nodes[0]?.outputNode, true)
})

test('categories 只给顶级分类', () => {
  const index = new NodeIndex(OBJECT_INFO)
  const categories = index.categories()
  assert.ok(categories.includes('image'))
  assert.ok(categories.includes('loaders'))
  assert.ok(!categories.includes('image/upscale'), '不该列叶子分类')
})
