/**
 * 参考面板的数据源：Danbooru 的 posts。
 *
 * 只测解析（不联网）：真实的 `posts.json` 一条里有很多字段，面板只要图与 tag 串，
 * 这里把「什么算一条可用参考」钉住。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toRef } from '../lib/index.js'

/** 一份贴近真实的 post。 */
const SAMPLE = {
  id: 12506850,
  rating: 'g',
  score: 42,
  image_width: 2050,
  image_height: 2894,
  preview_file_url: 'https://cdn.donmai.us/180x180/ab/cd/abcdef.jpg',
  large_file_url: 'https://cdn.donmai.us/sample/ab/cd/sample-abcdef.jpg',
  file_url: 'https://cdn.donmai.us/original/ab/cd/abcdef.png',
  tag_string: '1girl solo blue_eyes smile',
  tag_string_general: '1girl solo blue_eyes smile',
  tag_string_character: 'ganyu_(genshin_impact)',
  tag_string_copyright: 'genshin_impact',
  tag_string_artist: 'wlop',
}

test('toRef：图 + tag 串 + 分类 tag 都要拿出来', () => {
  const ref = toRef(SAMPLE)
  assert.ok(ref !== undefined)
  assert.equal(ref.id, 12506850)
  assert.equal(ref.rating, 'g')
  assert.equal(ref.previewUrl, SAMPLE.preview_file_url)
  assert.equal(ref.largeUrl, SAMPLE.large_file_url)
  assert.equal(ref.prompt, '1girl solo blue_eyes smile', 'tag_string 就是可直接用的提示词')
  assert.deepEqual(ref.tags.general, ['1girl', 'solo', 'blue_eyes', 'smile'])
  assert.deepEqual(ref.tags.character, ['ganyu_(genshin_impact)'])
  assert.deepEqual(ref.tags.copyright, ['genshin_impact'])
  assert.deepEqual(ref.tags.artist, ['wlop'])
})

test('toRef：没有图或没有 tag 的不算参考（返回 undefined）', () => {
  assert.equal(toRef({ ...SAMPLE, preview_file_url: '' }), undefined, '没图就不该进列表')
  assert.equal(toRef({ ...SAMPLE, tag_string: '   ' }), undefined, '没 tag 就没提示词可抄')
  assert.equal(toRef(null), undefined)
  assert.equal(toRef('nope'), undefined)
})

test('toRef：大图缺失时退到 preview（不能给出空 href）', () => {
  const ref = toRef({ ...SAMPLE, large_file_url: '', file_url: '' })
  assert.ok(ref !== undefined)
  assert.equal(ref.largeUrl, SAMPLE.preview_file_url, 'largeUrl 空时要退到 preview，否则点开是坏链接')
  assert.equal(ref.fileUrl, SAMPLE.preview_file_url)
})
