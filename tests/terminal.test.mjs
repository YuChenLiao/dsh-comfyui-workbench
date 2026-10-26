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
