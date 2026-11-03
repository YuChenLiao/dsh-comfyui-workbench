/**
 * runner 自检：用本地假 ComfyUI 跑完整链路，验证"什么时候发请求、什么时候不发"。
 *
 * 对应验收：
 *   B12 缺变量 / 缺节点都在 POST /prompt **之前**失败
 *   B13 超时必须已发出 /interrupt
 *   B14 无产物时报 no_output
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { listenSafe } from './helpers.mjs'

import { ComfyClient } from '../lib/comfy.js'
import { collectArtifacts, resumeRun, runWorkflow } from '../lib/run.js'

/** 1×1 透明 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 起一个假 ComfyUI。`plan` 决定各端点的行为。 */
async function fakeComfy(plan) {
  const calls = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const key = `${req.method} ${url.pathname}`
    calls.push(key)

    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }

    if (url.pathname === '/system_stats') return json(200, { system: {} })
    if (url.pathname === '/object_info') return json(200, plan.nodes ?? {})
    if (url.pathname === '/prompt' && req.method === 'POST') return plan.onPrompt === undefined ? json(200, { prompt_id: 'p1' }) : plan.onPrompt(res, json)
    if (url.pathname.startsWith('/history/')) {
      const entry = plan.onHistory === undefined ? { status: { completed: true }, outputs: {} } : plan.onHistory()
      return json(200, entry === undefined ? {} : { p1: entry })
    }
    if (url.pathname === '/view') {
      if (plan.onView !== undefined) return plan.onView(url, res, json)
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    }
    if (url.pathname === '/interrupt') return json(200, {})
    return json(404, {})
  })

  const port = await listenSafe(server)
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
    has: prefix => calls.some(call => call.startsWith(prefix)),
  }
}

function workflow() {
  return {
    3: {
      class_type: 'KSampler',
      inputs: { seed: 1, steps: 10, cfg: 7, model: ['4', 0], positive: ['6', 0], negative: ['6', 0], latent_image: ['5', 0] },
    },
    4: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 8, height: 8, batch_size: 1 } },
    6: { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['4', 1] } },
    9: { class_type: 'SaveImage', inputs: { filename_prefix: 'x', images: ['3', 0] } },
  }
}

/** 取一份能过编译的 slots（直接从 IO 面推断）。 */
async function slotsOf(wf) {
  const { buildSurface } = await import('../lib/workflow.js')
  return buildSurface({ workflowId: 't', workflow: wf }).inputs
}

function tmpOut() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-run-'))
}

test('正常链路：预检 → 提交 → 轮询 → 取图 → 落盘 + sidecar', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => ({ status: { completed: true }, outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } }),
  })

  try {
    const outputDir = tmpOut()
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 42 },
      outputDir,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })

    assert.equal(outcome.promptId, 'p1')
    assert.equal(outcome.artifacts.length, 1)
    const artifact = outcome.artifacts[0]
    assert.ok(fs.existsSync(artifact.path), '产物应当落盘')
    assert.equal(artifact.width, 1)
    assert.equal(artifact.height, 1)
    assert.equal(artifact.mime, 'image/png')
    assert.ok(outcome.metadataPath !== undefined && fs.existsSync(outcome.metadataPath), '应当写 sidecar')

    const meta = JSON.parse(fs.readFileSync(outcome.metadataPath, 'utf8'))
    assert.equal(meta.workflowId, 't')
    assert.equal(meta.comfy.promptId, 'p1')
    assert.equal(meta.seed, 42)

    assert.ok(comfy.has('GET /object_info'))
    assert.ok(comfy.has('POST /prompt'))
    assert.ok(!comfy.has('POST /interrupt'))
  } finally {
    await comfy.close()
  }
})

test('200 响应带 node_errors 时，警告要进 notes（完成与 pending 两条出口都不能丢）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const nodeErrors = {
    3: {
      class_type: 'KSampler',
      errors: [{
        message: 'Value not in list',
        details: 'sampler_name: not in []',
        extra_info: { input_name: 'sampler_name', received_value: 'euler_ancestral_x' },
      }],
    },
  }

  // 1) 完成路径：history 给出产物
  const done = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onPrompt: (_res, json) => json(200, { prompt_id: 'p1', node_errors: nodeErrors }),
    onHistory: () => ({ status: { completed: true }, outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } }),
  })
  try {
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: done.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 1 },
      outputDir: tmpOut(),
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    assert.ok(!('pending' in outcome), '这条该跑完')
    const joined = (outcome.notes ?? []).join(' | ')
    assert.match(joined, /sampler_name/, `完成路径丢了警告：${joined}`)
    assert.match(joined, /euler_ancestral_x/)
  } finally {
    await done.close()
  }

  // 2) pending 路径：history 永远不完成 —— "参数被判非法 → 不产出 → 等到超时"的典型场景
  const stuck = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onPrompt: (_res, json) => json(200, { prompt_id: 'p1', node_errors: nodeErrors }),
    onHistory: () => undefined,
  })
  try {
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: stuck.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 1 },
      outputDir: tmpOut(),
      timeoutMs: 300,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    assert.ok('pending' in outcome, '超时该是 pending')
    const joined = (outcome.notes ?? []).join(' | ')
    assert.match(joined, /sampler_name/, `pending 路径丢了警告——而这正是最需要它的时刻：${joined}`)
  } finally {
    await stuck.close()
  }
})

test('预览节点的输出不算产物（SaveImage 优先）', async () => {
  const wf = workflow()
  // MOSS 图生图就有一个预览节点接在"对齐到 1MP"后面，收下来会把参考图当产物
  wf[13] = { class_type: 'PreviewImage', inputs: { images: ['3', 0] } }
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {}, PreviewImage: {} },
    onHistory: () => ({
      status: { completed: true },
      outputs: {
        9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
        13: { images: [{ filename: 'scaled-input.png', subfolder: '', type: 'temp' }] },
      },
    }),
  })

  try {
    const outputDir = tmpOut()
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 42 },
      outputDir,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })

    assert.equal(outcome.artifacts.length, 1, '只该收 SaveImage 那张')
    assert.ok(outcome.artifacts[0].path.endsWith('out.png'))
    assert.ok(!fs.existsSync(path.join(outputDir, 'scaled-input.png')), '预览图不该落进产物目录')
    assert.ok(outcome.notes.some(note => note.includes('预览图')), '要说明跳过了预览图')
  } finally {
    await comfy.close()
  }
})

test('产物取不回时不拖垮整次运行（temp 被清理）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => ({
      status: { completed: true },
      outputs: {
        9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] },
        // 另一个存盘节点，文件已被清理（正式产物，不是 temp —— 要测的是容错而不是过滤）
        11: { images: [{ filename: 'gone.png', subfolder: '', type: 'output' }] },
      },
    }),
    onView: (url, res, json) => {
      if (url.searchParams.get('filename') === 'gone.png') return json(404, { error: 'not found' })
      res.writeHead(200, { 'Content-Type': 'image/png' })
      return res.end(PNG)
    },
  })

  try {
    const outputDir = tmpOut()
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat', seed: 42 },
      outputDir,
      timeoutMs: 5_000,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })

    assert.equal(outcome.ok, true, '一张取不回不等于整次失败')
    assert.equal(outcome.artifacts.length, 1)
    assert.ok(outcome.artifacts[0].path.endsWith('out.png'))
    assert.ok(outcome.notes.some(note => note.includes('取不回')), '要在说明里交代跳过了哪个')
  } finally {
    await comfy.close()
  }
})

test('缺节点：在提交之前失败（B12）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  // 只声明一部分节点
  const comfy = await fakeComfy({ nodes: { KSampler: {}, SaveImage: {} } })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'node_missing',
    )
    assert.ok(!comfy.has('POST /prompt'), '缺节点时不该提交')
  } finally {
    await comfy.close()
  }
})

test('缺变量：一个请求都不发（B12）', async () => {
  const wf = workflow()
  const slots = (await slotsOf(wf)).map(slot => (slot.name === 'prompt' ? { ...slot, required: true, default: undefined } : slot))
  const comfy = await fakeComfy({ nodes: {} })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: {},
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'variable_unbound',
    )
    assert.equal(comfy.calls.length, 0, '变量不合法时应当一个请求都不发')
  } finally {
    await comfy.close()
  }
})

test('超时：返回可续查的 pending，不中断任务', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => undefined, // 永远不完成
  })

  try {
    const outcome = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat' },
      outputDir: tmpOut(),
      timeoutMs: 300,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    // 出图要几分钟，工具不能一直占着对话：超时是"这次不等了"，不是"放弃这个任务"。
    assert.equal(outcome.pending, true)
    assert.equal(outcome.promptId, 'p1')
    assert.ok(!comfy.has('POST /interrupt'), '不该中断还在跑的任务')
  } finally {
    await comfy.close()
  }
})

test('续查：同一 promptId 第二次查能拿到产物', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  // 用开关控制"什么时候算跑完"：第一次调用期间始终不完成，续查时再放行。
  let allowComplete = false
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => (allowComplete
      ? { status: { completed: true }, outputs: { 9: { images: [{ filename: 'out.png' }] } } }
      : undefined),
  })

  try {
    const first = await runWorkflow({
      client: new ComfyClient({ baseUrl: comfy.baseUrl }),
      workflow: wf,
      slots,
      vars: { prompt: 'a cat' },
      outputDir: tmpOut(),
      timeoutMs: 200,
      pollIntervalMs: 10,
      workflowId: 't',
      workflowHash: 'h1',
    })
    assert.equal(first.pending, true)

    allowComplete = true
    const resumed = await resumeRun(new ComfyClient({ baseUrl: comfy.baseUrl }), first.promptId, { outputDir: tmpOut() })
    assert.equal(resumed.ok, true)
    assert.equal(resumed.pending, undefined)
    assert.equal(resumed.artifacts.length, 1)
    assert.ok(fs.existsSync(resumed.artifacts[0].path))
  } finally {
    await comfy.close()
  }
})

test('提交被拒：透出 node_errors', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onPrompt: (res, json) => json(400, { error: 'bad', node_errors: { 3: { errors: [{ message: 'value out of range', details: 'steps' }] } } }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'submit_rejected' && /节点 3/.test(error.message),
    )
  } finally {
    await comfy.close()
  }
})

test('提交被拒：prompt_no_outputs 的 hint 指向"没有输出节点"，不是"被点名的节点"', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    // ComfyUI 对"一个 OUTPUT_NODE 都没有"的模板回 400，且 node_errors 是空对象
    // （execution.py:1187-1194 的 error 不带节点信息，server.py:1238 原样回传）
    onPrompt: (res, json) => json(400, {
      error: { type: 'prompt_no_outputs', message: 'Prompt has no outputs', details: '' },
      node_errors: {},
    }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => {
        assert.equal(error.code, 'submit_rejected')
        // node_errors 是空的 —— 说"检查被点名的节点"点不到任何东西
        assert.ok(!/被点名的节点/.test(String(error.hint ?? '')), `不该说被点名的节点：${error.hint}`)
        assert.match(String(error.hint ?? ''), /输出节点/, '要说清是没有输出节点')
        return true
      },
    )
  } finally {
    await comfy.close()
  }
})

test('提交被拒：prompt_outputs_failed_validation 指向"所有链参数非法"', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onPrompt: (res, json) => json(400, {
      error: {
        type: 'prompt_outputs_failed_validation',
        message: 'Prompt outputs failed validation',
        details: "Value not in list: sampler_name: 'nope' not in (list of length 65)",
      },
      node_errors: { 3: { errors: [{ message: 'Value not in list', details: 'sampler_name' }], class_type: 'KSampler' } },
    }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => {
        assert.equal(error.code, 'submit_rejected')
        // 这条路径 node_errors 非空，节点要被点名
        assert.match(error.message, /节点 3/, `要点名节点，实际：${error.message}`)
        assert.match(String(error.hint ?? ''), /所有输出链/, `该说清是"所有链"都不合法：${error.hint}`)
        return true
      },
    )
  } finally {
    await comfy.close()
  }
})

test('并发收同一 promptId 只落一份（resumeRun 与 sweepRun 抢）', async () => {
  // 面板按 promptId 轮询（resumeRun）与后台兜底（sweepRun）会同时看到同一条完成。
  // 两边各自 targetFor → fs.existsSync 判冲突：可能都判"没冲突"写同名（无害），
  // 也可能后一个判"有冲突"再落一份带时间戳前缀的副本 —— 用户看到两张一样的图。
  const wf = workflow()
  let viewCalls = 0
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onView: async (_url, res) => {
      viewCalls += 1
      // 故意慢一点，让两个收集方真正重叠（否则第二个可能在第一个落盘之后才进来）
      await new Promise(resolve => setTimeout(resolve, 200))
      res.writeHead(200, { 'Content-Type': 'image/png' })
      res.end(PNG)
    },
  })

  const out = tmpOut()
  const entry = { status: { completed: true }, outputs: { 7: { images: [{ filename: 'dup.png', subfolder: '', type: 'output' }] } } }
  const context = {
    workflowId: 't',
    workflowHash: 'h1',
    outputDir: out,
    effective: {},
    writeMetadata: true,
    submittedAt: Date.now(),
    workflow: wf,
  }
  const client = new ComfyClient({ baseUrl: comfy.baseUrl })

  try {
    const [first, second] = await Promise.all([
      collectArtifacts(client, 'p1', entry, context),
      collectArtifacts(client, 'p1', entry, context),
    ])
    assert.equal(first.promptId, 'p1')
    assert.equal(second.artifacts[0].path, first.artifacts[0].path, '两边该拿到同一份产物')

    const pngs = fs.readdirSync(out).filter(name => name.endsWith('.png'))
    assert.equal(pngs.length, 1, `并发收只该落一份，实际 ${pngs.length} 份：${pngs.join(', ')}`)
    const sidecars = fs.readdirSync(out).filter(name => name.endsWith('.png.json'))
    assert.equal(sidecars.length, 1, `sidecar 也只该一份，实际 ${sidecars.length} 份`)
    assert.equal(viewCalls, 1, `view 只该调一次，实际 ${viewCalls} 次`)
  } finally {
    await comfy.close()
  }
})

test('同一 promptId 顺序收两次：只落一份，且不把 sidecar 覆盖成 unknown', async () => {
  // 跨 bundle 时 `collecting` 那张表不共享（各 entry 各内联一份），`recallRun` 也恒空。
  // 所以第二次收集拿到的是 fallback 上下文（workflowId: 'unknown'）—— 没有磁盘幂等的话，
  // 它会走 targetFor 的时间戳分支再落一份图，并把 sidecar 覆盖成 unknown，
  // 那张副本在面板点「作为输入出图」会直接报 no-workflow，成为死链资产。
  const wf = workflow()
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
  })
  const out = tmpOut()
  const entry = { status: { completed: true }, outputs: { 7: { images: [{ filename: 'once.png', subfolder: '', type: 'output' }] } } }
  const good = {
    workflowId: 't',
    workflowHash: 'h1',
    outputDir: out,
    effective: { seed: 7 },
    writeMetadata: true,
    submittedAt: Date.now(),
    workflow: wf,
  }
  const client = new ComfyClient({ baseUrl: comfy.baseUrl })

  try {
    const first = await collectArtifacts(client, 'p9', entry, good)
    // 模拟跨 bundle 之后：登记表没了，只剩 fallback
    const fallback = { ...good, workflowId: 'unknown', workflowHash: '', effective: {} }
    const second = await collectArtifacts(client, 'p9', entry, fallback)

    assert.equal(second.artifacts[0].path, first.artifacts[0].path, '第二次要复用同一份，不该新建副本')
    const pngs = fs.readdirSync(out).filter(name => name.endsWith('.png'))
    assert.equal(pngs.length, 1, `只该有一份图，实际 ${pngs.length}：${pngs.join(', ')}`)

    const meta = JSON.parse(fs.readFileSync(`${first.artifacts[0].path}.json`, 'utf8'))
    assert.equal(meta.workflowId, 't', `sidecar 不该被 fallback 的 unknown 覆盖，实际 ${meta.workflowId}`)
    assert.equal(meta.vars.seed, 7, 'sidecar 的 vars 也不该被清空')
  } finally {
    await comfy.close()
  }
})

test('首次就落时间戳名时，第二次收集也能命中（不能只查原名）', async () => {
  // `targetFor` 在原名已存在时会改落 `<时间戳>-原名`。只查原名的话，第二次永远不命中，
  // 照样再落一份副本 —— 这条覆盖那个分支。
  const wf = workflow()
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
  })
  const out = tmpOut()
  // 先放一个同名文件（别的任务的产物），逼本次走时间戳分支
  fs.writeFileSync(path.join(out, 'once.png'), PNG)
  const entry = { status: { completed: true }, outputs: { 7: { images: [{ filename: 'once.png', subfolder: '', type: 'output' }] } } }
  const good = {
    workflowId: 't', workflowHash: 'h1', outputDir: out,
    effective: { seed: 5 }, writeMetadata: true, submittedAt: Date.now(), workflow: wf,
  }
  const client = new ComfyClient({ baseUrl: comfy.baseUrl })

  try {
    const first = await collectArtifacts(client, 'pA', entry, good)
    assert.match(
      path.basename(first.artifacts[0].path),
      /^\d{17}-once\.png$/,
      `该落时间戳名，实际 ${path.basename(first.artifacts[0].path)}`,
    )
    const second = await collectArtifacts(client, 'pA', entry, { ...good, workflowId: 'unknown', effective: {} })
    assert.equal(second.artifacts[0].path, first.artifacts[0].path, '第二次要命中时间戳名，不能再落一份')
    const pngs = fs.readdirSync(out).filter(name => name.endsWith('.png'))
    assert.equal(pngs.length, 2, `原有的 1 份 + 本次 1 份，实际 ${pngs.length}：${pngs.join(', ')}`)
  } finally {
    await comfy.close()
  }
})

test('部分复用 + 部分新落盘：复用那条的 sidecar 不被错写', async () => {
  const wf = workflow()
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
  })
  const out = tmpOut()
  const onlyA = { status: { completed: true }, outputs: { 7: { images: [{ filename: 'a.png', subfolder: '', type: 'output' }] } } }
  const both = {
    status: { completed: true },
    outputs: { 7: { images: [
      { filename: 'a.png', subfolder: '', type: 'output' },
      { filename: 'b.png', subfolder: '', type: 'output' },
    ] } },
  }
  const good = {
    workflowId: 't', workflowHash: 'h1', outputDir: out,
    effective: { seed: 3 }, writeMetadata: true, submittedAt: Date.now(), workflow: wf,
  }
  const client = new ComfyClient({ baseUrl: comfy.baseUrl })

  try {
    await collectArtifacts(client, 'pB', onlyA, good)
    // 第二轮：a 命中复用、b 是新落的；context 是跨 bundle 后的 fallback
    await collectArtifacts(client, 'pB', both, { ...good, workflowId: 'unknown', effective: {} })

    const metaA = JSON.parse(fs.readFileSync(path.join(out, 'a.png.json'), 'utf8'))
    assert.equal(metaA.workflowId, 't', `复用那条的 sidecar 要保留第一次的，实际 ${metaA.workflowId}`)
    assert.equal(metaA.vars.seed, 3, 'vars 也不该被清空')

    // sidecar 只跟主产物走：b 落了盘但没有 sidecar，这是既有设计，不是缺陷
    assert.ok(fs.existsSync(path.join(out, 'b.png')), 'b 该落盘')
    assert.equal(fs.existsSync(path.join(out, 'b.png.json')), false, 'sidecar 只给主产物写')
  } finally {
    await comfy.close()
  }
})

test('无产物：报 no_output（B14）', async () => {
  const wf = workflow()
  const slots = await slotsOf(wf)
  const comfy = await fakeComfy({
    nodes: { KSampler: {}, CheckpointLoaderSimple: {}, EmptyLatentImage: {}, CLIPTextEncode: {}, SaveImage: {} },
    onHistory: () => ({ status: { completed: true }, outputs: {} }),
  })

  try {
    await assert.rejects(
      runWorkflow({
        client: new ComfyClient({ baseUrl: comfy.baseUrl }),
        workflow: wf,
        slots,
        vars: { prompt: 'a cat' },
        outputDir: tmpOut(),
        timeoutMs: 2_000,
        pollIntervalMs: 10,
        workflowId: 't',
        workflowHash: 'h1',
      }),
      (error) => error.code === 'no_output',
    )
  } finally {
    await comfy.close()
  }
})
