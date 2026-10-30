/**
 * `TagIndex` 与线性实现的一致性。
 *
 * 索引只改候选集，不改判定 —— 这条承诺必须有测试守着。复审当初就是靠人工比对
 * 才发现"含空格查询会多命中 contains 档"的：索引把 needle 归一成下划线去比别名，
 * 而线性实现用未归一的原串。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { TagIndex, searchTagsLinear } from '../lib/index.js'

/** 造一份固定的记录集，覆盖别名、下划线、空格、多语言。 */
const RECORDS = [
  { tag: 'hatsune_miku', kind: 'character', postCount: 148311, names: ['初音未来', '初音ミク', 'miku'] },
  { tag: 'manabe_mana', kind: 'artist', postCount: 5200, names: ['manabe mana', '真鍋真名'] },
  { tag: 'kuren', kind: 'artist', postCount: 900, names: ['kuren_(orange_star)'] },
  { tag: 'orange_star', kind: 'artist', postCount: 700, names: ['orange star'] },
  { tag: 'a', kind: 'artist', postCount: 10, names: [] },
  { tag: 'mika_(blue_archive)', kind: 'character', postCount: 16024, names: ['圣园未花'] },
]

const QUERIES = [
  // 完整 tag 与空格形式
  'hatsune_miku', 'hatsune miku', 'mika_(blue_archive)',
  // 别名原样与空格形式 —— 这是当初出问题的那一类
  'orange star', 'orange_star', 'manabe mana', 'kuren_(orange_star)',
  // 多空格与首尾空格
  'orange  star', '  orange star  ', 'a  b',
  // 单字符与空
  'a', 'm', '', ' ', '   ',
  // 中文与日文
  '初音未来', '初音ミク', '圣园未花', '真鍋真名',
  // 子串
  'miku', 'kuren', 'star', 'mika', 'blu',
  // 不存在的
  'zzzzz', '不存在的角色',
]

test('索引与线性实现在所有固定查询上完全一致（含 how 档位与顺序）', () => {
  const index = new TagIndex(RECORDS)
  for (const query of QUERIES) {
    const indexed = index.search(query, 10).map(m => `${m.record.tag}|${m.how}`)
    const linear = searchTagsLinear(RECORDS, query, 10).map(m => `${m.record.tag}|${m.how}`)
    assert.deepEqual(indexed, linear, `查询 ${JSON.stringify(query)} 的结果不一致`)
  }
})

test('含空格的查询不多命中下划线别名（复审抓到的那个 bug）', () => {
  const index = new TagIndex(RECORDS)
  // `kuren` 的别名是 `kuren_(orange_star)`。查 `orange star`（带空格）时，
  // 线性实现比的是带空格的原串，所以命中不到它；索引必须一致。
  const spaced = index.search('orange star', 10).map(m => m.record.tag)
  assert.ok(!spaced.includes('kuren'), `不该命中 kuren，实际：${JSON.stringify(spaced)}`)
  assert.ok(spaced.includes('orange_star'), '应命中 tag 名就叫 orange_star 的那条')
  // 下划线形式则应该命中
  const underscored = index.search('orange_star', 10).map(m => m.record.tag)
  assert.ok(underscored.includes('kuren'), `下划线形式应命中 kuren，实际：${JSON.stringify(underscored)}`)
})

test('单字符查询走全扫，结果与线性一致', () => {
  const index = new TagIndex(RECORDS)
  const indexed = index.search('a', 10).map(m => `${m.record.tag}|${m.how}`)
  const linear = searchTagsLinear(RECORDS, 'a', 10).map(m => `${m.record.tag}|${m.how}`)
  assert.deepEqual(indexed, linear)
})

test('空与纯空白查询返回空', () => {
  const index = new TagIndex(RECORDS)
  for (const query of ['', ' ', '   ']) assert.deepEqual(index.search(query, 10), [])
})

test('names 为空的记录仍能按 tag 查到', () => {
  const index = new TagIndex(RECORDS)
  const result = index.search('a', 10)
  const hit = result.find(m => m.record.tag === 'a')
  assert.ok(hit !== undefined, '单字母 tag 应当能被查到')
  assert.equal(hit.how, 'tag')
})

test('postCount 相同的记录顺序与线性一致（稳定排序）', () => {
  const tied = [
    { tag: 'x_one', kind: 'artist', postCount: 100, names: ['same'] },
    { tag: 'x_two', kind: 'artist', postCount: 100, names: ['same'] },
    { tag: 'x_three', kind: 'artist', postCount: 100, names: ['same'] },
  ]
  const index = new TagIndex(tied)
  const indexed = index.search('same', 10).map(m => m.record.tag)
  const linear = searchTagsLinear(tied, 'same', 10).map(m => m.record.tag)
  assert.deepEqual(indexed, linear)
})

test('真实数据抽样：索引与线性一致（数据缺失则跳过）', () => {
  const store = path.join(os.homedir(), '.dsh-comfyui-workbench', 'danbooru', 'characters.jsonl')
  if (!fs.existsSync(store)) {
    // CI 上没有数据文件；上面那些固定用例已覆盖判定逻辑
    return
  }
  const records = fs.readFileSync(store, 'utf8').trim().split('\n').slice(0, 4000).map(line => JSON.parse(line))
  const index = new TagIndex(records)
  const samples = [
    ...records.slice(0, 60).map(r => r.tag),
    ...records.slice(0, 60).map(r => r.tag.replace(/_/g, ' ')),
    ...records.filter(r => r.names.length > 0).slice(0, 60).map(r => r.names[0]),
    '甘雨', '初音未来', 'mika', 'blu', 'a', 'zzz',
  ]
  for (const query of samples) {
    const indexed = index.search(query, 10).map(m => `${m.record.tag}|${m.how}`)
    const linear = searchTagsLinear(records, query, 10).map(m => `${m.record.tag}|${m.how}`)
    assert.deepEqual(indexed, linear, `真实数据查询 ${JSON.stringify(query)} 不一致`)
  }
})
