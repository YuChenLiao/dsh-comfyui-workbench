/**
 * 上游 CSV 导入：解析、记录转换、四类路径。
 *
 * 这段逻辑原先只在 `scripts/import-danbooru-zh.mjs` 里，面板的「更新标签」按钮
 * 也要走它，所以提到了 `src/`。这里钉住三件容易回退的事：
 * 引号里的逗号不能被硬切、中文名要排第一、写盘只能落用户数据目录。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  bundledDir,
  KIND_OF_CATEGORY,
  TAG_KINDS,
  UPSTREAM_FILES,
  importUpstream,
  ownStorePath,
  parseCsvLine,
  readStore,
  rowToRecord,
  storePath,
} from '../lib/index.js'

/** 造一个隔离的数据目录。 */
function tmpDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-upstream-'))
}

test('parseCsvLine：引号里的逗号与转义双引号都要留住', () => {
  // aliases 里出现过 `"f4samurai, Inc."` 这种被引号包住、内含逗号的值；
  // 按逗号硬切会整行解析失败并静默丢数据。
  const row = parseCsvLine('f4samurai,1,"f4samurai, Inc.|f4","F4社",100,带逗号的注释')
  assert.equal(row?.tag, 'f4samurai')
  assert.equal(row?.category, 1)
  assert.equal(row?.aliases, 'f4samurai, Inc.|f4')
  assert.equal(row?.zh, 'F4社')
  assert.equal(row?.count, 100)

  const escaped = parseCsvLine('x,0,"a""b",,1,')
  assert.equal(escaped?.aliases, 'a"b', '转义的双引号要还原成一个引号')
})

test('parseCsvLine：字段不足六列返回 undefined（该行跳过而不是崩）', () => {
  assert.equal(parseCsvLine('only,three,fields'), undefined)
})

test('rowToRecord：中文名排第一，与 tag 同名的别名不收', () => {
  const record = rowToRecord(
    { tag: 'hatsune_miku', category: 4, aliases: 'miku|hatsune_miku|初音', zh: '初音未来', count: 9, notes: '说明' },
    'character',
  )
  assert.equal(record.tag, 'hatsune_miku')
  assert.equal(record.kind, 'character')
  assert.equal(record.names[0], '初音未来', '中文名要排第一')
  assert.deepEqual(record.names, ['初音未来', 'miku', '初音'], '与 tag 同名的别名不收，其余去重保序')
  assert.equal(record.note, '说明')
})

test('rowToRecord：中文名为空时不占位', () => {
  const record = rowToRecord({ tag: 'solo', category: 0, aliases: '', zh: '', count: 1, notes: '' }, 'general')
  assert.deepEqual(record.names, [])
  assert.equal(record.note, undefined, '空注释不该写字段')
})

test('四类路径用显式表，不是 ${kind}s', () => {
  assert.deepEqual([...TAG_KINDS], ['character', 'artist', 'copyright', 'general'])
  const dir = tmpDataDir()
  assert.equal(path.basename(ownStorePath(dir, 'character')), 'characters.jsonl')
  assert.equal(path.basename(ownStorePath(dir, 'artist')), 'artists.jsonl')
  assert.equal(path.basename(ownStorePath(dir, 'copyright')), 'copyrights.jsonl')
  assert.equal(path.basename(ownStorePath(dir, 'general')), 'general.jsonl', 'general 不该变成 generals')
  for (const kind of TAG_KINDS) assert.ok(UPSTREAM_FILES[kind].endsWith('.csv'), `${kind} 要有上游文件`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('category 映射：0/1/3/4 各归其位，2 与 5 不导入', () => {
  assert.equal(KIND_OF_CATEGORY[0], 'general')
  assert.equal(KIND_OF_CATEGORY[1], 'artist')
  assert.equal(KIND_OF_CATEGORY[3], 'copyright')
  assert.equal(KIND_OF_CATEGORY[4], 'character')
  assert.equal(KIND_OF_CATEGORY[2], undefined)
  assert.equal(KIND_OF_CATEGORY[5], undefined)
})

test('storePath：用户目录没有就回退到随包数据', () => {
  const dir = tmpDataDir()
  const fallback = storePath(dir, 'character')
  assert.equal(path.basename(fallback), 'characters.jsonl')
  // 随包数据存在，所以应当指向包内那份（不是空目录里的不存在的路径）
  assert.equal(fs.existsSync(fallback), true, `回退路径该存在：${fallback}`)
  assert.ok(fallback.startsWith(bundledDir()) || fs.existsSync(path.join(dir, 'danbooru')), '回退要么指向包内、要么用户目录已有')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('importUpstream：不联网跑通（注入 fetch），落盘且按类别过滤', async () => {
  const dir = tmpDataDir()
  const csv = [
    'tag,category,aliases,zh,count,notes',
    'long_hair,0,长髪,长发,6134076,从肩长到腰长的头发',
    'should_not_enter,4,,,10,类别不匹配要被跳过',
    'solo,0,,单人,6984063,',
    'broken row',
  ].join('\n')

  const result = await importUpstream('general', {
    dataDir: dir,
    fetchImpl: async () => new Response(csv, { status: 200 }),
  })

  assert.equal(result.records, 2, '只收 category=0 的两条')
  assert.equal(result.skipped, 1, '坏行要计数，不能静默丢')
  assert.equal(result.kind, 'general')

  const records = readStore(ownStorePath(dir, 'general'))
  assert.deepEqual(records.map(r => r.tag), ['long_hair', 'solo'])
  assert.equal(records[0].names[0], '长发')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('importUpstream：dataDir 指到随包目录时被护栏拒绝（不覆盖随包数据）', async () => {
  // 这条对应文件头第三项承诺。护栏在 writeStore 里，但要确认 importUpstream 这条路
  // 真的会把 dataDir 拼到随包目录并被拦下 —— 否则一次误配就能把 20 MB 随包库写没。
  const bundledParent = path.dirname(bundledDir())
  await assert.rejects(
    () => importUpstream('general', {
      dataDir: bundledParent,
      fetchImpl: async () => new Response(['tag,category,aliases,zh,count,notes', 'x,0,,,1,'].join('\n'), { status: 200 }),
    }),
    /拒绝写入随包数据目录/,
  )
})

test('importUpstream：表头不对直接报错，不写坏数据', async () => {
  const dir = tmpDataDir()
  await assert.rejects(
    () => importUpstream('general', {
      dataDir: dir,
      fetchImpl: async () => new Response('wrong,header\n1,2', { status: 200 }),
    }),
    /表头不符合预期/,
  )
  assert.equal(fs.existsSync(ownStorePath(dir, 'general')), false, '失败不该留下文件')
  fs.rmSync(dir, { recursive: true, force: true })
})
