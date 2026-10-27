/**
 * 终端面板：输出缓冲与读取接口。
 *
 * 缓冲是环形覆盖的，最容易错的两处：覆盖后顺序要对、增量拉取不能重不能漏。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { stripAnsi, TerminalBuffer } from '../lib/index.js'

test('剥 ANSI：颜色、光标控制、OSC 标题都要去掉', () => {
  assert.equal(stripAnsi('\u001b[31mred\u001b[0m'), 'red')
  assert.equal(stripAnsi('\u001b[1;32m[INFO]\u001b[0m ok'), '[INFO] ok')
  // 光标左移 + 覆盖（ComfyUI 进度条就是这么刷新的）
  assert.equal(stripAnsi('10%\r20%'), '10%\r20%')
  assert.equal(stripAnsi('\u001b]0;title\u0007text'), 'text')
})

test('按行切分：\\r 结尾去掉，空字符串不产出行', () => {
  const buf = new TerminalBuffer(10)
  buf.push('out', 'a\r\nb\n')
  buf.push('out', '')
  const slice = buf.since(0)
  assert.deepEqual(slice.lines.map(l => l.text), ['a', 'b'])
})

test('序号单调递增，cursor 能续上', () => {
  const buf = new TerminalBuffer(10)
  buf.push('out', 'one\n')
  buf.push('err', 'two\n')
  const first = buf.since(0)
  assert.deepEqual(first.lines.map(l => l.seq), [1, 2])
  assert.equal(first.cursor, 2)

  buf.push('out', 'three\n')
  const next = buf.since(first.cursor)
  assert.deepEqual(next.lines.map(l => l.text), ['three'], '增量只给新的')
  assert.equal(next.cursor, 3)
})

test('环形覆盖：超出容量后仍按写入顺序返回，且记下丢弃数', () => {
  const buf = new TerminalBuffer(3)
  for (const text of ['a', 'b', 'c', 'd', 'e']) buf.push('out', text + '\n')
  const slice = buf.since(0)
  assert.deepEqual(slice.lines.map(l => l.text), ['c', 'd', 'e'], '保留最新的三条、顺序不能乱')
  assert.equal(slice.dropped, 2)
  assert.equal(buf.size(), 3)
})

test('清屏后旧 cursor 不会拉回旧内容', () => {
  const buf = new TerminalBuffer(10)
  buf.push('out', 'x\n')
  const before = buf.since(0)
  buf.clear()
  assert.equal(buf.size(), 0)
  const after = buf.since(before.cursor)
  assert.deepEqual(after.lines, [], '拿着旧 cursor 来也不该看到已清掉的行')
})

test('流式与非流式解码都能接上（多字节字符被切块）', () => {
  const decoder = new TextDecoder('utf-8', { fatal: false })
  // “初” 的 UTF-8 是 e5 88 9d，故意从中间切开
  const bytes = Buffer.from('初音', 'utf8')
  const part1 = bytes.subarray(0, 1)
  const part2 = bytes.subarray(1)
  const a = decoder.decode(part1, { stream: true })
  const b = decoder.decode(part2, { stream: true })
  assert.equal(a + b, '初音', '跨块的多字节字符要能拼回')
})


test('cursor 超前时不能永久失明（热重载后缓冲重建的典型场景）', () => {
  // 插件热重载会新建缓冲，seq 从 1 开始，而浏览器 ref 还停在旧高位。
  // 曾用 Math.max(cursor, last) 兜底 —— 结果是之后每轮都判成"没有新行"，面板死在原地。
  const buf = new TerminalBuffer(10)
  buf.push('out', 'fresh\n')
  const ahead = buf.since(9999)
  assert.equal(ahead.cursor, 1, 'cursor 必须回的是实际给到哪一行')

  buf.push('out', 'more\n')
  const next = buf.since(ahead.cursor)
  assert.deepEqual(next.lines.map(l => l.text), ['more'], '超前之后仍能收到新输出')
})

test('clear 不把可见行算进 dropped（那是用户自己按的清屏）', () => {
  const buf = new TerminalBuffer(10)
  for (const text of ['a', 'b', 'c']) buf.push('out', text + '\n')
  buf.clear()
  const after = buf.since(0)
  assert.equal(after.dropped, 0, '清屏不该弹「更早的 N 行已滚出缓冲」')
  assert.deepEqual(after.lines, [])
})


test('HTTP 面：清屏与启动都要能走通（走真实路由表）', async () => {
  // 之前只测了 TerminalBuffer 的纯函数，HTTP 面一次没碰 —— 于是
  // 「POST /terminal 被 WRITABLE 漏掉、恒 405」这个缺陷全绿通过。
  const { createTerminalRoutes, TerminalBuffer: Buf } = await import('../lib/index.js')
  const buf = new Buf(10)
  buf.push('out', 'line-1\n')
  let started = 0
  const routes = createTerminalRoutes({
    buffer: buf,
    status: () => ({ state: 'unknown', managed: false, baseUrl: 'http://127.0.0.1:8188' }),
    start: () => { started += 1 },
  })
  const route = routes['/terminal']
  assert.equal(typeof route, 'function')

  const call = (url, method) => {
    let payload
    const req = { method }
    const res = {
      writeHead: () => {},
      end: (body) => { payload = JSON.parse(body) },
    }
    route(new URL(url, 'http://x'), res, req)
    return payload
  }

  const first = call('http://x/terminal?since=0', 'GET')
  assert.equal(first.lines.length, 1)
  assert.equal(first.cursor, 1)

  const cleared = call('http://x/terminal', 'POST')
  assert.equal(cleared.ok, true, 'POST /terminal 应当是清屏')
  assert.equal(buf.size(), 0)

  const started2 = call('http://x/terminal?action=start', 'POST')
  assert.equal(started2.started, true)
  assert.equal(started, 1, '启动动作要被调到')
})

test('tqdm 多帧：一个 chunk 里多个回车只留最后一帧', () => {
  // 进度条会在一个 chunk 里塞几十帧同一条行，全留会得到一行几 KB 的拼接文本。
  // 但行尾的回车（CRLF 前半）不是刷新，内容要留 —— 两种含义不能混。
  const buf = new TerminalBuffer(10)
  buf.push('out', '10%\r20%\r30%\r100%\n')
  assert.deepEqual(buf.since(0).lines.map(l => l.text), ['100%'])
  const buf2 = new TerminalBuffer(10)
  buf2.push('out', 'keep\r\n')
  assert.deepEqual(buf2.since(0).lines.map(l => l.text), ['keep'])
})


test('CRLF 收尾的进度条：Windows 上 tqdm 的真实形态，不能拼成一长串', () => {
  // 真实 pipe 里 ComfyUI 的进度条长这样：每帧以 \r 开头，整行以 \r\n 收尾。
  // 早先的实现先判"末尾是不是 \r"，一命中就整段保留，于是几十帧拼成 " 10% 50%100%"。
  const buf = new TerminalBuffer(10)
  buf.push('out', '\r 10%\r 50%\r100%\r\n')
  assert.deepEqual(buf.since(0).lines.map(l => l.text), ['100%'])

  // 分次写也要对（真实 pipe 会被 64KB 缓冲切开）
  const buf2 = new TerminalBuffer(10)
  buf2.push('out', '\r 10%\r 20%')
  buf2.push('out', '\r 30%\r\n')
  const texts = buf2.since(0).lines.map(l => l.text)
  // 每行至多一个百分比：拼帧的话会出现 ' 10% 20% 30%' 这种
  for (const text of texts) {
    assert.ok((text.match(/%/g) ?? []).length <= 1, `一行里出现多个百分比说明拼帧了：${JSON.stringify(texts)}`)
  }
})

test('epoch：缓冲重建后代号会变（前端据此判断旧 cursor 失效）', () => {
  const a = new TerminalBuffer(10)
  a.push('out', 'x\n')
  const first = a.since(0)
  assert.equal(typeof first.epoch, 'string')
  assert.ok(first.epoch.length > 0)

  const b = new TerminalBuffer(10)
  b.push('out', 'y\n')
  assert.notEqual(b.since(0).epoch, first.epoch, '新实例必须有不同代号')
})


test('日志跟踪：首次给末尾 N 行，之后只给新增，轮转后重来', async () => {
  // 外部启动的 ComfyUI 拿不到 stdout，只能读 user/comfyui.log —— 这条路径要可靠。
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { LogTail, readTail } = await import('../lib/index.js')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logtail-'))
  const file = path.join(dir, 'comfyui.log')
  try {
    const lines = Array.from({ length: 300 }, (_, i) => `line-${i + 1}`)
    fs.writeFileSync(file, lines.join('\n') + '\n')

    assert.deepEqual(readTail(file, 3).split('\n'), ['line-298', 'line-299', 'line-300'])

    const tail = new LogTail(file)
    const first = tail.poll()
    assert.equal(first.split('\n').filter(Boolean).length, 200, '首次只给末尾 200 行')
    assert.ok(first.includes('line-300'))
    assert.equal(tail.poll(), '', '没有新增就是空串')

    fs.appendFileSync(file, 'line-301\n')
    assert.equal(tail.poll().trim(), 'line-301', '增量只给新增的那一行')

    // 变小 = 被轮转/截断
    fs.writeFileSync(file, 'fresh-1\nfresh-2\n')
    const afterRotate = tail.poll()
    assert.ok(afterRotate.includes('fresh-1') && afterRotate.includes('fresh-2'), '轮转后要重新从头给')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('日志跟踪：文件不存在时安静返回空（服务没起来是常态）', async () => {
  const { LogTail } = await import('../lib/index.js')
  const tail = new LogTail('/definitely/not/here/comfyui.log')
  assert.equal(tail.poll(), '')
  assert.equal(LogTail.locate(undefined), undefined)
  assert.equal(LogTail.locate('/nope'), undefined)
})


test('readTail 跨块不切碎多字节字符', async () => {
  // 逐块 toString 会把跨 64KB 边界的汉字切成 U+FFFD。长中文行/长堆栈会命中。
  const fs = await import('node:fs')
  const os = await import('node:os')
  const path = await import('node:path')
  const { readTail } = await import('../lib/index.js')

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-utf8-'))
  const file = path.join(dir, 'a.log')
  try {
    const big = '测试中文行'.repeat(3000)
    fs.writeFileSync(file, [big, big, big].join('\n') + '\n')
    const out = readTail(file, 200)
    assert.equal((out.match(/\uFFFD/g) ?? []).length, 0, '不该出现替换字符')
    assert.equal(out.split('\n').filter(Boolean).length, 3)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('installDirOf 惰性探测且只探一次（外部实例从不进 start()）', async () => {
  // installDir 原本只在 start() 里赋值，外部实例走不到那里 → 日志永远读不到。
  // 这条要能守住"探测与拉起解耦"和"负缓存"，所以用可替换的探测器计数，
  // 而不是断言返回值类型（那样删掉缓存也照样绿）。
  const { ComfySupervisor } = await import('../lib/index.js')
  let calls = 0
  const sup = new ComfySupervisor({
    baseUrl: 'http://127.0.0.1:1',
    autoDetect: true,
    autoStart: false,
    readyTimeoutMs: 1000,
    idleShutdownMs: 0,
    // 注入探测器：被调用就计数
    detect: () => {
      calls += 1
      return '/fake/comfy'
    },
  })
  assert.equal(sup.installDirOf(), '/fake/comfy', '未 start 也要能拿到安装目录')
  assert.equal(calls, 1, '第一次应当探测')
  assert.equal(sup.installDirOf(), '/fake/comfy')
  assert.equal(calls, 1, '负缓存：第二次不该再探测')

  // autoDetect 关掉时不探测
  let off = 0
  const sup2 = new ComfySupervisor({
    baseUrl: 'http://127.0.0.1:1',
    autoDetect: false,
    autoStart: false,
    readyTimeoutMs: 1000,
    idleShutdownMs: 0,
    detect: () => {
      off += 1
      return '/x'
    },
  })
  assert.equal(sup2.installDirOf(), undefined, 'autoDetect=false 时不该给目录')
  assert.equal(off, 0, 'autoDetect=false 时不该探测')

  // 负缓存真正起作用的场景是「探测失败」：没装 ComfyUI 时 pumpLog 每 2 秒问一次，
  // 不缓存就会每 2 秒扫一遍盘。探测器返回 undefined 才走到这条分支。
  let miss = 0
  const sup3 = new ComfySupervisor({
    baseUrl: 'http://127.0.0.1:1',
    autoDetect: true,
    autoStart: false,
    readyTimeoutMs: 1000,
    idleShutdownMs: 0,
    detect: () => {
      miss += 1
      return undefined
    },
  })
  assert.equal(sup3.installDirOf(), undefined)
  assert.equal(sup3.installDirOf(), undefined)
  assert.equal(sup3.installDirOf(), undefined)
  assert.equal(miss, 1, '探测失败也只该试一次（否则每 2 秒扫一次盘）')
})

test('日志轮转：新文件比旧 offset 更大时也要能读到（inode 判据）', async () => {
  // 只比大小时这里会静默卡住：轮转后新文件更长，`size <= offset` 一直成立，
  // 之后每隔 2 秒 poll 都返回空，面板再也不更新且不报错。
  const fs2 = await import("node:fs")
  const os2 = await import("node:os")
  const path2 = await import("node:path")
  const { LogTail } = await import("../lib/index.js")

  const dir = fs2.mkdtempSync(path2.join(os2.tmpdir(), "rot-"))
  const file = path2.join(dir, "comfyui.log")
  try {
    fs2.writeFileSync(file, "old-1\nold-2\n")
    const tail = new LogTail(file)
    assert.ok(tail.poll().includes("old-1"))

    // 轮转：删掉重建，内容比旧 offset 长
    fs2.rmSync(file)
    fs2.writeFileSync(file, "new-1\nnew-2\nnew-3\nnew-4\n")
    const after = tail.poll()
    assert.ok(after.includes("new-"), `轮转后要能读到新内容，实际：${JSON.stringify(after)}`)

    // 纯 append 不能重复给
    fs2.appendFileSync(file, "new-5\n")
    const inc = tail.poll()
    assert.equal(inc.trim(), "new-5")
  } finally {
    fs2.rmSync(dir, { recursive: true, force: true })
  }
})
