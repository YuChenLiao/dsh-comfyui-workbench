import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  createTagCache,
  pruneSharedAliases,
  danbooruLookupTool,
  pickNames,
  readStore,
  searchOnline,
  searchTags,
  syncKind,
  storePath,
  worthKeeping,
  writeStore,
} from '../lib/index.js'

const record = (tag, kind, postCount, names) => ({ tag, kind, postCount, names, updatedAt: '2026-01-01T00:00:00.000Z' })

const SAMPLE = [
  record('hatsune_miku', 'character', 148305, ['初音未来', '初音ミク', 'miku']),
  record('ganyu_(genshin_impact)', 'character', 30000, ['甘雨', '甘雨(原神)']),
  record('hakurei_reimu', 'character', 102620, ['博丽灵梦', '霊夢']),
  record('dairi', 'artist', 18859, ['だいり']),
  record('wlop', 'artist', 9000, []),
]

test('别名过滤：只留含中日韩文字、且不是活动名的', () => {
  // 二创活动名（结尾带年份）与纯英文变体都该被丢掉，否则查询结果全是噪音
  assert.equal(worthKeeping('初音未来', 'hatsune_miku'), true)
  assert.equal(worthKeeping('hatsune_miku', 'hatsune_miku'), false, '与 tag 同名的不重复收录')
  assert.equal(worthKeeping('mikumonday', 'hatsune_miku'), false, '纯英文变体不收')
  assert.equal(worthKeeping('初音ミク誕生祭2014', 'hatsune_miku'), false, '活动名不收')
  assert.equal(worthKeeping('x'.repeat(30), 'tag'), false, '过长的名字不收')
  assert.equal(worthKeeping('  ', 'tag'), false)
})

test('pickNames：中文优先，但没有中文时保留日文名', () => {
  // 用户明确要求"没有中文名就用日文名替代"，所以假名不能一刀切砍掉。
  const picked = pickNames('hatsune_miku', ['初音ミク', '初音未来', '初音未來'])
  assert.equal(picked[0], '初音未来', '中文优先')
  assert.ok(picked.includes('初音ミク'), '日文原名也要留（没有中文时它就是替代）')
  const onlyJp = pickNames('sylveon', ['ニンフィア'])
  assert.deepEqual(onlyJp, ['ニンフィア'], '只有日文名时不该被清空')
})

test('pickNames 去重', () => {
  const picked = pickNames('hatsune_miku', ['初音未来', '初音未来', '初音未來', 'miku', ''])
  assert.deepEqual(picked, ['初音未来', '初音未來'], '重复的去掉，纯英文的丢掉')
})

test('按中文名查询命中', () => {
  const matches = searchTags(SAMPLE, '甘雨')
  assert.equal(matches.length >= 1, true)
  assert.equal(matches[0]?.record.tag, 'ganyu_(genshin_impact)')
  assert.equal(matches[0]?.how, 'exact')
})

test('按 Danbooru tag 查询命中', () => {
  const matches = searchTags(SAMPLE, 'hatsune_miku')
  assert.equal(matches[0]?.record.tag, 'hatsune_miku')
  assert.equal(matches[0]?.how, 'exact')
})

test('空格与下划线等价', () => {
  assert.equal(searchTags(SAMPLE, 'hatsune miku')[0]?.record.tag, 'hatsune_miku')
  assert.equal(searchTags(SAMPLE, 'hatsune miku')[0]?.how, 'exact')
})

test('分档顺序：精确 > 前缀 > 包含', () => {
  // 造三条同前缀但档位不同的记录，必须按档位排，不能只靠唯一命中"碰巧"过
  const pool = [
    record('hatsune_miku', 'character', 500, []),            // contains（不以 miku 开头）
    record('miku', 'character', 10, []),                     // exact（热度最低）
    record('miku_append', 'character', 900, []),             // prefix（热度最高）
  ]
  const byExact = searchTags(pool, 'miku')
  assert.deepEqual(byExact.map(m => m.how), ['exact', 'prefix', 'contains'], '档位顺序必须精确在前')
})

test('同档内按帖子数降序', () => {
  const pool = [
    record('alpha_low', 'character', 10, []),
    record('alpha_high', 'character', 900, []),
    record('alpha_mid', 'character', 300, []),
  ]
  const matches = searchTags(pool, 'alpha')
  assert.deepEqual(matches.map(m => m.record.tag), ['alpha_high', 'alpha_mid', 'alpha_low'], '同档应按热度排序')
})

test('共用别名只保留在热度最高的记录上', () => {
  // 两类共用：CP 名（分属不同角色）与同一角色的多个 tag。统一让热度最高的那条留着，
  // 这样每个别名最多对应一条结果 —— 查得到，又不会出现两个 exact。
  const records = [
    record('hakurei_reimu', 'character', 102620, ['博丽灵梦', 'レイマリ', '霊夢']),
    record('kirisame_marisa', 'character', 88740, ['雾雨魔理沙', 'レイマリ']),
    record('hatsune_miku', 'character', 148305, ['初音未来', '初音ミク']),
  ]
  const removed = pruneSharedAliases(records)
  assert.equal(removed, 1, '魔理沙那份被去掉')
  assert.deepEqual(records[0].names, ['博丽灵梦', 'レイマリ', '霊夢'], '热度更高的灵梦保留')
  assert.deepEqual(records[1].names, ['雾雨魔理沙'], '魔理沙不再挂 CP 名')
  assert.deepEqual(records[2].names, ['初音未来', '初音ミク'], '唯一的日文名不受影响')
})

test('同一角色的多个 tag 共用别名时不会被清空', () => {
  // `散兵` 同时挂在 scaramouche 的两个 tag 上：不该两边都删光
  const records = [
    record('scaramouche_(genshin_impact)', 'character', 9000, ['散兵', '国崩']),
    record('kabukimono', 'character', 300, ['散兵']),
  ]
  pruneSharedAliases(records)
  assert.deepEqual(records[0].names, ['散兵', '国崩'], '热度高的那条保留')
  assert.deepEqual(records[1].names, [], '低热度的那条让出别名')
})

test('空查询返回空结果', () => {
  assert.deepEqual(searchTags(SAMPLE, '   '), [])
})

test('JSONL 读写往返，坏行被跳过', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-'))
  const file = storePath(dir, 'character')
  try {
    writeStore(file, SAMPLE.filter(item => item.kind === 'character'))
    assert.equal(readStore(file).length, 3)
    // 追加半行（模拟同步中断），读的时候应当跳过而不是抛
    fs.appendFileSync(file, '{"tag":"broken"')
    assert.equal(readStore(file).length, 3)
    assert.equal(readStore(storePath(dir, 'artist')).length, 0, '不存在的文件返回空数组')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('库为空时走在线查询，不再要求先同步', async () => {
  // 用户明确要求"本地没数据也允许通过网络查"，所以空库不再是错误态。
  // 这里不强断言网络结果（CI 可能断网），只锁住"不再要求同步"这个行为变化。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-empty-'))
  try {
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const out = await tool.execute({ query: '甘雨' })
    if (out.ok) {
      assert.equal(out.source, 'online', '本地没有就该标成 online')
      assert.ok(Array.isArray(out.tags) && out.tags.length > 0)
    } else {
      assert.doesNotMatch(String(out.error), /同步/, '不该再让用户先去同步')
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('查询工具：中文与 tag 都能查，且能按 kind 分流', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-tool-'))
  try {
    writeStore(storePath(dir, 'character'), SAMPLE.filter(item => item.kind === 'character'))
    writeStore(storePath(dir, 'artist'), SAMPLE.filter(item => item.kind === 'artist'))
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })

    const byChinese = await tool.execute({ query: '博丽灵梦' })
    assert.equal(byChinese.ok, true)
    assert.deepEqual(byChinese.tags, ['hakurei_reimu'], '只返回 tag')
    assert.equal(byChinese.source, 'local')

    const byTag = await tool.execute({ query: 'wlop', kind: 'artist' })
    assert.deepEqual(byTag.tags, ['wlop'])

    const onlyArtist = await tool.execute({ query: 'a', kind: 'artist' })
    assert.ok(onlyArtist.tags.every(tag => ['dairi', 'wlop'].includes(tag)), `kind=artist 不该返回角色，实际：${JSON.stringify(onlyArtist.tags)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('查询工具：缓存失效后能读到新数据', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-cache-'))
  try {
    const cache = createTagCache(dir)
    const tool = danbooruLookupTool({ dataDir: dir, cache })
    // 空库时 source 是 online（或者断网时干脆失败），无论如何都不是 local
    const before = await tool.execute({ query: '甘雨' })
    assert.notEqual(before.source, 'local', '本地没数据不该标成 local')

    writeStore(storePath(dir, 'character'), SAMPLE.filter(item => item.kind === 'character'))
    cache.invalidate('character')
    const after = await tool.execute({ query: '甘雨' })
    assert.equal(after.ok, true)
    assert.equal(after.source, 'local', '写完并失效缓存后应当读本地')
    assert.deepEqual(after.tags, ['ganyu_(genshin_impact)'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})


test('查询结果只有 tag，不带冗余字段', async () => {
  // 上下文是稀缺资源：模型要的是"名字 → tag"，多给 postCount/names/matched 只是噪音
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-shape-'))
  try {
    writeStore(storePath(dir, 'artist'), [record('dairi', 'artist', 18859, [])])
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const out = await tool.execute({ query: 'dairi' })
    assert.deepEqual(Object.keys(out).sort(), ['ok', 'source', 'tags'])
    assert.deepEqual(out.tags, ['dairi'])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('查询工具：档位优先于热度', async () => {
  // 高热度但只是前缀命中的，不能盖过精确命中
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-rank-'))
  try {
    writeStore(storePath(dir, 'character'), [
      record('miku_nakano', 'character', 999999, []),
      record('miku', 'character', 5, []),
    ])
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const out = await tool.execute({ query: 'miku' })
    assert.equal(out.tags[0], 'miku', '精确命中必须排第一，哪怕热度低得多')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('在线查询：空查询直接返回空，不打网络', async () => {
  assert.deepEqual(await searchOnline('   ', 5), [])
})

test('在线查询：中文走别名反查、英文走 tag 模糊匹配（假 fetch 回放）', async () => {
  const originalFetch = globalThis.fetch
  const calls = []
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  globalThis.fetch = async input => {
    const url = String(input)
    calls.push(url)
    if (url.includes('other_names_match')) return jsonRes([{ title: 'ganyu_(genshin_impact)' }])
    if (url.includes('name_matches')) return jsonRes([{ name: 'black-haired_girl_(wlop)' }, { name: 'wlop' }])
    // 指定 kind 时中文分支会回查 tags 确认分类，这里要给出正确的 category
    if (url.includes('/tags.json')) return jsonRes([{ name: 'ganyu_(genshin_impact)', category: 4 }])
    return jsonRes([])
  }
  try {
    const cjk = await searchOnline('甘雨', 3, 'character')
    assert.deepEqual(cjk, ['ganyu_(genshin_impact)'], '中文走别名反查，只取第一条')
    assert.ok(calls.some(url => url.includes('other_names_match')))

    calls.length = 0
    const ascii = await searchOnline('wlop', 5)
    assert.equal(ascii[0], 'wlop', '精确同名必须排第一')
    assert.ok(calls.some(url => url.includes('name_matches')))
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('在线查询：网络故障时降级为空数组，不抛错', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('network down') }
  try {
    assert.deepEqual(await searchOnline('甘雨', 3), [], '断网时返回空而不是抛')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('同步会自动去掉共用别名（这条锁住 syncKind 里的 prune 调用）', async () => {
  // 没有这条用例时，把 syncKind 里的 pruneSharedAliases 调用删掉，全量测试依然全绿 ——
  // 而它正是"CP 名不再查出两个角色"的实现所在。用假 fetch 走完整同步流程，不碰网络。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-sync-'))
  const originalFetch = globalThis.fetch
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body })

  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('/tags.json')) {
      return jsonRes([
        { name: 'hakurei_reimu', post_count: 100 },
        { name: 'kirisame_marisa', post_count: 90 },
      ])
    }
    if (url.includes('/wiki_pages.json')) {
      const title = decodeURIComponent((url.match(/search\[title\]=([^&]+)/) ?? [])[1] ?? '')
      const own = title === 'hakurei_reimu' ? '博丽灵梦' : '雾雨魔理沙'
      // 两个角色都带 CP 名 `レイマリ`：落盘时必须只剩各自的名字
      return jsonRes([{ other_names: [own, 'レイマリ'] }])
    }
    return jsonRes([])
  }

  try {
    const records = await syncKind('character', {
      dataDir: dir, minPostCount: 0, pageSize: 1000, maxTags: 10, concurrency: 2,
    })
    assert.equal(records.length, 2)
    // 共用别名只保留在热度最高（灵梦 100 > 魔理沙 90）的那条上，另一条让出
    assert.deepEqual(records[0].names, ['博丽灵梦', 'レイマリ'], '热度高的保留共用别名')
    assert.deepEqual(records[1].names, ['雾雨魔理沙'], '热度低的让出，自己的名字还在')
    // 落盘的也得是处理之后的结果
    const onDisk = readStore(storePath(dir, 'character'))
    assert.deepEqual(onDisk.map(r => r.names), [['博丽灵梦', 'レイマリ'], ['雾雨魔理沙']])
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('在线：中文多候选时取最热的那条（wiki 顺序不代表热度）', async () => {
  // `アリス` 这类共享别名会返回多个不同角色；wiki 的返回顺序不可靠，
  // 必须回查 post_count 取最热 —— 否则本地查和在线查会给出不同答案。
  const originalFetch = globalThis.fetch
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('other_names_match')) {
      return jsonRes([{ title: 'alice_(alice_in_wonderland)' }, { title: 'aris_(blue_archive)' }])
    }
    if (url.includes('search[name]=')) {
      if (url.includes('alice_')) return jsonRes([{ name: 'alice_(alice_in_wonderland)', post_count: 4030, category: 4 }])
      return jsonRes([{ name: 'aris_(blue_archive)', post_count: 12151, category: 4 }])
    }
    return jsonRes([])
  }
  try {
    const tags = await searchOnline('アリス', 5, 'character')
    assert.deepEqual(tags, ['aris_(blue_archive)'], '应当只返回热度最高的那条')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('在线：kind 不匹配时不返回（wiki 页没有分类，得回查）', async () => {
  const originalFetch = globalThis.fetch
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('other_names_match')) return jsonRes([{ title: 'ganyu_(genshin_impact)' }])
    // 分类是角色（4），但调用方要画师（1）
    if (url.includes('search[name]=')) return jsonRes([{ name: 'ganyu_(genshin_impact)', post_count: 20306, category: 4 }])
    return jsonRes([])
  }
  try {
    assert.deepEqual(await searchOnline('甘雨', 5, 'artist'), [], '要画师就不该给角色')
    assert.deepEqual(await searchOnline('甘雨', 5, 'character'), ['ganyu_(genshin_impact)'])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('在线：跨 kind 时精确同名仍然排第一', async () => {
  // 两类各查一轮，只在循环内排序会被循环次序打乱 —— 精确名必须全局优先
  const originalFetch = globalThis.fetch
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('name_matches')) {
      if (url.includes('search[category]=4')) return jsonRes([{ name: 'black-haired_girl_(wlop)' }])
      return jsonRes([{ name: 'wlop' }])
    }
    return jsonRes([])
  }
  try {
    const tags = await searchOnline('wlop', 5)
    assert.equal(tags[0], 'wlop', `精确同名必须在首位，实际：${JSON.stringify(tags)}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('在线：空格与下划线等价（hatsune miku ≡ hatsune_miku）', async () => {
  const originalFetch = globalThis.fetch
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  globalThis.fetch = async input => {
    const url = String(input)
    if (url.includes('name_matches')) return jsonRes([{ name: 'hatsune_miku_(variant)' }, { name: 'hatsune_miku' }])
    return jsonRes([])
  }
  try {
    const tags = await searchOnline('hatsune miku', 5)
    assert.equal(tags[0], 'hatsune_miku', `空格写法也该把精确名排首位，实际：${JSON.stringify(tags)}`)
  } finally {
    globalThis.fetch = originalFetch
  }
})
