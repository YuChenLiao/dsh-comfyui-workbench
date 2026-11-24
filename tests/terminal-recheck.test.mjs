/**
 * external 状态卡死：外部实例被关掉之后，面板永久卡在 `external`，
 * 「启动」不出现、灰「关机」点不动，想恢复只能重启 Harness。
 *
 * 根因与方案见 `docs/10-external状态卡死-根因与修复.md`。这里只钉两个预先约定的 seam：
 *
 *   A. `ComfySupervisor.recheckExternal()` —— 状态机补的那条边
 *   B. `GET /terminal` —— 那条边真的被路由接上了
 *
 * **为什么两个都要**：只测 A，路由忘了接线就是"全绿但真机还是卡"
 * （`tests/arch-write-routes.mjs` 正是被这类事故逼出来的）；只测 B，
 * 状态机的边界（探通不许抖动、非 external 一次都不许探）不好断言。
 *
 * `canStart` 不单独测：它自 v0.7.0 起逐字未变，`state` 回到 `unknown` 之后它自然为真，
 * 再测等于测常量。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * 假 ComfyUI：`/system_stats` 的成败可切换，并记下被探了几次。
 *
 * **探不通用 500 而不是关端口**：关了端口就数不到探测次数，而这条修复最要紧的两个
 * 断言恰恰是"探了几次"——非 `external` 状态下一次都不许探。端口留着、答案变 500，
 * 对 `probe()` 来说与"进程没了"等价（它只看 `res.ok`），计数却还在。
 */
async function fakeProbe() {
  const http = await import('node:http')
  const { listenSafe } = await import('./helpers.mjs')
  let up = true
  let hits = 0
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/system_stats') {
      hits += 1
      // 不 up 时照样应答，只是不 ok —— 模拟"进程没了"对 probe 的语义
      res.writeHead(up ? 200 : 500, { 'Content-Type': 'application/json' })
      res.end('{"system":{}}')
      return
    }
    res.writeHead(404).end('{}')
  })
  const port = await listenSafe(server)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits: () => hits,
    reset: () => { hits = 0 },
    kill: () => { up = false },
    revive: () => { up = true },
    close: () => new Promise(resolve => { server.close(resolve) }),
  }
}

/** 拿一个当前没人听的端口（给真子进程用）。 */
async function reservePort() {
  const http = await import('node:http')
  const { listenSafe } = await import('./helpers.mjs')
  const probeServer = http.createServer()
  const port = await listenSafe(probeServer)
  await new Promise(resolve => { probeServer.close(resolve) })
  return port
}

// ── Seam A：状态机补的那条边 ──

test('recheckExternal：外部实例关掉后退回 unknown，让「启动」按钮回来', async () => {
  // 这是唯一的出口。少了它，`external` 就是只能进不能出的状态：
  // 没有 child 就没有 exit 事件，空闲回收定时器在 child === null 时自清，
  // 而 /terminal 只读 status() 不探测 —— 三条路全堵死。
  const { ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeProbe()
  let closed = false
  const shutdown = async () => {
    if (closed) return
    closed = true
    await comfy.close()
  }
  const sup = new ComfySupervisor({
    baseUrl: comfy.baseUrl,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })
  try {
    assert.equal(await sup.ensureReady(), true, '假 ComfyUI 应当在跑')
    assert.equal(sup.status().state, 'external', '不是我们拉起的，应当判为 external')

    // 用户把外部 ComfyUI 关了 —— 真的关端口，这是现场的样子
    await shutdown()

    // 端口已关时连接被即时 RST，不该抛；probe() 自己吃掉异常，这里验的是
    // recheckExternal 也不把它漏出来（漏出来就是 GET /terminal 整轮 500）
    assert.equal(await sup.recheckExternal(), true, '探不通要报告"已翻状态"')
    assert.equal(sup.status().state, 'unknown', '必须退回 unknown，否则面板永久卡在 external')
    assert.equal(sup.status().managed, false, '不是我们拉起的，managed 不能凭空变 true')
    assert.equal(
      sup.status().detail,
      '外部实例已不在运行。',
      'detail 要说清原因 —— 实测见过这里留着上一轮的「已停止本插件拉起的进程。」，完全对不上',
    )
  } finally {
    await shutdown()
    sup.dispose()
  }
})

test('recheckExternal：外部实例还活着就保持 external，不许抖动', async () => {
  // 抖动一次就是灰「关机」和「启动」来回跳。活着就不许改状态 ——
  // 而"活着"这一侧必须每次都真探，否则"关掉了"永远发现不了。
  const { ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeProbe()
  const sup = new ComfySupervisor({
    baseUrl: comfy.baseUrl,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })
  try {
    await sup.ensureReady()
    assert.equal(sup.status().state, 'external')

    comfy.reset()
    assert.equal(await sup.recheckExternal(), false, '探通就没翻状态，返回 false')
    assert.equal(sup.status().state, 'external', '还在跑就必须保持 external')
    assert.equal(comfy.hits(), 1, '活着的情况每次复查要真探一次，不多不少')

    // 探通之后紧接着关掉：下一轮必须能发现（证明它没有缓存上一次的答案）
    comfy.kill()
    assert.equal(await sup.recheckExternal(), true)
    assert.equal(sup.status().state, 'unknown')
  } finally {
    await comfy.close()
    sup.dispose()
  }
})

test('recheckExternal：unknown / failed / starting 一次都不许探', async () => {
  // 这条守的是**双重拉起**：`starting` 期间服务本来就还没起来，探一定不通。
  // 若按"探不通就翻 unknown"处理，面板会在进程正在启动时弹出「启动」，
  // 用户点下去就是第二个 ComfyUI —— 比原来的卡死严重得多。
  const { ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeProbe()
  const sup = new ComfySupervisor({
    baseUrl: comfy.baseUrl,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })
  try {
    // ① unknown：还没探测过，谁也没说这里该有服务
    comfy.reset()
    assert.equal(await sup.recheckExternal(), false, 'unknown 时不该翻状态')
    assert.equal(comfy.hits(), 0, 'unknown 时一次都不许探')
    assert.equal(sup.status().state, 'unknown', '不许顺手改状态')

    // ② failed：已经明确失败过，文案就是给用户看的，不能被悄悄抹成 unknown
    comfy.kill()
    assert.equal(await sup.ensureReady(), false)
    assert.equal(sup.status().state, 'failed')
    comfy.reset()
    assert.equal(await sup.recheckExternal(), false)
    assert.equal(comfy.hits(), 0, 'failed 时一次都不许探')
    assert.equal(sup.status().state, 'failed', 'failed 的文案要留着，不能被抹成 unknown')

    // ③ starting：子进程在启动但永远不就绪（这里让它睡够），服务探不通
    const sleeper = [process.execPath, '-e', 'setTimeout(() => {}, 30000)']
    const starting = new ComfySupervisor({
      baseUrl: comfy.baseUrl,
      autoDetect: false,
      autoStart: false,
      startCommand: sleeper,
      readyTimeoutMs: 30_000,
      idleShutdownMs: 0,
    })
    try {
      const pending = starting.ensureReady()
      await sleep(300)
      assert.equal(starting.status().state, 'starting', '应当已经进入 starting 并 spawn 出进程')
      comfy.reset()
      assert.equal(await starting.recheckExternal(), false, 'starting 时不许翻状态')
      assert.equal(comfy.hits(), 0, 'starting 时一次都不许探 —— 探不通就翻 unknown = 双重拉起')
      assert.equal(starting.status().state, 'starting', '状态不许被改')
      starting.stop()
      await pending
    } finally {
      starting.stop()
      starting.dispose()
    }
  } finally {
    await comfy.close()
    sup.dispose()
  }
})

test('recheckExternal：插件自己拉起的 ready 实例不复查（探一下就可能把好实例判死）', async () => {
  // `ready && managed` 时我们有个活着的 child。按"探不通就翻 unknown"处理的话，
  // 一次瞬时抖动就会把能用的实例标成"没在跑"，面板露出「启动」——
  // 用户点下去，`ensureReady()` 先探一次（这次可能探通）就直接复用了，
  // 但如果那时确实探不通，就是第二个进程。
  const { ComfySupervisor } = await import('../lib/index.js')
  const port = await reservePort()
  // 子进程自己数被探几次：go ready 之后一次都不该再涨
  const script = [
    'const http = require("node:http")',
    'let n = 0',
    'http.createServer((q, s) => {',
    '  if (q.url === "/system_stats") { n += 1; s.writeHead(200, {"Content-Type":"application/json"}); s.end("{}"); return }',
    '  if (q.url === "/probes") { s.writeHead(200, {"Content-Type":"application/json"}); s.end(String(n)); return }',
    '  s.writeHead(404).end()',
    `}).listen(${port}, "127.0.0.1")`,
  ].join('\n')
  const sup = new ComfySupervisor({
    baseUrl: `http://127.0.0.1:${port}`,
    autoDetect: false,
    autoStart: false,
    startCommand: [process.execPath, '-e', script],
    readyTimeoutMs: 15_000,
    idleShutdownMs: 0,
  })
  try {
    assert.equal(await sup.ensureReady(), true, '子进程应当在 15 秒内就绪')
    const status = sup.status()
    assert.equal(status.state, 'ready')
    assert.equal(status.managed, true, '这次是我们拉起的，managed 要为 true')

    const probes = async () => Number(await (await fetch(`http://127.0.0.1:${port}/probes`)).text())
    const before = await probes()
    assert.equal(await sup.recheckExternal(), false, 'ready 时不该翻状态')
    assert.equal(await probes(), before, 'ready 时一次都不许探 —— 探一下就可能把能用的实例判死')
    assert.equal(sup.status().state, 'ready', '状态不许被改')
  } finally {
    sup.stop()
    sup.dispose()
  }
})

test('ensureReady 判成 external 时要写对 detail，不能留着上一轮的旧话', async () => {
  // 现场实测见过 `state: "external"` 配着 `detail: "已停止本插件拉起的进程。"` ——
  // 上一轮 stop() 留的话，与"外部实例在跑"完全对不上。翻状态时一并写正确文案。
  const { ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeProbe()
  const sup = new ComfySupervisor({
    baseUrl: comfy.baseUrl,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })
  try {
    // 先留一句"停过"的旧话（stop() 在没进程时就是这个返回值）
    assert.equal(sup.stop(), false)
    assert.equal(sup.status().detail, '没有本插件拉起的进程，未停止任何东西。')

    // 然后外部实例起来了
    assert.equal(await sup.ensureReady(), true)
    assert.equal(sup.status().state, 'external')
    assert.notEqual(
      sup.status().detail,
      '没有本插件拉起的进程，未停止任何东西。',
      '判成 external 就必须换掉旧文案，否则界面上给出的是与状态矛盾的说明',
    )
  } finally {
    await comfy.close()
    sup.dispose()
  }
})

test('误判保护：recheck 判死后点「启动」不会双开（2s/3s 反向超时是刻意的）', async () => {
  // 这是这次修复唯一可能**引入**的新风险，必须钉死。
  //
  // recheckExternal 用 2 秒，ensureReady 的 probe 用 3 秒，方向相反：复查偏向"容易判死"
  // （判死的代价只是按钮闪一下），就绪判定偏向"容易判活"（判活才能复用已有实例）。
  // 于是外部实例正在满载出图、2 秒内没响应时，会被误判成"不在了"、按钮闪出「启动」。
  // 此时点下去：ensureReady() **先探一次再决定拉不拉**，探通就直接复用 —— 不会双开。
  //
  // 这条用例真的去 spawn：`spawned` 计数为 0 才算过。只断言 state 是不够的 ——
  // 万一 ensureReady 变成"先拉再探"，state 依然会停在 external，双开却已经发生了。
  const { ComfySupervisor } = await import('../lib/index.js')
  const http = await import('node:http')
  const { listenSafe } = await import('./helpers.mjs')

  // 慢实例：每个 /system_stats 都拖 800ms 才答。对 300ms 的复查是"探不通"，
  // 对 3s 的 ensureReady 是"探得通" —— 正是那个误判窗口。
  const slow = http.createServer((req, res) => {
    if (req.url === '/system_stats') {
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"system":{}}')
      }, 800)
      return
    }
    res.writeHead(404).end()
  })
  const port = await listenSafe(slow)

  // 双开的证据要落盘：子进程可能在断言之前就退出了（`managed` 又变回 false），
  // 只看 status 会漏判。让"被拉起"这件事留下一个文件，才是不可赖掉的证据。
  const marker = path.join(
    (await import('node:os')).tmpdir(),
    `cwf-recheck-doublelaunch-${process.pid}-${Date.now()}.txt`,
  )
  const sup = new ComfySupervisor({
    baseUrl: `http://127.0.0.1:${port}`,
    autoDetect: false,
    autoStart: true,
    // 真能拉起的命令：只写标记，不去抢端口（抢了反而测不出"有没有多拉一个"）
    startCommand: [process.execPath, '-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'spawned')`],
    readyTimeoutMs: 2_000,
    idleShutdownMs: 0,
  })
  try {
    // ensureReady 用 3s 超时，慢实例答得上来 → 判 external
    assert.equal(await sup.ensureReady(), true, '慢实例在 3s 内应当探得通')
    assert.equal(sup.status().state, 'external')

    // 复查只给 300ms：慢实例答不上来 → 误判成"不在了"
    assert.equal(await sup.recheckExternal(300), true, '短超时下应当误判并翻状态')
    assert.equal(sup.status().state, 'unknown', '误判的现场：按钮确实会闪出「启动」')

    // 用户点了「启动」。ensureReady 先探（3s），慢实例这次答得上来 → 复用，不拉进程
    const ok = await sup.ensureReady()
    assert.equal(ok, true, '点「启动」要能成功')
    assert.equal(fs.existsSync(marker), false, '一个进程都不许拉 —— 探通了就该复用，双开比卡死严重得多')
    assert.equal(sup.status().managed, false, 'managed 必须还是 false：说明真的没拉新进程')
    assert.equal(sup.status().state, 'external', '状态回到 external，灰「关机」又出现')
    assert.equal(sup.status().detail, '复用已在运行的外部实例。', '文案要对得上实际发生的事')
  } finally {
    await new Promise(resolve => { slow.closeAllConnections?.(); slow.close(resolve) })
    sup.stop()
    sup.dispose()
    if (fs.existsSync(marker)) fs.unlinkSync(marker)
  }
})

// ── Seam B：那条边真的接上了（真 HTTP，不是打桩） ──

test('GET /terminal：外部实例关掉后，下一轮轮询就回到 unknown', async () => {
  // 只测状态机是不够的：`/terminal` 的 GET 分支如果没调 recheck，
  // 状态机再对也永远没人触发它 —— 这正是 arch-write-routes.mjs 记的那类事故。
  const { createTerminalRoutes, TerminalBuffer, ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeProbe()
  const sup = new ComfySupervisor({
    baseUrl: comfy.baseUrl,
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1_000,
    idleShutdownMs: 0,
  })
  try {
    await sup.ensureReady()
    assert.equal(sup.status().state, 'external')

    const routes = createTerminalRoutes({
      buffer: new TerminalBuffer(10),
      status: () => sup.status(),
      start: () => {},
      recheck: () => sup.recheckExternal(),
    })
    const get = async () => {
      let payload
      await routes['/terminal'](
        new URL('http://x/terminal?since=0'),
        { writeHead: () => {}, end: body => { payload = JSON.parse(body) } },
        { method: 'GET' },
      )
      return payload
    }

    const alive = await get()
    assert.equal(alive.status.state, 'external', '还活着就是 external，别乱翻')
    assert.equal(alive.ok, true)

    comfy.kill() // 用户把外部实例关了
    const gone = await get()
    assert.equal(gone.status.state, 'unknown', '关掉之后下一轮就必须变成 unknown，否则「启动」永远不出现')
    assert.equal(gone.status.managed, false)
    assert.equal(gone.status.detail, '外部实例已不在运行。')

    // 幂等：再拉一轮还是 unknown，不该反复改文案或抛错
    const again = await get()
    assert.equal(again.status.state, 'unknown')
    assert.equal(again.ok, true)
  } finally {
    await comfy.close()
    sup.dispose()
  }
})

test('GET /terminal：没注入 recheck 就维持原样（其它调用方不受影响）', async () => {
  // recheck 是可选的：`tests/terminal.test.mjs` 等处手工拼 deps，
  // 少传一个依赖不该让整条路由坏掉。
  const { createTerminalRoutes, TerminalBuffer } = await import('../lib/index.js')
  const routes = createTerminalRoutes({
    buffer: new TerminalBuffer(10),
    status: () => ({ state: 'external', managed: false, baseUrl: 'http://127.0.0.1:8188' }),
    start: () => {},
  })
  let payload
  await routes['/terminal'](
    new URL('http://x/terminal?since=0'),
    { writeHead: () => {}, end: body => { payload = JSON.parse(body) } },
    { method: 'GET' },
  )
  assert.equal(payload.ok, true)
  assert.equal(payload.status.state, 'external', '没有 recheck 就照抄 status，不自己发明状态')
})

test('entries/terminal.ts 必须把 recheck 接进路由（漏了就是测试全绿、真机还是卡）', () => {
  // seam B 用假 deps 挂上了 recheck，但真机上 `entries/terminal.ts` 忘了传，
  // 表现与没修一样 —— 而所有测试照样全绿。这是结构性检查，不是行为测试。
  const src = fs.readFileSync(path.join(here, '..', 'src', 'entries', 'terminal.ts'), 'utf8')
  assert.match(
    src,
    /recheck:\s*\(\)\s*=>\s*rt\.supervisor\.recheckExternal\(\)/,
    'entries/terminal.ts 必须把 recheck 接到 supervisor.recheckExternal()',
  )
})
