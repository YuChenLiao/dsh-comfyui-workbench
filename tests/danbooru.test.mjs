import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import {
  bundledDir,
  ownStorePath,
  createTagCache,
  pruneSharedAliases,
  danbooruLookupTool,
  pickNames,
  readStore,
  searchOnline,
  searchOnlineDetailed,
  searchTags,
  useMirrors,
  useTimeout,
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

test('按 Danbooru tag 查询命中（tag 名命中独立成档）', () => {
  const matches = searchTags(SAMPLE, 'hatsune_miku')
  assert.equal(matches[0]?.record.tag, 'hatsune_miku')
  // tag 名直接命中比"某个别名恰好相同"更强：查 wlop 应当先给 wlop 这个 tag
  assert.equal(matches[0]?.how, 'tag')
})

test('空格与下划线等价', () => {
  assert.equal(searchTags(SAMPLE, 'hatsune miku')[0]?.record.tag, 'hatsune_miku')
  assert.equal(searchTags(SAMPLE, 'hatsune miku')[0]?.how, 'tag')
})

test('分档顺序：tag 名 > 别名精确 > 前缀 > 包含', () => {
  // 造三条同前缀但档位不同的记录，必须按档位排，不能只靠唯一命中"碰巧"过
  const pool = [
    record('hatsune_miku', 'character', 500, []),            // contains（不以 miku 开头）
    record('miku', 'character', 10, []),                     // exact（热度最低）
    record('miku_append', 'character', 900, []),             // prefix（热度最高）
  ]
  const byExact = searchTags(pool, 'miku')
  assert.deepEqual(byExact.map(m => m.how), ['tag', 'prefix', 'contains'], '档位顺序必须 tag 名在前')
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
  const file = ownStorePath(dir, 'character')
  try {
    writeStore(file, SAMPLE.filter(item => item.kind === 'character'))
    assert.equal(readStore(file).length, 3)
    // 追加半行（模拟同步中断），读的时候应当跳过而不是抛
    fs.appendFileSync(file, '{"tag":"broken"')
    assert.equal(readStore(file).length, 3)
    assert.equal(readStore(ownStorePath(dir, 'artist')).length, 0, '不存在的文件返回空数组')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('数据目录为空时用包内自带的库，不联网', async () => {
  // 数据随包内聚之后，"空目录"不再等于"空库" —— 装好即可查
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-empty-'))
  try {
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const out = await tool.execute({ query: '甘雨' })
    assert.equal(out.ok, true)
    assert.equal(out.tags[0], 'ganyu_(genshin_impact)', '首位应当是主 tag')
    assert.equal(out.source, 'local', '包内库够用就不该联网')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('查询工具：中文与 tag 都能查，且能按 kind 分流', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-tool-'))
  try {
    writeStore(ownStorePath(dir, 'character'), SAMPLE.filter(item => item.kind === 'character'))
    writeStore(ownStorePath(dir, 'artist'), SAMPLE.filter(item => item.kind === 'artist'))
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })

    const byChinese = await tool.execute({ query: '博丽灵梦' })
    assert.equal(byChinese.ok, true)
    assert.deepEqual(byChinese.tags, ['hakurei_reimu'], '只返回 tag')
    assert.equal(byChinese.source, 'local')

    const byTag = await tool.execute({ query: 'wlop', kind: 'artist' })
    assert.equal(byTag.tags[0], 'wlop', 'tag 名精确命中要排第一')

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
    // 包内自带库之后，"空目录"也有数据了，所以这里断言的是"读到的来源是本地"
    const before = await tool.execute({ query: '甘雨' })
    assert.equal(before.source, 'local')

    writeStore(ownStorePath(dir, 'character'), SAMPLE.filter(item => item.kind === 'character'))
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
    writeStore(ownStorePath(dir, 'artist'), [record('dairi', 'artist', 18859, [])])
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
    writeStore(ownStorePath(dir, 'character'), [
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

test('在线：429 时标记为限流，文案与"没找到"区分开', async () => {
  // 用户分不清"名字写错了"和"被限流了"—— 这两种情况的下一步动作完全不同
  const originalFetch = globalThis.fetch
  const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } })

  try {
    // 两个镜像都会被打到（降级），全部 429 才算"限流"
    globalThis.fetch = async () => jsonRes({}, 429)
    const limited = await searchOnlineDetailed('甘雨', 5)
    assert.equal(limited.throttled, true, '应当标成限流')
    assert.deepEqual(limited.tags, [])

    globalThis.fetch = async () => jsonRes([])
    const empty = await searchOnlineDetailed('紫薇仙子', 5)
    assert.equal(empty.throttled, false, '空结果不是限流')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('查询工具：限流与查无此人的错误文案必须不同', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-throttle-'))
  const originalFetch = globalThis.fetch
  const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } })
  try {
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })

    // 用内置库里肯定没有的名字，逼它走网络
    globalThis.fetch = async () => jsonRes({}, 429)
    const limited = await tool.execute({ query: 'zzz_not_a_real_tag_zzz' })
    assert.equal(limited.ok, false)
    assert.match(limited.error, /限流/, `限流时应当说明是限流，实际：${limited.error}`)

    globalThis.fetch = async () => jsonRes([])
    const missing = await tool.execute({ query: 'zzz_not_a_real_tag_zzz' })
    assert.equal(missing.ok, false)
    assert.match(missing.error, /没找到/)
    assert.doesNotMatch(missing.error, /限流/, '查无此人不能说成限流')
  } finally {
    globalThis.fetch = originalFetch
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('降级：主站失败自动换镜像，结果不变', async () => {
  // safebooru.donmai.us 是官方 SFW 镜像，数据与主站同源（实测 post_count/别名逐字段一致）
  const originalFetch = globalThis.fetch
  const hits = []
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  useMirrors(['https://primary.test', 'https://mirror.test'])
  globalThis.fetch = async input => {
    const url = String(input)
    hits.push(url)
    if (url.includes('primary.test')) throw new Error('ECONNRESET')
    return jsonRes([{ name: 'hatsune_miku', post_count: 148311, category: 4 }])
  }
  try {
    const tags = await searchOnline('hatsune_miku', 3, 'character')
    assert.deepEqual(tags, ['hatsune_miku'], '主站挂了要能从镜像拿到同样的结果')
    assert.ok(hits.some(url => url.includes('mirror.test')), '应当打到镜像')
  } finally {
    globalThis.fetch = originalFetch
    useMirrors([])
  }
})

test('降级：404 表示镜像缺这个端点，应当换站（查无此项是 200+[]）', async () => {
  // Danbooru 的"没有这个 tag"是 200 + 空数组，不是 404。
  // 404 只说明该镜像没有这个端点（主站 500 + 镜像 404 时若不换站，同步会静默拿 0 条）。
  const originalFetch = globalThis.fetch
  const hits = []
  const res404 = { ok: false, status: 404, json: async () => ({}), headers: { get: () => null } }
  const ok = { ok: true, status: 200, json: async () => [{ name: 'wlop', post_count: 401, category: 1 }], headers: { get: () => null } }
  useMirrors(['https://dead.test', 'https://mirror.test'])
  globalThis.fetch = async input => {
    const url = String(input)
    hits.push(url)
    return url.includes('dead.test') ? res404 : ok
  }
  try {
    const tags = await searchOnline('wlop', 3, 'artist')
    assert.deepEqual(tags, ['wlop'], '镜像有结果就该拿回来')
    assert.ok(hits.some(url => url.includes('mirror.test')), '404 之后应当换站')
  } finally {
    globalThis.fetch = originalFetch
    useMirrors([])
  }
})

test('降级：全部镜像都挂时降级为空，不抛错', async () => {
  const originalFetch = globalThis.fetch
  let calls = 0
  useMirrors(['https://a.test', 'https://b.test'])
  globalThis.fetch = async () => { calls += 1; throw new Error('down') }
  try {
    assert.deepEqual(await searchOnline('甘雨', 3), [])
    assert.ok(calls >= 2, '两个镜像都该试过')
  } finally {
    globalThis.fetch = originalFetch
    useMirrors([])
  }
})

test('降级：记住上次成功的镜像，不再撞坏掉的那个', async () => {
  const originalFetch = globalThis.fetch
  const hits = []
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  useMirrors(['https://dead.test', 'https://mirror.test'])
  globalThis.fetch = async input => {
    const url = String(input)
    hits.push(url)
    if (url.includes('dead.test')) throw new Error('ECONNREFUSED')
    return jsonRes([{ name: 'hatsune_miku', post_count: 148311, category: 4 }])
  }
  try {
    await searchOnline('hatsune_miku', 3, 'character')
    const firstRound = hits.length
    assert.ok(firstRound >= 2, '第一次要先撞主站再换')

    hits.length = 0
    await searchOnline('hatsune_miku', 3, 'character')
    assert.equal(hits.length, 1, `第二次应当直接打镜像，实际 ${hits.length} 次`)
    assert.ok(hits[0].includes('mirror.test'))
  } finally {
    globalThis.fetch = originalFetch
    useMirrors([])
  }
})

test('降级：429 也算"这个站暂时不能用"，换站而不是直接失败', async () => {
  const originalFetch = globalThis.fetch
  const jsonRes = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, headers: { get: () => null } })
  let hits = 0
  useMirrors(['https://limited.test', 'https://mirror.test'])
  globalThis.fetch = async input => {
    hits += 1
    return String(input).includes('limited.test') ? jsonRes({}, 429) : jsonRes([{ name: 'wlop', post_count: 401, category: 1 }])
  }
  try {
    const tags = await searchOnline('wlop', 3, 'artist')
    assert.deepEqual(tags, ['wlop'], '主站限流时应当从镜像拿到结果')
    assert.ok(hits >= 2)
  } finally {
    globalThis.fetch = originalFetch
    useMirrors([])
  }
})

test('降级：连接建立但不响应时，超时也要能触发换站', async () => {
  // 这是"降级形同虚设"的真实成因：fetch 不 reject、只是一直挂着。
  // 没有 AbortSignal.timeout 的话，请求会永远卡在第一个镜像上。
  const originalFetch = globalThis.fetch
  const hits = []
  const jsonRes = body => ({ ok: true, status: 200, json: async () => body, headers: { get: () => null } })
  useMirrors(['https://hang.test', 'https://mirror.test'])
  useTimeout(60)
  globalThis.fetch = (input, init) => {
    const url = String(input)
    hits.push(url)
    if (url.includes('hang.test')) {
      // 永不 resolve，只有 abort 时才 reject —— 模拟"连上了但不响应"
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
      })
    }
    return Promise.resolve(jsonRes([{ name: 'hatsune_miku', post_count: 148311, category: 4 }]))
  }
  try {
    const tags = await searchOnline('hatsune_miku', 3, 'character')
    assert.deepEqual(tags, ['hatsune_miku'], '超时后应当从镜像拿到结果')
    assert.ok(hits.some(url => url.includes('mirror.test')), '超时也必须换站')
  } finally {
    globalThis.fetch = originalFetch
    useTimeout(0)
    useMirrors([])
  }
})

test('跨 kind 时档位不丢：tag 名精确压过另一类的别名精确', async () => {
  // 真实场景：`wlop` 在画师库里是 tag 名，而角色库里某条记录把 wlop 当别名。
  // 收集时若只留 tag 名字符串，档位信息就丢了，别名那条会靠热度压上来。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-crosskind-'))
  try {
    writeStore(ownStorePath(dir, 'character'), [record('princess_aeolian', 'character', 999999, ['wlop'])])
    writeStore(ownStorePath(dir, 'artist'), [record('wlop', 'artist', 398, [])])
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const out = await tool.execute({ query: 'wlop' })
    assert.equal(out.tags[0], 'wlop', `tag 名命中必须压过跨类的别名命中，实际：${JSON.stringify(out.tags)}`)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('数据目录为空时回退到包内自带的标签库', () => {
  // 数据随包内聚，装好就该能查 —— 不该逼用户先联网同步
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-bundled-'))
  try {
    const bundled = bundledDir()
    assert.equal(fs.existsSync(path.join(bundled, 'characters.jsonl')), true, `包内数据缺失：${bundled}`)

    const viaEmpty = storePath(dir, 'character')
    assert.equal(viaEmpty, path.join(bundled, 'characters.jsonl'), '数据目录没有时应当回退到包内那份')

    // 用户自己导入过之后，优先用他的（可能更新）
    const own = path.join(dir, 'danbooru', 'characters.jsonl')
    fs.mkdirSync(path.dirname(own), { recursive: true })
    fs.writeFileSync(own, '')
    assert.equal(storePath(dir, 'character'), own, '用户数据存在时优先用自己的')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('包内自带数据能被正常查询（葱娘 / 米山舞）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-bundled-q-'))
  try {
    const tool = danbooruLookupTool({ dataDir: dir, cache: createTagCache(dir) })
    const c = await tool.execute({ query: '葱娘' })
    assert.deepEqual(c.tags, ['hatsune_miku'], `葱娘应当命中初音，实际：${JSON.stringify(c.tags ?? c.error)}`)
    assert.equal(c.source, 'local', '不该走网络')

    const artist = await tool.execute({ query: '米山舞', kind: 'artist' })
    assert.equal(artist.tags[0], 'yoneyama_mai')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('写入绝不碰包内数据（storePath 只用于读）', () => {
  // 踩过一次：storePath 加了"回退到包内"之后，测试里的 writeStore(storePath(...))
  // 把随包分发的 7 MB 数据覆盖成了一条假记录。写入必须走 ownStorePath。
  // 独立推导包内数据位置（不用被测函数自己算，否则缺陷会被它自己掩盖）
  const bundled = path.join(path.dirname(fileURLToPath(import.meta.url)), String.fromCharCode(46,46), 'data', 'danbooru', 'characters.jsonl')
  const countLines = file => fs.readFileSync(file, 'utf8').split(String.fromCharCode(10)).filter((line) => line.trim() !== '').length
  const beforeLines = countLines(bundled)
  assert.ok(beforeLines > 30000, `包内数据应当有 3 万+ 条，实际 ${beforeLines} 行`)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'danbooru-nowrite-'))
  try {
    assert.notEqual(storePath(dir, 'character'), ownStorePath(dir, 'character'), '空目录下两者必须指向不同文件')
    writeStore(ownStorePath(dir, 'character'), [record('zzz_probe', 'character', 1, [])])
    // 用行数而不是 size：同尺寸覆盖也能拦住
    const afterLines = countLines(bundled)
    assert.equal(afterLines, beforeLines, '包内数据文件不该被改动')
    assert.equal(readStore(ownStorePath(dir, 'character')).length, 1)

    // 护栏：直接往包内路径写必须抛错
    assert.throws(() => writeStore(bundled, []), /拒绝写入随包数据目录/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test("包内数据定位不依赖 cwd（装好之后 cwd 是用户项目目录）", () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "danbooru-cwd-"));
  const before = process.cwd();
  process.chdir(outside);
  try {
    // bundledDir 用 import.meta.url 定位，chdir 之后仍应找到包内那份
    const recs = readStore(storePath(fs.mkdtempSync(path.join(os.tmpdir(), "danbooru-x-")), "character"));
    assert.ok(recs.length > 30000, `cwd 在插件之外也该读到 3 万+ 条，实际 ${recs.length}`);
  } finally {
    process.chdir(before);
    fs.rmSync(outside, { recursive: true, force: true });
  }
})

test("护栏：大小写变体与子目录也写不进包内", () => {
  // 只比"父目录相等"会被 data/Danbooru/ 绕过（Windows 上等价同一文件），实测真把库写成了空文件
  const dir = bundledDir();
  const blockers = [
    path.join(dir, "characters.jsonl"),
    path.join(dir, "Data", "characters.jsonl"),
    path.join(path.dirname(dir), "Danbooru", "characters.jsonl"),
    path.join(dir, "sub", "characters.jsonl"),
  ];
  for (const target of blockers) {
    assert.throws(() => writeStore(target, []), /拒绝写入随包数据目录/, );
  }
})