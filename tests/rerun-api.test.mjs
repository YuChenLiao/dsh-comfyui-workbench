/**
 * `POST /rerun`：以产物当时的参数重跑，只换输入图。
 *
 * 上一版面板上的"作为输入出图"是**让用户挑一个吃图的工作流，只传图路径** ——
 * prompt / seed / 步数 / 模型全走默认值，等于把原图的一半信息丢了。
 * 用户的原话是"应该是以当前参数再跑一遍"。
 *
 * 这里直接打生产路由，验 sidecar 里的参数真的被带过去了。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { test } from 'node:test'

import { RunRegistry, createWorkflowRoutes } from '../lib/index.js'

/**
 * 吃图的工作流：LoadImage → VAEEncode → KSampler → SaveImage。
 *
 * 要有 `prompt` 与 `steps` 这些真实槽位，才能验"sidecar 里的参数真被带过去"。
 */
const IMG_WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
  3: { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['1', 2] } },
  4: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['3', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  7: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'x' } },
}

/** 吃图、但采样节点没有 seed 槽位的工作流（验"没有 seed 槽位"那条路径）。 */
const IMG_NO_SEED_WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  2: { class_type: 'LoadImage', inputs: { image: 'placeholder.png' } },
  3: { class_type: 'VAEEncode', inputs: { pixels: ['2', 0], vae: ['1', 2] } },
  4: { class_type: 'KSamplerPlain', inputs: { steps: 20, cfg: 7, model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['3', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  7: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'x' } },
}

/** 不吃图的工作流（没有 LoadImage / VAEEncode）。 */
const TXT_WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
  4: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, cfg: 7, model: ['1', 0], positive: ['5', 0], negative: ['6', 0], latent_image: ['8', 0] } },
  5: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
  8: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
  7: { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'x' } },
}

/** 真 1×1 PNG。 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/**
 * 造环境：工作流目录 + 一张带 sidecar 的产物。
 *
 * @param wf - 工作流图。
 * @param sidecar - 写进 `<png>.json` 的内容。
 */
function makeEnv(wf, sidecar) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-'))
  const wfDir = path.join(dir, 'wf')
  fs.mkdirSync(wfDir, { recursive: true })
  fs.writeFileSync(path.join(wfDir, 'wf.json'), JSON.stringify(wf))
  const out = path.join(dir, 'out')
  fs.mkdirSync(out, { recursive: true })
  const png = path.join(dir, 'shot.png')
  fs.writeFileSync(png, PNG)
  if (sidecar !== undefined) fs.writeFileSync(`${png}.json`, JSON.stringify(sidecar))

  const runs = new RunRegistry(out)
  const routes = createWorkflowRoutes({
    client: {
      baseUrl: 'http://127.0.0.1:8188',
      async objectInfo() {
        const info = {}
        for (const node of Object.values(wf)) info[node.class_type] = { input: {}, output: [], output_node: false }
        return info
      },
      async queuePrompt() { return 'pid-rr' },
      async queue() { return { running: [], pending: [] } },
      async history() { return { status: { status_str: 'success', completed: true }, outputs: {} } },
      async view() { return PNG },
      // 本地图要搬进 ComfyUI 的 input 目录；返回它在 ComfyUI 那边的名字
      async uploadImage() { return { name: 'uploaded.png', subfolder: 'comfyui-workbench' } },
    },
    supervisor: { status: () => ({ running: false }), ensureRunning: async () => undefined },
    workflowDir: wfDir,
    settings: { pollIntervalMs: 40, outputDir: out, comfyBaseUrl: 'http://127.0.0.1:8188' },
    assertWritable: () => {},
    defaultOutputDir: out,
    runs,
    getExporter: () => undefined,
  })
  return { routes, dir, out, runs, png }
}

/** 假 ServerResponse。 */
function fakeRes() {
  return {
    status: 0,
    body: '',
    writeHead(status) { this.status = status; return this },
    end(body) { this.body = body },
  }
}

/** 打一次 POST /rerun。 */
async function post(routes, body) {
  const res = fakeRes()
  await routes.exact['/rerun'](
    new URL('http://x/rerun'),
    res,
    Readable.from([Buffer.from(JSON.stringify(body))]),
  )
  return JSON.parse(res.body)
}

test('asInput：把图填进 image 槽位，其余参数从 sidecar 原样带过去', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'old.png', steps: 33, prompt: '原图的提示词' },
  })
  const payload = await post(routes, { path: png, asInput: true })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(payload.pending, true)

  // 关键断言：其余参数不能被默认值覆盖
  const effective = payload.effectiveVars ?? {}
  assert.equal(effective.steps, 33, 'steps 要保留')
  assert.equal(effective.prompt, '原图的提示词', 'prompt 要保留')
  // 实现会把本地图传进 ComfyUI 并换成那边的名字，所以这里断言"被换掉了"
  assert.notEqual(effective.image, 'old.png', 'image 要换成传进去的那张')
  // seed 是**故意**换掉的：换了参考图还沿用原 seed，等于"同一张图 + 同一个 seed"，
  // 而这条链路位级确定（实测清缓存重算也逐字节相同）→ 每次点都得到同一张。
  assert.equal(typeof effective.seed, 'number', 'asInput 要换一个新 seed')
  assert.equal(typeof payload.seed, 'number', '响应里要把实际用的 seed 回给调用方')
  assert.ok(String(effective.image).includes('uploaded'), `应当指向上传后的文件，实际 ${String(effective.image)}`)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不传 asInput：参数全保留、不换图', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'keep.png', steps: 7 },
  })
  const payload = await post(routes, { path: png })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  const effective = payload.effectiveVars ?? {}
  assert.equal(effective.image, 'keep.png', '不带 asInput 就不该换图')
  assert.equal(effective.steps, 7)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('不传 asInput：seed 保持 sidecar 原值（普通重跑就是"完全复现"）', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'keep.png', steps: 7, seed: 424242 },
  })
  const payload = await post(routes, { path: png })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  const effective = payload.effectiveVars ?? {}
  assert.equal(effective.seed, 424242, '不带 asInput 时 seed 必须留着')
  assert.equal(payload.seed, undefined, '没换 seed 就不该回这个字段')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asInput：同一张图连点两次，seed 不同（否则出的图一模一样）', async () => {
  // 这条是这次改动的核心判据：换了参考图还沿用原 seed 时，每次点都得到同一张图。
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'old.png', steps: 12, seed: 999 },
  })
  const first = await post(routes, { path: png, asInput: true })
  const second = await post(routes, { path: png, asInput: true })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.equal(second.ok, true, JSON.stringify(second))
  assert.equal(typeof first.seed, 'number')
  assert.equal(typeof second.seed, 'number')
  assert.notEqual(first.seed, 999, 'asInput 不该沿用 sidecar 的 seed')
  assert.notEqual(second.seed, 999, 'asInput 不该沿用 sidecar 的 seed')
  assert.notEqual(first.seed, second.seed, '两次要得到不同的 seed')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asInput + 显式 seed：用调用方给的，不再随机', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'old.png', steps: 8, seed: 111 },
  })
  const payload = await post(routes, { path: png, asInput: true, seed: 654321 })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(payload.seed, 654321, '给了 seed 就用它的')
  assert.equal((payload.effectiveVars ?? {}).seed, 654321)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asInput + 字符串 seed：照样用它（模型常把数字包成字符串）', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, {
    workflowId: 'wf',
    vars: { image: 'old.png', steps: 8, seed: 111 },
  })
  const payload = await post(routes, { path: png, asInput: true, seed: '777888' })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(payload.seed, 777888, '数字字符串要当数字用，不能静默退回随机')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('asInput + 工作流没有 seed 槽位：不报错，也不硬塞 seed', async () => {
  // 若有人把 vars[seedSlot] 写成无守卫赋值，这里会抛 variable_unknown 整条失败
  const { routes, dir, png } = makeEnv(IMG_NO_SEED_WF, {
    workflowId: 'wf',
    vars: { image: 'old.png', steps: 6 },
  })
  const payload = await post(routes, { path: png, asInput: true })
  assert.equal(payload.ok, true, JSON.stringify(payload))
  assert.equal(payload.seed, undefined, '没有 seed 槽位就不该回这个字段')
  assert.equal((payload.effectiveVars ?? {}).seed, undefined)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('工作流不吃图时明确拒绝，不静默降级成空参数重跑', async () => {
  const { routes, dir, png } = makeEnv(TXT_WF, { workflowId: 'wf', vars: { steps: 5 } })
  const payload = await post(routes, { path: png, asInput: true })
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'no-image-slot')
  assert.match(String(payload.message), /不吃图|image/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('没有 sidecar：说清读不到参数，不猜', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, undefined)
  const payload = await post(routes, { path: png, asInput: true })
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'no-sidecar')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('sidecar 里的工作流已不在本机：说清楚', async () => {
  const { routes, dir, png } = makeEnv(IMG_WF, { workflowId: 'gone', vars: { steps: 1 } })
  const payload = await post(routes, { path: png, asInput: true })
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'no-workflow')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('缺 path 直接 400', async () => {
  const { routes, dir } = makeEnv(IMG_WF, { workflowId: 'wf', vars: {} })
  const payload = await post(routes, {})
  assert.equal(payload.ok, false)
  assert.equal(payload.error, 'bad-body')
  fs.rmSync(dir, { recursive: true, force: true })
})
