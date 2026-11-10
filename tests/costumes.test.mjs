/**
 * 衣装库：目录索引、图代理（webp + `costume/` 子目录）、工具。
 *
 * 与姿势库共用同一个取图实现，但白名单不同 —— 这里重点测三件事：
 * 1. 1407 套 / 8 类 / 成人向 393 与随包目录一致
 * 2. 默认全给（不做内容筛选），`onlySafe` 才收窄
 * 3. **webp 与 `costume/` 路径**能被代理接受，而姿势库那条白名单不接受它们（反之亦然）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { bundledCostumePath, costumeTool, createCostumesIndex, createImageCache, createPoseImages } from '../lib/index.js'
// **白名单从生产代码导入，不在这里抄一份**：抄一份等于给闸门配一把假钥匙 ——
// 生产那份被放宽成 `^(thumbs|img)\/.+$` 时，抄出来的测试照样全绿。
import { COSTUME_PATH } from '../lib/entries/costumes.js'

const ORIGIN = 'https://example.invalid'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-costumes-'))
}

/** 最小合法 webp（RIFF....WEBP 头，后面补到 32 字节以上）。 */
function tinyWebp(size = 64) {
  const buffer = Buffer.alloc(size)
  buffer.write('RIFF', 0, 'ascii')
  buffer.write('WEBP', 8, 'ascii')
  return buffer
}

const BUNDLED = bundledCostumePath(new URL('../lib/index.js', import.meta.url).href)

test('随包目录：1407 套 / 8 类 / 成人向 393，且每条都有英文关键词', () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  const stats = index.stats()
  assert.equal(stats.total, 1407)
  assert.equal(stats.adultCount, 393)
  assert.equal(stats.safeCount, 1014)
  assert.deepEqual(Object.keys(stats.categories), ['春季穿搭', '夏季穿搭', '秋季穿搭', '冬季穿搭', '内衣・睡衣', '性感穿搭', '泳装・度假', '派对・礼服'])
  assert.deepEqual(Object.values(stats.categories), [215, 254, 244, 253, 199, 140, 54, 48])
  const { items } = index.search({ limit: 100 })
  assert.ok(items.every(item => typeof item.keywords === 'string' && item.keywords.trim() !== ''), '英文关键词是这套数据的核心，不能有空')
})

test('默认全给，onlySafe 才收窄', () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  assert.equal(index.search({ limit: 100 }).total, 1407, '默认不藏任何一套')
  const safe = index.search({ onlySafe: true, limit: 100 })
  assert.equal(safe.total, 1014)
  assert.ok(safe.items.every(item => item.adult === false))
  // 内衣分类默认可见（不做内容决定）
  assert.equal(index.search({ category: '内衣・睡衣' }).total, 199)
  assert.equal(index.search({ category: '内衣・睡衣', onlySafe: true }).total, 0)
})

test('搜索：中文描述、标签、英文关键词都能命中', () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  const byName = index.search({ query: '牛仔' })
  assert.ok(byName.total > 0, '中文描述该能搜')
  const byKeyword = index.search({ query: 'denim' })
  assert.ok(byKeyword.total > 0, '英文关键词该能搜')
  const byCode = index.search({ query: 'SPR-0001' })
  assert.equal(byCode.total, 1)
  assert.equal(byCode.items[0].id, 'SPR-0001')
  // 多词 AND
  const both = index.search({ query: 'denim skirt' })
  assert.ok(both.total > 0)
  assert.ok(both.items.every(item => `${item.keywords} ${item.name}`.toLowerCase().includes('denim')))
  assert.equal(index.search({ query: '绝不可能存在的衣装' }).total, 0)
})

test('分页：offset 与 limit 生效，且不重不漏', () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  const first = index.search({ limit: 10 })
  const second = index.search({ limit: 10, offset: 10 })
  assert.equal(first.items.length, 10)
  assert.equal(second.items.length, 10)
  const overlap = first.items.filter(item => second.items.some(other => other.id === item.id))
  assert.deepEqual(overlap, [], '两页不该有重复')
})

test('取图白名单：服装与姿势是两条，互不接受对方的形状', async () => {
  const fetchImpl = async () => new Response(tinyWebp(), { status: 200 })
  const costume = createImageCache({ cacheDir: tempDir(), origin: ORIGIN, pathPattern: COSTUME_PATH, fetchImpl })
  const pose = createPoseImages({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl })

  // 服装该接受自己的形状
  const ok = await costume.fetch('thumbs/costume/SPR-0001.webp')
  assert.equal(ok.mediaType, 'image/webp')

  // 服装的白名单不该接受姿势的形状
  await assert.rejects(() => costume.fetch('thumbs/full_single_P001_front.jpg'), /路径无效/)
  // 姿势的白名单不该接受服装的形状（多一层目录 + webp）
  await assert.rejects(() => pose.fetch('thumbs/costume/SPR-0001.webp'), /路径无效/)
  // 穿越与任意地址两边都拒
  await assert.rejects(() => costume.fetch('costume/../secret.webp'), /路径无效/)
  await assert.rejects(() => costume.fetch('https://evil.example/a.webp'), /路径无效/)
})

test('webp 被识别成 image/webp，非图内容被拒', async () => {
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => new Response(tinyWebp(), { status: 200 }),
  })
  assert.equal((await images.fetch('img/costume/SUM-0012.webp')).mediaType, 'image/webp')

  const notImage = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => new Response(Buffer.from(`<html>${'x'.repeat(80)}</html>`), { status: 200 }),
  })
  await assert.rejects(() => notImage.fetch('img/costume/SUM-0012.webp'), /不是 PNG\/JPEG\/WebP/)
})

test('磁盘上限与统计对两级目录生效（写死一级目录会双双失效）', async () => {
  const cacheDir = tempDir()
  const images = createImageCache({
    cacheDir,
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    cacheSubdirs: ['thumbs/costume', 'img/costume'],
    diskLimitBytes: 8 * 1024,
    fetchImpl: async () => new Response(tinyWebp(2048), { status: 200 }),
  })
  for (let i = 0; i < 10; i += 1) {
    await images.fetch(`thumbs/costume/SPR-10${i}.webp`)
  }
  // 清理是写入后 setImmediate 跑的，等一拍
  await new Promise(resolve => setTimeout(resolve, 80))
  const stats = images.stats()
  assert.ok(stats.diskFiles > 0, '统计必须看得见两级目录里的文件（写死 thumbs/img 时这里是 0）')
  assert.ok(stats.diskBytes <= 8 * 1024, `磁盘占用该压到上限以内，实际 ${stats.diskBytes} 字节`)
})

test('工具：搜索校验分类并给出可用分类，空结果区分"没有"与"被筛掉"', async () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => new Response(tinyWebp(), { status: 200 }),
  })
  const tool = costumeTool({ index, images, uploadsDir: () => tempDir() })

  const bad = await tool.execute({ category: '不存在的分类' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /category 只能是/)

  const none = await tool.execute({ query: '绝不可能存在的衣装' })
  assert.equal(none.ok, true)
  assert.equal(none.costumes.length, 0)
  assert.match(none.note, /换个词/)

  const filtered = await tool.execute({ category: '内衣・睡衣', onlySafe: true })
  assert.equal(filtered.costumes.length, 0)
  assert.match(filtered.note, /过滤掉/)

  const hit = await tool.execute({ query: '牛仔' })
  assert.equal(hit.ok, true)
  assert.ok(hit.costumes.length > 0)
  assert.ok(typeof hit.costumes[0].keywords === 'string', '搜索结果必须带关键词，模型要靠它写提示词')
})

test('工具：fetch 落盘并回关键词，找不到编号时指向 search', async () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  let hits = 0
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => {
      hits += 1
      return new Response(tinyWebp(), { status: 200 })
    },
  })
  const tool = costumeTool({ index, images, uploadsDir: () => tempDir() })

  const missing = await tool.execute({ id: 'NO-SUCH-0001' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /不带 id 搜一下/)
  assert.equal(hits, 0, '找不到编号时不该打网络')

  const ok = await tool.execute({ id: 'SPR-0001', size: 'thumb' })
  assert.equal(ok.ok, true)
  assert.ok(fs.existsSync(ok.file))
  assert.ok(typeof ok.costume.keywords === 'string' && ok.costume.keywords !== '')
  assert.equal(hits, 1)
})

test('工具返回不带 undefined：非成人向服装必须能无损 JSON 往返', async () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => new Response(tinyWebp(), { status: 200 }),
  })
  const tool = costumeTool({ index, images, uploadsDir: () => tempDir() })

  const result = await tool.execute({ query: '针织', limit: 3 })
  assert.equal(result.ok, true)
  assert.ok(result.costumes.length > 0)
  // 同姿势库：工具返回值里出现 undefined 会被宿主的「无损 JSON」校验整次拒掉。
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  // 同姿势库：字段必须是布尔，不能是 undefined
  for (const item of result.costumes) assert.equal(typeof item.adult, 'boolean')
})

test('工具：给 id 是取图、不给 id 是搜索（与姿势库同构，mode 自证）', async () => {
  const index = createCostumesIndex(tempDir(), BUNDLED)
  let hits = 0
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: COSTUME_PATH,
    fetchImpl: async () => {
      hits += 1
      return new Response(tinyWebp(), { status: 200 })
    },
  })
  const tool = costumeTool({ index, images, uploadsDir: () => tempDir() })

  // 不给 id：纯搜索，不碰网络，也不该返回 file
  const searched = await tool.execute({ limit: 2 })
  assert.equal(searched.mode, 'search')
  assert.equal(searched.file, undefined, '搜索不该带回文件路径')
  assert.equal(hits, 0, '搜索不该打网络')

  // 给了 id：取图，即使同时带了搜索参数也以 id 为准
  const item = index.search({ limit: 1 }).items[0]
  const fetched = await tool.execute({ id: item.id, query: '这个参数该被忽略', size: 'thumb' })
  assert.equal(fetched.mode, 'fetch')
  assert.equal(fetched.costumes, undefined, '取图不该返回结果列表')
  assert.ok(fs.existsSync(fetched.file), '该落盘并回绝对路径')
  // 取图返回里必须同时带 keywords 与 tags —— 合并两个工具时这两组词是唯一容易丢的字段
  assert.ok(typeof fetched.costume.keywords === 'string' && fetched.costume.keywords !== '')
  assert.ok(Array.isArray(fetched.costume.tags), 'tags 不能丢（HEAD 就是 slice(0, 8)）')
  assert.ok(fetched.costume.tags.length <= 8)
  assert.equal(hits, 1)
})