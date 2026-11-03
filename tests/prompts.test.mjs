/**
 * 提示词参考的数据层。
 *
 * 只测能离线验的部分：**池子的读写、搜索打分、以及"没建池时不给假结果"**。
 * 随机抽样走网络（HF），所以 `fetchRandomPrompts` 只做注入 fetch 的形状校验。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  DEFAULT_POOL,
  fetchRandomPrompts,
  promptPoolInfo,
  promptPoolPath,
  searchPrompts,
  syncPromptPool,
} from '../lib/index.js'

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-prompts-'))
}

/** 造一个假 HF rows 响应。 */
function fakeRows(entries, total) {
  return {
    num_rows_total: total,
    rows: entries.map((text, index) => ({ row_idx: index, row: { text } })),
  }
}

test('searchPrompts：没建池时返回空数组，不假装有结果', () => {
  const dir = tmpDir()
  try {
    assert.deepEqual(searchPrompts('cyberpunk', 5, dir), [])
    assert.equal(promptPoolInfo(dir).size, 0)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('syncPromptPool：写入后能搜到，且同一句话只留一份', async () => {
  const dir = tmpDir()
  try {
    let page = 0
    await syncPromptPool({
      dataDir: dir,
      count: 200,
      log: () => {},
      // 两页里有重复：池子里应当只留一份
      fetchImpl: async () => {
        page += 1
        const body = page === 1
          ? fakeRows(Array.from({ length: 100 }, (_, i) => (i === 0 ? 'cyberpunk city at night' : i === 1 ? 'a cat on a chair' : `filler prompt ${i}`)), 1000)
          : fakeRows(Array.from({ length: 100 }, (_, i) => (i === 0 ? 'neon cyberpunk alley' : `more filler ${i}`)), 1000)
        return new Response(JSON.stringify(body), { status: 200 })
      },
    })

    const info = promptPoolInfo(dir)
    assert.ok(info.size >= 4, `实际 ${info.size}`)
    assert.ok(info.builtAt > 0, '该有修改时间')

    const hits = searchPrompts('cyberpunk', 10, dir)
    assert.ok(hits.length >= 2, `实际 ${JSON.stringify(hits)}`)
    assert.ok(hits.every(hit => hit.text.toLowerCase().includes('cyberpunk')))

    // 去重：同一句不该出现两次
    const texts = hits.map(hit => hit.text)
    assert.equal(new Set(texts).size, texts.length, `有重复：${JSON.stringify(texts)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('searchPrompts：多个词要全部命中，且词边界命中的排前面', async () => {
  const dir = tmpDir()
  try {
    fs.mkdirSync(path.dirname(promptPoolPath(dir)), { recursive: true })
    fs.writeFileSync(promptPoolPath(dir), [
      { text: 'cyberpunk city, neon lights, rain', source: 1 },
      { text: 'a city where cyberpunk vibes appear late', source: 2 },
      { text: 'cyberpunk only', source: 3 },
    ].map(record => JSON.stringify(record)).join('\n'))

    const both = searchPrompts('cyberpunk city', 10, dir)
    assert.equal(both.length, 2, `两个词都要命中的只有 2 条，实际 ${JSON.stringify(both)}`)
    assert.equal(both[0].text, 'cyberpunk city, neon lights, rain', '开头就命中的该排第一')

    // 空白查询不该返回全部
    assert.deepEqual(searchPrompts('   ', 10, dir), [])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('fetchRandomPrompts：读的是 row.text，不是 row.prompt', async () => {
  const items = await fetchRandomPrompts(3, {
    fetchImpl: async () => new Response(JSON.stringify(fakeRows(['a', 'b', 'c'], 50)), { status: 200 }),
  })
  assert.equal(items.length, 3)
  assert.deepEqual(items.map(item => item.text).sort(), ['a', 'b', 'c'])
  assert.ok(items.every(item => typeof item.source === 'number'), '要带行号')
})

test('fetchRandomPrompts：上游失败时抛错，不返回空数组假装成功', async () => {
  await assert.rejects(
    () => fetchRandomPrompts(3, { fetchImpl: async () => new Response('', { status: 503 }) }),
    /HTTP 503/,
  )
})

test('fetchRandomPrompts：总行数缓存后稳态只打一次网络', async () => {
  let calls = 0
  const counting = async () => {
    calls += 1
    return new Response(JSON.stringify(fakeRows(['a', 'b'], 5000)), { status: 200 })
  }

  // 第一次可能打两次（拿 total + 挑一页），取决于随机落点
  await fetchRandomPrompts(2, { fetchImpl: counting })
  const firstCalls = calls
  assert.ok(firstCalls >= 1 && firstCalls <= 2, `第一次实际 ${firstCalls} 次`)

  // 之后 total 已缓存：每次只应有一次请求（不缓存的话恒定两次，那一页纯浪费）
  calls = 0
  await fetchRandomPrompts(2, { fetchImpl: counting })
  assert.equal(calls, 1, `缓存生效后该只打一次，实际 ${calls} 次`)
})

test('fetchRandomPrompts：第一枪失败会重试一次', async () => {
  let calls = 0
  const flaky = async () => {
    calls += 1
    if (calls === 1) return new Response('', { status: 503 })
    return new Response(JSON.stringify(fakeRows(['ok'], 10)), { status: 200 })
  }
  const items = await fetchRandomPrompts(1, { fetchImpl: flaky })
  assert.equal(items.length, 1, '重试之后该拿到结果')
  assert.equal(calls, 2)
})

test('默认池子 5 千条（2 万条要 200 次请求，HF 会一路 429）', () => {
  assert.equal(DEFAULT_POOL, 5_000)
})

test('syncPromptPool：429 会退避重试，不是一撞就整趟失败', async () => {
  const dir = tmpDir()
  let calls = 0
  try {
    const result = await syncPromptPool({
      dataDir: dir,
      count: 200,
      intervalMs: 0,
      log: () => {},
      fetchImpl: async () => {
        calls += 1
        // 头两次 429，之后成功：模拟 HF 限流
        if (calls <= 2) {
          return new Response('', { status: 429, headers: { 'retry-after': '0' } })
        }
        return new Response(JSON.stringify(fakeRows(Array.from({ length: 100 }, (_, i) => `prompt ${i}`), 1000)), { status: 200 })
      },
    })
    assert.ok(result.size > 0, '退避之后该拿到结果')
    assert.ok(calls >= 3, `该重试过，实际 ${calls} 次`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('syncPromptPool：失败不碰原有的池，临时文件也要清干净', async () => {
  const dir = tmpDir()
  try {
    // 先建一份好池子
    fs.mkdirSync(path.dirname(promptPoolPath(dir)), { recursive: true })
    fs.writeFileSync(promptPoolPath(dir), `${JSON.stringify({ text: '原来的那一条', source: 1 })}\n`)
    const before = fs.readFileSync(promptPoolPath(dir), 'utf8')

    // 再建一次，但上游一直 500：必须失败，且原文件一个字不变
    await assert.rejects(
      () => syncPromptPool({
        dataDir: dir,
        count: 200,
        intervalMs: 0,
        log: () => {},
        fetchImpl: async () => new Response('', { status: 500 }),
      }),
      /HTTP 500/,
    )
    assert.equal(fs.readFileSync(promptPoolPath(dir), 'utf8'), before, '失败不该动原池')
    const strays = fs.readdirSync(path.dirname(promptPoolPath(dir))).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(strays, [], `临时文件没清：${JSON.stringify(strays)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('syncPromptPool：首页成功、后续全 429 时不能把原池覆盖成一小撮', async () => {
  // 这是"建池失败把原池炸了"的另一种形态：只有 `written === 0` 才判失败是不够的，
  // 首页拿到 100 条、后面几十页全 429 时 written=100 —— 照样 rename 就把 5000 缩成 100。
  const dir = tmpDir()
  try {
    const file = promptPoolPath(dir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    // 造一个"原有 5000 条"的池
    const lines = []
    for (let i = 0; i < 5000; i += 1) lines.push(JSON.stringify({ text: `原来的第 ${i} 条`, source: i }))
    fs.writeFileSync(file, `${lines.join('\n')}\n`)
    const before = fs.readFileSync(file, 'utf8')

    let calls = 0
    await assert.rejects(
      () => syncPromptPool({
        dataDir: dir,
        count: 5000,
        intervalMs: 0,
        maxPageRetries: 0,
        log: () => {},
        fetchImpl: async () => {
          calls += 1
          // 只有第一枪成功（100 条），之后全 429
          if (calls === 1) {
            return new Response(JSON.stringify(fakeRows(Array.from({ length: 100 }, (_, i) => `新的 ${i}`), 100000)), { status: 200 })
          }
          return new Response('', { status: 429, headers: { 'retry-after': '0' } })
        },
      }),
      /看着像被限流|原有.*条/,
    )
    assert.equal(fs.readFileSync(file, 'utf8'), before, '原池必须一个字不变')
    const strays = fs.readdirSync(path.dirname(file)).filter(name => name.endsWith('.tmp'))
    assert.deepEqual(strays, [], `临时文件没清：${JSON.stringify(strays)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
