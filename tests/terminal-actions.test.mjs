/**
 * 终端面板：外部实例的死状态、关机路由与按钮决策表。
 *
 * 三件事各自钉住：
 * 1. `external` 没有天然出口 —— 别人把 ComfyUI 关掉后必须能自己回到 `unknown`，
 *    否则面板永久停在「外部实例」、启动按钮永不出现；
 * 2. 「关机」必须走终端自己的路由，不能借 `panel.workflow` 的 `/service/stop`
 *    （关掉工作流面板后那条路由不在，点一下就是 404）；
 * 3. 外部实例的关机按钮只能是灰的 —— 杀别人的进程是越界。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const { ComfySupervisor, queueBusy } = await import('../lib/comfy.js')
const { createTerminalRoutes } = await import('../lib/index.js')

const require = createRequire(import.meta.url)

async function loadClientModule() {
  let captured = null
  const prevWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: { load: spec => { captured = spec } },
  }
  try {
    await import('../lib/client.js?terminal-actions=' + Date.now())
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
  assert.ok(captured, 'client.js 应当向 ModuleLoader 注册 factory')
  return captured.factory(require)
}

// ── 1. 按钮决策表 ──────────────────────────────────────────────
test('按钮决策：外部实例只有灰掉的关机，且不算「未启动」', async () => {
  const mod = await loadClientModule()
  const { terminalActions } = mod.__test

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'external', managed: false, busy: false }),
    { canStart: false, canStop: false, stopDisabled: true, confirmBeforeStop: false },
    '外部实例不能给启动（会拉起第二个），也不能给可点的关机',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'unknown', managed: false, busy: false }),
    { canStart: true, canStop: false, stopDisabled: false, confirmBeforeStop: false },
    '未启动时 managed 也是 false，但必须给启动而不是灰关机',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: false, state: 'unknown', managed: false, busy: false }),
    { canStart: false, canStop: false, stopDisabled: false, confirmBeforeStop: false },
    '还没拿到状态时不显示任何动作',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'starting', managed: false, busy: false }),
    { canStart: false, canStop: false, stopDisabled: false, confirmBeforeStop: false },
    '拉起中两个按钮都不给',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'ready', managed: true, busy: false }),
    { canStart: false, canStop: true, stopDisabled: false, confirmBeforeStop: false },
    '受管且就绪：可以关机，空闲时不弹确认',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'ready', managed: true, busy: true }),
    { canStart: false, canStop: true, stopDisabled: false, confirmBeforeStop: true },
    '正在出图：关机前必须二次确认',
  )

  assert.deepEqual(
    terminalActions({ hasStatus: true, state: 'ready', managed: false, busy: false }),
    { canStart: false, canStop: false, stopDisabled: false, confirmBeforeStop: false },
    '就绪但不是我们拉起的：不给关机',
  )
})

// ── 2. supervisor 的 external 出口 ──────────────────────────────
test('supervisor：外部实例关掉后能自己回到 unknown，且不留旧 detail', async () => {
  const original = globalThis.fetch
  let alive = true
  globalThis.fetch = async () => (alive
    ? { ok: true, json: async () => ({}) }
    : Promise.reject(new Error('ECONNREFUSED')))
  try {
    const sup = new ComfySupervisor({ baseUrl: 'http://127.0.0.1:9', readyTimeoutMs: 100 })

    assert.equal(await sup.ensureReady(), true)
    const first = sup.status()
    assert.equal(first.state, 'external')
    assert.equal(first.managed, false)
    assert.match(String(first.detail), /外部实例/, '切到 external 时要写原因，别留着上一次的报错')

    // 外部实例真的还在：复查返回 true，状态不变
    assert.equal(await sup.recheckExternal(50), true)
    assert.equal(sup.status().state, 'external')

    // 别人把它关了：一次复查就该回到 unknown
    alive = false
    assert.equal(await sup.recheckExternal(50), false)
    const after = sup.status()
    assert.equal(after.state, 'unknown', '外部实例消失后必须回到 unknown，否则启动按钮永远不出现')
    assert.match(String(after.detail), /不在运行/)

    // 非 external 状态没有可复查的东西
    assert.equal(await sup.recheckExternal(50), false)
  } finally {
    globalThis.fetch = original
  }
})

// ── 3. 终端路由：stop 与 busy ──────────────────────────────────
function makeDeps(overrides = {}) {
  const state = { status: { state: 'ready', managed: true, baseUrl: 'http://x' } }
  const calls = { stopped: 0, rechecked: 0, busy: 0 }
  const deps = {
    buffer: { since: () => ({ lines: [], cursor: 0, dropped: 0, epoch: 'e' }), clear: () => {} },
    status: () => state.status,
    start: () => {},
    stop: () => { calls.stopped += 1; state.status = { ...state.status, state: 'unknown', managed: false }; return true },
    recheckExternal: async () => { calls.rechecked += 1; return true },
    busy: async () => { calls.busy += 1; return true },
    ...overrides,
  }
  return { deps, state, calls }
}

async function callRoute(deps, url, method = 'GET') {
  const table = createTerminalRoutes(deps)
  const res = {
    statusCode: 0,
    body: '',
    writeHead(status) { this.statusCode = status },
    setHeader() {},
    end(body) { this.body = body },
    on() {},
  }
  const req = { method }
  await table['/terminal'](new URL(url, 'http://localhost'), res, req)
  return { code: res.statusCode, json: JSON.parse(res.body) }
}

test('终端路由：POST action=stop 停的是自己的进程，不碰 workflow 的 /service/stop', async () => {
  const { deps, calls } = makeDeps()
  const { code, json } = await callRoute(deps, 'http://localhost/terminal?action=stop', 'POST')
  assert.equal(code, 200)
  assert.equal(json.ok, true)
  assert.equal(json.stopped, true)
  assert.equal(calls.stopped, 1, 'stop 必须真的调到 supervisor')

  // 部署没开放 stop 时明说，而不是假装成功
  const { deps: bare } = makeDeps({ stop: undefined })
  const r = await callRoute(bare, 'http://localhost/terminal?action=stop', 'POST')
  assert.equal(r.code, 501)
  assert.equal(r.json.ok, false)
})

test('终端路由：只有受管实例就绪时才探测队列，外部实例不探测', async () => {
  const managed = makeDeps()
  const a = await callRoute(managed.deps, 'http://localhost/terminal')
  assert.equal(a.json.busy, true)
  assert.equal(managed.calls.busy, 1)

  const external = makeDeps()
  external.state.status = { state: 'external', managed: false, baseUrl: 'http://x' }
  const b = await callRoute(external.deps, 'http://localhost/terminal')
  assert.equal(b.json.busy, false, '外部实例没有关机按钮，不该为此多发一次请求')
  assert.equal(external.calls.busy, 0)
  assert.equal(external.calls.rechecked, 1, '外部实例每次读状态都要复查一次')

  // 复查后状态可能已经变了（外部实例被关掉）
  const gone = makeDeps({
    recheckExternal: async () => { goneState.status = { state: 'unknown', managed: false, baseUrl: 'http://x' }; return false },
  })
  const goneState = { status: { state: 'external', managed: false, baseUrl: 'http://x' } }
  gone.deps.status = () => goneState.status
  const c = await callRoute(gone.deps, 'http://localhost/terminal')
  assert.equal(c.json.status.state, 'unknown', '复查结果要反映在这一轮的响应里')
})

test('queueBusy 对外部不可达地址返回 false，不抛错', async () => {
  assert.equal(await queueBusy('http://127.0.0.1:9', 50), false)
})
