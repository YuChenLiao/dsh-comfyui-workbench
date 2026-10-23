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

import { ComfySupervisor, detectInstallation } from '../lib/comfy.js'

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
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

test('detectInstallation：认 main.py + models，不认空目录', () => {
  const good = fakeInstall()
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-empty-'))
  assert.equal(detectInstallation([good]), good)
  assert.equal(detectInstallation([empty]), undefined, '空目录不算安装')
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
