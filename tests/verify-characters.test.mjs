/**
 * 上游体检脚本的探针层。
 *
 * `scripts/verify-characters.mjs` 里 `probe` / `rangedLength` 最初一条测试都没有，
 * 于是藏了一个真 bug：`Number(headers.get('content-length'))` 在头缺失时是
 * `Number(null) === 0`，导致「上游没给长度」被当成「长度是 0」——
 * 一边把有字节数的条目误判成 `size-mismatch`（假红），一边把只有路径的 preview
 * 误判成 ok（假绿），而 `Range: bytes=0-0` 的兜底永远不会被调用。
 *
 * 这里用注入的 `fetchImpl` 把六条分支钉住，不需要网络，也不需要起 server。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  describeError,
  encodePath,
  judge,
  lengthOf,
  probe,
  rangedLength,
  targetsOf,
} from '../scripts/verify-characters.mjs'

const URL_BASE = 'https://example.invalid/x.jpg'

/** 一条假响应。`headers` 里不给 content-length 就是"上游没给长度"。 */
function respond(status, headers = {}) {
  return new Response(null, { status, headers })
}

test('lengthOf：头缺失必须是 null，不能是 0', () => {
  assert.equal(lengthOf(new Headers({})), null, '缺 Content-Length ≠ 长度 0 —— 这是整条兜底分支的开关')
  assert.equal(lengthOf(new Headers({ 'content-length': '1234' })), 1234)
  assert.equal(lengthOf(new Headers({ 'content-length': '0' })), 0, '真的写了 0 就是 0')
  assert.equal(lengthOf(new Headers({ 'content-length': 'abc' })), null)
  assert.equal(lengthOf(new Headers({ 'content-length': '-5' })), null)
})

test('probe：有长度就一次 HEAD，不碰 Range', async () => {
  const calls = []
  const result = await probe(URL_BASE, {
    fetchImpl: async (url, init) => {
      calls.push(init?.method ?? 'GET')
      // 与 images.ts 同一条边界：跟随后 302 会把代理变成任意出口，体检也不能比生产宽松。
      assert.equal(init?.redirect, 'error', 'redirect 必须显式为 error')
      return respond(200, { 'content-length': '1234' })
    },
  })
  assert.deepEqual(result, { status: 200, length: 1234 })
  assert.deepEqual(calls, ['HEAD'])
})

test('probe：没长度时退到 Range，从 Content-Range 读出总长', async () => {
  const calls = []
  const result = await probe(URL_BASE, {
    fetchImpl: async (url, init) => {
      calls.push(init?.headers?.Range ?? 'no-range')
      assert.equal(init?.redirect, 'error', 'Range 这一跳同样不许跟随重定向')
      // 第一跳：HEAD 没有 Content-Length；第二跳：206 + Content-Range
      return calls.length === 1 ? respond(200, {}) : respond(206, { 'content-range': 'bytes 0-0/1234' })
    },
  })
  assert.deepEqual(result, { status: 200, length: 1234 })
  assert.equal(calls.length, 2, '缺长度时必须补一次 Range 请求')
  assert.equal(calls[1], 'bytes=0-0')
})

test('probe：Range 也问不出长度时是 null（不是 0，也不伪装成通过）', async () => {
  const result = await probe(URL_BASE, {
    fetchImpl: async () => respond(200, {}),
  })
  assert.equal(result.status, 200)
  assert.equal(result.length, null)
})

test('probe：Range 返回 `*` 总长时同样是 null', async () => {
  const result = await probe(URL_BASE, {
    fetchImpl: async (url, init) => (init?.method === 'HEAD'
      ? respond(200, {})
      : respond(206, { 'content-range': 'bytes 0-0/*' })),
  })
  assert.equal(result.length, null)
})

test('probe：404 不重试；5xx 才重试一次', async () => {
  let notFoundCalls = 0
  const notFound = await probe(URL_BASE, {
    retries: 2,
    fetchImpl: async () => {
      notFoundCalls += 1
      return respond(404, { 'content-length': '0' })
    },
  })
  assert.equal(notFound.status, 404)
  assert.equal(notFoundCalls, 1, '404 是确定的，重试只是浪费')

  let flakyCalls = 0
  const flaky = await probe(URL_BASE, {
    retries: 1,
    fetchImpl: async () => {
      flakyCalls += 1
      return flakyCalls === 1 ? respond(500, {}) : respond(200, { 'content-length': '88' })
    },
  })
  assert.equal(flakyCalls, 2)
  assert.deepEqual(flaky, { status: 200, length: 88 })
})

test('probe：3xx 被 redirect:error 拒掉时给一句人话，而不是 "fetch failed"', async () => {
  const result = await probe(URL_BASE, {
    retries: 0,
    fetchImpl: async () => {
      const error = new TypeError('fetch failed')
      error.cause = new Error('unexpected redirect')
      throw error
    },
  })
  assert.equal(result.status, 0)
  assert.match(result.error, /重定向/)
  assert.doesNotMatch(result.error, /fetch failed/, '原始 TypeError 什么也没说，不该原样透给用户')
})

test('describeError：普通网络错误保留原文', () => {
  assert.match(describeError(new Error('getaddrinfo ENOTFOUND')), /ENOTFOUND/)
  assert.match(describeError('字符串也接'), /字符串也接/)
})

test('judge：四类互斥，且「没长度」不能被当成「相符」', () => {
  assert.equal(judge({ bytes: 100 }, { status: 200, length: 100 }), 'ok')
  assert.equal(judge({ bytes: 100 }, { status: 404, length: null }), 'unreachable')
  assert.equal(judge({ bytes: 100 }, { status: 200, length: 99 }), 'size-mismatch')
  // 有 bytes 却量不出长度：说不清就是说不清，不能算相符
  assert.equal(judge({ bytes: 100 }, { status: 200, length: null }), 'unmeasured')
  // preview 没有 bytes：只要可达就是 ok
  assert.equal(judge({ bytes: null }, { status: 200, length: 4096 }), 'ok')
  assert.equal(judge({ bytes: null }, { status: 200, length: null }), 'unmeasured')
})

test('targetsOf：20×5 槽 + 20 张 preview，preview 没有可比对的字节数', () => {
  const catalog = {
    characters: [
      {
        id: 'c01',
        preview: 'docs/previews/01.webp',
        slots: {
          turnaround: { path: '设定图/a/1.jpg', bytes: 10 },
          sheet: { path: '设定图/a/2.jpg', bytes: 20 },
        },
      },
    ],
  }
  const targets = targetsOf(catalog)
  assert.equal(targets.length, 3)
  assert.deepEqual(targets.map(item => item.where), ['c01.preview', 'c01.turnaround', 'c01.sheet'])
  assert.equal(targets[0].bytes, null)
  assert.equal(targets[1].bytes, 10)

  // 缺 preview 时给人话错误，而不是等到 encodePath 里 undefined.split 抛栈
  assert.throws(() => targetsOf({ characters: [{ id: 'c09', slots: {} }] }), /没有 preview/)
})

test('encodePath：逐段编码，斜杠必须保留', () => {
  assert.equal(encodePath('设定图/a/1.jpg'), `${encodeURIComponent('设定图')}/a/1.jpg`)
  assert.equal(encodePath('a/b/c').split('/').length, 3, '整串编码会把 / 变成 %2F，上游一律 404')
})

test('rangedLength：body 只取首字节就断开，不把整份图读进内存', async () => {
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([0xff]))
      // 不 close：模拟"还有 2 MB 没读"
    },
    cancel() {
      cancelled = true
    },
  })
  const total = await rangedLength(URL_BASE, async () => new Response(stream, {
    status: 206,
    headers: { 'content-range': 'bytes 0-0/2773574' },
  }))
  assert.equal(total, 2773574)
  assert.equal(cancelled, true, '必须立刻取消，否则一次体检就把 120 张图拉下来了')
})
