/**
 * `/run` 的 pending 契约必须有人收尾。
 *
 * 上一轮的 P1：`run-api.ts` 返回 `{pending:true, promptId}` 并注明"前端按 promptId 轮询"，
 * 但前端从不轮询（`pollRun` 全仓零调用方），服务端也没有 watcher ——
 * 于是 ComfyUI 跑完，产物留在它自己的 output 目录，插件不落盘、不写 sidecar、
 * registry 停在 pending。本机能"看见"只是运气（/roots 里恰好含 ComfyUI 的 output）。
 *
 * 这里验：`POST /run` 之后**有人**把记录收敛、把产物收到插件目录。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { RunRegistry, createRunHandler } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
  3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
  7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
}

/** 真 1×1 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/** 造工作流目录与依赖。 */
function makeDeps(historyFor) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ra-'))
  fs.writeFileSync(path.join(dir, 'wf.json'), JSON.stringify(WF))
  const out = path.join(dir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const runs = new RunRegistry(out)
  return {
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
        async history(promptId) { return historyFor(promptId) },
        async view() { return PNG },
      },
      workflowDir: dir,
      settings: { pollIntervalMs: 40, outputDir: out, comfyBaseUrl: 'http://127.0.0.1:8188' },
      assertWritable: () => {},
      defaultOutputDir: out,
      runs,
    },
    dir,
    out,
    runs,
  }
}

/** 假 ServerResponse。 */
function fakeRes() {
  const res = {
    status: 0,
    body: '',
    headers: {},
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers ?? {}); return this },
    end(body) { this.body = body },
  }
  return res
}

/** 真 Readable：readJsonBody 用的是 `for await`，只实现 on 不认。 */
function fakeReq(body) {
  return Readable.from([Buffer.from(JSON.stringify(body))])
}

test('POST /run 之后有人收产物：文件真的落到插件目录、sidecar 写出', async () => {
  const { deps, dir, out, runs } = makeDeps(() => ({
    status: { status_str: 'success', completed: true },
    outputs: { 7: { images: [{ filename: 'o.png', subfolder: '', type: 'output' }] } },
  }))
  const handler = createRunHandler(deps)
  const res = fakeRes()
  await handler(new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))

  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, true)
  assert.equal(payload.pending, true, '提交即返回，契约不变')
  assert.equal(typeof payload.promptId, 'string')

  // 后台 sweep 应当把它收敛并收产物
  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    const state = runs.get(payload.promptId)?.state
    if (state === 'done' || state === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  const record = runs.get(payload.promptId)
  assert.equal(record?.state, 'done', `后台要有收尾，实际 ${record?.state}`)
  assert.ok(typeof record?.finishedAt === 'number')

  // 产物必须真在磁盘上（不是只有状态对）
  const files = fs.readdirSync(out).filter(name => name.endsWith('.png'))
  assert.ok(files.length >= 1, `产物要落到插件目录，实际 ${JSON.stringify(fs.readdirSync(out))}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('POST /run 提交失败仍返回 ok:false（不因加了 sweep 而变）', async () => {
  const { deps, dir } = makeDeps(() => undefined)
  deps.client.queuePrompt = async () => {
    const error = new Error('连不上')
    error.code = 'comfy_unreachable'
    throw error
  }
  const handler = createRunHandler(deps)
  const res = fakeRes()
  await handler(new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))
  const payload = JSON.parse(res.body)
  assert.equal(payload.ok, false)
  assert.equal(payload.code, 'comfy_unreachable')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('POST /run 之后 ComfyUI 执行报错：记录收敛成 failed，不是永远 pending', async () => {
  const { deps, dir, runs } = makeDeps(() => ({
    status: {
      status_str: 'error',
      messages: [['execution_error', { exception_message: 'CUDA out of memory', node_id: '2', node_type: 'KSampler' }]],
    },
  }))
  const handler = createRunHandler(deps)
  const res = fakeRes()
  await handler(new URL('http://x/run'), res, fakeReq({ workflowId: 'wf', vars: { seed: 1 } }))
  const promptId = JSON.parse(res.body).promptId

  const startedAt = Date.now()
  while (Date.now() - startedAt < 5_000) {
    if (runs.get(promptId)?.state === 'failed') break
    await new Promise(resolve => setTimeout(resolve, 40))
  }
  const record = runs.get(promptId)
  assert.equal(record?.state, 'failed', `该收敛成 failed，实际 ${record?.state}`)
  assert.equal(record?.error?.code, 'execution_failed')
  assert.equal(record?.error?.kind, 'oom', 'kind 也要落盘')
  fs.rmSync(dir, { recursive: true, force: true })
})
