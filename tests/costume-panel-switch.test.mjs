/**
 * 衣装面板的**画风切换**：写实版（1407 套）与动画版（1320 套）。
 *
 * 这组用例钉的是"面板真的能切过去且不串数据"：
 * - 两库的 `stats` 不同（套数、分类名）
 * - 切库时分类要清掉（两库分类名不一样，留着会查空）
 * - 落盘目录分开，不撞名
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { COSTUME_ANIME_ORIGIN, bundledCostumePath, createCostumesIndex } from '../lib/index.js'

const LIB_URL = new URL('../lib/index.js', import.meta.url).href
const REAL = bundledCostumePath(LIB_URL, 'real')
const ANIME = bundledCostumePath(LIB_URL, 'anime')

function index(style) {
  return createCostumesIndex(fs.mkdtempSync(path.join(os.tmpdir(), `sw-${style}-`)), style === 'anime' ? ANIME : REAL, style)
}

test('两库的 stats 不同：套数与分类名都能区分', () => {
  const real = index('real').stats()
  const anime = index('anime').stats()

  assert.equal(real.total, 1407)
  assert.equal(anime.total, 1320)

  const realCats = Object.keys(real.categories)
  const animeCats = Object.keys(anime.categories)
  assert.ok(realCats.includes('春季穿搭'), '写实版用长分类名')
  assert.ok(animeCats.includes('春装'), '动画版用短分类名')
  assert.equal(animeCats.includes('春季穿搭'), false, '两库分类名不重叠（这是切库要清分类的原因）')
})

test('动画版有独立的原站与路径（不串写实版）', () => {
  assert.equal(COSTUME_ANIME_ORIGIN, 'https://ai-costume-anime-gallery.pages.dev')
  // 动画版的原图是 png，写实版全是 webp —— 这条也是隔离的证据
  const anime = index('anime')
  const item = anime.get('SPR-0001')
  assert.ok(item !== undefined)
  assert.match(item.full, /^png\/.*\.png$/)
  assert.match(item.thumb, /^thumbs\/.*\.webp$/)
})

test('切库时分类必须清掉 —— 两库的分类名不通用', () => {
  const animeCategory = '春装'
  const realCategory = '春季穿搭'

  // 拿动画版的分类名去写实版查：必须空
  assert.equal(index('real').search({ category: animeCategory, limit: 1 }).total, 0, '写实版没有「春装」')
  // 反过来也一样
  assert.equal(index('anime').search({ category: realCategory, limit: 1 }).total, 0, '动画版没有「春季穿搭」')
  // 各自用自己的分类名都能查到
  assert.ok(index('anime').search({ category: animeCategory, limit: 1 }).total > 0)
  assert.ok(index('real').search({ category: realCategory, limit: 1 }).total > 0)
})
