/**
 * `comfyui_run` 的参数瘦身：`wait` 一参两用。
 *
 * 原来三个参数管同一件事 —— `wait`（等不等）、`waitMs`（等多久）、`timeoutMs`（已废弃，
 * 描述里写着"请用 waitMs"却还留着）。模型经常两个都传，或者传了 `timeoutMs` 以为在设等待上限。
 *
 * 现在只有 `wait`：布尔表示等不等，数字表示"等，但最多这么久"。这组用例钉住四条路径。
 *
 * 为什么值得单独测：`additionalProperties: false` 只在**宿主侧**校验，单元测试直接调 execute
 * 时多余参数会被静默忽略 —— 这正是"改了 schema 但旧参数还活着"最容易假绿的地方。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { RunRegistry, parseWait, rerunTool, resolveWait, runBatchTool, runTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** history 永远返回"还在跑"，用来观察它到底等了多久。 */
function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runwait-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  let polls = 0
  return {
    polls: () => polls,
    file,
    dir,
    deps: {
      client: {
        baseUrl: 'http://127.0.0.1:8188',
        async objectInfo() {
          const info = {}
          for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
          return info
        },
        async queuePrompt() { return { promptId: 'pid-1', warnings: [] } },
        async queue() { return { running: [], pending: [] } },
        async history() { polls += 1; return {} },
        async view() { return Buffer.alloc(0) },
      },
      workflowsDir: dir,
      outputDir: dir,
      // 配置里的默认等待上限故意设得很大：这样"按 wait 数字提前返回"才证明得了
      timeoutMs: 30_000,
      pollIntervalMs: 20,
      overrides: new Map(),
      runs: new RunRegistry(dir),
      index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
      assertWritable: () => {},
    },
  }
}

test('wait: false —— 提交后立刻返回，不轮询', async () => {
  const { deps, file, dir, polls } = makeDeps()
  const result = await runTool(deps).execute({ workflow: { path: file }, vars: { seed: 1 }, wait: false })
  assert.equal(result.ok, true)
  assert.equal(result.pending, true, '异步路径回的是 pending，不是 state')
  assert.equal(polls(), 0, '异步路径不该去 poll')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('配置 runWait: sync —— 不传 wait 也会真的去等（接线没断）', async () => {
  const { deps, file, dir, polls } = makeDeps()
  // 只注入 runWait，不传 wait：走的是「配置默认」这条路径。
  // 上限收到 1 秒，否则会按默认的 30 分钟等满 —— 这个用例本身不该花 30 秒。
  const syncDeps = { ...deps, runWaitMaxMs: 1_000, runWait: () => 'sync' }
  const result = await runTool(syncDeps).execute({ workflow: { path: file }, vars: { seed: 1 } })

  assert.ok(polls() > 0, 'runWait 注入 sync 之后，不传 wait 也要去 poll —— 否则开关是摆设')
  assert.equal(result.pending, true, '等不到产物时仍是 pending')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('配置 runWait: sync 也压不过显式的 wait: false', async () => {
  const { deps, file, dir, polls } = makeDeps()
  const syncDeps = { ...deps, runWaitMaxMs: 1_000, runWait: () => 'sync' }
  const result = await runTool(syncDeps).execute({ workflow: { path: file }, vars: { seed: 1 }, wait: false })

  assert.equal(result.pending, true)
  assert.equal(polls(), 0, '显式 false 要压过配置的 sync')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('wait 给数字 —— 按这个毫秒数等，不是按配置的 30 秒', async () => {
  const { deps, file, dir, polls } = makeDeps()
  const started = Date.now()
  const result = await runTool(deps).execute({ workflow: { path: file }, vars: { seed: 1 }, wait: 400 })
  const elapsed = Date.now() - started

  assert.ok(polls() > 0, '数字形式应当真的去等')
  assert.ok(elapsed >= 300, `应当等满约 400ms，实际 ${elapsed}ms`)
  assert.ok(elapsed < 10_000, `不该退化成配置的 30 秒，实际 ${elapsed}ms`)
  assert.equal(result.pending, true, '超时仍未出图 → pending（任务可能还在 ComfyUI 那边跑）')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('wait 给字符串数字也认（模型偶尔给 "300"）', async () => {
  const { deps, file, dir, polls } = makeDeps()
  const started = Date.now()
  await runTool(deps).execute({ workflow: { path: file }, vars: { seed: 1 }, wait: '300' })
  const elapsed = Date.now() - started

  assert.ok(polls() > 0, '字符串数字也该被当成"等一会"')
  assert.ok(elapsed < 10_000, `不该退化成配置超时，实际 ${elapsed}ms`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('参数表只剩七个（多了 preset），wait 承担了原来的 wait + waitMs + timeoutMs', async () => {
  const { deps, dir } = makeDeps()
  const names = Object.keys(runTool(deps).parameters.properties).sort()
  assert.deepEqual(names, ['outputPath', 'preset', 'promptId', 'tags', 'vars', 'wait', 'workflow'])
  for (const gone of ['waitMs', 'timeoutMs', 'returnImages']) {
    assert.equal(names.includes(gone), false, `${gone} 应该已经删掉`)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('wait 的 schema 同时接受布尔与整数', async () => {
  const { deps, dir } = makeDeps()
  const wait = runTool(deps).parameters.properties.wait
  assert.deepEqual(wait.type, ['boolean', 'integer'], '一个参数两种类型，模型才知道可以传毫秒数')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('parseWait 的规则：布尔 / 数字 / 字符串 / 夹值 / 零与负数', () => {
  // 不给：不等
  assert.deepEqual(parseWait(undefined, 300_000), { shouldWait: false, waitMs: 300_000 })
  // 只给 true：等配置值
  assert.deepEqual(parseWait(true, 5_000), { shouldWait: true, waitMs: 5_000 })
  // 数字：就等这个数
  assert.deepEqual(parseWait(1_200, 300_000), { shouldWait: true, waitMs: 1_200 })
  // 字符串数字也认
  assert.deepEqual(parseWait('1200', 300_000), { shouldWait: true, waitMs: 1_200 })
  // 小于下限抬到 1 秒；超过上限压到 30 分钟
  assert.equal(parseWait(500, 300_000).waitMs, 1_000)
  assert.equal(parseWait(999_999_999, 300_000).waitMs, 1_800_000)
  // 0 与负数当"不等"—— 0 最可能表达"别等"，变成同步等 1 秒是反直觉的
  assert.equal(parseWait(0, 300_000).shouldWait, false)
  assert.equal(parseWait(-1, 300_000).shouldWait, false)
  // 配置把默认值调大时，true 的等待也要被 30 分钟上限夹住，不能翻倍
  assert.equal(parseWait(true, 3_600_000).waitMs, 1_800_000)
  // 认不出的字符串按"不等"处理，不抛
  assert.equal(parseWait('abc', 300_000).shouldWait, false)
})

test('parseWait 的配置默认：runWait 决定不传时等不等，显式值仍压过它', () => {
  // 不传：跟配置走
  assert.deepEqual(parseWait(undefined, 5_000, 'sync'), { shouldWait: true, waitMs: 5_000 })
  assert.deepEqual(parseWait(undefined, 5_000, 'async'), { shouldWait: false, waitMs: 5_000 })
  assert.deepEqual(parseWait(undefined, 5_000), { shouldWait: false, waitMs: 5_000 }, '默认仍是 async')
  // 显式值压过配置 —— 这是这个开关能被单次调用覆盖的前提
  assert.equal(parseWait(false, 5_000, 'sync').shouldWait, false, '显式 false 要压过 sync')
  assert.equal(parseWait(true, 5_000, 'async').shouldWait, true, '显式 true 要压过 async')
  assert.equal(parseWait(3_000, 5_000, 'async').shouldWait, true, '显式毫秒也要压过 async')
  assert.equal(parseWait(0, 5_000, 'sync').shouldWait, false, '0 在 sync 下也不等')
  // 模型把布尔写成字符串时不能掉进 fallback：sync 下 "false" 会变成阻塞
  assert.equal(parseWait('false', 5_000, 'sync').shouldWait, false, '字符串 false 要当布尔')
  assert.equal(parseWait('true', 5_000, 'async').shouldWait, true, '字符串 true 要当布尔')
  assert.equal(parseWait(' FALSE ', 5_000, 'sync').shouldWait, false, '大小写与空白都认')
})

/** run_batch 的依赖：与 run 同构，只是多一个 runs 数组。 */
function makeBatchDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rbwait-'))
  const file = path.join(dir, 'wf.json')
  fs.writeFileSync(file, JSON.stringify(WF))
  let polls = 0
  return {
    polls: () => polls,
    file,
    dir,
    deps: {
      client: {
        baseUrl: 'http://127.0.0.1:8188',
        async objectInfo() {
          const info = {}
          for (const node of Object.values(WF)) info[node.class_type] = { input: {}, output: [], output_node: false }
          return info
        },
        async queuePrompt() { return { promptId: 'p1', warnings: [] } },
        async queue() { return { running: [], pending: [] } },
        async history() { polls += 1; return {} },
        async view() { return Buffer.alloc(0) },
      },
      workflowsDir: dir,
      outputDir: dir,
      uploadsDir: dir,
      timeoutMs: 30_000,
      pollIntervalMs: 20,
      overrides: new Map(),
      runs: new RunRegistry(dir),
      index: { add: () => {}, list: () => [], remove: () => {}, dropItems: () => {} },
      assertWritable: () => {},
    },
  }
}

test('run_batch 的数字 wait 真的生效（上一版只解析不消费，参数是摆设）', async () => {
  const asyncRun = makeBatchDeps()
  const startedAsync = Date.now()
  const quick = await runBatchTool(asyncRun.deps).execute({
    workflow: { path: asyncRun.file },
    runs: [{ vars: { seed: 1 } }],
    wait: false,
  })
  const asyncMs = Date.now() - startedAsync
  assert.equal(quick.ok, true)
  assert.equal(asyncRun.polls(), 0, '异步路径不该 poll')
  assert.ok(asyncMs < 500, `异步应立刻返回，实际 ${asyncMs}ms`)
  fs.rmSync(asyncRun.dir, { recursive: true, force: true })

  const waited = makeBatchDeps()
  const started = Date.now()
  await runBatchTool(waited.deps).execute({
    workflow: { path: waited.file },
    runs: [{ vars: { seed: 1 } }],
    wait: 1_200,
  })
  const elapsed = Date.now() - started
  assert.ok(waited.polls() > 0, '数字 wait 应当真的去等（上一版这里是 0）')
  assert.ok(elapsed >= 1_100, `应当等满约 1200ms，实际 ${elapsed}ms`)
  assert.ok(elapsed < 4_000, `不该等成配置的 30 秒，实际 ${elapsed}ms`)
  fs.rmSync(waited.dir, { recursive: true, force: true })
})

test('run_batch 的 schema 也接受两种类型（三个工具一致）', () => {
  const { deps, dir } = makeBatchDeps()
  const wait = runBatchTool(deps).parameters.properties.wait
  assert.deepEqual(wait.type, ['boolean', 'integer'])
  fs.rmSync(dir, { recursive: true, force: true })
})

test('run_batch 也认配置 runWait（三处手抄同一行，抄漏一处就静默退回 async）', async () => {
  const batch = makeBatchDeps()
  const syncDeps = { ...batch.deps, runWaitMaxMs: 1_000, runWait: () => 'sync' }
  await runBatchTool(syncDeps).execute({
    workflow: { path: batch.file },
    runs: [{ vars: { seed: 1 } }],
  })
  assert.ok(batch.polls() > 0, 'runWait: sync 下不传 wait 也要去 poll')
  fs.rmSync(batch.dir, { recursive: true, force: true })
})

test('组件 tool.sync-wait 关掉时，三个工具都不再暴露 wait 参数', async () => {
  const { deps, dir } = makeDeps()
  const off = { ...deps, syncWait: false }
  for (const tool of [runTool(off), runBatchTool(off), rerunTool(off)]) {
    assert.equal('wait' in tool.parameters.properties, false, `${tool.name} 关掉组件后不该有 wait 参数`)
  }
  // 开着的默认形态仍带这个参数
  assert.equal('wait' in runTool(deps).parameters.properties, true)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('组件关掉时即使传了 wait 也按异步走（参数不在 schema，但也不能反过来阻塞）', async () => {
  const { deps, file, dir, polls } = makeDeps()
  const off = { ...deps, syncWait: false, runWait: () => 'sync' }
  const result = await runTool(off).execute({ workflow: { path: file }, vars: { seed: 1 } })
  assert.equal(result.pending, true)
  assert.equal(polls(), 0, '组件关掉 = 一律异步，配置成 sync 也不该去等')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveWait 一处收口：三个工具共享同一份默认值逻辑', () => {
  // 直接测收口函数本身 —— 三处手抄的风险已被消除，这里保证实现没跑偏
  const base = { timeoutMs: 120_000 }
  assert.deepEqual(resolveWait(base, undefined), { shouldWait: false, waitMs: 120_000 }, '全缺省按 async、退回 timeoutMs')
  assert.deepEqual(
    resolveWait({ timeoutMs: 120_000, runWaitMaxMs: 1_800_000, runWait: () => 'sync' }, undefined),
    { shouldWait: true, waitMs: 1_800_000 },
    '配置 sync 时等 runWaitMaxMs，而不是 HTTP 超时',
  )
  assert.equal(resolveWait({ timeoutMs: 5_000, runWaitMaxMs: 1_800_000, runWait: () => 'sync' }, false).shouldWait, false)
  assert.equal(resolveWait({ timeoutMs: 5_000, runWait: () => 'async' }, 2_000).waitMs, 2_000)
})
