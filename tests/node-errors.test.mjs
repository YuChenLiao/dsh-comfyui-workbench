/**
 * `POST /prompt` 的 200 响应里那份 `node_errors`。
 *
 * ComfyUI 有两条拒绝路径：400（整份提交被拒）和 **200 + node_errors**（提交被接受、
 * 会执行，但某些输出链的参数非法 → 那条链不产出文件）。后者以前被整份丢掉，
 * 于是只能等十几秒后从"没有产物"倒推原因。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { ComfyClient, describeNodeErrors } from '../lib/index.js'

test('describeNodeErrors：把节点、参数名、收到的值都带出来', () => {
  const warnings = describeNodeErrors({
    6: {
      class_type: 'KSampler',
      errors: [{
        message: 'Value not in list',
        details: 'sampler_name: euler_ancestral_x not in [...]',
        extra_info: { input_name: 'sampler_name', received_value: 'euler_ancestral_x' },
      }],
    },
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /节点 6/, `实际 ${warnings[0]}`)
  assert.match(warnings[0], /sampler_name/, '要带上参数名')
  assert.match(warnings[0], /euler_ancestral_x/, '要带上收到的值')
  assert.match(warnings[0], /不会产出文件/, '要说清后果')
})

test('describeNodeErrors：一个节点多条错误都要列，且带"提交已被接受"的汇总头', () => {
  const warnings = describeNodeErrors({ 3: { errors: [{ message: '缺 text' }, { message: 'steps 超范围' }] } })
  // 多条时首行是汇总（与 400 那条"整份被拒"的措辞区分开）
  assert.match(warnings[0], /提交已被接受/, `首行该说明这次提交是进的队：${warnings[0]}`)
  const body = warnings.filter(line => line.startsWith('节点'))
  assert.equal(body.length, 2, `实际 ${JSON.stringify(warnings)}`)
})

test('describeNodeErrors：超过 3 条要截断并说明还有几条', () => {
  const many = {}
  for (let i = 1; i <= 6; i += 1) many[i] = { errors: [{ message: 'bad', extra_info: { input_name: 'x' } }] }
  const warnings = describeNodeErrors(many)
  const body = warnings.filter(line => line.startsWith('节点'))
  assert.equal(body.length, 3, '最多列 3 条')
  assert.ok(warnings.some(line => /另有 3 条/.test(line)), `要说明省略了几条：${JSON.stringify(warnings)}`)
})

test('describeNodeErrors：收到的值不管什么类型都要说出来（含 true / 数组 / null）', () => {
  const warn = value => describeNodeErrors({ 1: { errors: [{ message: 'bad', extra_info: { input_name: 'x', received_value: value } }] } })[0]
  assert.match(warn(true), /收到 true/)
  assert.match(warn([3, 1]), /收到 \[3,1\]/)
  assert.match(warn(null), /收到 null/)
  assert.match(warn(''), /空字符串/)
  assert.match(warn(0), /收到 0/, '0 不能被当成假值吞掉')
  assert.match(warn('x'.repeat(200)), /…/, '长值要截断')
})

test('describeNodeErrors：空 / null / 数组 / 无 errors 都返回空数组，不抛', () => {
  for (const value of [null, undefined, {}, [], 42, 'x', { 1: {} }, { 1: { errors: [] } }]) {
    assert.deepEqual(describeNodeErrors(value), [], `输入 ${JSON.stringify(value)} 该返回 []`)
  }
})

test('ComfyClient.queuePrompt：200 带 node_errors 时把警告带出来，prompt_id 仍然可用', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-nodeerr-'))
  // 假 ComfyUI：/prompt 返回 200 + node_errors（模拟"部分输出链被拒"）
  const server = await import('node:http').then(mod => mod.default.createServer((req, res) => {
    if (req.url === '/prompt' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        prompt_id: 'pid-partial',
        number: 1,
        node_errors: {
          7: {
            class_type: 'SaveImage',
            errors: [{
              message: 'Required input is missing',
              details: 'images',
              extra_info: { input_name: 'images' },
            }],
          },
        },
      }))
      return
    }
    res.writeHead(404)
    res.end()
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = new ComfyClient({ baseUrl: `http://127.0.0.1:${port}` })
    const result = await client.queuePrompt({ 1: { class_type: 'X', inputs: {} } })
    assert.equal(result.promptId, 'pid-partial', '有 node_errors 也照样返回 prompt_id')
    assert.equal(result.warnings.length, 1, '警告不能丢')
    assert.match(result.warnings[0], /节点 7/)
    assert.match(result.warnings[0], /images/)
  } finally {
    await new Promise(resolve => server.close(resolve))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('ComfyClient.queuePrompt：400 走 submitRejected，不返回 warnings', async () => {
  const server = await import('node:http').then(mod => mod.default.createServer((req, res) => {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({
      error: { type: 'prompt_outputs_failed_validation', message: 'Prompt outputs failed validation' },
      node_errors: { 4: { errors: [{ message: 'Value not in list', extra_info: { input_name: 'ckpt_name' } }] } },
    }))
  }))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port

  try {
    const client = new ComfyClient({ baseUrl: `http://127.0.0.1:${port}` })
    await assert.rejects(
      () => client.queuePrompt({ 1: { class_type: 'X', inputs: {} } }),
      error => {
        assert.equal(error.code, 'submit_rejected')
        assert.match(String(error.message), /节点 4/, '400 那条路早就有节点信息，别退化')
        return true
      },
    )
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
