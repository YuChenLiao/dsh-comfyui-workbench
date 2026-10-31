/**
 * 生产接线与观测开销。
 *
 * 上一轮复审抓到的阻断项：`runtime.ts` 写的是 `new RunRegistry()` 没传目录，
 * 于是纯内存、`runs.json` 永不落盘 —— 而 `tests/runs.test.mjs` 全绿，因为测试
 * 自己传了目录，**绕过了真实接线**。这里守的就是这条。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { ComfyClient, RunRegistry, runsTool } from '../lib/index.js'

test('queue() 有 1 秒缓存：同 tick 里 20 条任务不该打出 20 次请求', async () => {
  const realFetch = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ queue_running: [], queue_pending: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const client = new ComfyClient({ baseUrl: 'http://127.0.0.1:9' })
    await client.queue()
    await client.queue()
    await client.queue()
    assert.equal(calls, 1, `3 次调用应只打 1 次 HTTP，实际 ${calls}`)

    // 过期后要能重新拉
    await new Promise(resolve => setTimeout(resolve, 1_100))
    await client.queue()
    assert.equal(calls, 2, '缓存过期后应重新请求')
  } finally {
    globalThis.fetch = realFetch
  }
})

test('queue() 离线时返回空数组，不抛', async () => {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  try {
    const client = new ComfyClient({ baseUrl: 'http://127.0.0.1:9' })
    const result = await client.queue()
    assert.deepEqual(result, { running: [], pending: [] })
  } finally {
    globalThis.fetch = realFetch
  }
})

test('内存也裁剪：提交 300 条后只留 200 条（不只是落盘时裁）', () => {
  const registry = new RunRegistry()
  for (let i = 0; i < 300; i += 1) registry.submit(`p${i}`, 'wf')
  const all = registry.list({ limit: 200 })
  assert.equal(all.length, 200)
  assert.equal(all[0]?.promptId, 'p299', '最新的要在最前')
  // 最老的应该被丢掉
  assert.equal(registry.get('p0'), undefined, 'p0 应已被裁掉')
})

test('生产接线：runtime 传了 outputDir 就会落盘', async () => {
  // 这条不直接测 runtime（它要在 cordis 里跑），而是钉住"传目录就写盘"这个契约，
  // 提醒改接线的人别把参数漏掉。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wire-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  registry.flush()
  assert.ok(fs.existsSync(path.join(dir, 'runs.json')), '传了目录就必须有 runs.json')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不传目录时纯内存，不写文件也不抛', () => {
  const registry = new RunRegistry()
  registry.submit('p1', 'wf')
  registry.flush()
  assert.equal(registry.get('p1')?.state, 'queued', '内存里仍在')
})

test('comfyui_runs 的 limit 会被夹到 50', async () => {
  const registry = new RunRegistry()
  for (let i = 0; i < 80; i += 1) registry.submit(`p${i}`, 'wf')
  const tool = runsTool({ runs: registry })
  const result = await tool.execute({ limit: 999 })
  assert.ok(result.count <= 50, `limit 应被夹到 50，实际 ${result.count}`)
})
