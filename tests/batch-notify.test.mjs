/**
 * 批量汇总通知。
 *
 * 问题：`run_batch` 逐条挂 `watchRun`，10 张图 = 10 次 `followup` = 10 轮打断。
 *
 * 但**不能改用 `inject`（不唤醒）**——模型不知道出图效果就没法继续迭代。
 * 所以保留唤醒、改频次：一批结束投递一条汇总。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { BatchCollector, RunRegistry, runBatchTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 造 ComfyUI 依赖。`historyFor` 决定每条的结果。 */
function makeDeps(historyFor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  const runs = new RunRegistry(dir)
  let submitted = 0
  return {
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { submitted += 1; return `pid-${submitted}` },
      async queue() { return { running: [], pending: [] } },
      async history(promptId) { return historyFor(promptId) },
      // 真 1×1 PNG：宽高能被 readPng 解出来，汇总里才有 WxH
      async view() { return Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64') },
    },
    workflowsDir: dir,
    outputDir: dir,
    timeoutMs: 5_000,
    pollIntervalMs: 30,
    overrides: new Map(),
    runs,
    index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
    assertWritable: () => {},
    _file: file,
    _dir: dir,
  }
}

/** 造一个收集消息的 agent。 */
function recordingAgent() {
  const messages = []
  return { messages, followup: message => { messages.push(message) } }
}

test('BatchCollector：凑齐才投递，且只投一次', () => {
  const delivered = []
  const collector = new BatchCollector({ total: 3, deliver: text => delivered.push(text) })

  collector.settle({ promptId: 'a', ok: true, text: 'a 完成' })
  collector.settle({ promptId: 'b', ok: true, text: 'b 完成' })
  assert.equal(delivered.length, 0, '没凑齐不该投递')

  collector.settle({ promptId: 'c', ok: false, text: 'c 失败：no_output' })
  assert.equal(delivered.length, 1, '凑齐应投递一条')

  // 再回报一条不该重复投递
  collector.settle({ promptId: 'd', ok: true, text: 'd' })
  assert.equal(delivered.length, 1, '只投一次')

  const text = delivered[0]
  assert.match(text, /3 条全部结束/)
  assert.match(text, /2 成功/)
  assert.match(text, /1 失败/)
  assert.match(text, /c 失败/)
  collector.dispose()
})

test('BatchCollector：产物逐行列出（模型要拿路径读图）', () => {
  const delivered = []
  const collector = new BatchCollector({ total: 2, deliver: text => delivered.push(text) })
  collector.settle({ promptId: 'a', ok: true, text: '', artifacts: ['/x/a.png', '/x/b.png'] })
  collector.settle({ promptId: 'b', ok: true, text: '', artifacts: ['/x/c.png'] })
  const text = delivered[0]
  for (const file of ['/x/a.png', '/x/b.png', '/x/c.png']) {
    assert.ok(text.includes(file), `产物路径要列出：缺少 ${file}`)
  }
  collector.dispose()
})

test('BatchCollector：超时投递"还有 N 条在跑"，不无限等', () => {
  const delivered = []
  const collector = new BatchCollector({ total: 3, deliver: text => delivered.push(text), maxWaitMs: 60 })
  collector.settle({ promptId: 'a', ok: true, text: '' })
  return new Promise(resolve => {
    setTimeout(() => {
      assert.equal(delivered.length, 1, '到点该投递')
      assert.match(delivered[0], /还有 2 条在跑|已结束 1 条/)
      collector.dispose()
      resolve()
    }, 120)
  })
})

test('run_batch：一批只投一条通知（不是每条一条）', async () => {
  const deps = makeDeps(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const agent = recordingAgent()
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }, { vars: { seed: 3 } }] }, { agent })

  // 等三条各自收敛
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    if (agent.messages.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  await new Promise(resolve => setTimeout(resolve, 300))
  assert.equal(agent.messages.length, 1, `一批该只有 1 条通知，实际 ${agent.messages.length} 条`)
  const text = String(agent.messages[0]?.content?.[0]?.text ?? '')
  // 断言**真实内容**，不能只断言"有个 3"—— 假汇总（0 成功 0 失败）也曾命中旧断言
  assert.match(text, /3 成功/, `汇总要说清 3 条都成功，实际：${text}`)
  assert.ok(!/0 成功/.test(text), `不能投空汇总，实际：${text}`)
  assert.match(text, /全部结束/, '凑齐了就该说全部结束')
  // 产物路径必须真的在汇总里（模型要拿它读图）
  assert.equal((text.match(/\.png/g) ?? []).length, 3, `3 条产物路径都要列出，实际：${text}`)
  // 宽高也要有：默认异步路径原来只给纯路径，而 wait 路径有尺寸 —— 两条该一致
  const hasSize = /\d+×\d+/.test(text)
  assert.equal(hasSize, true, `汇总里要有宽高（与 wait 路径一致），实际：${text}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('run_batch：有失败也要汇总（不吞通知）', async () => {
  const deps = makeDeps(promptId => promptId === 'pid-2'
    ? { status: { status_str: 'success', completed: true }, outputs: {} } // no_output
    : { status: { status_str: 'success', completed: true }, outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } } })
  const agent = recordingAgent()
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }] }, { agent })

  const startedAt = Date.now()
  while (Date.now() - startedAt < 6_000) {
    if (agent.messages.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.ok(agent.messages.length >= 1, '有失败也要发通知')
  const text = String(agent.messages[0]?.content?.[0]?.text ?? '')
  // 1 成功 1 失败：两个数都要对，不能只说"有成功"
  assert.match(text, /1 成功/, `要说清 1 条成功，实际：${text}`)
  assert.match(text, /1 失败/, `要说清 1 条失败，实际：${text}`)
  assert.match(text, /失败：/, '失败条目要点名')
  assert.ok(!/0 成功/.test(text), '不能投空汇总')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('run_batch：没有 agent 时不投递，但记录照常收敛', async () => {
  const deps = makeDeps(() => ({ status: { status_str: 'success', completed: true }, outputs: {} }))
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }] })
  const startedAt = Date.now()
  while (Date.now() - startedAt < 3_000) {
    if (deps.runs.list({ limit: 1 })[0]?.state === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.equal(deps.runs.list({ limit: 1 })[0]?.state, 'failed')
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('投递发生在 watcher 回报之后，不是 execute 返回前就投空汇总', async () => {
  const deps = makeDeps(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const agent = recordingAgent()
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }] }, { agent })
  // execute 返回的那一刻（异步路径）不该已经有通知：watcher 首轮 poll 还没跑
  assert.equal(agent.messages.length, 0, 'execute 返回前不该投递 —— 那说明投的是空汇总')

  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    if (agent.messages.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.equal(agent.messages.length, 1)
  assert.match(String(agent.messages[0]?.content?.[0]?.text ?? ''), /1 成功/)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})

test('wait=true 全成功也要凑齐（不能等到 30 分钟超时）', async () => {
  const deps = makeDeps(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const agent = recordingAgent()
  const tool = runBatchTool(deps)
  await tool.execute({ workflow: { path: deps._file }, runs: [{ vars: { seed: 1 } }, { vars: { seed: 2 } }], wait: true, timeoutMs: 5_000 }, { agent })

  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    if (agent.messages.length > 0) break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  assert.equal(agent.messages.length, 1, '同步全成功也该在几秒内投一条')
  const text = String(agent.messages[0]?.content?.[0]?.text ?? '')
  assert.match(text, /2 成功/, `实际：${text}`)
  assert.ok(!/还有 \d+ 条在跑/.test(text), `不该说还在跑：${text}`)
  fs.rmSync(deps._dir, { recursive: true, force: true })
})
