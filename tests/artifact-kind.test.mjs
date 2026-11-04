/**
 * 「哪些文件算这次运行的产物」—— 中间产物不该混进来。
 *
 * 起因：测动作控制工作流时，depth 中间图和成品一起进了资产库。
 * 根因是工作流里有两个 SaveImage，而 ComfyUI 不标哪个是"中间"；
 * 判据只能从数据流里取：**保存的图若还被别的计算节点消费，它就是中间产物**。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { fileRefsOf, pickArtifacts } from '../lib/index.js'

/**
 * 复刻 `moss_dual_pose_api` 的形状（真实节点 id 与连线）。
 *
 * 9 是 depth（被 12 的 ControlNet 和 18 的保存同时消费），16 是成品解码结果（只被 17 消费）。
 */
const workflow = {
  9: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['7', 0] } },
  12: { class_type: 'ControlNetApplyAdvanced', inputs: { image: ['9', 0], control_net: ['11', 0] } },
  16: { class_type: 'VAEDecode', inputs: { samples: ['15', 0] } },
  17: { class_type: 'SaveImage', inputs: { images: ['16', 0], filename_prefix: 'moss_dual_pose' } },
  18: { class_type: 'SaveImage', inputs: { images: ['9', 0], filename_prefix: 'moss_dual_depth' } },
}

const outputs = {
  17: { images: [{ filename: 'moss_dual_pose_00001_.png', subfolder: '', type: 'output' }] },
  18: { images: [{ filename: 'moss_dual_depth_00001_.png', subfolder: '', type: 'output' }] },
}

test('中间产物：保存的图还被别的节点消费 → 标 intermediate', () => {
  const refs = fileRefsOf(outputs, workflow)
  const pose = refs.find(ref => ref.filename === 'moss_dual_pose_00001_.png')
  const depth = refs.find(ref => ref.filename === 'moss_dual_depth_00001_.png')

  assert.equal(pose?.kind, 'save', '成品（来源只被这个 SaveImage 消费）应当算正式产物')
  assert.equal(depth?.kind, 'intermediate', 'depth（来源还被 ControlNet 消费）应当算中间产物')
})

test('预览节点仍然是 preview，与中间产物分开', () => {
  const withPreview = {
    ...workflow,
    19: { class_type: 'PreviewImage', inputs: { images: ['16', 0] } },
  }
  const refs = fileRefsOf(
    { ...outputs, 19: { images: [{ filename: 'preview_00001_.png', subfolder: '', type: 'temp' }] } },
    withPreview,
  )
  assert.equal(refs.find(ref => ref.filename === 'preview_00001_.png')?.kind, 'preview')
})

test('同一张图被两个 SaveImage 各存一遍，都不算中间产物', () => {
  // 只被保存节点消费（没有别的计算节点）—— 这是"故意存两份"，不是中间结果
  const doubled = {
    16: { class_type: 'VAEDecode', inputs: { samples: ['15', 0] } },
    17: { class_type: 'SaveImage', inputs: { images: ['16', 0] } },
    20: { class_type: 'SaveImage', inputs: { images: ['16', 0] } },
  }
  const refs = fileRefsOf(
    {
      17: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] },
      20: { images: [{ filename: 'b.png', subfolder: '', type: 'output' }] },
    },
    doubled,
  )
  assert.deepEqual(refs.map(ref => ref.kind), ['save', 'save'])
})

test('拿不到工作流模板时不误判：一律标 save', () => {
  const refs = fileRefsOf(outputs, undefined)
  assert.equal(refs.length, 2)
  assert.ok(refs.every(ref => ref.kind === 'save'), '没有模板就没有数据流，不能凭空判中间产物')
})

test('保存节点自己的输出被下游消费不影响判定（只看它保存的来源）', () => {
  // SaveImage 本身通常没有下游；即便有，也不该把别人的判断带偏
  const chained = {
    9: { class_type: 'ImageScaleToTotalPixels', inputs: { image: ['7', 0] } },
    18: { class_type: 'SaveImage', inputs: { images: ['9', 0] } },
    21: { class_type: 'ImageBlur', inputs: { image: ['18', 0] } },
  }
  const refs = fileRefsOf(
    { 18: { images: [{ filename: 'x.png', subfolder: '', type: 'output' }] } },
    chained,
  )
  // 9 的消费者只有 18（保存节点），所以 18 存的是正式产物
  assert.equal(refs[0].kind, 'save')
})

// ── 挑产物那四档（`pickArtifacts`）──
// 这一层原来埋在 collectArtifacts 里，起假 ComfyUI 才能碰到，所以一档错就静默多收/漏收。

const ref = (kind, type, filename) => ({ kind, type, filename, subfolder: '', nodeId: '1' })

test('挑产物：有正式产物就只要正式产物', () => {
  const { refs, dropped, skippedPreview } = pickArtifacts([
    ref('save', 'output', 'a.png'),
    ref('intermediate', 'output', 'depth.png'),
    ref('preview', 'temp', 'p.png'),
  ])
  assert.deepEqual(refs.map(item => item.filename), ['a.png'])
  assert.deepEqual(dropped.map(item => item.filename), ['depth.png'], '中间产物要单独报出来')
  assert.equal(skippedPreview, 1, '预览图与中间产物分别计数，不能混成一个"预览图"')
})

test('挑产物：只剩中间产物时用它，绝不把预览图一起收进来', () => {
  // 这条守一个实测退化：缺了"仅中间产物"这一档，会掉到 all，
  // 把一个 SaveImage + 七个 PreviewImage 的模板从 1 张变成 8 张
  const { refs, dropped } = pickArtifacts([
    ref('intermediate', 'output', 'only_depth.png'),
    ref('preview', 'temp', 'p1.png'),
    ref('preview', 'temp', 'p2.png'),
  ])
  assert.deepEqual(refs.map(item => item.filename), ['only_depth.png'])
  assert.deepEqual(dropped, [], '这一档已经把中间产物用上了，不算"被丢掉"')
})

test('挑产物：只有 temp 的正式产物也算（有一个能拿的比报没有强）', () => {
  const { refs } = pickArtifacts([ref('save', 'temp', 't.png')])
  assert.deepEqual(refs.map(item => item.filename), ['t.png'])
})

test('挑产物：什么都没有时返回空（调用方据此报 no_output）', () => {
  const { refs, dropped, skippedPreview } = pickArtifacts([])
  assert.deepEqual(refs, [])
  assert.deepEqual(dropped, [])
  assert.equal(skippedPreview, 0)
})
