/**
 * 列表去重：两段式判据。
 *
 * 事故背景：判据原来只用 `seed|尺寸|提示词前160字` 做签名。用户同一个固定 seed 跑了一组
 * 换装的图，seed 与提示词模板都没变 → 全部撞成同一个签名，被当成"同一张图的副本"合并。
 * 实测某个输出目录 **451 条被压成 244 条**，用户"最新的两张"直接消失。
 *
 * 现在的规则：
 * 1. 按 `looseKey`（seed / 尺寸 / **完整**提示词）聚类
 * 2. 簇内出现 ≥2 个不同 `promptId` 就按 promptId 拆开；否则整簇合并
 *
 * 两条断言方向都要有：既不能吞掉真图（用户报的就是这个），也不能把真重复留在列表里。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { dedupeItems, looseKey } from '../lib/index.js'

const LONG_TAIL = 'x'.repeat(400)
const base = {
  size: 1000,
  mtime: 1,
  root: 'D:\\out',
  hasMeta: true,
  metaSource: 'sidecar',
  seed: 20261115,
  width: 1312,
  height: 1744,
  prompt: '@kazutake_hazano, masterpiece, best quality',
}

test('同一次运行的两份副本合并（同 promptId）', () => {
  const out = dedupeItems([
    { ...base, path: 'D:\\out\\a.png', promptId: 'p-1' },
    { ...base, path: 'D:\\out\\b.png', promptId: 'p-1' },
  ])
  assert.equal(out.length, 1, '同一次运行的两份该合并')
  assert.equal(out[0].duplicateCount, 2)
})

test('同 seed 的多次运行：按 promptId 拆开，一张都不能少', () => {
  // 事故现场：固定 seed，换了服装
  const out = dedupeItems([
    { ...base, path: 'D:\\out\\airy.png', promptId: 'p-1' },
    { ...base, path: 'D:\\out\\maryjane.png', promptId: 'p-2' },
    { ...base, path: 'D:\\out\\shy.png', promptId: 'p-3' },
  ])
  assert.equal(out.length, 3, '三次不同的运行就是三张图')
  assert.deepEqual(out.map(item => item.duplicateCount), [undefined, undefined, undefined])
})

test('跨来源副本仍要合并：一份内嵌块没有 promptId，一份 sidecar 有', () => {
  // 这是原设计的主题（真实数据里 142 组），不能因为加判据就丢掉
  const out = dedupeItems([
    { ...base, path: 'D:\\out\\embedded.png', metaSource: 'embedded' },
    { ...base, path: 'D:\\out\\sidecar.png', promptId: 'p-1' },
  ])
  assert.equal(out.length, 1, '簇内只有一个 promptId → 整簇合并')
  assert.equal(out[0].path, 'D:\\out\\sidecar.png', 'sidecar 优先当主项')
  assert.deepEqual(out[0].duplicates, ['D:\\out\\embedded.png'])
})

test('簇要拆时，没有 promptId 的条目各自独立（不跟着别人一起消失）', () => {
  const out = dedupeItems([
    { ...base, path: 'D:\\out\\orphan.png', metaSource: 'embedded' },
    { ...base, path: 'D:\\out\\a.png', promptId: 'p-1' },
    { ...base, path: 'D:\\out\\b.png', promptId: 'p-2' },
  ])
  assert.equal(out.length, 3, '无主的条目不能塞进任何一组')
  assert.ok(out.some(item => item.path === 'D:\\out\\orphan.png'))
})

test('提示词不截断：只有前 160 字相同的图不再撞签名', () => {
  const head = 'masterpiece, best quality, ' + 'y'.repeat(140)
  const a = { ...base, path: 'D:\\out\\a.png', promptId: 'p-1', prompt: `${head}${LONG_TAIL}dress` }
  const b = { ...base, path: 'D:\\out\\b.png', promptId: 'p-2', prompt: `${head}${LONG_TAIL}jeans` }
  assert.notEqual(looseKey(a), looseKey(b), '完整串不同 → 签名必须不同')
  assert.equal(dedupeItems([a, b]).length, 2)
})

test('没有 seed 或没有提示词时不合并（宁多勿错）', () => {
  assert.equal(looseKey({ ...base, path: 'x', seed: undefined }), undefined)
  assert.equal(looseKey({ ...base, path: 'x', prompt: '   ' }), undefined)
  assert.equal(dedupeItems([
    { ...base, path: 'D:\\out\\a.png', seed: undefined },
    { ...base, path: 'D:\\out\\b.png', seed: undefined },
  ]).length, 2)
})

test('同一次运行产出多张不同图（batch / 双 SaveImage）：不同签名，不合并', () => {
  // 真实存在：同一个 promptId 下 depth 与 depthmap 两条产物
  const out = dedupeItems([
    { ...base, path: 'D:\\out\\depth.png', promptId: 'p-1', prompt: 'a' },
    { ...base, path: 'D:\\out\\depthmap.png', promptId: 'p-1', prompt: 'b' },
  ])
  assert.equal(out.length, 2, 'promptId 相同但签名不同，是两张图')
})
