/**
 * `danbooru_lookup` 的**批量路径**（`queries`）。
 *
 * 守三件事：去重保序、缺失上报、以及"只查本地不联网"这条承诺；上限由 `MAX_BATCH_QUERIES` 管。
 *
 * 注意这里直接调 `batchLookup`，不经过工具的分派层 —— 分派由
 * `danbooru-kinds.test.mjs` 里那条用例守着，两者各管一段。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { TagIndex, batchLookup } from '../lib/index.js'

/** 工具已并入 danbooru_lookup；这些用例只管批量路径，包成原来的形状。 */
const lookupBatch = deps => ({ execute: args => batchLookup(deps, args) })

const RECORDS = [
  { tag: 'hatsune_miku', kind: 'character', postCount: 148311, names: ['初音未来', '初音ミク', 'miku'] },
  { tag: 'mika_(blue_archive)', kind: 'character', postCount: 16024, names: ['圣园未花'] },
  { tag: 'wlop', kind: 'artist', postCount: 5000, names: [] },
]

/** 最小可用的 cache（不碰磁盘）。 */
function fakeCache(records = RECORDS) {
  const byKind = new Map([
    ['character', records.filter(r => r.kind === 'character')],
    ['artist', records.filter(r => r.kind === 'artist')],
  ])
  return {
    read: kind => byKind.get(kind) ?? [],
    search: (kind, query, limit = 10) => new TagIndex(byKind.get(kind) ?? []).search(query, limit),
    invalidate: () => {},
  }
}

test('批量查询：一次拿到多个名字，缺的单独列出', async () => {
  const tool = lookupBatch({ cache: fakeCache() })
  const result = await tool.execute({ queries: ['初音未来', '圣园未花', 'wlop', '不存在xyz'], limit: 2 })
  assert.equal(result.ok, true)
  assert.equal(result.count, 4)
  assert.equal(result.found, 3)
  assert.deepEqual(result.missing, ['不存在xyz'])
  const miku = result.results.find(r => r.query === '初音未来')
  assert.deepEqual(miku.tags, ['hatsune_miku'])
  assert.equal(miku.found, true)
  const missing = result.results.find(r => r.query === '不存在xyz')
  assert.deepEqual(missing.tags, [])
  assert.equal(missing.found, false)
})

test('批量查询：重复名字去重，但保持顺序', async () => {
  const tool = lookupBatch({ cache: fakeCache() })
  const result = await tool.execute({ queries: ['初音未来', 'wlop', '初音未来'], limit: 1 })
  assert.equal(result.count, 2, '重复项应被去掉')
  assert.deepEqual(result.results.map(r => r.query), ['初音未来', 'wlop'])
})

test('批量查询：空列表与超上限被拒', async () => {
  const tool = lookupBatch({ cache: fakeCache() })
  assert.equal((await tool.execute({ queries: [] })).ok, false)
  assert.equal((await tool.execute({ queries: ['', '  '] })).ok, false)
  const tooMany = Array.from({ length: 51 }, (_, i) => `q${i}`)
  const result = await tool.execute({ queries: tooMany })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /最多查 50/)
})

test('批量查询：只查本地，没有 online 字段', async () => {
  const tool = lookupBatch({ cache: fakeCache() })
  const result = await tool.execute({ queries: ['不存在xyz'] })
  // 单条工具没命中会走在线（source: 'online'）；批量不走，只报 missing
  assert.equal(result.ok, true)
  assert.deepEqual(result.missing, ['不存在xyz'])
  assert.equal('source' in result, false, '批量不该有 source 字段')
})

test('批量查询：kind 过滤生效', async () => {
  const tool = lookupBatch({ cache: fakeCache() })
  const artistsOnly = await tool.execute({ queries: ['wlop'], kind: 'artist' })
  assert.deepEqual(artistsOnly.results[0].tags, ['wlop'])
  const charactersOnly = await tool.execute({ queries: ['wlop'], kind: 'character' })
  assert.deepEqual(charactersOnly.results[0].tags, [], '画师不该出现在角色库里')
})
