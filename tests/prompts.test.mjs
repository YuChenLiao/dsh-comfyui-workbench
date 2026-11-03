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
          ? fakeRows(['cyberpunk city at night', 'a cat on a chair', 'cyberpunk city at night'], 1000)
          : fakeRows(['neon cyberpunk alley', 'a dog'], 1000)
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

test('默认池子大小是 2 万（文档里写的就是这个数）', () => {
  assert.equal(DEFAULT_POOL, 20_000)
})
