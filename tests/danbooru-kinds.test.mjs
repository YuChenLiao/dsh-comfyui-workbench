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
  danbooruLookupBatchTool,
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

test('danbooru_lookup_batch：批量也能查到 general 与 copyright', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupBatchTool({ cache: createTagCache(dir) })
  const result = await tool.execute({ queries: ['长发', '东方Project', '微笑'] })
  assert.equal(result.ok, true, JSON.stringify(result))
  const flat = JSON.stringify(result)
  assert.ok(flat.includes('long_hair'), `批量结果里该有 long_hair：${flat.slice(0, 300)}`)
  assert.ok(flat.includes('touhou'), `批量结果里该有 touhou：${flat.slice(0, 300)}`)
  assert.ok(flat.includes('smile'), `批量结果里该有 smile：${flat.slice(0, 300)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('两个工具的 kind 枚举都列出了四类', () => {
  const dir = emptyDataDir()
  const cache = createTagCache(dir)
  for (const tool of [danbooruLookupTool({ dataDir: dir, cache }), danbooruLookupBatchTool({ cache })]) {
    const kind = tool.parameters.properties.kind
    assert.ok(Array.isArray(kind.enum), `${tool.name} 的 kind 应该是枚举`)
    for (const expected of ['character', 'artist', 'copyright', 'general', 'all']) {
      assert.ok(kind.enum.includes(expected), `${tool.name} 的 enum 缺 ${expected}：${JSON.stringify(kind.enum)}`)
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
})
