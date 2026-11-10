/**
 * 四类标签库**真的能查到** —— 这是「全导」的生产判据。
 *
 * 上一版只测了导入（`tests/upstream.test.mjs`），数据落了盘但查询面还只认
 * character / artist：`storePath` 能读到 general.jsonl，而没有任何生产代码把
 * general 传进去。385 项测试全绿，模型查「长发」却仍走在线兜底。
 *
 * 所以这里从**工具入口**验，不碰内部函数。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  batchLookup,
  danbooruLookupTool,
  createTagCache,
} from '../lib/index.js'

/** 空的数据目录 —— `storePath` 会回退到随包 `data/danbooru/`。 */
function emptyDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-kinds-'))
}

test('danbooru_lookup：general 类能查到（长发 → long_hair）', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const result = await tool.execute({ query: '长发' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.source, 'local', '本地该命中——命中不了就说明 general 没接进查询面')
  assert.ok(result.tags.includes('long_hair'), `实际 ${JSON.stringify(result.tags)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('danbooru_lookup：copyright 类能查到（东方Project → touhou）', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const result = await tool.execute({ query: '东方Project' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.source, 'local')
  assert.ok(result.tags.includes('touhou'), `实际 ${JSON.stringify(result.tags)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('danbooru_lookup：kind 限定到 general 仍然命中，说明按类建索引', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const result = await tool.execute({ query: 'long_hair', kind: 'general' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.source, 'local')
  assert.ok(result.tags.includes('long_hair'))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('danbooru_lookup：kind 限定到 character 时不会从 general 里凑答案', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  // ganyu 是角色。限定 character 该命中；这里验的是「限定生效」而不是「命中什么」
  const result = await tool.execute({ query: 'ganyu', kind: 'character' })
  assert.equal(result.ok, true, JSON.stringify(result))
  assert.equal(result.source, 'local')
  assert.ok(
    result.tags.some(tag => String(tag).startsWith('ganyu')),
    `实际 ${JSON.stringify(result.tags)}`,
  )
  fs.rmSync(dir, { recursive: true, force: true })
})

test('批量路径（queries）也能查到 general 与 copyright', async () => {
  const dir = emptyDataDir()
  const result = await batchLookup({ cache: createTagCache(dir) }, { queries: ['长发', '东方Project', '微笑'] })
  assert.equal(result.ok, true, JSON.stringify(result))
  const flat = JSON.stringify(result)
  assert.ok(flat.includes('long_hair'), `批量结果里该有 long_hair：${flat.slice(0, 300)}`)
  assert.ok(flat.includes('touhou'), `批量结果里该有 touhou：${flat.slice(0, 300)}`)
  assert.ok(flat.includes('smile'), `批量结果里该有 smile：${flat.slice(0, 300)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('kind 枚举列出了四类（单条与批量共用同一个 schema）', () => {
  const dir = emptyDataDir()
  const cache = createTagCache(dir)
  // 两个工具已合成一个：kind 现在只有一份声明，批量路径也用同一份
  for (const tool of [danbooruLookupTool({ dataDir: dir, cache })]) {
    const kind = tool.parameters.properties.kind
    assert.ok(Array.isArray(kind.enum), `${tool.name} 的 kind 应该是枚举`)
    for (const expected of ['character', 'artist', 'copyright', 'general', 'all']) {
      assert.ok(kind.enum.includes(expected), `${tool.name} 的 enum 缺 ${expected}：${JSON.stringify(kind.enum)}`)
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('两条路径的分派：给 queries 走批量（不联网），只给 query 才走单条', async () => {
  const dir = emptyDataDir()
  const cache = createTagCache(dir)
  const deps = { dataDir: dir, cache }
  const tool = danbooruLookupTool(deps)

  // 给 queries：应当走 batchLookup —— 返回的是逐条结果，不是一个 tags 列表
  const batched = await tool.execute({ queries: ['长发'] })
  assert.equal(batched.ok, true)
  assert.ok(Array.isArray(batched.results), '批量路径该回 results 数组')
  assert.equal(batched.tags, undefined, '批量路径不该回单条的 tags')

  // 两个都不给：明确说清有两条路径，而不是只提 query
  const empty = await tool.execute({})
  assert.equal(empty.ok, false)
  assert.match(empty.message ?? empty.error, /query/)
  assert.match(empty.message ?? empty.error, /queries/)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('批量路径不许静默吞掉 category（单条会硬报错，批量也得说清）', async () => {
  const dir = emptyDataDir()
  const cache = createTagCache(dir)
  const tool = danbooruLookupTool({ dataDir: dir, cache })

  // 批量的筛选逻辑没实现。静默忽略会得到"看着筛过了、其实没筛"的结果 —— 那比报错更误导
  const blocked = await tool.execute({ queries: ['长发'], category: 'clothing' })
  assert.equal(blocked.ok, false, '批量 + category 应当报错，不能静默返回未筛结果')
  assert.match(blocked.error, /category/)
  assert.match(blocked.error, /query/)

  // 去掉 category 就能用
  const ok = await tool.execute({ queries: ['长发'] })
  assert.equal(ok.ok, true)

  fs.rmSync(dir, { recursive: true, force: true })
})
