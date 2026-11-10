/**
 * 姿势库：目录索引、取图代理、工具。
 *
 * 三条最要紧的：
 * 1. **成人向默认不可见**，勾了才给 —— 288 组里 190 组是成人向，比例不小，
 *    默认行为弄错就是事故。
 * 2. **取图是受白名单约束的代理**，不是任意 URL 转发。路径、host、大小、字节头四道闸。
 * 3. **缓存与冷却**：同一张图并发只下一次；远端连着失败几次就短路，别让面板几十个
 *    请求各自挂在超时上。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { bundledCatalogPath, createPoseImages, createPosesIndex, createPosesRoutes, poseTool } from '../lib/index.js'

const ORIGIN = 'https://example.invalid'

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-poses-'))
}

/** 1×1 透明 PNG（内容不重要，重要的是 magic bytes）。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 真实的随包目录——索引的断言就对着它，避免另造一份测试数据把线上数据的问题藏起来。 */
const BUNDLED = bundledCatalogPath(new URL('../lib/index.js', import.meta.url).href)

test('随包目录：288 组 / 1439 视角 / 四体系与上游一致', () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const stats = index.stats()
  assert.equal(stats.poseCount, 288)
  assert.equal(stats.viewCount, 1439)
  assert.equal(stats.adultPoseCount, 190)
  assert.deepEqual(stats.systems.map(item => item.id), ['full', 'sexy', 'bust', 'pair'])
  assert.deepEqual(stats.systems.map(item => item.poseCount), [73, 80, 80, 55])
  assert.deepEqual(stats.systems.map(item => item.viewCount), [365, 399, 400, 275])
  assert.equal(Object.keys(stats.categories).length, 26)
})

test('默认全给 288 组；onlySafe 才收窄到 98 组', () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  assert.equal(index.search({ limit: 100 }).total, 288, '默认不该藏任何一组')
  const safeOnly = index.search({ onlySafe: true, limit: 100 })
  assert.equal(safeOnly.total, 98)
  assert.ok(safeOnly.items.every(item => item.adult === false))
  // 体系筛选与 onlySafe 独立成立
  assert.equal(index.search({ systemId: 'pair' }).total, 55, 'pair 体系 55 组，默认可见')
  assert.equal(index.search({ systemId: 'pair', onlySafe: true }).total, 0)
})

test('搜索与筛选：编号、分类、多词 AND、未知条件返回空', () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const byCode = index.search({ query: 'P001' })
  assert.ok(byCode.total > 0)
  assert.ok(byCode.items.every(item => item.code === 'P001'))
  // 空格分隔 = 都要命中
  const both = index.search({ query: '坐姿 后仰' })
  assert.ok(both.total >= 1, '该有同时满足两个词的姿势')
  assert.ok(both.items.every(item => item.name.includes('后仰') || item.category.includes('坐姿')))
  assert.equal(index.search({ query: '绝不可能存在的姿势名' }).total, 0)
  assert.equal(index.search({ category: '坐姿', limit: 1 }).items.length, 1)
})

test('每条都有可用的封面视角，且图路径是代理认的形态', () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const { items } = index.search({ limit: 100 })
  for (const item of items) {
    assert.match(item.cover.viewId, /^[a-z0-9]+_[A-Za-z0-9]+$|^[a-z0-9]+_.+$/)
    assert.match(item.cover.thumb, /^(thumbs|img)\/[A-Za-z0-9_]+\.(jpg|png)$/)
    assert.ok(item.viewCount === 4 || item.viewCount === 5)
    // 前端按 angleIds 画按钮：数量必须与 viewCount 一致，否则会点出 404
    assert.equal(item.angleIds.length, item.viewCount, `${item.id} 的 angleIds 与 viewCount 不一致`)
    assert.ok(item.angleIds.includes(item.cover.viewId.split('_').pop()), '封面角度必须在 angleIds 里')
  }
})

test('findView：接受视角 id，也接受姿势 id（回落到正面）', () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const pose = index.search({ limit: 1 }).items[0]
  const byPose = index.findView(pose.id)
  assert.ok(byPose !== undefined)
  assert.equal(byPose.view.angleId, 'front', '只给组 id 时该给正面')
  const sideId = `${pose.id}_side`
  const byView = index.findView(sideId)
  assert.ok(byView !== undefined)
  assert.equal(byView?.view.angleId, 'side')
  assert.equal(index.findView('no_such_pose'), undefined)
})

test('插件数据目录里的副本优先于随包快照', () => {
  const dataDir = tempDir()
  const bundled = createPosesIndex(dataDir, BUNDLED)
  assert.equal(bundled.stats().poseCount, 288)

  // 自己那份只放一组：应当立刻改用它
  const own = JSON.parse(fs.readFileSync(BUNDLED, 'utf8'))
  own.poses = own.poses.slice(0, 1)
  own.poseCount = 1
  own.viewCount = own.poses[0].views.length
  own.adultPoseCount = own.poses[0].adult ? 1 : 0
  fs.mkdirSync(path.join(dataDir, 'poses'), { recursive: true })
  fs.writeFileSync(path.join(dataDir, 'poses', 'catalog.json'), JSON.stringify(own))

  const custom = createPosesIndex(dataDir, BUNDLED)
  // 文件指纹变了才会重读：这里新建实例，直接读新文件
  assert.equal(custom.stats().poseCount, 1)
})

test('取图：路径白名单挡掉穿越与任意地址', async () => {
  const images = createPoseImages({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl: async () => new Response(null) })
  for (const bad of [
    '../etc/passwd',
    'thumbs/../../secret.jpg',
    'https://evil.example/a.jpg',
    'img/a.jpg?x=1',
    'thumbs/a.exe',
    'other/a.jpg',
  ]) {
    await assert.rejects(() => images.fetch(bad), /路径无效/, `该拒绝：${bad}`)
  }
})

test('取图：origin 必须是 https', () => {
  assert.throws(
    () => createPoseImages({ cacheDir: tempDir(), origin: 'http://example.invalid', fetchImpl: async () => new Response(null) }),
    /必须是 https/,
  )
})

test('取图：落盘缓存，第二次不再打网络；并发同一条只下一次', async () => {
  const cacheDir = tempDir()
  let hits = 0
  const fetchImpl = async () => {
    hits += 1
    // 慢一点，让并发真的重叠
    await new Promise(resolve => setTimeout(resolve, 30))
    return new Response(TINY_PNG, { status: 200, headers: { 'content-type': 'image/png' } })
  }
  const images = createPoseImages({ cacheDir, origin: ORIGIN, fetchImpl })

  const target = 'thumbs/full_single_P001_front.jpg'
  const results = await Promise.all([images.fetch(target), images.fetch(target), images.fetch(target)])
  assert.equal(hits, 1, '三条并发只该打一次上游')
  assert.equal(results[0].mediaType, 'image/png')
  assert.ok(fs.existsSync(path.join(cacheDir, target)), '该落盘到缓存目录')

  // 换一个新实例（模拟进程重启）：内存空了，但要读磁盘，不再打网络
  const restarted = createPoseImages({ cacheDir, origin: ORIGIN, fetchImpl })
  const again = await restarted.fetch(target)
  assert.equal(hits, 1, '重启后该命中磁盘缓存')
  assert.equal(again.from, 'disk')
})

test('取图：不是 PNG/JPEG 就拒绝（扩展名不算类型保证）', async () => {
  // 内容要超过 MIN_BYTES，否则先撞上"大小异常"那一关，测不到类型检查
  const html = Buffer.from(`<html><body>${'not an image'.repeat(20)}</body></html>`)
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => new Response(html, { status: 200 }),
  })
  await assert.rejects(() => images.fetch('thumbs/full_single_P001_front.jpg'), /不是 PNG\/JPEG/)
})

test('取图：连续失败进入冷却，冷却期内直接短路不再等待超时', async () => {
  let hits = 0
  let clock = 0
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    now: () => clock,
    fetchImpl: async () => {
      hits += 1
      throw new Error('ECONNRESET')
    },
  })
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => images.fetch(`thumbs/full_single_P00${i}_front.jpg`), /ECONNRESET/)
  }
  assert.equal(hits, 3)
  assert.ok(images.stats().cooldownRemainingMs > 0, '三次失败后该进入冷却')

  // 冷却期内：短路，**不再打上游**。这才是这条守护的价值——
  // 否则面板一屏 40 张图就是 40 次 20 秒超时。
  await assert.rejects(() => images.fetch('thumbs/full_single_P003_front.jpg'), /冷却/)
  assert.equal(hits, 3, '冷却期内不该再打上游')

  // 时间推过冷却：重新尝试
  clock = 40_000
  assert.equal(images.stats().cooldownRemainingMs, 0)
  await assert.rejects(() => images.fetch('thumbs/full_single_P003_front.jpg'), /ECONNRESET/)
  assert.equal(hits, 4, '冷却结束后该重新尝试')
})

test('取图：成功一次就把失败计数清零，偶发失败不会攒成"远端挂了"', async () => {
  let n = 0
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => {
      n += 1
      if (n % 2 === 1) throw new Error('偶发')
      return new Response(TINY_PNG, { status: 200 })
    },
  })
  // 失败-成功-失败-成功……永远不该触发冷却
  for (let i = 0; i < 6; i += 1) {
    await images.fetch(`thumbs/full_single_P10${i}_front.jpg`).catch(() => {})
  }
  assert.equal(images.stats().cooldownRemainingMs, 0, '交替失败/成功不该进入冷却')
})

test('取图：太小的响应被拒（不是图）', async () => {
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => new Response(Buffer.from([0x89, 0x50]), { status: 200 }),
  })
  await assert.rejects(() => images.fetch('thumbs/full_single_P001_front.jpg'), /大小异常/)
})

test('取图：内存缓存不超过上限（LRU 真的在淘汰）', async () => {
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    memoryLimit: 2,
    fetchImpl: async () => new Response(TINY_PNG, { status: 200 }),
  })
  for (let i = 0; i < 4; i += 1) await images.fetch(`thumbs/full_single_P30${i}_front.jpg`)
  assert.equal(images.stats().memoryEntries, 2, '内存里只该留上限条数')
})

test('取图：超过 8 MB 的响应被拒（上界按实际字节算，不看声明）', async () => {
  // 谎报 Content-Length：只靠声明就会被绕过
  const big = new Uint8Array(9 * 1024 * 1024)
  big.set([0x89, 0x50, 0x4e, 0x47], 0)
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => new Response(big, { status: 200, headers: { 'content-length': '100' } }),
  })
  await assert.rejects(() => images.fetch('thumbs/full_single_P001_front.jpg'), /大小异常/)
})

test('取图：重定向必须被拒（否则一道 302 就把代理变成任意出口）', async () => {
  let sawRedirectOption
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async (_url, init) => {
      sawRedirectOption = init?.redirect
      throw new Error('redirect blocked')
    },
  })
  await assert.rejects(() => images.fetch('thumbs/full_single_P001_front.jpg'), /redirect blocked/)
  assert.equal(sawRedirectOption, 'error', "必须显式传 redirect: 'error' —— 默认的 follow 会跟到任意地址")
})

test('取图：磁盘命中的图不受上游冷却影响', async () => {
  const cacheDir = tempDir()
  let mode = 'ok'
  // memoryLimit 1：取别的图就会把 target 挤出内存，逼它走磁盘那一层
  const images = createPoseImages({
    cacheDir,
    origin: ORIGIN,
    memoryLimit: 1,
    fetchImpl: async () => {
      if (mode === 'ok') return new Response(TINY_PNG, { status: 200 })
      throw new Error('ECONNRESET')
    },
  })
  const target = 'thumbs/full_single_P002_front.jpg'
  await images.fetch(target) // 落盘
  await images.fetch('thumbs/full_single_P003_front.jpg') // 把 target 挤出内存

  // 同一个实例里把上游打到冷却
  mode = 'fail'
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => images.fetch(`thumbs/full_single_P20${i}_front.jpg`), /ECONNRESET/)
  }
  assert.ok(images.stats().cooldownRemainingMs > 0, '此时应当处于冷却')

  // 再取那张已落盘的图：必须读磁盘，而不是报冷却
  const cached = await images.fetch(target)
  assert.equal(cached.from, 'disk', '冷却只该拦网络请求，不该让本地缓存失效')
})

test('materialize：把线稿落盘成工作流能吃的文件', async () => {
  const cacheDir = tempDir()
  const uploads = tempDir()
  const images = createPoseImages({
    cacheDir,
    origin: ORIGIN,
    fetchImpl: async () => new Response(TINY_PNG, { status: 200 }),
  })
  const { file, mediaType } = await images.materialize('img/full_single_P001_front.png', uploads)
  assert.equal(mediaType, 'image/png')
  assert.equal(path.basename(file), 'full_single_P001_front.png')
  assert.ok(fs.existsSync(file), '该真的写进 uploads')
  assert.ok(fs.statSync(file).size > 0)
})

test('路由：搜索 / 统计 / 越界参数都被夹住', async () => {
  const dataDir = tempDir()
  const index = createPosesIndex(dataDir, BUNDLED)
  const images = createPoseImages({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl: async () => new Response(TINY_PNG) })
  const routes = createPosesRoutes({ index, images, uploadsDir: () => tempDir() })

  const search = routes.exact['/poses']
  assert.ok(search !== undefined)

  const collected = []
  const res = {
    writeHead(status) { this.status = status },
    end(body) { collected.push({ status: this.status, body: JSON.parse(String(body)) }) },
    status: 0,
    headersSent: false,
  }
  await search(new URL('http://x/poses?limit=999&safe=1'), res, { method: 'GET' })
  const payload = collected.at(-1).body
  assert.equal(payload.ok, true)
  // limit 上限 100：288 组时也最多回 100
  assert.ok(payload.items.length <= 100, `limit 该被夹到 100，实际 ${payload.items.length}`)

  // 非 GET/HEAD 一律 405
  await search(new URL('http://x/poses'), res, { method: 'POST' })
  assert.equal(collected.at(-1).status, 405)
})

test('工具：搜索参数校验与空结果的原因区分', async () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const images = createPoseImages({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl: async () => new Response(TINY_PNG) })
  const tool = poseTool({ index, images, uploadsDir: () => tempDir() })

  const bad = await tool.execute({ system: 'nope' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /system 只能是/)

  const none = await tool.execute({ query: '绝不可能存在的姿势名' })
  assert.equal(none.ok, true)
  assert.equal(none.poses.length, 0)
  assert.match(none.note, /换个词/)

  // 被条件筛掉时，note 要说清是"筛掉的"而不是"没有"
  const filtered = await tool.execute({ system: 'pair', onlySafe: true })
  assert.equal(filtered.poses.length, 0)
  assert.match(filtered.note, /过滤掉/)

  // 默认不带 onlySafe：pair 体系本来就在结果里
  const pair = await tool.execute({ system: 'pair' })
  assert.ok(pair.poses.length > 0, '默认该给全部，包含 pair')
})

test('工具：fetch 找不到 id 时给出可执行的下一步', async () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  let hits = 0
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => {
      hits += 1
      return new Response(TINY_PNG, { status: 200 })
    },
  })
  const tool = poseTool({ index, images, uploadsDir: () => tempDir() })

  const missing = await tool.execute({ id: 'no_such_pose' })
  assert.equal(missing.ok, false)
  assert.match(missing.error, /不带 id 搜一下/)
  assert.equal(hits, 0, '找不到 id 时不该去打网络')

  const pose = index.search({ limit: 1 }).items[0]
  const ok = await tool.execute({ id: pose.id, size: 'thumb' })
  assert.equal(ok.ok, true)
  assert.ok(fs.existsSync(ok.file), '该落盘并回绝对路径')
  assert.equal(hits, 1)
})

test('工具：给 id 是取图、不给 id 是搜索（同一个工具两条路径，不互相干扰）', async () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  let hits = 0
  const images = createPoseImages({
    cacheDir: tempDir(),
    origin: ORIGIN,
    fetchImpl: async () => {
      hits += 1
      return new Response(TINY_PNG, { status: 200 })
    },
  })
  const tool = poseTool({ index, images, uploadsDir: () => tempDir() })

  // 不给 id：纯搜索，不该碰网络，也不该返回 file
  const searched = await tool.execute({ limit: 2 })
  assert.equal(searched.mode, 'search')
  assert.equal(searched.file, undefined, '搜索不该带回文件路径')
  assert.equal(hits, 0, '搜索不该打网络')

  // 给了 id：取图，即使同时带了搜索参数也以 id 为准
  const pose = index.search({ limit: 1 }).items[0]
  const fetched = await tool.execute({ id: pose.id, query: '这个参数该被忽略', size: 'thumb' })
  assert.equal(fetched.mode, 'fetch')
  assert.equal(fetched.poses, undefined, '取图不该返回结果列表')
  assert.ok(fs.existsSync(fetched.file), '该落盘并回绝对路径')
  assert.equal(hits, 1)
})

test('工具返回不带 undefined：非成人向结果必须能无损 JSON 往返', async () => {
  const index = createPosesIndex(tempDir(), BUNDLED)
  const images = createPoseImages({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl: async () => new Response(TINY_PNG) })
  const tool = poseTool({ index, images, uploadsDir: () => tempDir() })

  const result = await tool.execute({ onlySafe: true, limit: 3 })
  assert.equal(result.ok, true)
  assert.equal(result.poses.length, 3)
  // 宿主按「无损 JSON」校验工具返回值：undefined 这类不可序列化的值会让整次调用作废
  // （"returned invalid output: value is not lossless JSON"）。往返一次就能暴露它。
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result)
  // 字段必须在、且必须是布尔：显式 false 比"字段缺失"更能说明这套是非成人向。
  // 真正的约束是「不能是 undefined」——那才会让宿主的无损校验拒掉整次调用。
  for (const pose of result.poses) assert.equal(typeof pose.adult, 'boolean')
})