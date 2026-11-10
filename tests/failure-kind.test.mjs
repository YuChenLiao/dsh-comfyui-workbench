/**
 * 失败分类与可执行建议。
 *
 * 现状是无论什么错都给同一句「通常是模型/节点参数不匹配或显存不足」。
 * 而真实失败就那么几类，解法完全不同 —— 模型拿笼统句子只能猜，猜错就是又一轮报错。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adviceFor, classifyFailure, modelNameIn } from '../lib/index.js'

/** 造上下文。 */
function ctx(text, extra = {}) {
  return { text, ...extra }
}

test('五类各能认出来', () => {
  assert.equal(classifyFailure(ctx('CUDA out of memory. Tried to allocate 2.10 GiB')), 'oom')
  assert.equal(classifyFailure(ctx('Allocation on device cuda:0 failed')), 'oom')

  assert.equal(classifyFailure(ctx('Cannot execute because node IPAdapterApply does not exist.')), 'missing_node')
  assert.equal(classifyFailure(ctx('node type not found: ImpactSwitch')), 'missing_node')

  assert.equal(classifyFailure(ctx('No such file or directory: models/checkpoints/waiNSFWIllustrious_v140.safetensors')), 'missing_model')
  // "Value not in list" 现在归 bad_param：值可能只是写错了，候选里本来就有正确的。
  // 只有"文件真的不存在"才算缺模型。
  assert.equal(classifyFailure(ctx('Value not in list: ckpt_name: 3d.safetensors not in [...]')), 'bad_param')

  assert.equal(classifyFailure(ctx('cannot identify image file <_io.BytesIO object>')), 'bad_input')
  assert.equal(classifyFailure(ctx('Invalid image file: foo.png')), 'bad_input')

  assert.equal(classifyFailure(ctx('Value not in list: sampler_name: euler_a not in [euler, dpmpp_2m]')), 'bad_param')
  assert.equal(classifyFailure(ctx('steps must be an int, got 20.5')), 'bad_param')
})

test('认不出来的归 unknown，不硬猜', () => {
  assert.equal(classifyFailure(ctx('something completely unexpected happened')), 'unknown')
  assert.equal(classifyFailure(ctx('')), 'unknown')
})

test('OOM 的建议要带具体尺寸', () => {
  const advice = adviceFor('oom', ctx('CUDA out of memory at 1312x1840'))
  assert.match(advice, /显存/)
  assert.match(advice, /1312×1840/, '要说清当前尺寸')
  assert.match(advice, /\d+×\d+/, '要给出建议尺寸')
  assert.match(advice, /lowvram|关掉/, '要给可操作的下一步')
})

test('OOM 没有尺寸时也给建议，不说空话', () => {
  const advice = adviceFor('oom', ctx('CUDA out of memory'))
  assert.match(advice, /1024|降/)
  assert.ok(advice.length > 20)
})

test('缺模型的建议指向 node_search 的 hasModel', () => {
  const advice = adviceFor('missing_model', ctx('No such file: RealESRGAN_x4plus_anime_6B.pth'))
  assert.match(advice, /comfyui_node_search/)
  assert.match(advice, /hasModel/)
  assert.match(advice, /RealESRGAN_x4plus_anime_6B\.pth/, '要说出缺的是哪个文件')
})

test('缺节点的建议指向扩展包', () => {
  const advice = adviceFor('missing_node', ctx('Cannot execute because node X does not exist', { nodeId: '12', nodeType: 'X' }))
  assert.match(advice, /扩展包|Manager/)
  assert.match(advice, /节点 12/)
})

test('坏输入的建议说清 LoadImage 只认 input 目录', () => {
  const advice = adviceFor('bad_input', ctx('cannot identify image file'))
  assert.match(advice, /input/)
  assert.match(advice, /绝对路径/)
})

test('参数越界的建议带节点定位', () => {
  const advice = adviceFor('bad_param', ctx('Value not in list: sampler_name', { nodeId: '5', nodeType: 'KSampler' }))
  assert.match(advice, /节点 5/)
  assert.match(advice, /KSampler/)
  assert.match(advice, /comfyui_workflow/, '建议里要给能照做的工具名')
})

test('unknown 退化成原来那句（不能更差）', () => {
  const advice = adviceFor('unknown', ctx('???'))
  assert.match(advice, /inspect|降分辨率|换底模/)
})

test('能从文本里捞出模型文件名', () => {
  assert.equal(modelNameIn('No such file: models/vae/sdxl_vae.safetensors'), 'models/vae/sdxl_vae.safetensors')
  assert.equal(modelNameIn('missing RealESRGAN_x4plus.pth'), 'RealESRGAN_x4plus.pth')
  assert.equal(modelNameIn('no file here'), undefined)
})

test('modelNameIn 不误抓过长的路径', () => {
  const name = modelNameIn('failed to open C:/very/long/path/to/model.ckpt')
  assert.ok(name?.endsWith('.ckpt'))
})

test('中文错误串也要认（自定义节点会抛中文）', () => {
  assert.equal(classifyFailure(ctx('显存不足，无法分配张量')), 'oom')
  assert.equal(classifyFailure(ctx('节点 IPAdapterApply 不存在')), 'missing_node')
  assert.equal(classifyFailure(ctx('参数 steps 越界')), 'bad_param')
})

test('OOM 的其它写法', () => {
  assert.equal(classifyFailure(ctx('OOM when allocating tensor with shape[1,4,128,128]')), 'oom')
  assert.equal(classifyFailure(ctx('OSError: [Errno 12] Cannot allocate memory')), 'oom')
})

test('缺节点的其它写法', () => {
  assert.equal(classifyFailure(ctx('The following node types were not found: ImpactSwitch')), 'missing_node')
  assert.equal(classifyFailure(ctx("Node 'IPAdapterApply' not found")), 'missing_node')
})

test('modelNameIn 指向"你写错的那个"，不是候选里正确的', () => {
  // 上一版会抓成 add-detail-xl.safetensors（候选里那个），等于把"你拼错了"说成"你缺这个文件"
  const text = "Value not in list: lora_name: 'add-detail-xl.safetensorsx' not in ['add-detail-xl.safetensors']"
  assert.equal(modelNameIn(text), 'add-detail-xl.safetensorsx')
})

test('Value not in list 且候选里有近似项：点名"你写的是 X，候选里是 Y"', () => {
  const text = "Value not in list: lora_name: 'add-detail-xl.safetensorsx' not in ['add-detail-xl.safetensors']"
  const kind = classifyFailure(ctx(text))
  assert.equal(kind, 'bad_param', '值写错了不是缺模型')
  const advice = adviceFor(kind, ctx(text))
  assert.match(advice, /add-detail-xl\.safetensorsx/, '要说出你写的那个')
  assert.match(advice, /add-detail-xl\.safetensors'/, '要给出候选里正确的那个')
})

test('短边场景不把比例压成 1:1（断言的必须是"建议尺寸"）', () => {
  // 上一版断言抓的是文案里第一条 \d+×\d+ —— 那是"当前 768×512"，不是建议尺寸，
  // 所以测试必然通过（误报）。这里只抓「降到 …」后面那对。
  const advice = adviceFor('oom', ctx('CUDA out of memory at 768x512'))
  const match = advice.match(/降到\s*(\d+)×(\d+)/)
  assert.ok(match !== null, `建议里要有"降到 W×H"，实际：${advice}`)
  const width = Number(match[1])
  const height = Number(match[2])
  assert.notEqual(width, height, `768×512 的建议尺寸不该是方的，实际 ${width}×${height}`)
  assert.ok(width > height, '横图缩完还该是横的')
})

test('竖图缩完还是竖的', () => {
  const advice = adviceFor('oom', ctx('CUDA out of memory at 512x768'))
  const match = advice.match(/降到\s*(\d+)×(\d+)/)
  assert.ok(match !== null)
  const width = Number(match[1])
  const height = Number(match[2])
  assert.ok(height > width, `竖图缩完该是竖的，实际 ${width}×${height}`)
})

test('1312×1840 的建议尺寸仍接近原比例', () => {
  const advice = adviceFor('oom', ctx('CUDA out of memory at 1312x1840'))
  const match = advice.match(/降到\s*(\d+)×(\d+)/)
  assert.ok(match !== null)
  const width = Number(match[1])
  const height = Number(match[2])
  const sourceRatio = 1312 / 1840
  const nextRatio = width / height
  assert.ok(Math.abs(sourceRatio - nextRatio) < 0.06, `比例偏移过大：${sourceRatio.toFixed(3)} → ${nextRatio.toFixed(3)}`)
})
