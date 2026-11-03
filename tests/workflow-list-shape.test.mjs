/**
 * 工作流列表项的**共同字段**不能漂。
 *
 * 面板与模型各有一份转换（`toPanelItem` / `toModelItem`）。字段已经有意分叉：
 * 面板要 `imageSlots` / `basicCount`，模型要 `inputs` 明细。但**共同的那几个字段**
 * 必须一致 —— 历史上就出过"面板那份缺 imageSlots，于是永远列不出候选"这种事。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildSurface } from '../lib/workflow.js'
import { toModelItem, toPanelItem } from '../lib/index.js'

const WORKFLOW = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'LoadImage', inputs: { image: 'a.png' } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'hi', clip: ['1', 1] } },
  4: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, model: ['1', 0], positive: ['3', 0], negative: ['3', 0], latent_image: ['2', 0] } },
  5: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'x' } },
}

function surfaceOf() {
  const surface = buildSurface({ workflowId: 'probe', workflow: WORKFLOW })
  return { ...surface, title: '探针', description: '比对两份列表项', enabled: true }
}

test('两份列表项的共同字段必须逐字段相同', () => {
  const surface = surfaceOf()
  const panel = toPanelItem(surface, null)
  const model = toModelItem(surface)
  for (const key of ['workflowId', 'title', 'description', 'undescribed', 'enabled']) {
    assert.ok(key in panel, `面板侧缺 ${key}：${JSON.stringify(Object.keys(panel))}`)
    assert.ok(key in model, `模型侧缺 ${key}：${JSON.stringify(Object.keys(model))}`)
    assert.deepEqual(panel[key], model[key], `字段 ${key} 两边不一致：${JSON.stringify(panel[key])} vs ${JSON.stringify(model[key])}`)
  }
})

test('各自独有的字段也要在（分叉是有意的，但不能互相漏）', () => {
  const surface = surfaceOf()
  const panel = toPanelItem(surface, null)
  const model = toModelItem(surface)
  assert.deepEqual(panel.imageSlots, ['image'], '面板侧 imageSlots 丢了 —— "拿这张图去出图"会列不出候选')
  assert.ok(Array.isArray(model.inputs) && model.inputs.length > 0, '模型侧缺 inputs 明细')
  assert.equal(typeof panel.basicCount, 'number', '面板侧缺 basicCount')
  assert.equal(typeof model.nodes, 'number', '模型侧缺 nodes')
})

test('同名但语义不同的字段要钉住差异（inputKinds 最容易再漂）', () => {
  const surface = surfaceOf()
  const panel = toPanelItem(surface, null)
  const model = toModelItem(surface)
  // 两边都叫 inputKinds，但模型侧过滤掉 number/boolean/enum（对写提示词没意义），
  // 面板侧全留（它要画"这个工作流吃哪些输入"）。同名字段两套语义 —— 显式钉住。
  assert.ok(Array.isArray(panel.inputKinds) && Array.isArray(model.inputKinds))
  for (const kind of model.inputKinds) {
    assert.ok(panel.inputKinds.includes(kind), `模型侧的 ${kind} 不在面板侧里`)
  }
  const trivial = panel.inputKinds.filter(kind => ['number', 'boolean', 'enum'].includes(kind))
  assert.deepEqual(
    model.inputKinds.filter(kind => trivial.includes(kind)),
    [],
    '模型侧不该出现 number/boolean/enum —— 出现了说明过滤被删了',
  )
  // outputs / nodes 两边都有，且形状一致
  assert.deepEqual(panel.outputs, model.outputs, 'outputs 两边该一致')
  assert.equal(panel.nodes, model.nodes, 'nodes 两边该一致')
})

test('undescribed 的判定两边一致（空描述才算未描述）', () => {
  const base = surfaceOf()
  for (const description of ['', '有描述']) {
    const surface = { ...base, description }
    assert.equal(
      toPanelItem(surface, null).undescribed,
      toModelItem(surface).undescribed,
      `description=${JSON.stringify(description)} 时两边不一致`,
    )
  }
})
