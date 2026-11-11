/**
 * 素材库的两处命中率补救：
 *
 * 1. **前缀回退**（`shared/search/fallback.ts`）：零命中时把最后一个词逐字砍短再试
 * 2. **分类别名**（`scripts/import-poses.mjs` 生成到 catalog 的 `aliases`）：补英文与中文同义词
 *
 * 这组用例钉两类东西：**哪些能救**（砍虚词），以及**哪些必须拒答**（砍掉实词）。
 * 后者同样重要 —— 放宽成"命中就给结果"，`牛仔外套` 会拿回一堆没有外套的结果。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { createPosesIndex, isFillerTail, searchWithPrefixFallback } from '../lib/index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLED = path.join(HERE, '..', 'data', 'poses', 'catalog.json')

// ── 纯函数：回退 ──

test('前缀回退：砍虚词能救回动词短语', () => {
  const run = (query) => ['坐姿 01', '站姿 02'].filter(entry => entry.includes(query))

  const sitting = searchWithPrefixFallback('坐着', run)
  assert.equal(sitting.fellBack, true)
  assert.equal(sitting.usedQuery, '坐')
  assert.equal(sitting.droppedTail, '着', '被砍掉的部分要带回去，上层才能判断该不该给结果')

  const standing = searchWithPrefixFallback('站着', run)
  assert.equal(standing.usedQuery, '站')
  assert.equal(standing.droppedTail, '着')
})

test('前缀回退：直接命中时不回退，droppedTail 为空', () => {
  const run = (query) => (query === '坐姿' ? ['坐姿 01'] : [])
  const direct = searchWithPrefixFallback('坐姿', run)
  assert.equal(direct.fellBack, false)
  assert.equal(direct.droppedTail, '')
})

test('前缀回退：救不回来时明确回 false，不假装命中', () => {
  const outcome = searchWithPrefixFallback('水手服', () => [])
  assert.equal(outcome.fellBack, false)
  assert.deepEqual(outcome.list, [])
  assert.equal(outcome.usedQuery, '水手服')
})

test('前缀回退：空查询只调一次，不折腾', () => {
  let calls = 0
  const outcome = searchWithPrefixFallback('', () => { calls += 1; return [] })
  assert.equal(calls, 1)
  assert.equal(outcome.fellBack, false)
})

test('前缀回退：只砍最后一个词，前面的不动', () => {
  const seen = []
  const run = (query) => { seen.push(query); return query === '白色 针' ? ['hit'] : [] }
  const outcome = searchWithPrefixFallback('白色 针织衫', run)
  assert.equal(outcome.usedQuery, '白色 针')
  assert.ok(seen.every(query => query.startsWith('白色 ')))
})

test('前缀回退：单字词不会被砍成空串（避免死循环与空查询）', () => {
  const seen = []
  const run = (query) => { seen.push(query); return [] }
  searchWithPrefixFallback('坐', run)
  assert.ok(seen.every(query => query !== ''), `不该出现空查询：${JSON.stringify(seen)}`)
})

test('前缀回退：上限是 4 字 —— 砍更多就会退化成单字', () => {
  // 造一个只有在砍到第 4 字时才命中的场景；砍第 5 字（落回单字）不该被尝试
  const seen = []
  const run = (query) => { seen.push(query); return [] }
  searchWithPrefixFallback('一二三四五六七八', run)
  // 原词 1 次 + 最多 4 次重试
  assert.equal(seen.length, 5, `最多砍 4 字，实际尝试 ${seen.length} 次：${JSON.stringify(seen)}`)
  assert.equal(seen[seen.length - 1], '一二三四')
})

// ── 纯函数：虚词判据 ──

test('虚词判据：砍掉助词/方位词算"没伤语义"，砍掉实词算"语义被破坏"', () => {
  for (const tail of ['着', '了', '上', '下', '在', '里', '中', '的']) {
    assert.equal(isFillerTail(tail), true, `「${tail}」该算虚词`)
  }
  for (const tail of ['裙子', '外套', '连衣裙', '椅']) {
    assert.equal(isFillerTail(tail), false, `「${tail}」是实词，不该放行`)
  }
  assert.equal(isFillerTail(''), false, '空串不算回退，也不该被当成虚词')
})

// ── 真索引：别名生效 ──

test('分类别名：英文能查到（数据本身只有中文分类词）', () => {
  const index = createPosesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'alias-')), BUNDLED)

  // 精确值：坐姿 29 + 别名里有 sitting 的组
  const sitting = index.search({ query: 'sitting', limit: 1 })
  assert.equal(sitting.total, 49, `sitting 应命中 49 组，实际 ${sitting.total}（别名表被改过？）`)

  assert.ok(index.search({ query: 'standing', limit: 1 }).total > 0)
  assert.ok(index.search({ query: 'lying', limit: 1 }).total > 0, 'lying 应当命中趴卧与侧卧位')
})

test('分类别名：`prone` 不该有 —— 趴卧里混着仰卧，标 prone 会错配', () => {
  const index = createPosesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'alias2-')), BUNDLED)
  assert.equal(index.search({ query: 'prone', limit: 1 }).total, 0, 'prone 是俯卧，趴卧分类里只有 9/30 是俯卧')
})

test('分类别名：「躺」并进了趴卧/侧卧位（数据原本只有仰卧/侧卧/俯卧）', () => {
  const index = createPosesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'alias3-')), BUNDLED)
  assert.ok(index.search({ query: '躺', limit: 1 }).total > 0, '「躺」应当命中')
})

test('分类别名不改中文查询：坐姿仍是 30 组，且不走回退', () => {
  const index = createPosesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'alias4-')), BUNDLED)
  const byCategory = index.search({ query: '坐姿', limit: 40 })
  assert.equal(byCategory.total, 30, `坐姿应命中 30 组（category 里 29 + 名字里带「坐姿」的），实际 ${byCategory.total}`)
  assert.equal(byCategory.fellBack, false)
})
