/**
 * 标签面板的 HTTP 面。
 *
 * 走真实 `createTagsRoutes` 返回的 handler（不起服务器），断言的是面板真正依赖的
 * 三件事：能搜到、能按大类筛、统计数字与数据一致。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { createTagsIndex, createSyncJob, createTagsRoutes } from '../lib/index.js'

/** 假的 ServerResponse：只收 body。 */
function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body },
  }
}

/** 打一次路由。 */
async function call(routes, sub, url, method = 'GET') {
  const res = fakeRes()
  const req = Readable.from([Buffer.from('')])
  req.method = method
  const handler = routes.exact[sub]
  assert.ok(handler !== undefined, `没有注册 ${sub}`)
  await handler(new URL(`http://x${url}`), res, req)
  return { status: res.status, body: JSON.parse(res.body) }
}

test('GET /tags：中文名能搜到，返回 tag + 中文名 + 大类', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const { status, body } = await call(routes, '/tags', '/tags?q=长发&limit=5')
  assert.equal(status, 200, JSON.stringify(body))
  assert.equal(body.ok, true)
  const hit = body.items.find(item => item.tag === 'long_hair')
  assert.ok(hit !== undefined, `实际 ${JSON.stringify(body.items.map(i => i.tag))}`)
  assert.equal(hit.zh, '长发')
  assert.equal(hit.kind, 'general')
  assert.equal(hit.category, 'appearance', '长发改归「外貌」')
})

test('GET /tags：按大类筛，且总数与命中数分开给（面板要显示"还有多少"）', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const { body } = await call(routes, '/tags', '/tags?q=skirt&category=clothing&limit=10')
  assert.equal(body.ok, true)
  assert.ok(body.items.every(item => item.category === 'clothing'), `实际 ${JSON.stringify(body.items.map(i => i.category))}`)
  assert.ok(body.total >= body.items.length, 'total 应当是不受 limit 限制的总数')

  // 同一个词换到不匹配的大类：应当为空而不是报错
  const none = await call(routes, '/tags', '/tags?q=skirt&category=action')
  assert.equal(none.body.ok, true)
  assert.equal(none.body.items.length, 0)
})

test('GET /tags：空查询按热度排（面板一打开不能是空白）', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const { body } = await call(routes, '/tags', '/tags?limit=3')
  assert.equal(body.items.length, 3)
  assert.ok(body.items[0].postCount >= body.items[1].postCount, '第一条该是最热的')
  assert.ok(body.total > 90_000, `总数该是四类合计，实际 ${body.total}`)
})

test('GET /tags/stats：四类计数与数据一致，大类有中文名', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const { status, body } = await call(routes, '/tags/stats', '/tags/stats')
  assert.equal(status, 200)
  assert.equal(body.ok, true)
  assert.equal(body.kinds.character, 35384)
  assert.equal(body.kinds.artist, 24881)
  assert.equal(body.kinds.copyright, 8414)
  assert.equal(body.kinds.general, 30693)
  assert.equal(body.total, 99372)
  assert.equal(body.labels.clothing, '服装')
  assert.equal(body.labels.explicit, '性相关')
  assert.ok((body.categories.other ?? 0) > 0, '归不了类的应当有，且在 other 里')
})

test('分页：按 offset 增量取，两页之间不重叠（面板"再看 N 条"靠它）', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const first = await call(routes, '/tags', '/tags?limit=50&offset=0')
  const second = await call(routes, '/tags', '/tags?limit=50&offset=50')
  assert.equal(first.body.items.length, 50)
  assert.equal(second.body.items.length, 50)
  assert.equal(first.body.total, second.body.total, 'total 不该随 offset 变')

  const overlap = first.body.items
    .map(item => `${item.kind}:${item.tag}`)
    .filter(key => second.body.items.some(item => `${item.kind}:${item.tag}` === key))
  assert.deepEqual(overlap, [], `两页不该有重复：${overlap.slice(0, 3).join(', ')}`)
})

test('limit 超过上限被夹到 100（前端要靠 offset 翻页，不能靠加大 limit）', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  const big = await call(routes, '/tags', '/tags?limit=500')
  assert.equal(big.body.items.length, 100, '这是 MAX_LIMIT，前端必须用 offset 而不是把 limit 越加越大')
})

test('面板路由是只读的：POST / PUT / DELETE 一律 405', async () => {
  const routes = createTagsRoutes(createTagsIndex(path.join(os.homedir(), '.dsh-nonexistent')))
  for (const method of ['POST', 'PUT', 'DELETE']) {
    for (const sub of ['/tags', '/tags/stats']) {
      const { status } = await call(routes, sub, sub, method)
      assert.equal(status, 405, `${method} ${sub} 该 405`)
    }
  }
})

test('POST /tags/sync 开跑、GET 轮进度；同一刻只允许一个任务', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-syncjob-'))
  let runs = 0
  const job = createSyncJob({
    dataDir: dir,
    // 注入：不联网，只验证状态机
    runCsv: async kind => { runs += 1; return { kind, records: 3, withNames: 3 } },
    runGroups: async () => ({ groups: 91, tags: 15064, failed: [], file: '', seconds: 0, fromCache: false }),
  })
  const routes = createTagsRoutes(createTagsIndex(dir), job)

  try {
    const started = await call(routes, '/tags/sync', '/tags/sync', 'POST')
    assert.equal(started.status, 200)
    assert.equal(started.body.state, 'running', JSON.stringify(started.body))

    // 再点一次：拿到的是同一次任务，不会起第二个
    const again = await call(routes, '/tags/sync', '/tags/sync', 'POST')
    assert.equal(again.body.state, 'running')

    let status = again.body
    for (let i = 0; i < 50 && status.state === 'running'; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      status = (await call(routes, '/tags/sync', '/tags/sync')).body
    }
    assert.equal(status.state, 'done', JSON.stringify(status))
    assert.equal(status.results.length, 4, '四类各一条结果')
    assert.equal(status.groups.groups, 91)
    assert.equal(runs, 4, '四类各导入一次')

    for (const method of ['PUT', 'DELETE']) {
      const res = await call(routes, '/tags/sync', '/tags/sync', method)
      assert.equal(res.status, 405)
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('更新任务失败时如实报错，不假装成功', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-syncfail-'))
  const job = createSyncJob({
    dataDir: dir,
    runCsv: async () => { throw new Error('下载 general.csv 失败：HTTP 500') },
    runGroups: async () => { throw new Error('不该走到这里') },
  })
  const routes = createTagsRoutes(createTagsIndex(dir), job)
  try {
    await call(routes, '/tags/sync', '/tags/sync', 'POST')
    let status
    for (let i = 0; i < 50; i += 1) {
      await new Promise(resolve => setTimeout(resolve, 10))
      status = (await call(routes, '/tags/sync', '/tags/sync')).body
      if (status.state !== 'running') break
    }
    assert.equal(status.state, 'failed')
    assert.match(status.message, /HTTP 500/, '要把真实原因带出来')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('数据文件变了会自动重建索引（面板常驻，不能等重启才看到新数据）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-tags-'))
  try {
    const index = createTagsIndex(dir)
    const first = index.stats()
    assert.equal(first.kinds.general, 30693, '先确认读到的是随包数据')

    // 往运行时目录写一份 min 数据：文件名要与 `FILE_OF_KIND` 一致（general 是单数）
    fs.mkdirSync(path.join(dir, 'danbooru'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'danbooru', 'general.jsonl'), `${JSON.stringify({ tag: 'x', kind: 'general', postCount: 1, names: [], updatedAt: '' })}\n`)

    // **不调 invalidate**：靠 mtime+size 指纹自己发现文件变了。这是必修项——
    // 早先 invalidate() 没有生产调用点，用户跑完同步到宿主重启前一直看旧数据。
    const rebuilt = index.stats()
    assert.equal(rebuilt.kinds.general, 1, `数据变了该自动重建，实际 ${JSON.stringify(rebuilt.kinds)}`)

    // 手动 invalidate 仍然有效（文件没变也会重读一次）
    index.invalidate()
    assert.equal(index.stats().kinds.general, 1)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
