/**
 * `history` 的状态码语义。
 *
 * 上一版 `if (!res.ok) return undefined` 把 5xx 也当成"还没完成"，
 * 于是 poller 永远认为任务在跑：记录停在 queued、activeCount 虚高，
 * 而 ComfyUI 那边可能早挂了。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ComfyClient } from '../lib/index.js'

/** 用给定的 HTTP 状态码造一个 client。 */
function clientReturning(status, body = '{}') {
  const realFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(body, {
    status,
    headers: { 'content-type': 'application/json' },
  })
  return { client: new ComfyClient({ baseUrl: 'http://127.0.0.1:9' }), restore: () => { globalThis.fetch = realFetch } }
}

test('404 表示"这条记录还没有"，返回 undefined 继续等', async () => {
  const { client, restore } = clientReturning(404)
  try {
    assert.equal(await client.history('p1'), undefined)
  } finally {
    restore()
  }
})

test('5xx 抛可重试错误，不再静默当成"没完成"', async () => {
  const { client, restore } = clientReturning(500)
  try {
    await assert.rejects(
      () => client.history('p1'),
      (error) => {
        assert.equal(error.code, 'comfy_unreachable', `应是可重试的错误，实际 ${error.code}`)
        return true
      },
    )
  } finally {
    restore()
  }
})

test('401 / 403 抛认证错误', async () => {
  for (const status of [401, 403]) {
    const { client, restore } = clientReturning(status)
    try {
      await assert.rejects(
        () => client.history('p1'),
        (error) => {
          assert.equal(error.code, 'auth_failed')
          return true
        },
      )
    } finally {
      restore()
    }
  }
})

test('正常返回时解析出 entry', async () => {
  const { client, restore } = clientReturning(200, JSON.stringify({
    p1: { status: { status_str: 'success', completed: true }, outputs: {} },
  }))
  try {
    const entry = await client.history('p1')
    assert.equal(entry?.status?.completed, true)
  } finally {
    restore()
  }
})

test('history 里没有这个 promptId 时返回 undefined', async () => {
  const { client, restore } = clientReturning(200, JSON.stringify({}))
  try {
    assert.equal(await client.history('p1'), undefined)
  } finally {
    restore()
  }
})
