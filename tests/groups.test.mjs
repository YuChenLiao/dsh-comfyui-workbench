/**
 * Danbooru 的 tag 分组（语义分类）：解析、大类映射、以及它在工具里真的生效。
 *
 * 分组来自 wiki（`tag_groups` 索引页 + 88~91 个子页面），不是 API —— 所以解析要
 * 对付 DText 的三种写法（空格名、别名对、带管道的链接），还要排掉跨组引用。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  categoryOf,
  createTagCache,
  danbooruLookupTool,
  groupsPath,
  normalizeTag,
  parseGroupIndex,
  parseGroupPage,
  readCategoryMap,
  readGroups,
  syncGroups,
} from '../lib/index.js'

function emptyDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-groups-'))
}

test('parseGroupIndex：取出组名、去重、不分层级', () => {
  const body = [
    '[expand=Table of Contents]',
    '* 1. "Intro":#dtext-intro',
    '* [[Tag group:Artistic license]]',
    '** [[Tag group:Backgrounds]]',
    '* [[Tag group:Posture]]',
    '* [[Tag group:Posture|姿势]]',
    '* [[Tag group:Posture]]',
    '[/expand]',
  ].join('\n')
  assert.deepEqual(parseGroupIndex(body), ['Tag group:Artistic license', 'Tag group:Backgrounds', 'Tag group:Posture'])
})

test('parseGroupPage：空格名归一、别名对拆开、跨组引用排掉', () => {
  const body = [
    '[See [[tag groups]].]',
    '* [[Arm behind back]] / [[Arms behind back]]',
    '** See [[tag group:gestures]] for various gestures',
    '* [[Victory pose]]',
    '* [[Ponytail|ponytail_tag]]',
    '* [[^_^]]',
    '* [[6+girls]]',
    '* [[\u3000]]',
  ].join('\n')
  const tags = parseGroupPage(body)
  assert.ok(tags.includes('arm_behind_back'), `实际 ${JSON.stringify(tags)}`)
  assert.ok(tags.includes('arms_behind_back'), '别名对的两个都要收')
  assert.ok(tags.includes('victory_pose'))
  assert.ok(tags.includes('ponytail'), '带管道时取左边显示名')
  assert.ok(!tags.includes('tag_groups'), '导航链接不是成员')
  assert.ok(!tags.some(tag => tag.startsWith('tag_group')), '跨组引用不是成员')
  // 早期白名单只留 `[a-z0-9_\-().]`，把 `^_^`（15.5 万帖）、`>_<`、`6+girls` 全剔了，
  // 同一页里 `._.`、`0_0` 却进得来 —— 那是白名单在造数据缺口，不是"剔噪"。
  assert.ok(tags.includes('^_^'), '表情类 tag 是真实存在的，不能丢')
  assert.ok(tags.includes('6+girls'), '`+` 是合法字符')
  assert.equal(new Set(tags).size, tags.length, '不该有重复')
})

test('normalizeTag：空格与下划线等价、大小写归一、结构性字符才丢', () => {
  assert.equal(normalizeTag('Arm behind back'), 'arm_behind_back')
  assert.equal(normalizeTag('  LONG_hair  '), 'long_hair')
  assert.equal(normalizeTag('ganyu_(genshin_impact)'), 'ganyu_(genshin_impact)', '括号是合法字符')
  assert.equal(normalizeTag('^_^'), '^_^', '表情 tag 要留下')
  assert.equal(normalizeTag('>_<'), '>_<')
  assert.equal(normalizeTag('6+girls'), '6+girls')
  assert.equal(normalizeTag("so_moe_i'm_gonna_die!"), "so_moe_i'm_gonna_die!")
  // 真正该丢的：DText 结构字符与纯空白
  assert.equal(normalizeTag('[see]'), '')
  assert.equal(normalizeTag('a|b'), '')
  assert.equal(normalizeTag('\u3000'), '')
})

test('分组数据与映射表都在随包里，且映射覆盖每一个组', () => {
  const groups = readGroups()
  assert.ok(groups.size > 10_000, `随包分组表该有上万条，实际 ${groups.size}`)
  const map = readCategoryMap()
  const mapped = Object.keys(map.groups)
  assert.ok(mapped.length >= 90, `映射表该覆盖 90+ 组，实际 ${mapped.length}`)

  const seen = new Set()
  for (const list of groups.values()) for (const group of list) seen.add(group)
  const missing = [...seen].filter(group => map.groups[group] === undefined)
  assert.deepEqual(missing, [], `这些组没有映射，会落 other：${missing.join(' / ')}`)

  // 六个核心大类都要有中文名
  for (const key of ['action', 'clothing', 'appearance', 'composition', 'object', 'theme', 'explicit', 'other']) {
    assert.equal(typeof map.labels[key], 'string', `${key} 缺中文名`)
  }
})

test('categoryOf：多组时按 priority 裁决，映射不到落 other', () => {
  const map = {
    labels: { clothing: '服装', explicit: '性相关', other: '其它' },
    groups: { Attire: 'clothing', 'Sex acts': 'explicit' },
    priority: ['explicit', 'clothing'],
  }
  assert.equal(categoryOf(['Attire'], map), 'clothing')
  assert.equal(categoryOf(['Unknown group', 'Attire'], map), 'clothing', '无关组该被跳过')
  // 关键：组名在数据里是字母序（Attire < Sex acts），照字母序会把 ahegao 归成服装
  assert.equal(categoryOf(['Attire', 'Sex acts'], map), 'explicit', 'prioritize explicit')
  assert.equal(categoryOf(['Unknown group'], map), 'other')
  assert.equal(categoryOf([], map), 'other')

  // 没有 priority 时退回缺省顺序，同样不该按字母序
  const bare = { labels: {}, groups: { 'Face tags': 'appearance', 'Sex acts': 'explicit' }, priority: [] }
  assert.equal(categoryOf(['Face tags', 'Sex acts'], bare), 'explicit', '缺省优先级里 explicit 在最前')
})

test('随包数据里 ahegao 这类跨组 tag 归 explicit，不是外貌', () => {
  const groups = readGroups()
  const map = readCategoryMap()
  // 这几个是审查实测出来的"字母序误判"样本
  for (const [tag, expected] of [['ahegao', 'explicit'], ['cum_in_mouth', 'explicit'], ['cooperative_footjob', 'explicit']]) {
    const list = groups.get(tag)
    if (list === undefined) continue // 数据更新后可能不在，跳过而不是假红
    assert.equal(categoryOf(list, map), expected, `${tag} 属于 ${JSON.stringify(list)}，该归 ${expected}`)
  }
})

test('随包数据里 swimsuit / bikini / bustier 仍归服装（explicit 不能抢走它们）', () => {
  const groups = readGroups()
  const map = readCategoryMap()
  // 这些 tag 同时属于 Attire（clothing）与 Breasts tags/Nudity/Sexual attire。
  // 把身体部位类映射成 explicit 时，explicit 排第一就会把它们从服装里抢走 ——
  // 所以 Breasts tags / Nudity / Ass / Pussy 归 appearance，不是 explicit。
  for (const tag of ['swimsuit', 'bikini', 'panties', 'bustier', 'corset', 'bra', 'sleeveless']) {
    const list = groups.get(tag)
    if (list === undefined) continue
    assert.equal(categoryOf(list, map), 'clothing', `${tag} 属于 ${JSON.stringify(list)}，该归 clothing`)
  }
})

test('limit 很小的时候也不能造出假筛空', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  // limit=1 时若先按 limit 截断再筛，`long` 的头号候选不是服装 → 会误报"没有匹配"
  const one = await tool.execute({ query: 'long', kind: 'general', category: 'clothing', limit: 1 })
  assert.equal(one.ok, true, `limit=1 不该假空：${JSON.stringify(one)}`)
  assert.equal(one.tags.length, 1, '筛完仍要按 limit 截断')
  const more = await tool.execute({ query: 'long', kind: 'general', category: 'clothing', limit: 3 })
  assert.equal(more.ok, true, JSON.stringify(more))
  assert.ok(more.tags.length >= 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('非法的 category 直接报错并列出合法值（不能当成合法类名回显）', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const bad = await tool.execute({ query: 'skirt', category: 'clothingx' })
  assert.equal(bad.ok, false)
  assert.match(String(bad.error), /clothing/, '要列出合法值')
  assert.match(String(bad.error), /clothingx/, '要回显收到的值')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('带 category 时不走在线兜底（在线结果没有分组维度）', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  // 本地一定没有这个乱码词；带 category 时不该去问网络
  const result = await tool.execute({ query: 'zzzz_not_a_real_tag_zzzz', category: 'clothing' })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /在线|分组/, `要说清为什么不去在线：${result.error}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('kind 限定到角色时带 category，文案要点明"这几类本身没有分类"', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const result = await tool.execute({ query: '初音', kind: 'character', category: 'clothing' })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /通用|general/, '不能把原因归到"分类覆盖不全"')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('syncGroups：注入 fetch 跑通幂等、全失败保留旧快照、部分失败从旧快照补回', async () => {
  const dir = emptyDataDir()
  const indexBody = '* [[Tag group:Attire]]\n* [[Tag group:Posture]]'

  /** 造一个响应。 */
  const page = body => new Response(JSON.stringify([{ body }]), { status: 200 })
  const fetchFor = pages => async (url) => {
    const title = decodeURIComponent(String(url).split('title%5D=')[1] ?? '')
    if (title === 'tag_groups') return page(indexBody)
    const body = pages[title]
    if (body === undefined) return new Response('', { status: 500 })
    return page(body)
  }

  // 1) 正常：两组都抓到
  const ok = await syncGroups({
    dataDir: dir,
    delayMs: 0,
    fetchImpl: fetchFor({ 'Tag group:Attire': '* [[Shirt]]\n* [[Skirt]]', 'Tag group:Posture': '* [[Sitting]]' }),
  })
  assert.equal(ok.fromCache, false)
  assert.equal(ok.tags, 3, `实际 ${JSON.stringify(ok)}`)
  const first = readGroups(dir)
  assert.deepEqual(first.get('shirt'), ['Attire'])

  // 2) 部分失败：Posture 抓不到 → 从旧快照补回 sitting
  const partial = await syncGroups({
    dataDir: dir,
    delayMs: 0,
    fetchImpl: fetchFor({ 'Tag group:Attire': '* [[Shirt]]\n* [[Dress]]' }),
  })
  assert.deepEqual(partial.failed, ['Posture'], `实际 ${JSON.stringify(partial.failed)}`)
  const afterPartial = readGroups(dir)
  assert.deepEqual(afterPartial.get('dress'), ['Attire'], '新抓到的要写进去')
  assert.deepEqual(afterPartial.get('sitting'), ['Posture'], '失败组要从旧快照补回，不能凭空消失')
  assert.equal(afterPartial.has('skirt'), false, '这一组抓到了就应该以新数据为准')

  // 3) 全失败：不写盘，fromCache 为真
  const snapshot = fs.readFileSync(groupsPath(dir), 'utf8')
  const allFailed = await syncGroups({
    dataDir: dir,
    delayMs: 0,
    fetchImpl: async url => (String(url).includes('tag_groups') ? page(indexBody) : new Response('', { status: 500 })),
  })
  assert.equal(allFailed.fromCache, true)
  assert.equal(fs.readFileSync(groupsPath(dir), 'utf8'), snapshot, '全失败时不该动旧快照')

  // 4) 护栏：往随包目录写要显式允许
  await assert.rejects(
    () => syncGroups({ dataDir: path.dirname(path.dirname(groupsPath())), delayMs: 0, fetchImpl: fetchFor({}) }),
    /拒绝写入随包数据目录/,
  )

  fs.rmSync(dir, { recursive: true, force: true })
})

test('danbooru_lookup 的 category 参数真的在筛（不是摆设）', async () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })

  const action = await tool.execute({ query: 'sitting', category: 'action' })
  assert.equal(action.ok, true, JSON.stringify(action))
  assert.ok(action.tags.includes('sitting'), `实际 ${JSON.stringify(action.tags)}`)
  assert.equal(action.source, 'local', '筛完仍该是本地来源')

  const clothing = await tool.execute({ query: 'skirt', category: 'clothing' })
  assert.equal(clothing.ok, true, JSON.stringify(clothing))
  assert.ok(clothing.tags.includes('skirt'))

  // 反向：sitting 不是服装。筛空要说清是"被筛掉的"，不能掉进"没找到"或走在线
  const mismatch = await tool.execute({ query: 'sitting', category: 'clothing' })
  assert.equal(mismatch.ok, false, '筛空时不该返回 ok')
  assert.match(String(mismatch.error), /服装/, `要说清是哪个类：${mismatch.error}`)
  assert.match(String(mismatch.error), /去掉 category/, '要给出下一步怎么做')

  fs.rmSync(dir, { recursive: true, force: true })
})

test('category 的枚举里有全部八类，且描述里带中文对照', () => {
  const dir = emptyDataDir()
  const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
  const spec = tool.parameters.properties.category
  for (const key of ['action', 'clothing', 'appearance', 'composition', 'object', 'theme', 'explicit', 'other']) {
    assert.ok(spec.enum.includes(key), `enum 缺 ${key}：${JSON.stringify(spec.enum)}`)
  }
  assert.match(String(spec.description), /动作/, '描述里要有中文对照，模型才好选')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('groupsPath：随包与运行时是两个位置', () => {
  const dir = emptyDataDir()
  assert.ok(groupsPath().endsWith(path.join('data', 'danbooru', 'groups.jsonl')))
  assert.equal(path.basename(groupsPath(dir)), 'groups.jsonl')
  assert.ok(groupsPath(dir).startsWith(dir), '传了 dataDir 就该落在那里')
  fs.rmSync(dir, { recursive: true, force: true })
})
