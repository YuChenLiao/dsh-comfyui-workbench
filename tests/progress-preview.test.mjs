/**
 * 潜空间预览帧：解析与内存缓存。
 *
 * 两条容易写错、且错了很难从界面看出来：
 * 1. ComfyUI 的二进制帧头是 **big-endian**（`struct.pack(">I", ...)`），写成小端会得到
 *    一个巨大的事件类型号、所有帧都被当成非法；
 * 2. 预览只能留在内存、运行进终态必须清 —— 一帧几十 KB，30 步推几十帧，
 *    不清就是稳定泄漏，而界面上完全看不出来。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

const { parsePreviewFrame, bytesOfMessage } = await import('../lib/index.js')
const { RunRegistry } = await import('../lib/index.js')

/** 构造一帧：4 字节事件类型 + 4 字节图像格式 + payload。 */
function frame(eventType, imageType, payload = [0x89, 0x50, 0x4e, 0x47]) {
  const out = new Uint8Array(8 + payload.length)
  new DataView(out.buffer).setUint32(0, eventType, false)
  new DataView(out.buffer).setUint32(4, imageType, false)
  out.set(payload, 8)
  return out
}

test('parsePreviewFrame：JPEG / PNG 两种格式都能认，且剥掉 8 字节头', () => {
  const jpeg = parsePreviewFrame(frame(1, 1, [0xff, 0xd8, 0xff]))
  assert.deepEqual(jpeg, { mime: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff]) })

  const png = parsePreviewFrame(frame(1, 2, [0x89, 0x50]))
  assert.equal(png?.mime, 'image/png')
  assert.deepEqual(png?.bytes, new Uint8Array([0x89, 0x50]))
})

test('parsePreviewFrame：大端解析 —— 换成小端就认不出来', () => {
  // 事件类型 1 在大端下是 00 00 00 01；若实现误用 little-endian 会读成 0x01000000
  const raw = frame(1, 2)
  assert.deepEqual([...raw.slice(0, 4)], [0, 0, 0, 1])
  assert.notEqual(parsePreviewFrame(raw), null, '大端正确的实现应当认得出')
})

test('parsePreviewFrame：非预览事件、未知格式、长度不足一律返回 null', () => {
  assert.equal(parsePreviewFrame(frame(3, 2)), null, '只有 type=1 是 PREVIEW_IMAGE')
  assert.equal(parsePreviewFrame(frame(1, 9)), null, '未知图像格式码')
  assert.equal(parsePreviewFrame(new Uint8Array(8)), null, '只有头、没有图像字节')
  assert.equal(parsePreviewFrame(new Uint8Array(4)), null, '连头都不够')
})

test('parsePreviewFrame：接受 ArrayBuffer 与各种 TypedArray 视图', () => {
  const raw = frame(1, 1)
  assert.equal(parsePreviewFrame(raw.buffer)?.mime, 'image/jpeg', 'ArrayBuffer')
  assert.equal(parsePreviewFrame(new DataView(raw.buffer))?.mime, 'image/jpeg', 'DataView')
  // 带偏移的视图：不能把 buffer 从头开始读
  const padded = new Uint8Array(16)
  padded.set(raw, 4)
  assert.equal(parsePreviewFrame(padded.subarray(4))?.mime, 'image/jpeg', 'subarray 偏移')
})

test('bytesOfMessage：字符串（JSON 消息）不算二进制', () => {
  assert.equal(bytesOfMessage('{"type":"progress"}'), null)
  assert.notEqual(bytesOfMessage(new Uint8Array([1, 2])), null)
  assert.notEqual(bytesOfMessage(new ArrayBuffer(4)), null)
})

test('RunRegistry：只保留最新一帧，进终态即清', () => {
  const runs = new RunRegistry()
  runs.submit('p1', 'wf')

  runs.setPreview('p1', 'image/png', new Uint8Array([1]))
  runs.setPreview('p1', 'image/jpeg', new Uint8Array([2, 3]))
  const latest = runs.preview('p1')
  assert.equal(latest?.mime, 'image/jpeg', '后来的帧覆盖前面的')
  assert.deepEqual([...latest.bytes], [2, 3])

  // 进终态：预览必须消失（否则就是每次出图泄漏几十 KB）
  runs.update('p1', { state: 'done' })
  assert.equal(runs.preview('p1'), undefined, 'done 之后不该再有预览帧')

  // failed / unknown 同理
  runs.submit('p2', 'wf')
  runs.setPreview('p2', 'image/png', new Uint8Array([1]))
  runs.update('p2', { state: 'failed' })
  assert.equal(runs.preview('p2'), undefined)

  // 中间态不清理
  runs.submit('p3', 'wf')
  runs.setPreview('p3', 'image/png', new Uint8Array([9]))
  runs.update('p3', { state: 'running' })
  assert.notEqual(runs.preview('p3'), undefined, 'running 期间要保留')
})

test('RunRegistry：没有记录的 promptId 不攒垃圾；dropPreview / clear 生效', () => {
  const runs = new RunRegistry()
  runs.setPreview('ghost', 'image/png', new Uint8Array([1]))
  assert.equal(runs.preview('ghost'), undefined, '没有运行记录时不该缓存迟到帧')

  runs.submit('p1', 'wf')
  runs.setPreview('p1', 'image/png', new Uint8Array([1]))
  runs.dropPreview('p1')
  assert.equal(runs.preview('p1'), undefined)

  runs.setPreview('p1', 'image/png', new Uint8Array([1]))
  runs.clear()
  assert.equal(runs.preview('p1'), undefined, 'clear 要连预览一起清')
})
