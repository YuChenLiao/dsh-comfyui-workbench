/**
 * 织装库的**两个画风版本**：写实版（1407 套实拍风）与动画版（1320 套二次元风）。
 *
 * 这组用例钉四件事：
 * 1. `source` 分派正确 —— 两库同 id 格式（`SPR-xxxx`），混了就会查错库
 * 2. 两库的词表**不完全一样**（动画版说「缎带」「吊带背心」「牛仔布」，写实版说「蝴蝶结」「吊带衫」「牛仔」）
 * 3. 两条白名单**互斥** —— 动画版的 png 不该被写实版接受，反之亦然
 * 4. 落盘目录分开 —— 否则两库同号图会互相覆盖
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { COSTUME_ANIME_PATH, COSTUME_PATH, bundledCostumePath, costumeTool, createCostumesIndex } from '../lib/index.js'

/** 路径都从包根推导，不写死盘符（换机器/CI 也要能跑）。 */
const LIB_URL = new URL('../lib/index.js', import.meta.url).href
const REAL = bundledCostumePath(LIB_URL, 'real')
const ANIME = bundledCostumePath(LIB_URL, 'anime')

function fakeImages() {
  return {
    async materialize() { return { file: '/tmp/x.webp', mediaType: 'image/webp' } },
    async fetch() { return Buffer.alloc(0) },
    stats() { return { files: 0, bytes: 0 } },
  }
}

function deps(options = {}) {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cust-'))
  const images = fakeImages()
  const uploads = os.tmpdir()
  return {
    index: createCostumesIndex(tmp(), REAL, 'real'),
    images,
    uploadsDir: () => uploads,
    ...(options.withAnime === false
      ? {}
      : {
        anime: {
          index: createCostumesIndex(tmp(), ANIME, 'anime'),
          images: fakeImages(),
          // 动画版落 uploads/anime 子目录
          uploadsDir: () => path.join(uploads, 'anime'),
        },
      }),
  }
}

test('两库分开索引：总数、分类名、词表都不同', () => {
  const real = createCostumesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'r-')), REAL, 'real')
  const anime = createCostumesIndex(fs.mkdtempSync(path.join(os.tmpdir(), 'a-')), ANIME, 'anime')

  assert.equal(real.stats().total, 1407)
  assert.equal(anime.stats().total, 1320, '动画版应当 1320 套')
  assert.ok('春季穿搭' in real.stats().categories)
  assert.ok('春装' in anime.stats().categories, '动画版的分类名短一截')
})

test('两条路径白名单互斥 —— 动画版的 png 不该被写实版接受', () => {
  const animeOnly = ['thumbs/SPR-0001.webp', 'img/SPR-0001.webp', 'png/SPR-0001.png']
  const realOnly = ['thumbs/costume/SPR-0001.webp', 'img/costume/SPR-0001.webp']

  for (const p of animeOnly) {
    assert.equal(COSTUME_ANIME_PATH.test(p), true, `动画版该接受 ${p}`)
    assert.equal(COSTUME_PATH.test(p), false, `写实版不该接受 ${p}`)
  }
  for (const p of realOnly) {
    assert.equal(COSTUME_PATH.test(p), true, `写实版该接受 ${p}`)
    assert.equal(COSTUME_ANIME_PATH.test(p), false, `动画版不该接受 ${p}`)
  }
  // 两边都该拒的：路径穿越、小写前缀
  for (const p of ['png/../img/costume/SPR-1.webp', 'png/spr-0001.png', 'thumbs/costume/../SPR-1.png']) {
    assert.equal(COSTUME_ANIME_PATH.test(p), false, `动画版不该接受 ${p}`)
  }
})

test('source 决定查哪个库 —— 同一个词命中数不同', async () => {
  const tool = costumeTool(deps())

  const real = await tool.execute({ query: '连衣裙', limit: 1 })
  const anime = await tool.execute({ query: '连衣裙', source: 'anime', limit: 1 })

  assert.equal(real.source, 'real')
  assert.equal(anime.source, 'anime')
  assert.equal(real.total, 393)
  assert.equal(anime.total, 377, '两库都收录了连衣裙，但套数不同')
})

test('不给 source 默认写实版', async () => {
  const result = await costumeTool(deps()).execute({ query: '针织', limit: 1 })
  assert.equal(result.source, 'real')
})

test('坏 source 明确报错，不静默落到写实版', async () => {
  const result = await costumeTool(deps()).execute({ query: '针织', source: 'nope' })
  assert.equal(result.ok, false)
  assert.match(result.error, /real/)
  assert.match(result.error, /anime/)
})

test('没接动画库时给出可读报错', async () => {
  const result = await costumeTool(deps({ withAnime: false })).execute({ query: '针织', source: 'anime' })
  assert.equal(result.ok, false)
  assert.match(result.error, /动画版/)
  assert.match(result.error, /costumes-anime/)
})

test('两库词表差异：动画版有「缎带」，写实版有「蝴蝶结」', async () => {
  const tool = costumeTool(deps())

  const ribbon = await tool.execute({ query: '缎带', source: 'anime', limit: 1 })
  assert.ok(ribbon.total > 0, '动画版应当能查到「缎带」')

  const bow = await tool.execute({ query: '蝴蝶结', limit: 1 })
  assert.ok(bow.total > 0, '写实版应当能查到「蝴蝶结」')

  // 反查：写实版没有「缎带」，动画版没有「蝴蝶结」
  // 注意可能走前缀回退（「缎带」→「缎」会撞上写实版的「缎面」），
  // 被实词判据拦下时返回 ok:false 且不带 total —— 两种都算"没查到"
  const ribbonReal = await tool.execute({ query: '缎带', limit: 1 })
  const bowAnime = await tool.execute({ query: '蝴蝶结', source: 'anime', limit: 1 })
  assert.equal(ribbonReal.total ?? 0, 0, '写实版没有「缎带」这个词')
  assert.equal(bowAnime.total ?? 0, 0, '动画版没有「蝴蝶结」这个词')
})

test('两库都不含风格/品类词（数据本身的限制，不是 bug）', async () => {
  const tool = costumeTool(deps())
  for (const word of ['水手服', '和服', '校服']) {
    const real = await tool.execute({ query: word, limit: 1 })
    const anime = await tool.execute({ query: word, source: 'anime', limit: 1 })
    assert.equal(real.total ?? 0, 0, `写实版不该命中「${word}」`)
    assert.equal(anime.total ?? 0, 0, `动画版也不该命中「${word}」—— 两库都没有风格这一层`)
  }
})

test('取图按 source 走各自的库 —— 用两库真实差异区分，不靠回显参数', async () => {
  const tool = costumeTool(deps())

  // 同一个 id（SPR-0001）在两库都存在，但内容不同：
  // 动画版说「牛仔布」，写实版说「牛仔」—— 这是能区分两库的硬事实。
  const anime = await tool.execute({ id: 'SPR-0001', source: 'anime', size: 'thumb' })
  const real = await tool.execute({ id: 'SPR-0001', size: 'thumb' })

  assert.equal(anime.ok, true, JSON.stringify(anime).slice(0, 200))
  assert.equal(real.ok, true)

  assert.match(anime.costume.name, /牛仔布/, '动画版的 name 应当来自动画版关键词')
  assert.doesNotMatch(real.costume.name, /牛仔布/, '写实版没有「牛仔布」这个译法')
  assert.match(real.costume.name, /牛仔/, '写实版用的是「牛仔」')
  // 动画版的 name 是关键词拼接（上游没有名称字段）
  assert.ok(anime.costume.name.includes('・'), '动画版的 name 由关键词拼成')
})
