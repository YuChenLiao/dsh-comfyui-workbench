/**
 * 服务托管自检：探测、外部实例只读、失败可解释。
 *
 * 最要紧的一条：**外部在跑的实例永不停止**。这是托管的基本边界，
 * 停错进程比连不上严重得多。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { listenSafe } from './helpers.mjs'

import { ComfySupervisor, detectInstallation, queueBusy, shouldReclaim } from '../lib/comfy.js'

/**
 * 空闲回收的三条语义。主路径要 spawn 真进程，端到端测不划算，
 * 但判定错了就是误杀实例，必须逐条钉住。
 */
test('shouldReclaim：关掉回收 / 没到点 / 忙 三种情况都不回收', () => {
  assert.equal(shouldReclaim({ idledMs: 999_999, idleShutdownMs: 0, busy: false }), false, 'idleShutdownMs=0 等于关掉回收')
  assert.equal(shouldReclaim({ idledMs: 100, idleShutdownMs: 300_000, busy: false }), false, '没到点不回收')
  assert.equal(shouldReclaim({ idledMs: 300_000, idleShutdownMs: 300_000, busy: true }), false, '有任务在跑就不能回收')
  assert.equal(shouldReclaim({ idledMs: 300_000, idleShutdownMs: 300_000, busy: false }), true, '真闲了才回收')
})

/**
 * 空闲回收前必须问队列。
 *
 * 这条守的是一个很隐蔽的事故：异步提交之后模型不再调用任何工具，`lastUsedAt` 停住，
 * 于是一个**正在跑图**的实例会被判成空闲、到点被插件自己 kill —— 与"用户手动杀进程"
 * 是同一个后果，但界面上只说"已停止本插件拉起的进程"。
 */
async function queueServer(body) {
  const server = http.createServer((req, res) => {
    if (req.url === '/queue') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
      return
    }
    res.writeHead(404)
    res.end()
  })
  const port = await listenSafe(server)
  return { url: `http://127.0.0.1:${port}`, close: () => new Promise(resolve => server.close(resolve)) }
}

test('queueBusy：有任务在跑或在排队就算忙，读不到算闲', async () => {
  const running = await queueServer({ queue_running: [[0, 'pid-1']], queue_pending: [] })
  const pending = await queueServer({ queue_running: [], queue_pending: [[1, 'pid-2']] })
  const idle = await queueServer({ queue_running: [], queue_pending: [] })
  // 上游改过键名：旧的 `running` / `pending` 也要认，否则会静默判成"没活"去杀进程
  const legacy = await queueServer({ running: [[0, 'pid-3']], pending: [] })
  // 元素形状认不出来，但数组非空本身就是"有活"
  const odd = await queueServer({ queue_running: [{ weird: true }], queue_pending: [] })
  const broken = await queueServer(null)
  try {
    assert.equal(await queueBusy(running.url), true, '正在跑 = 忙，回收必须让路')
    assert.equal(await queueBusy(pending.url), true, '排队中 = 忙，回收必须让路')
    assert.equal(await queueBusy(legacy.url), true, '旧键名 running 也要认')
    assert.equal(await queueBusy(odd.url), true, '元素形状认不出但数组非空，仍算忙')
    assert.equal(await queueBusy(idle.url), false, '队列空了才算真的闲')
    assert.equal(await queueBusy(broken.url), false, '响应不是对象时不崩，算闲')
    assert.equal(await queueBusy('http://127.0.0.1:9'), false, '连不上算闲：回收才是对的')
  } finally {
    await running.close()
    await pending.close()
    await idle.close()
    await legacy.close()
    await odd.close()
    await broken.close()
  }
})

/** 造一个像 ComfyUI 的目录（main.py + models/）。 */
function fakeInstall() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-comfy-'))
  fs.writeFileSync(path.join(dir, 'main.py'), '# fake\n', 'utf8')
  fs.mkdirSync(path.join(dir, 'models'), { recursive: true })
  return dir
}

/** 起一个假的 /system_stats 服务。 */
async function fakeRunning() {
  const server = http.createServer((req, res) => {
    if (req.url === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"system":{}}')
      return
    }
    res.writeHead(404)
    res.end()
  })
  const port = await listenSafe(server)
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('detectInstallation：认 main.py + models，不认空目录', () => {
  const good = fakeInstall()
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-empty-'))
  assert.equal(detectInstallation([good]), good)
  // 注意：detectInstallation 还会扫环境变量与常见位置，所以这里只能断言
  // "空目录本身没被当成安装"，不能断言整体返回 undefined（本机可能真装着 ComfyUI）。
  assert.notEqual(detectInstallation([empty]), empty, '空目录不算安装')
})

test('外部实例在跑：只用不托管，且 stop 不动它', async () => {
  const running = await fakeRunning()
  const supervisor = new ComfySupervisor({
    baseUrl: running.url,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 5_000,
    idleShutdownMs: 0,
  })

  try {
    assert.equal(await supervisor.ensureReady(), true)
    const status = supervisor.status()
    assert.equal(status.state, 'external')
    assert.equal(status.managed, false)

    assert.equal(supervisor.stop(), false, '外部实例不该被停')
    // 还在应答，证明没被停掉
    const res = await fetch(`${running.url}/system_stats`)
    assert.equal(res.ok, true)
  } finally {
    supervisor.dispose()
    await running.close()
  }
})

test('连不上且未开启自动探测：失败并给出原因', async () => {
  const supervisor = new ComfySupervisor({
    baseUrl: 'http://127.0.0.1:9', // 必然没人听
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })

  try {
    assert.equal(await supervisor.ensureReady(), false)
    const status = supervisor.status()
    assert.equal(status.state, 'failed')
    assert.ok(typeof status.detail === 'string' && status.detail.includes('127.0.0.1:9'))
  } finally {
    supervisor.dispose()
  }
})

test('已安装但 autoStart 关闭：不拉进程', async () => {
  const dir = fakeInstall()
  const supervisor = new ComfySupervisor({
    baseUrl: 'http://127.0.0.1:9',
    autoDetect: true,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })

  try {
    assert.equal(await supervisor.ensureReady(), false)
    assert.equal(supervisor.status().managed, false)
    assert.ok(fs.existsSync(path.join(dir, 'main.py')), '模板目录没被动过')
  } finally {
    supervisor.dispose()
  }
})
