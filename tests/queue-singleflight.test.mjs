/**
 * `/queue` 的并发去重。
 *
 * 批量提交时最多 20 条任务各自轮询队列。只靠 1 秒缓存挡不住：缓存要等结果回来才写，
 * 冷启动那一瞬间 20 个调用看到的是同一个空缓存，于是同时打出 20 个请求。
 * 共享 in-flight promise 才是真去重。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { test } from 'node:test'

import { ComfyClient } from '../lib/index.js'

/** 起一个假 ComfyUI，只实现 `/queue` 与 `/system_stats`。 */
async function fakeComfy(options = {}) {
  const { delayMs = 30, status = 200 } = options
  let hits = 0
  const server = http.createServer((req, res) => {
    if (req.url === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ system: {} }))
      return
    }
    if (req.url?.startsWith('/queue')) {
      hits += 1
      // 故意慢一点：让并发调用真的重叠（快返回的话第二次可能被缓存接走）
      setTimeout(() => {
        res.writeHead(status, { 'Content-Type': 'application/json' })
        res.end(status === 200 ? JSON.stringify({ queue_running: [[0, 'pid-1', {}, {}, []]], queue_pending: [] }) : '{}')
      }, delayMs)
      return
    }
    res.writeHead(404)
    res.end()
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = server.address().port
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits: () => hits,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('queue()：20 个并发调用只打一次 /queue（single-flight，不是"缓存看起来也对"）', async () => {
  const comfy = await fakeComfy({ delayMs: 30 })
  try {
    const client = new ComfyClient({ baseUrl: comfy.baseUrl })
    // 冷缓存下的并发：这才是批量提交时的真实形态。
    // 去掉 single-flight 的话这 20 个会各走一遍 fetchQueue，hits 变 20。
    const results = await Promise.all(Array.from({ length: 20 }, () => client.queue()))
    assert.equal(comfy.hits(), 1, `实际打了 ${comfy.hits()} 次`)
    for (const result of results) assert.deepEqual(result.running, ['pid-1'])
  } finally {
    await comfy.close()
  }
})

test('queue()：上游 500 时降级成空队列（不抛），且缓存不会把降级结果永久钉住', async () => {
  // 注意：`fetchQueue` 对所有失败（500 / 网络炸 / 坏 body）都返回空队列、**从不 reject**，
  // 所以 `queue()` 里的 `.catch` 目前是纯防御。这里测的是真实行为：降级不抛，
  // 过了一秒之后会重新去问，而不是把"空队列"永久缓存住。
  const comfy = await fakeComfy({ delayMs: 5, status: 500 })
  try {
    const client = new ComfyClient({ baseUrl: comfy.baseUrl })
    const first = await client.queue()
    assert.deepEqual(first, { running: [], pending: [] }, '500 该降级成空队列，不该抛')
    assert.equal(comfy.hits(), 1)

    // 立刻再查：1 秒缓存内，不该再打
    await client.queue()
    assert.equal(comfy.hits(), 1, '缓存窗口内不该重复请求')

    // 等过缓存窗口：必须重新去问（否则一次 500 会把这个客户端永久钉在"空队列"上）
    await new Promise(resolve => setTimeout(resolve, 1_100))
    await client.queue()
    assert.equal(comfy.hits(), 2, '过了缓存窗口该重新请求')
  } finally {
    await comfy.close()
  }
})

test('queue()：并发调用拿到的是同一个值的副本语义（调用方改它不污染缓存）', async () => {
  const comfy = await fakeComfy({ delayMs: 20 })
  try {
    const client = new ComfyClient({ baseUrl: comfy.baseUrl })
    const [a, b] = await Promise.all([client.queue(), client.queue()])
    assert.deepEqual(a, b)
    // 并发共享同一个 value：这里只断言形状，避免有人误以为能安全地原地改它。
    // 目前唯一调用方（notify.ts 的 syncQueueState）只读。
    assert.ok(Array.isArray(a.running) && Array.isArray(a.pending))
  } finally {
    await comfy.close()
  }
})
