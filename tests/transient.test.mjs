/**
 * 瞬时失败不该一次判死。
 *
 * 复审抓的阻塞项：`watchRun` 单 tick 遇 5xx 即判死并发通知，而 `sweepRun` 要连续 6 次 ——
 * 两条路径对同一错误给出相反结论。更糟的是判死后 `collectArtifacts` 永不执行：
 * ComfyUI 其实出了图也不落盘，用户拿到假失败结论还丢了产物。
 *
 * 这里锁三件事：单次 5xx 不判死、连续 6 次才判 unknown、确定终态（execution_failed）立即判死。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, sweepRun, watchRun } from '../lib/index.js'

/** 造一个总是抛指定错误的 client。 */
function failingClient(code, times = Infinity) {
  let calls = 0
  return {
    baseUrl: 'http://127.0.0.1:9',
    async queue() { return { running: [], pending: [] } },
    async history() {
      calls += 1
      if (calls > times) {
        return {
          status: { status_str: 'success', completed: true },
          outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
        }
      }
      const error = new Error(code === 'execution_failed' ? 'CUDA out of memory' : `/history 返回 500`)
      error.code = code
      throw error
    },
    async view() { return Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    get calls() { return calls },
  }
}

/** 造一个不投消息的 agent。 */
function silentAgent() {
  const messages = []
  return { messages, followup: (message) => { messages.push(message) } }
}

/** 等条件成立。 */
async function waitFor(predicate, timeoutMs = 4_000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  return false
}

test('watchRun：单次 5xx 不判死，保持原状态并继续等', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  const client = failingClient('comfy_unreachable', 3) // 前 3 次失败，之后成功
  const agent = silentAgent()
  const stop = watchRun({
    client,
    target: agent,
    promptId: 'p1',
    outputDir: dir,
    intervalMs: 60,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    // 失败两次期间不该判死、不该发"执行失败"通知
    await new Promise(resolve => setTimeout(resolve, 200))
    assert.notEqual(registry.get('p1')?.state, 'failed', '单次 5xx 不该判 failed')
    assert.equal(agent.messages.length, 0, '不该发失败通知')
    // 第 4 次成功后应收敛
    const done = await waitFor(() => registry.get('p1')?.state === 'done')
    assert.equal(done, true, `恢复后应收敛成 done，实际 ${registry.get('p1')?.state}`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('watchRun：连续 6 次才判 unknown，且文案不说"执行失败"', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr2-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  const client = failingClient('comfy_unreachable') // 一直失败
  const agent = silentAgent()
  const stop = watchRun({
    client,
    target: agent,
    promptId: 'p1',
    outputDir: dir,
    intervalMs: 50,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const settled = await waitFor(() => registry.get('p1')?.state === 'unknown', 5_000)
    assert.equal(settled, true, '连续失败到上限应标 unknown')
    assert.ok(agent.messages.length >= 1, '应当发一条说明')
    const text = String(agent.messages[0]?.content?.[0]?.text ?? '')
    assert.match(text, /查不到|comfyui_run|promptId/, '文案要给出续查方式')
    assert.ok(!/执行失败/.test(text), `没有证据说任务失败，不该说"执行失败"：${text}`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('watchRun：execution_failed 立即判死（确定终态不等）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tr3-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  const client = failingClient('execution_failed')
  const agent = silentAgent()
  const stop = watchRun({
    client,
    target: agent,
    promptId: 'p1',
    outputDir: dir,
    intervalMs: 50,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const failed = await waitFor(() => registry.get('p1')?.state === 'failed', 2_000)
    assert.equal(failed, true, '确定的执行失败要立即记 failed')
    assert.ok(registry.get('p1')?.error !== undefined)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('判据真一致：同一组"恒 500"，watch 与 sweep 的终态相同（都是 unknown）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trc-'))
  const mk = () => {
    const registry = new RunRegistry(dir)
    registry.submit('p1', 'wf')
    registry.submit('p2', 'wf')
    return registry
  }

  // watch：挂 watcher。注意用不同的 promptId —— watchers 是模块级 Map、按 promptId
  // 索引，两条都挂 'p1' 的话后者的 stop() 会把前者的 timer 清掉（生产里两者互斥，
  // 是 `canNotify ? watch : sweep`，不会撞）。
  const regA = mk()
  const agentA = silentAgent()
  const stopA = watchRun({
    client: failingClient('comfy_unreachable'),
    target: agentA,
    promptId: 'p2',
    outputDir: dir,
    intervalMs: 40,
    registry: regA,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  // sweep：不挂 watcher
  const regB = mk()
  const stopB = sweepRun({
    client: failingClient('comfy_unreachable'),
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 40,
    registry: regB,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })

  try {
    await waitFor(() => regA.get('p2')?.state === 'unknown' && regB.get('p1')?.state === 'unknown', 6_000)
    assert.equal(regA.get('p2')?.state, 'unknown', `watch 该收敛 unknown，实际 ${regA.get('p2')?.state}`)
    assert.equal(regB.get('p1')?.state, 'unknown', `sweep 也该收敛 unknown（不是 failed），实际 ${regB.get('p1')?.state}`)
  } finally {
    stopA(); stopB()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('auth_failed 两条路径都立即判死（不等 6 次）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tra-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  const client = failingClient('auth_failed')
  const stop = sweepRun({
    client,
    promptId: 'p1',
    workflowId: 'wf',
    outputDir: dir,
    intervalMs: 40,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    const failed = await waitFor(() => registry.get('p1')?.state === 'failed', 2_000)
    assert.equal(failed, true, 'auth_failed 是确定终态，该立即 failed')
    assert.ok(client.calls <= 2, `不该等 6 次，实际查了 ${client.calls} 次`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('"连续"计数：成功但未完成的 tick 会复位，不是累计', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trr-'))
  const registry = new RunRegistry(dir)
  registry.submit('p1', 'wf')
  let calls = 0
  const client = {
    baseUrl: 'http://127.0.0.1:9',
    async queue() { return { running: [], pending: [] } },
    async history() {
      calls += 1
      // 500、未完成、500、未完成…交替：连续失败从不达 6
      if (calls % 2 === 1) {
        const error = new Error('/history 返回 500')
        error.code = 'comfy_unreachable'
        throw error
      }
      return { status: { status_str: 'success', completed: false } }
    },
    async view() { return Buffer.alloc(0) },
  }
  const stop = watchRun({
    client,
    target: silentAgent(),
    promptId: 'p1',
    outputDir: dir,
    intervalMs: 30,
    registry,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  try {
    // 跑过 12 次（6 个失败 + 6 个未完成）后，不该被累计判死
    await waitFor(() => calls >= 12, 4_000)
    assert.notEqual(registry.get('p1')?.state, 'unknown', `交替场景不该判 unknown（那是累计判据），实际 ${registry.get('p1')?.state}`)
  } finally {
    stop()
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
