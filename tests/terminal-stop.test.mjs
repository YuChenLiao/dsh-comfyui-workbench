/**
 * 终端面板的「关机」按钮：后端那条 busy 链路，以及客户端接线。
 *
 * 判定表（哪个状态给什么按钮、要不要确认）在 `tests/render.mjs` 里打表 ——
 * 那里已经为了 SSR 自检把客户端 bundle 的 `__test` 挂起来了，纯函数放一起最省事，
 * 也和 `shouldLoadMore` / `planPage` 的既有位置一致。
 *
 * 这里只留下纯函数够不着的两段：
 * 1. **后端的 busy 到底怎么来的** —— 什么时候才该去问队列，必须打真 HTTP。
 * 2. **客户端接线** —— 按钮打哪个接口。走错就是"点了没反应"，任何纯函数都测不到。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

// ── 后端的 busy 是怎么来的（真 server，不是打桩） ──

/**
 * 起一个假的 ComfyUI，`/queue` 的答案由用例控制。
 *
 * 这条链路最容易错的地方是"什么时候才该问队列"：`/terminal` 是 1 秒轮询，
 * 而 `queueBusy` 自带 2 秒超时。如果无条件去问，服务半死（端口不响应）时
 * 轮询会被拖成 3 秒一次，面板看起来就是卡住；而外部实例的队列压根不归我们管。
 * 用假 server 记 `queueHits` 就能把这两面都钉死。
 */
async function fakeComfy(queueBusyAnswer) {
  const http = await import('node:http')
  const { listenSafe } = await import('./helpers.mjs')
  let queueHits = 0
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    if (url.pathname === '/queue') {
      queueHits += 1
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // 形状按真实 /queue：running 与 pending 两个数组
      res.end(JSON.stringify({
        queue_running: queueBusyAnswer ? [[1, 'pid-1', {}, {}, []]] : [],
        queue_pending: [],
      }))
      return
    }
    if (url.pathname === '/system_stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ system: {} }))
      return
    }
    res.writeHead(404).end('{}')
  })
  const port = await listenSafe(server)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    hits: () => queueHits,
    close: () => new Promise(resolve => { server.close(resolve) }),
  }
}

test('GET /terminal 只有在 ready && managed 时才真去问 /queue', async () => {
  const { createTerminalRoutes, TerminalBuffer, ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeComfy(true)
  try {
    const sup = new ComfySupervisor({
      baseUrl: comfy.baseUrl,
      autoDetect: false,
      autoStart: false,
      readyTimeoutMs: 1000,
      idleShutdownMs: 0,
    })
    // 外部实例（没人拉起）：ensureReady 探通后记成 external
    const external = await sup.ensureReady()
    assert.equal(external, true, '假 ComfyUI 应当在跑')
    assert.equal(sup.status().state, 'external', '不是我们拉起的，应当判为 external')
    assert.equal(sup.status().managed, false)

    const routes = createTerminalRoutes({
      buffer: new TerminalBuffer(10),
      status: () => sup.status(),
      start: () => {},
      // 注意：**不**注入 queueBusyOf，走真实的 queueBusy
    })
    const before = comfy.hits()
    const payload = await new Promise((resolve) => {
      routes['/terminal'](new URL('http://x/terminal?since=0'), {
        writeHead: () => {},
        end: body => resolve(JSON.parse(body)),
      }, { method: 'GET' })
    })
    assert.equal(payload.status.busy, false, '外部实例永远是 busy:false')
    assert.equal(comfy.hits(), before, '外部实例不该去问队列 —— 它的队列不归我们管')
  } finally {
    await comfy.close()
  }
})

test('外部实例的 /service/stop 是幂等的，不会去动别人的进程（停错比停不掉严重）', async () => {
  const { ComfySupervisor } = await import('../lib/index.js')
  const comfy = await fakeComfy(true)
  try {
    const sup = new ComfySupervisor({
      baseUrl: comfy.baseUrl,
      autoDetect: false,
      autoStart: false,
      readyTimeoutMs: 1000,
      idleShutdownMs: 0,
    })
    await sup.ensureReady()
    assert.equal(sup.stop(), false, '没有我们拉起的进程时 stop() 必须返回 false')
    // 关键：外部实例还在跑
    const res = await fetch(`${comfy.baseUrl}/system_stats`)
    assert.equal(res.ok, true, '外部实例必须还活着 —— 停错进程比停不掉严重得多')
  } finally {
    await comfy.close()
  }
})

// ── 客户端接线（源码契约） ──

test('关机走 api.ts 的 stopService()，且三个文案键中英各一份', () => {
  // 判定对了但按钮的 onClick 打错地址，用户点了就是没反应 —— 真机上表现为
  // "点了没动静、也不报错"，纯函数与 SSR 都抓不到这一层。
  //
  // 为什么是源码契约而不是渲染测试：`Terminal` 的按钮由 status 派生，而 status
  // 只能由异步轮询落地。在 node 里挂真 React 需要一整套 DOM（jsdom 不在依赖里），
  // 而判定的所有分支已经在上面的纯函数用例里逐条钉住了 —— 这里只剩"接线对不对"。
  const src = fs.readFileSync(
    path.join(here, '..', 'src', 'components', 'panel-terminal', 'client', 'Terminal.tsx'),
    'utf8',
  )
  assert.match(src, /stopService\(\)/, '关机必须走 api.ts 的 stopService()（它会看 ok/stopped，message 不丢）')
  assert.match(src, /runStop\(/, '组件必须走 runStop 这条统一流程（确认/停止/刷新三步在别处验）')

  // busy 必须进 setStatus 的相等性比较：漏了它，队列从空到忙时对象被判成"没变"、
  // 状态不更新，于是忙时点关机不弹确认 —— 而那条确认是唯一挡住丢任务的东西。
  assert.match(
    src,
    /prev\.busy === data\.status\.busy/,
    'setStatus 的相等性比较必须包含 busy，否则忙状态永远不会触发重渲染',
  )

  // 停完立刻 pull，否则点完这一秒里按钮还是「关机」，像没反应。
  // 注意这不是重复测试：`runStop` 的打表验的是"流程里有 pull 这一步"，
  // 这里验的是**组件真的把 pull 接进去了** —— 少接一个依赖，打表照样全绿。
  assert.match(
    src,
    /pull: \(\) => \{ void pull\(\) \}/,
    'runStop 的 pull 必须接到组件的 pull()，否则停完不会立刻刷新',
  )
  assert.match(src, /stop: \(\) => stopService\(\)/, 'runStop 的 stop 必须接 stopService()')

  const planSrc = fs.readFileSync(
    path.join(here, '..', 'src', 'components', 'panel-terminal', 'client', 'terminal-stop.ts'),
    'utf8',
  )
  assert.match(planSrc, /termStopExternal/, '外部实例的提示键要在判定里给出')

  // 文案键三处都要有，中英各一份 —— 缺一个就是界面上露出 key 本身。
  const dict = fs.readFileSync(path.join(here, '..', 'src', 'client', 'i18n-data.ts'), 'utf8')
  for (const key of ['termStop', 'termStopExternal', 'termStopConfirm']) {
    const hits = dict.match(new RegExp(`\\b${key}:`, 'g')) ?? []
    assert.equal(hits.length, 2, `${key} 应当中英各一份，实际 ${hits.length} 份`)
  }
})

