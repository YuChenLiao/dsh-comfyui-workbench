/**
 * 进度订阅的降级行为。
 *
 * WebSocket 是本插件唯一的长连接，也最容易在别人的网络环境里翻车。
 * 所以核心契约是：**连不上就静默什么都不做**，调用方照样靠轮询出图。
 *
 * 本机 ComfyUI 离线，所以这里只验"降级不炸"，不验真实百分比。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { watchProgress } from '../lib/index.js'

test('连不上时返回可调用的取消函数，不抛', () => {
  // 端口 1 上没人监听
  const stop = watchProgress('http://127.0.0.1:1', 'p1', () => {})
  assert.equal(typeof stop, 'function')
  stop()
  stop() // 幂等
})

test('取消之后不再回调', async () => {
  let ticks = 0
  const stop = watchProgress('http://127.0.0.1:1', 'p1', () => { ticks += 1 })
  stop()
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(ticks, 0)
})

test('地址不合法也不抛', () => {
  const stop = watchProgress('not a url', 'p1', () => {})
  assert.equal(typeof stop, 'function')
  stop()
})

test('没有全局 WebSocket 时降级成空操作', () => {
  const original = globalThis.WebSocket
  // @ts-expect-error 故意删掉
  delete globalThis.WebSocket
  try {
    const stop = watchProgress('http://127.0.0.1:8188', 'p1', () => {})
    assert.equal(typeof stop, 'function')
    stop()
  } finally {
    globalThis.WebSocket = original
  }
})

test('sweepRun 在 progressStream 关闭时行为不变（默认关）', async () => {
  const { RunRegistry, sweepRun } = await import('../lib/index.js')
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'))
  const runs = new RunRegistry(dir)
  runs.submit('p1', 'wf')
  const client = {
    baseUrl: 'http://127.0.0.1:1',
    async queue() { return { running: [], pending: [] } },
    async history() {
      const error = new Error('/history 返回 500')
      error.code = 'comfy_unreachable'
      throw error
    },
    async view() { return Buffer.alloc(0) },
  }
  const stop = sweepRun({
    client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 40,
    registry: runs,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    // 默认不订阅进度，但轮询照常工作：连续失败到上限会收敛
    const startedAt = Date.now()
    while (Date.now() - startedAt < 3_000) {
      if (runs.get('p1')?.state === 'unknown') break
      await new Promise(resolve => setTimeout(resolve, 40))
    }
    assert.equal(runs.get('p1')?.state, 'unknown', '默认关进度不影响轮询收敛')
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
