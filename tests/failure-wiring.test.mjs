/**
 * `executionFailed` 真的用上了分类。
 *
 * 上一轮的教训：分类器写得再好，如果 `executionFailed` 没接它，
 * 用户拿到的还是那句"通常是参数不匹配或显存不足"。这里端到端验证。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { executionFailed } from '../lib/index.js'

/** 造一份报错的 history。 */
function historyWith(message, nodeId = '2', nodeType = 'KSampler') {
  return {
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: message, node_id: nodeId, node_type: nodeType }]],
    },
  }
}

test('OOM：hint 变成带具体尺寸的建议，不再是一句话糊过去', () => {
  const error = executionFailed(historyWith('CUDA out of memory. Tried to allocate 2.10 GiB at 1312x1840'), 'p1')
  assert.equal(error.code, 'execution_failed', 'code 不能改，调用方可能按它分支')
  assert.equal(error.kind, 'oom')
  assert.match(String(error.hint), /显存/)
  assert.match(String(error.hint), /1312×1840/)
})

test('缺模型：hint 指向 node_search 的 hasModel', () => {
  const error = executionFailed(
    historyWith('No such file or directory: models/upscale_models/RealESRGAN_x4plus_anime_6B.pth', '7', 'UpscaleModelLoader'),
    'p2',
  )
  assert.equal(error.kind, 'missing_model')
  assert.match(String(error.hint), /hasModel/)
})

test('缺节点：hint 指向扩展包', () => {
  const error = executionFailed(historyWith('Cannot execute because node IPAdapterApply does not exist.', '9', 'IPAdapterApply'), 'p3')
  assert.equal(error.kind, 'missing_node')
  assert.match(String(error.hint), /Manager|扩展包/)
})

test('坏输入：hint 说清 input 目录', () => {
  const error = executionFailed(historyWith('cannot identify image file', '4', 'LoadImage'), 'p4')
  assert.equal(error.kind, 'bad_input')
  assert.match(String(error.hint), /input/)
})

test('参数越界：hint 带节点定位', () => {
  const error = executionFailed(historyWith('Value not in list: sampler_name: foo not in [...]', '5', 'KSampler'), 'p5')
  assert.equal(error.kind, 'bad_param')
  assert.match(String(error.hint), /节点 5/)
  assert.match(String(error.hint), /KSampler/)
})

test('认不出的错误：退化成原来那句，不能更差', () => {
  const error = executionFailed(historyWith('something weird'), 'p6')
  assert.equal(error.kind, 'unknown')
  assert.ok(String(error.hint).length > 10)
})

test('消息里保留节点与原始异常文本', () => {
  const error = executionFailed(historyWith('CUDA out of memory', '2', 'KSampler'), 'p7')
  assert.match(error.message, /节点 2/)
  assert.match(error.message, /KSampler/)
  assert.match(error.message, /out of memory/)
})

test('history 没有任何消息时也不崩', () => {
  const error = executionFailed({ status: { status_str: 'error' } }, 'p8')
  assert.equal(error.code, 'execution_failed')
  assert.equal(error.kind, 'unknown')
})
