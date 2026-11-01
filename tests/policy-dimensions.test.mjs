/**
 * 判据的二维性：`isRetryable`（还等不等）与 `finalStateOf`（终态写什么）是两件事。
 *
 * 上一版把它们合成一个布尔，于是 `no_output` 被归进"可重试的网络问题"：
 * history 明明每次都查到 `completed=true`，文案却说"连续 6 次查不到 /history" ——
 * 事实完全相反；`wait` 路径更把它改写成 pending，让用户去续查一个永远查不到的结果。
 *
 * 但也不能把 `no_output` 直接塞进 fatal：产物可能稍后才被收集到（竞态窗）。
 * 所以它"继续等、但放弃时落 failed"。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  RunRegistry,
  codeOf,
  finalStateOf,
  giveUpMessage,
  isFatalRunError,
  isRetryable,
  waitForRun,
} from '../lib/index.js'

/** 造一个带 code 的错误。 */
function err(code, message = 'boom') {
  const error = new Error(message)
  if (code !== undefined) error.code = code
  return error
}

test('null / undefined / 非对象不会崩（它跑在 catch 里，崩了就是 unhandledRejection）', () => {
  for (const value of [null, undefined, 42, 'str', {}, []]) {
    assert.equal(codeOf(value), '')
    assert.equal(typeof isRetryable(value), 'boolean')
    assert.equal(typeof finalStateOf(value), 'string')
    assert.equal(typeof isFatalRunError(value), 'boolean')
  }
})

test('两个维度是独立的：no_output 可重试，但终态是 failed', () => {
  const error = err('no_output', '执行完成了，但没有拿到任何产物文件。')
  assert.equal(isRetryable(error), true, '产物可能稍后到，竞态窗要保留')
  assert.equal(isFatalRunError(error), false, '不该立即判死')
  assert.equal(finalStateOf(error), 'failed', '放弃时必须是 failed —— 这是个确定结论')
})

test('execution_failed / auth_failed：不可重试且落 failed', () => {
  for (const code of ['execution_failed', 'auth_failed']) {
    const error = err(code)
    assert.equal(isRetryable(error), false)
    assert.equal(isFatalRunError(error), true)
    assert.equal(finalStateOf(error), 'failed')
  }
})

test('网络类：可重试且落 unknown', () => {
  const error = err('comfy_unreachable')
  assert.equal(isRetryable(error), true)
  assert.equal(finalStateOf(error), 'unknown', '我们只是观测不到，没证据说任务失败')
})

test('giveUpMessage 按错误类型分开说，不能撒谎', () => {
  const noOutput = giveUpMessage(err('no_output', '执行完成了，但没有拿到任何产物文件。'), 'p1', 6)
  assert.match(noOutput, /执行完成了|没有拿到任何产物/, '要说清是"完成但无产物"')
  assert.ok(!/查不到/.test(noOutput), `no_output 不是"查不到"，实际：${noOutput}`)
  assert.match(noOutput, /SaveImage|PreviewImage/, '要指向具体的排查方向')
  // 真机实测 + ComfyUI 源码核实（execution.py:1183-1194、1265-1300）：
  // - validate 失败只影响那一条输出链，别的链照跑，所以整体仍算成功 → 走 no_output
  // - 全部链被拒 → prompt_outputs_failed_validation → 提交阶段 400，走 submit_rejected
  // - 一个 OUTPUT_NODE 都没有 → prompt_no_outputs → 同样在提交阶段被拒
  // 因此"末端缺少 SaveImage / PreviewImage"这个因果**到不了 no_output**，不能这么写。
  assert.match(noOutput, /validate|Value not in list/, `要指出参数非法这条原因，实际：${noOutput}`)
  assert.ok(
    !/末端(缺少|没有)\s*SaveImage/.test(noOutput),
    `不能把成因写成"末端缺输出节点"（那种模板在提交阶段就被拒），实际：${noOutput}`,
  )

  const network = giveUpMessage(err('comfy_unreachable', '/history 返回 500'), 'p2', 6)
  assert.match(network, /查不到|comfyui_run/)
  assert.ok(!/没有拿到任何产物/.test(network))

  const executed = giveUpMessage(err('execution_failed', 'CUDA out of memory'), 'p3', 1)
  assert.match(executed, /执行失败/)

  const auth = giveUpMessage(err('auth_failed', '401'), 'p4', 1)
  assert.match(auth, /认证/)
})

test('无 code 的错误兜底不该是 execution_failed（会被误判成执行失败）', () => {
  assert.equal(codeOf(new Error('随便什么错')), '', 'codeOf 返回空串')
  const message = giveUpMessage(new Error('随便什么错'), 'p5', 6)
  assert.ok(!/执行失败/.test(message), `没有 code 时不该说执行失败：${message}`)
})

test('waitForRun 遇 no_output：第 6 次才抛（保留竞态窗），抛的是 no_output', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dk-'))
  let calls = 0
  const client = {
    baseUrl: 'http://127.0.0.1:9',
    async history() {
      calls += 1
      // 每次都"完成了但没有产物"
      return { status: { status_str: 'success', completed: true }, outputs: {} }
    },
    async view() { return Buffer.alloc(0) },
  }
  await assert.rejects(
    () => waitForRun(client, 'p1', {
      timeoutMs: 10_000,
      pollIntervalMs: 20,
      fallback: { outputDir: dir },
    }),
    (error) => {
      assert.equal(error.code, 'no_output', `该抛 no_output，实际 ${error.code}`)
      // hint 是工具层直接交给用户看的那句话：两种原因都要在
      assert.match(String(error.hint ?? ''), /SaveImage|PreviewImage/, 'hint 要指向存盘节点')
      assert.match(String(error.hint ?? ''), /validate|Value not in list/, 'hint 也要指出参数非法这条原因')
      return true
    },
  )
  assert.ok(calls >= 2, `不该首次就放弃，实际查了 ${calls} 次`)
  fs.rmSync(dir, { recursive: true, force: true })
})
