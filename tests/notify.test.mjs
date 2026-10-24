/**
 * 后台等待与通知自检。
 *
 * 这是"对话能自己收到结果"的实现：出图后由插件调 Agent.followup 把通知塞回会话。
 * 测试用一个桩 target 代替宿主 Agent，验证消息真的发出、内容包含产物路径。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { ComfyClient } from '../lib/comfy.js'
import { watchRun } from '../lib/run.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 假 ComfyUI：history 立即完成并给一张图。 */
async function fakeComfy(options = {}) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname.startsWith('/history/')) {
      // 注意 `null ?? x` 会取 x：这里必须用 in 判断，否则"永不完成"的用例会拿到默认的已完成响应
      const entry = Object.hasOwn(options, 'entry')
        ? options.entry
        : { status: { completed: true }, outputs: { 9: { images: [{ filename: 'n.png' }] } } }
      return json(200, entry === null ? {} : { p1: entry })
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    return json(404, {})
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('出图完成后把通知塞回会话（含产物路径）', async () => {
  const comfy = await fakeComfy()
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-notify-'))
  const messages = []

  try {
    const stop = watchRun({
      client: new ComfyClient({ baseUrl: comfy.url }),
      target: { followup: message => messages.push(message) },
      promptId: 'p1',
      outputDir: out,
      intervalMs: 20,
    })

    await sleep(300)
    stop()

    assert.equal(messages.length, 1, '应当恰好通知一次')
    const message = messages[0]
    assert.equal(message.role, 'user')
    assert.equal(message.source.kind, 'plugin')
    assert.equal(message.source.form, 'notice')
    assert.ok(message.source.summary.length > 0 && message.source.summary.length <= 120)
    assert.match(message.content[0].text, /出图完成/)
    assert.match(message.content[0].text, /\.png/, '通知里要带产物路径')
    assert.ok(fs.existsSync(path.join(out, 'n.png')), '产物要落盘')
  } finally {
    await comfy.close()
  }
})

test('执行失败也通知，而不是静默', async () => {
  const comfy = await fakeComfy({
    entry: { status: { status_str: 'error', messages: [['execution_error', { node_id: '3', node_type: 'KSampler', exception_message: 'CUDA out of memory' }]] } },
  })
  const messages = []

  try {
    const stop = watchRun({
      client: new ComfyClient({ baseUrl: comfy.url }),
      target: { followup: message => messages.push(message) },
      promptId: 'p1',
      outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-notify-err-')),
      intervalMs: 20,
    })

    await sleep(300)
    stop()

    assert.equal(messages.length, 1)
    assert.match(messages[0].content[0].text, /失败/)
    assert.match(messages[0].content[0].text, /CUDA out of memory/)
  } finally {
    await comfy.close()
  }
})

test('还没完成时不发通知，直到超时才收尾', async () => {
  const comfy = await fakeComfy({ entry: null })
  const messages = []

  try {
    const stop = watchRun({
      client: new ComfyClient({ baseUrl: comfy.url }),
      target: { followup: message => messages.push(message) },
      promptId: 'p1',
      outputDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-notify-wait-')),
      intervalMs: 20,
      maxWaitMs: 120,
    })

    await sleep(400)
    stop()

    assert.equal(messages.length, 1, '超时后应当只发一条收尾通知')
    assert.match(messages[0].content[0].text, /仍在跑|超时/)
  } finally {
    await comfy.close()
  }
})
