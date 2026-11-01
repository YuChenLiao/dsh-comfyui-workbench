/**
 * 进度订阅的**正向路径**。
 *
 * 上一版 5 条测试全是"降级不炸"，于是掩盖了一个致命缺陷：`sweepRun` 里
 * 订阅刚建好就被自己的 `stop()` 关掉（`closed` 一置，后续事件全被吞），
 * 功能 100% 不生效而测试全绿。
 *
 * 所以这里注入一个假 WebSocket，直接验"事件真的被收到并写进注册表"。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, sweepRun, watchProgress } from '../lib/index.js'

/** 假 WebSocket：记录实例、可手工派发事件。 */
class FakeSocket {
  static instances = []
  static reset() { FakeSocket.instances = [] }
  static get last() { return FakeSocket.instances[FakeSocket.instances.length - 1] }

  constructor(url) {
    this.url = url
    this.closed = false
    this.listeners = new Map()
    FakeSocket.instances.push(this)
  }

  addEventListener(type, handler) {
    const list = this.listeners.get(type) ?? []
    list.push(handler)
    this.listeners.set(type, list)
  }

  /** 手工派发一个事件。 */
  emit(type, payload) {
    for (const handler of this.listeners.get(type) ?? []) handler(payload)
  }

  close() {
    this.closed = true
    this.emit('close', {})
  }
}

/** 装上假 WebSocket，返回还原函数。 */
function withFakeWebSocket() {
  const original = globalThis.WebSocket
  FakeSocket.reset()
  globalThis.WebSocket = FakeSocket
  return () => { globalThis.WebSocket = original }
}

/** 造一个永不完成的 client（让 sweep 一直轮询，便于观察进度）。 */
function pendingClient() {
  return {
    baseUrl: 'http://127.0.0.1:8188',
    async queue() { return { running: [], pending: [] } },
    async history() { return undefined },
    async view() { return Buffer.alloc(0) },
  }
}

test('正向：progress 事件真的写进注册表', async () => {
  const restore = withFakeWebSocket()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-'))
  const runs = new RunRegistry(dir)
  runs.submit('p1', 'wf')
  const stop = sweepRun({
    client: pendingClient(),
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 60,
    registry: runs,
    progressStream: true,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const socket = FakeSocket.last
    assert.ok(socket !== undefined, '要建一个 socket')
    // 关键：订阅**不该**在建好后立刻被关掉
    assert.equal(socket.closed, false, 'socket 建好就被关了 —— 订阅会被自己的 stop() 掐断')

    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 7, max: 20, prompt_id: 'p1' } }) })
    assert.deepEqual(runs.get('p1')?.progress, { value: 7, max: 20 }, '进度要写进注册表')

    // 换一条不相关的 prompt_id：不该串
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 19, max: 20, prompt_id: 'other' } }) })
    assert.deepEqual(runs.get('p1')?.progress, { value: 7, max: 20 }, '别人的进度不该串过来')

    // 没有 prompt_id 的也不该串
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 19, max: 20 } }) })
    assert.deepEqual(runs.get('p1')?.progress, { value: 7, max: 20 }, '缺 prompt_id 的进度要忽略')
  } finally {
    stop()
    restore()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('反向：stop() 之后 socket 被关闭', async () => {
  const restore = withFakeWebSocket()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv2-'))
  const runs = new RunRegistry(dir)
  runs.submit('p1', 'wf')
  const stop = sweepRun({
    client: pendingClient(),
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 60,
    registry: runs,
    progressStream: true,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const socket = FakeSocket.last
    assert.equal(socket.closed, false)
    stop()
    assert.equal(socket.closed, true, 'stop() 要把连接断掉，否则它活到进程结束')
  } finally {
    restore()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('默认关闭时不建 socket', async () => {
  const restore = withFakeWebSocket()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv3-'))
  const runs = new RunRegistry(dir)
  runs.submit('p1', 'wf')
  const stop = sweepRun({
    client: pendingClient(),
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 60,
    registry: runs,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    assert.equal(FakeSocket.instances.length, 0, '默认关就不该连')
  } finally {
    stop()
    restore()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('watchProgress 复用传入的 clientId（progress 带 sid，只发提交方）', async () => {
  // ComfyUI 的 `main.py:475` 是 `send_sync("progress", progress, client_id)` ——
  // 带 sid，只发给最后提交任务的客户端。独立随机 id 握手能成、status 能收，
  // 但永远收不到本任务的 progress（真机实测 20 步跑完，相关事件 0 条）。
  const restore = withFakeWebSocket()
  try {
    const stop = watchProgress('http://127.0.0.1:8188', 'p1', () => {}, { clientId: 'submitter-abc' })
    const socket = FakeSocket.last
    assert.ok(socket !== undefined, '要建 socket')
    assert.match(String(socket.url), /clientId=submitter-abc/, `URL 要带提交方的 client_id，实际 ${socket.url}`)
    stop()
  } finally {
    restore()
  }
})

test('sweepRun 开了 progressStream 会把客户端的 client_id 接下去', async () => {
  const restore = withFakeWebSocket()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pv4-'))
  const runs = new RunRegistry(dir)
  runs.submit('p1', 'wf')
  const stop = sweepRun({
    // 模拟真实的 ComfyClient：它有公开的 clientId（与提交时用的同一个）
    client: { ...pendingClient(), clientId: 'client-from-submit' },
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 60,
    registry: runs,
    progressStream: true,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const socket = FakeSocket.last
    assert.ok(socket !== undefined, '开了就该连')
    assert.match(String(socket.url), /clientId=client-from-submit/, `要复用提交方的 id，实际 ${socket.url}`)
  } finally {
    stop()
    restore()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('watchProgress 自身：正向拿到 tick，取消后关闭', async () => {
  const restore = withFakeWebSocket()
  try {
    const ticks = []
    const stop = watchProgress('http://127.0.0.1:8188', 'p1', tick => ticks.push(tick))
    const socket = FakeSocket.last
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 3, max: 10, prompt_id: 'p1' } }) })
    assert.deepEqual(ticks, [{ value: 3, max: 10 }])
    stop()
    assert.equal(socket.closed, true)
    // 取消之后再来的事件不该回调
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 9, max: 10, prompt_id: 'p1' } }) })
    assert.equal(ticks.length, 1)
  } finally {
    restore()
  }
})

test('max 缺失时填 0', async () => {
  const restore = withFakeWebSocket()
  try {
    const ticks = []
    const stop = watchProgress('http://127.0.0.1:8188', 'p1', tick => ticks.push(tick))
    const socket = FakeSocket.last
    socket.emit('open', {})
    socket.emit('message', { data: JSON.stringify({ type: 'progress', data: { value: 5, prompt_id: 'p1' } }) })
    assert.deepEqual(ticks, [{ value: 5, max: 0 }])
    stop()
  } finally {
    restore()
  }
})
