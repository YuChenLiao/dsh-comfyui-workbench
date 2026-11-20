/**
 * 异步出图的资产索引登记。
 *
 * 背景：默认 `runWait: 'async'` —— 提交即返回，产物由后台 `watchRun` / `sweepRun`
 * 收。而索引登记原来只写在「同步等到产物」那条分支里，于是默认模式下：
 *
 * - 图确实出了，相册扫目录也能看见
 * - 但 `tags` 参数等于没写：索引里没有这一行，`/assets?tag=…` 查不到
 * - `comfyui_run` 的参数描述还明确写着"异步路径不写索引"，把缺口写成了特性
 *
 * 这组用例钉住补上的那段接线：异步收完产物之后，索引必须多一行，`tags` 必须跟着走。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { listenSafe } from './helpers.mjs'

import { ComfyClient, RunRegistry, runTool } from '../lib/index.js'
import { recordArtifacts } from '../lib/run.js'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 一份最小可跑的工作流：只有一个 SaveImage 链，preflight 要认得全部 class_type。 */
const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 假 ComfyUI：提交成功、history 立刻完成、view 给一张 1×1 PNG。 */
async function fakeComfy() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/prompt') return json(200, { prompt_id: 'pid-1', number: 1 })
    if (url.pathname === '/object_info') {
      const info = {}
      for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
      return json(200, info)
    }
    if (url.pathname === '/queue') return json(200, { queue_running: [], queue_pending: [] })
    if (url.pathname === '/system_stats') return json(200, {})
    if (url.pathname.startsWith('/history/')) {
      return json(200, { 'pid-1': { status: { completed: true }, outputs: { 7: { images: [{ filename: 'n.png', subfolder: '', type: 'output' }] } } } })
    }
    if (url.pathname === '/view') {
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    return json(404, {})
  })
  const port = await listenSafe(server)
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

/** 等到 predicate 为真或超时（异步路径靠轮询收尾，测试也得等它）。 */
async function until(predicate, { timeoutMs = 8_000, stepMs = 30 } = {}) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, stepMs))
  }
  return predicate()
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

test('recordArtifacts：字段完整、tags 透传、单条失败不连累其余', () => {
  const added = []
  const outcome = {
    promptId: 'pid-1',
    artifacts: [
      { path: 'a.png', digest: 'd1', mime: 'image/png', bytes: 10, width: 4, height: 5 },
      { path: 'b.png', digest: 'd2', mime: 'image/png', bytes: 20 },
    ],
  }
  recordArtifacts(outcome, {
    index: {
      add: record => {
        added.push(record)
        // 第二条故意炸：索引是派生数据，一条写失败不该影响另外一条
        if (record.path === 'b.png') throw new Error('boom')
      },
    },
    workflowId: 'wf',
    workflowHash: 'hash',
    tags: ['x', 'y'],
    createdAt: '2026-01-01T00:00:00.000Z',
  })

  assert.equal(added.length, 2, '两条都要尝试登记')
  assert.deepEqual(added[0], {
    digest: 'd1',
    path: 'a.png',
    bytes: 10,
    mime: 'image/png',
    width: 4,
    height: 5,
    workflowId: 'wf',
    workflowHash: 'hash',
    promptId: 'pid-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    tags: ['x', 'y'],
    status: 'present',
  })
  // 没有宽高的产物不该带 undefined 字段（宿主那条无损 JSON 规则同样适用）
  assert.equal('width' in added[1], false)
})

test('recordArtifacts：tags 缺省是空数组，warn 只报一次一条', () => {
  const warnings = []
  recordArtifacts(
    { promptId: 'p', artifacts: [{ path: 'a.png', digest: 'd', mime: 'image/png', bytes: 1 }] },
    {
      index: { add: () => { throw new Error('boom') } },
      workflowId: 'wf',
      workflowHash: 'h',
      warn: message => warnings.push(message),
    },
  )
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /登记失败/)
})

test('comfyui_run 异步路径：产物出来后索引多一行，tags 跟着提交时的参数走', async () => {
  const comfy = await fakeComfy()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-async-index-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF), 'utf8')

  const added = []
  const notifications = []
  try {
    const deps = {
      client: new ComfyClient({ baseUrl: comfy.url, clientId: 'c1' }),
      workflowsDir: dir,
      outputDir: dir,
      timeoutMs: 30_000,
      pollIntervalMs: 30,
      overrides: new Map(),
      runs: new RunRegistry(dir),
      // 只实现真正被调用的那个方法：多写等于替生产代码猜接口
      index: { add: record => added.push(record), list: () => [], remove: () => {}, dropItems: () => {} },
      assertWritable: () => {},
    }

    const result = await runTool(deps).execute(
      { workflow: { path: file }, vars: { seed: 1 }, wait: false, tags: ['夜景', '  ', 42] },
      { agent: { followup: async message => notifications.push(message) } },
    )

    assert.equal(result.ok, true)
    assert.equal(result.pending, true, '默认路径是异步')
    assert.equal(added.length, 0, '提交那一刻还没有产物，索引不该有行')

    // 后台 watcher 收尾：索引登记 + 通知都在这之后发生
    const landed = await until(() => added.length > 0)
    assert.ok(landed, `异步收完产物后索引该有记录，实际 ${added.length} 条`)

    // **恰好一行**：watcher 是 interval 驱动的，重复登记会在这里多出来。
    // 只断言 `>0` 的话，「每条产物登记两次」这种改法照样绿。
    await sleep(200)
    assert.equal(added.length, 1, `同一产物只该登记一次，实际 ${added.length} 条`)

    // 非字符串的标签被丢掉；纯空白的那个是字符串，保留（过滤的是类型，不是内容）
    assert.deepEqual(added[0].tags, ['夜景', '  '])
    assert.equal(added[0].status, 'present')
    assert.equal(added[0].workflowId, path.basename(file, '.json'))
    assert.ok(typeof added[0].promptId === 'string' && added[0].promptId !== '')

    // sidecar 里也要有 tags：索引是可删可重建的派生数据，重建时只能靠它。
    // 这一条同时钉住 `PendingContext.tags` 那条链 —— 只靠闭包里的 tags 时，
    // 索引有标签、重建却全丢，而没有任何测试会红。
    const sidecar = JSON.parse(fs.readFileSync(`${added[0].path}.json`, 'utf8'))
    assert.deepEqual(sidecar.tags, ['夜景', '  '], 'sidecar 缺 tags 时重建索引会把标签全丢掉')

    assert.ok(await until(() => notifications.length > 0), '通知仍然要发，登记不能顶掉它')
    // 投递的是会话消息形状：{ content: [{ type: 'text', text }] }
    const noticeText = notifications[0].content.map(part => part.text).join('\n')
    assert.match(noticeText, /出图完成/)
  } finally {
    await comfy.close()
    await sleep(30)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('没有会话通道时（sweepFallback 分支）产物也要进索引', async () => {
  const comfy = await fakeComfy()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-async-index-fallback-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF), 'utf8')

  const added = []
  try {
    const deps = {
      client: new ComfyClient({ baseUrl: comfy.url, clientId: 'c2' }),
      workflowsDir: dir,
      outputDir: dir,
      timeoutMs: 30_000,
      pollIntervalMs: 30,
      overrides: new Map(),
      runs: new RunRegistry(dir),
      index: { add: record => added.push(record), list: () => [], remove: () => {}, dropItems: () => {} },
      assertWritable: () => {},
    }

    // 不传 exec.agent：走 `sweepFallback`（没有会话通道，产物只能靠后台 sweep 收）。
    // 这条分支原来连 watchRun 都不挂，是"图出了但索引里没有"的第三种入口。
    const result = await runTool(deps).execute({ workflow: { path: file }, vars: { seed: 1 }, wait: false, tags: ['兜底'] })
    assert.equal(result.pending, true)

    assert.ok(await until(() => added.length > 0), 'sweepFallback 也要登记')
    await sleep(200)
    assert.equal(added.length, 1)
    assert.deepEqual(added[0].tags, ['兜底'])
  } finally {
    await comfy.close()
    await sleep(30)
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('同一 promptId+path 只登记一次：两条路径各收一次同一份产物，不写双行', () => {
  const added = []
  const index = { add: record => added.push(record) }
  const outcome = {
    promptId: 'pid-dup',
    artifacts: [{ path: 'dup.png', digest: 'd1', mime: 'image/png', bytes: 1 }],
  }
  // 同一份 outcome 被登记两次（watcher 与续查撞车时就是这样：collectArtifacts 的单飞
  // 让两个消费者拿到同一个对象）。assets.jsonl 是追加写，不去重就是同一路径两行。
  recordArtifacts(outcome, { index, workflowId: 'wf', workflowHash: 'h' })
  recordArtifacts(outcome, { index, workflowId: 'wf', workflowHash: 'h' })
  assert.equal(added.length, 1, '同一产物不该被登记两次')

  // 但一次运行出多张时每张都要登记 —— 去重键必须带 path，不能按 promptId 一刀切
  recordArtifacts(
    { promptId: 'pid-dup', artifacts: [{ path: 'other.png', digest: 'd2', mime: 'image/png', bytes: 2 }] },
    { index, workflowId: 'wf', workflowHash: 'h' },
  )
  assert.equal(added.length, 2)
  assert.equal(added[1].path, 'other.png')
})
