/**
 * HTTP 层自检：工作流列表 / 详情 / 资产检索的契约。
 *
 * 全部用临时目录，不碰 ~/.dsh —— 这几个路由的默认目录来自配置，测试必须注入。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { listenSafe } from './helpers.mjs'


import { importWorkflowFile } from '../lib/workflow.js'

// 插件的默认目录（uploads / outputs / 索引）都挂在主目录下，测试必须隔离，
// 否则会扫到本机真实数据（上一轮就被真实产物绊过）。
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-home-'))
process.env.USERPROFILE = isoHome
process.env.HOME = isoHome
const { applyAll } = await import('../lib/index.js')

/** 起一个只含必要服务的假宿主。 */
async function boot(config) {
  const prefixRoutes = []
  const tools = []
  const ctx = {
    get(name) {
      if (name === 'webServer') {
        return {
          register(route) {
            prefixRoutes.push(route)
            return () => {}
          },
        }
      }
      if (name === 'tools') {
        return {
          register(spec) {
            tools.push(spec)
            return () => {}
          },
        }
      }
      return undefined
    },
    effect(run) {
      return run()
    },
  }

  const runtime = applyAll(ctx, config)

  const registered = prefixRoutes[0]
  assert.ok(registered !== undefined, '应当注册 HTTP 路由')

  const server = http.createServer((req, res) => {
    void registered.handler(req, res)
  })
  const port = await listenSafe(server)
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    tools,
    runtime,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function tmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-api-'))
  const workflows = path.join(base, 'workflows')
  const out = path.join(base, 'out')
  const uploads = path.join(base, 'uploads')
  const index = path.join(base, 'assets.jsonl')
  fs.mkdirSync(workflows, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  fs.mkdirSync(uploads, { recursive: true })
  return { base, workflows, out, uploads, index }
}

/** 1×1 透明 PNG。 */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

const SAMPLE = path.join(process.cwd(), 'samples', 'text2img-basic.json')

test('GET /workflows：空目录返回零条，导入后带模型与备注状态', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
  })

  try {
    const empty = await (await fetch(`${app.origin}/comfyui-workbench/api/workflows`)).json()
    assert.equal(empty.ok, true)
    assert.equal(empty.count, 0)
    assert.deepEqual(empty.workflows, [])

    importWorkflowFile(dirs.workflows, SAMPLE)

    const list = await (await fetch(`${app.origin}/comfyui-workbench/api/workflows`)).json()
    assert.equal(list.count, 1)
    const item = list.workflows[0]
    assert.equal(item.workflowId, 'text2img-basic')
    assert.equal(item.model, 'sd_xl_base_1.0.safetensors')
    assert.equal(item.modelKind, 'checkpoint')
    assert.equal(item.undescribed, true, '没有备注时应标出来')
    assert.deepEqual(item.inputKinds.sort(), ['number', 'string'])
    assert.ok(item.basicCount === 2, 'prompt 与 negative_prompt 进 basic')
  } finally {
    await app.close()
  }
})

test('GET /workflows/{id}：返回完整输入槽位；不存在时 404', async () => {
  const dirs = tmpDirs()
  importWorkflowFile(dirs.workflows, SAMPLE)
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })

  try {
    const detail = await (await fetch(`${app.origin}/comfyui-workbench/api/workflows/text2img-basic`)).json()
    assert.equal(detail.ok, true)
    const surface = detail.surface
    assert.equal(surface.workflowId, 'text2img-basic')
    assert.equal(surface.inputs.length > 0, true)
    const prompt = surface.inputs.find(slot => slot.name === 'prompt')
    assert.equal(prompt.group, 'basic')
    assert.equal(prompt.bind, '6.inputs.text')
    assert.equal(surface.outputs[0].kind, 'image')

    const missing = await fetch(`${app.origin}/comfyui-workbench/api/workflows/nope`)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error, 'no-workflow')
  } finally {
    await app.close()
  }
})

test('POST /workflows/{id} 改设置：不存在的工作流 404', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    // 这条路径现在是"改工作流设置"（启用/备注），不再是只读
    const res = await fetch(`${app.origin}/comfyui-workbench/api/workflows/text2img-basic`, { method: 'POST' })
    assert.equal(res.status, 404, '工作流不存在就该 404')
    // DELETE 现在支持了（删模板），不存在时同样是 404 —— 不再是 405
    const del = await fetch(`${app.origin}/comfyui-workbench/api/workflows/text2img-basic`, { method: 'DELETE' })
    assert.equal(del.status, 404, '删不存在的模板回 404，而不是 405')
  } finally {
    await app.close()
  }
})

test('POST /workflows 仍是批量导出（无 body 时 400）', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/workflows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(res.status, 400)
    assert.equal((await res.json()).error, 'bad-paths')
  } finally {
    await app.close()
  }
})

test('GET /assets：索引为空时返回空列表而不是报错', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/assets?limit=10`)
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.deepEqual(body.items, [])
  } finally {
    await app.close()
  }
})

test('POST /run 拒绝授权范围外的输出目录', async () => {
  const dirs = tmpDirs()
  importWorkflowFile(dirs.workflows, SAMPLE)
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })

  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workflowId: 'text2img-basic',
        vars: { prompt: 'x' },
        outputPath: path.join(os.tmpdir(), 'cwf-outside-should-not-exist'),
      }),
    })
    const body = await res.json()
    assert.equal(res.status, 400)
    assert.equal(body.error, 'forbidden-output')
    assert.match(body.message, /assetRoots/)

    // 授权内的目录不该被这一步拦下。用一个不存在的参数让它**在校验阶段**就失败，
    // 免得测试真的去连 ComfyUI 跑一次生成（那会让单测依赖外部服务状态与 GPU）。
    const ok = await fetch(`${app.origin}/comfyui-workbench/api/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ workflowId: 'text2img-basic', vars: { notAParameter: 1 }, outputPath: dirs.out }),
    })
    const okBody = await ok.json()
    assert.equal(okBody.error === 'forbidden-output', false, '授权内的目录不该被判为越权')
    assert.equal(okBody.code, 'variable_unknown', '应当走到参数校验这一步')
  } finally {
    await app.close()
  }
})

test('POST /upload：二进制直传落到上传目录，返回尺寸', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/upload?filename=${encodeURIComponent('参考图.png')}`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: TINY_PNG,
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.ok(typeof body.path === 'string' && fs.existsSync(body.path), '文件应当真的落盘')
    assert.equal(body.bytes, TINY_PNG.length)
    assert.equal(body.width, 1)
    assert.equal(body.height, 1)
    assert.ok(body.path.includes('参考图'), '文件名里的中文要保留')
    // 落了盘就能预览：同一条 /file 通道读得到
    const file = await fetch(`${app.origin}/comfyui-workbench/api/file?path=${encodeURIComponent(body.path)}`)
    assert.equal(file.status, 200)
  } finally {
    await app.close()
  }
})

test('POST /upload：不是图片就拒绝，扩展名不认也拒绝', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    const fake = await fetch(`${app.origin}/comfyui-workbench/api/upload?filename=a.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('this is not an image'),
    })
    assert.equal(fake.status, 400)
    assert.equal((await fake.json()).error, 'not-an-image')

    const badExt = await fetch(`${app.origin}/comfyui-workbench/api/upload?filename=a.exe`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: TINY_PNG,
    })
    assert.equal(badExt.status, 400)
    assert.equal((await badExt.json()).error, 'unsupported-type')
  } finally {
    await app.close()
  }
})

test('终端面板：GET /terminal 不能被方法校验拦成 405', async () => {
  // 这条必须走真实的 createDispatch —— 前两轮分别漏了"POST 被 WRITABLE 漏掉"
  // 和"GET 被 WRITABLE 封死"，都是因为测试直接调组件路由、绕过了方法校验层。
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads,
    indexFile: dirs.index,
    // 别让测试真去拉 ComfyUI
    autoStart: false,
    autoDetect: false,
  })
  try {
    // 这里是真 http server，直接 fetch（boot 返回的是 origin 而不是封装好的 get/post）
    const read = await fetch(`${app.origin}/comfyui-workbench/api/terminal?since=0`)
    assert.equal(read.status, 200, 'GET 必须可用（面板靠它轮询）')
    const readBody = await read.json()
    assert.equal(readBody.ok, true)
    assert.ok(Array.isArray(readBody.lines))

    const clear = await fetch(`${app.origin}/comfyui-workbench/api/terminal`, { method: 'POST' })
    assert.equal(clear.status, 200, 'POST 是清屏')

    const start = await fetch(`${app.origin}/comfyui-workbench/api/terminal?action=start`, { method: 'POST' })
    assert.equal(start.status, 200, 'POST ?action=start 是拉起服务')
  } finally {
    await app.close()
  }
})

test('面板「以原参数重跑」：POST /rerun 不能被方法校验拦成 405', async () => {
  // 上一版 rerun-api.test.mjs 从 routes.exact['/rerun'] 进，绕过了 createDispatch
  // 的方法白名单 —— 于是 POST /rerun 在真机上恒 405「这个接口是只读的」，面板上
  // "作为输入出图"那个按钮 100% 点不动，而那一整个测试文件全绿。
  // 这条必须走真 http server + 真 dispatch，与终端清屏那条同一个理由。
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads,
    indexFile: dirs.index,
    autoStart: false,
    autoDetect: false,
  })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/rerun`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    const body = await res.json()
    assert.notEqual(res.status, 405, `POST /rerun 被方法校验拦了：${String(body.message ?? '')}`)
    assert.equal(res.status, 400, '缺 path 应当是 400')
    assert.equal(body.ok, false)
    assert.equal(body.error, 'bad-body', '应当是 400 + bad-body，说明真的进了 handler')

    // 这条路径没有 GET 语义，只读方法仍该被拒
    const get = await fetch(`${app.origin}/comfyui-workbench/api/rerun`)
    assert.equal(get.status, 405, 'GET /rerun 应当 405')
  } finally {
    await app.close()
  }
})

test('面板开关：POST /config 切 progressStream，且 GET 能读回（不用重启）', async () => {
  // 这条必须走真实的 createDispatch —— /config 是 selfManaged 路径，
  // 白名单里没有它的话 POST 会恒 405（`/rerun` 就栽在这），而 GET 又必须能用。
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    const before = await (await fetch(`${app.origin}/comfyui-workbench/api/config`)).json()
    assert.equal(typeof before.config.toggles?.progressStream, 'boolean', '要报告开关当前值')
    assert.equal(before.config.toggles.progressStreamSource, 'config', '还没在面板上改过，来源是配置')

    const on = await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressStream: true }),
    })
    assert.notEqual(on.status, 405, 'POST /config 被方法校验拦了')
    const onBody = await on.json()
    assert.equal(onBody.ok, true)
    assert.equal(onBody.toggles.progressStream, true)
    assert.equal(onBody.toggles.progressStreamSource, 'toggle')

    // GET 立刻能读到（写的时候缓存已失效）
    const after = await (await fetch(`${app.origin}/comfyui-workbench/api/config`)).json()
    assert.equal(after.config.toggles.progressStream, true)
    assert.equal(after.config.toggles.progressStreamSource, 'toggle')

    // null = 清掉覆盖，回退到配置默认值
    const cleared = await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressStream: null }),
    })
    const clearedBody = await cleared.json()
    assert.equal(clearedBody.ok, true)
    assert.equal(clearedBody.toggles.progressStreamSource, 'config', '清掉覆盖后来源该回到配置')

    // 非布尔值要明确拒绝，而不是静默当成 false
    const bad = await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressStream: 'yes' }),
    })
    assert.equal((await bad.json()).error, 'bad-body')

    // PUT/DELETE 不能落进"当 GET 处理"（那会返回 200 + ok:true，客户端以为保存成功）
    for (const method of ['PUT', 'DELETE']) {
      const res = await fetch(`${app.origin}/comfyui-workbench/api/config`, { method })
      assert.equal(res.status, 405, `${method} /config 该 405，实际 ${res.status}`)
    }
  } finally {
    await app.close()
  }
})

test('POST /config 的 runWait 开关：与 progressStream 互不覆盖', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    const before = await (await fetch(`${app.origin}/comfyui-workbench/api/config`)).json()
    assert.equal(before.config.toggles.runWait, 'async', '内置默认是 async')
    assert.equal(before.config.toggles.runWaitSource, 'config')

    // 只切 runWait：progressStream 不能被顺手清掉
    await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressStream: true }),
    })
    const sync = await (await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runWait: 'sync' }),
    })).json()
    assert.equal(sync.ok, true)
    assert.equal(sync.toggles.runWait, 'sync')
    assert.equal(sync.toggles.runWaitSource, 'toggle')
    assert.equal(sync.toggles.progressStream, true, '切 runWait 不该把 progressStream 冲掉')

    // 反过来：只切 progressStream 时 runWait 也要留着
    const off = await (await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progressStream: false }),
    })).json()
    assert.equal(off.toggles.runWait, 'sync', '切 progressStream 不该把 runWait 冲掉')

    // null 清掉覆盖，回退到配置
    const cleared = await (await fetch(`${app.origin}/comfyui-workbench/api/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ runWait: null }),
    })).json()
    assert.equal(cleared.toggles.runWait, 'async')
    assert.equal(cleared.toggles.runWaitSource, 'config')

    // 非法值要拒绝，而不是静默当成 async
    for (const bad of ['later', 1, true, {}]) {
      const res = await (await fetch(`${app.origin}/comfyui-workbench/api/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runWait: bad }),
      })).json()
      assert.equal(res.error, 'bad-body', `runWait=${JSON.stringify(bad)} 该被拒`)
    }
  } finally {
    await app.close()
  }
})

test('POST /workflows/import：贴 API JSON 能导入，同名覆盖保留备注，UI 格式明确拒绝', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })

  /** 一份最小的 API 格式工作流。 */
  const apiWorkflow = {
    1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'x.safetensors' } },
    2: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, model: ['1', 0], positive: ['3', 0], negative: ['4', 0], latent_image: ['5', 0] } },
    3: { class_type: 'CLIPTextEncode', inputs: { text: 'a', clip: ['1', 1] } },
    4: { class_type: 'CLIPTextEncode', inputs: { text: 'b', clip: ['1', 1] } },
    5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    6: { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['1', 2] } },
    7: { class_type: 'SaveImage', inputs: { images: ['6', 0], filename_prefix: 'x' } },
  }

  const post = body => fetch(`${app.origin}/comfyui-workbench/api/workflows/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  try {
    // 1) 路由陷阱：`/workflows/import` 不能被当成 id=import 的工作流去读详情
    const ok = await post({ name: 'My Painted Flow', workflow: apiWorkflow })
    const okBody = await ok.json()
    assert.equal(ok.status, 200, `实际 ${ok.status} ${JSON.stringify(okBody)}`)
    assert.equal(okBody.ok, true)
    assert.equal(okBody.workflowId, 'my-painted-flow', 'name 要经 sanitizeId 生成 id')
    assert.equal(okBody.replaced, false, '首次导入不算覆盖')
    assert.ok(okBody.surface !== undefined, '要把 IO 面回给前端')

    // 2) 同名再导：先 409，确认后才覆盖；覆盖保留备注，旧模板备份
    const patched = await fetch(`${app.origin}/comfyui-workbench/api/workflows/my-painted-flow`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: '手动写的备注' }),
    })
    assert.equal(patched.status, 200)
    const clash = await post({ name: 'my-painted-flow', workflow: apiWorkflow })
    const clashBody = await clash.json()
    assert.equal(clash.status, 409, '同名不该静默覆盖')
    assert.equal(clashBody.error, 'already-exists')
    assert.equal(clashBody.workflowId, 'my-painted-flow', '要回 id，前端才好问"覆盖 X 吗"')

    const again = await post({ name: 'my-painted-flow', workflow: apiWorkflow, overwrite: true })
    const againBody = await again.json()
    assert.equal(again.status, 200, JSON.stringify(againBody))
    assert.equal(againBody.replaced, true, '确认覆盖后要标 replaced')
    const detail = await (await fetch(`${app.origin}/comfyui-workbench/api/workflows/my-painted-flow`)).json()
    assert.equal(detail.surface.description, '手动写的备注', '覆盖模板但不该抹掉备注')
    assert.equal(
      fs.existsSync(path.join(dirs.workflows, 'my-painted-flow.json.bak')),
      true,
      '覆盖前要留一份 .bak，至少要能回退一次',
    )

    // 3) 省略 name：每次生成不同的 id，不会互相覆盖
    const first = await (await post({ workflow: apiWorkflow })).json()
    const second = await (await post({ workflow: apiWorkflow })).json()
    assert.equal(first.ok, true, JSON.stringify(first))
    assert.equal(second.ok, true, JSON.stringify(second))
    assert.notEqual(first.workflowId, second.workflowId, '不填名字不能都落到同一个 id')
    assert.match(first.workflowId, /^workflow-/, `缺省 id 该带时间戳：${first.workflowId}`)

    // 4) 名字里的 `.json` 后缀要被 sanitizeId 去掉，中文名要保留
    const dotted = await (await post({ name: 'Flow.JSON', workflow: apiWorkflow })).json()
    assert.equal(dotted.workflowId, 'flow', '`.json` 不该进 id')
    const chinese = await (await post({ name: '工作流 一号', workflow: apiWorkflow })).json()
    assert.equal(chinese.workflowId, '工作流-一号', '中文名要保留，空格转连字符')
    assert.equal(fs.existsSync(path.join(dirs.workflows, '工作流-一号.json')), true, '落盘名要与返回的 id 一致')

    // 5) UI 格式：400 且指向 Export (API)
    const ui = await post({ name: 'ui-flow', workflow: { nodes: [], links: [] } })
    const uiBody = await ui.json()
    assert.equal(ui.status, 400)
    assert.equal(uiBody.error, 'bad-workflow')
    assert.match(String(uiBody.message), /Export \(API\)/, `要给出可执行指引：${uiBody.message}`)

    // 6) workflow 不是对象（数组 / 字符串）同样 400
    for (const bad of [[], 'not-a-workflow', 42]) {
      const res = await post({ name: 'bad-shape', workflow: bad })
      assert.equal(res.status, 400, `${JSON.stringify(bad)} 该被拒`)
      assert.equal((await res.json()).error, 'bad-workflow')
    }

    // 7) 缺 workflow 字段
    const missing = await post({ name: 'x' })
    assert.equal(missing.status, 400)
    assert.equal((await missing.json()).error, 'bad-body')

    // 8) 非 POST
    const getIt = await fetch(`${app.origin}/comfyui-workbench/api/workflows/import`)
    assert.equal(getIt.status, 405, '导入只接受 POST')
  } finally {
    await app.close()
  }
})

test('GET /run-status：查得到刚提交的运行，查不到时 found:false 而不是报错', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    // 缺失 promptId：说清楚要什么
    const missing = await fetch(`${app.origin}/comfyui-workbench/api/run-status`)
    assert.equal(missing.status, 400)

    // 不存在的 promptId：不是错误，是"查不到"（重启后注册表就是空的）
    const absent = await fetch(`${app.origin}/comfyui-workbench/api/run-status?promptId=nope`)
    assert.equal(absent.status, 200)
    const body = await absent.json()
    assert.equal(body.ok, true)
    assert.equal(body.found, false, '查不到要如实说 found:false')

    // 非 GET 一律 405
    const post = await fetch(`${app.origin}/comfyui-workbench/api/run-status?promptId=x`, { method: 'POST' })
    assert.equal(post.status, 405)
  } finally {
    await app.close()
  }
})

test('POST /tags/sync 不能被子方法校验拦成 405（走真实 dispatch）', async () => {
  // 这条防的是"单测全绿、真机 405"：`/tags/sync` 需要 POST（开始）与 GET（轮进度）
  // 两种方法，必须进 router 的 selfManaged，否则分派器在 handler 之前就 405 了。
  // 仓库在这个坑上踩过三次（/workflows、/terminal、/config），这是第四次。
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    // GET 是轮询路径，必须通
    const poll = await fetch(`${app.origin}/comfyui-workbench/api/tags/sync`)
    assert.equal(poll.status, 200, `GET /tags/sync 该放行，实际 ${poll.status}`)
    const body = await poll.json()
    assert.equal(body.ok, true, JSON.stringify(body))
    assert.equal(body.state, 'idle', '没跑过时该是 idle')

    // DELETE 这种真不支持的，仍然要 405（不能为了放行把整条路径变成万能）
    const del = await fetch(`${app.origin}/comfyui-workbench/api/tags/sync`, { method: 'DELETE' })
    assert.equal(del.status, 405, `DELETE 该 405，实际 ${del.status}`)
  } finally {
    await app.close()
  }
})

test('工具注册：13 个工具都带必要字段', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  try {
    const names = app.tools.map(spec => spec.name).sort()
    assert.deepEqual(names, [
      'comfyui_character',
      'comfyui_compose',
      'comfyui_costume',
      'comfyui_node_search',
      'comfyui_pose',
      'comfyui_rerun',
      'comfyui_run',
      'comfyui_run_batch',
      'comfyui_runs',
      'comfyui_workflow',
      'comfyui_workflow_edit',
      'danbooru_lookup',
      'danbooru_sync',
    ])
    for (const spec of app.tools) {
      assert.equal(typeof spec.description, 'string')
      assert.ok(spec.description.length > 20, `${spec.name} 的描述应当能让模型判断何时用`)
      assert.equal(typeof spec.execute, 'function')
      assert.ok(spec.output !== undefined && typeof spec.output.render === 'function')
    }
  } finally {
    await app.close()
  }
})

test('装配接线：runtime 的 RunRegistry 真的落在 outputDir 下（漏传目录这条要能被抓到）', async () => {
  // 这条守的是一个具体的洞：`new RunRegistry()` 漏传 outputDir 时 registry 纯内存，
  // 接口照样 200 `found:false`、`get()` 照样返回 undefined —— 任何"查状态"的用例都绿。
  // 唯一能抓到的方式是：真的提交一条、然后看 outputDir 里有没有 `runs.json`。
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    assert.ok(app.runtime !== undefined, 'applyAll 该把 runtime 回出来')
    app.runtime.runs.submit('pid-wire', 'wf-wire')
    app.runtime.runs.flush?.()

    const file = path.join(dirs.out, 'runs.json')
    assert.equal(fs.existsSync(file), true, `运行记录该落在 ${file}（漏传 outputDir 的话这里会是 false）`)
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    const ids = Array.isArray(saved) ? saved.map(record => record.promptId) : Object.keys(saved)
    assert.ok(ids.includes('pid-wire'), `记录里该有 pid-wire，实际 ${JSON.stringify(ids)}`)
  } finally {
    await app.close()
  }
})

/**
 * 姿势库走真实入口。
 *
 * 这条与 `/tags/sync` 那批是同一个理由：**不能只调 handler**。分派器在 handler 之前
 * 有一道 `selfManaged` 的方法校验，漏登记就是恒 405，而单测全绿。
 * 下面第 5、7 两条断言就是钉这件事的 —— 前者要 404（说明 POST 放行了）、
 * 后者要 405（说明 GET 被拦）。两个码混在一起才说明分派层真的按方法在分流。
 *
 * 这里**不碰网络**：只查本地目录与不存在的 id。真取图的路径在 poses.test.mjs 里
 * 用注入的 fetch 测。
 */
test('api/poses：搜索、统计、以及 /poses/fetch 的写方法真的被放行', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 默认不含成人向：288 组里只有 98 组可见
    const visible = await (await fetch(`${base}/poses?limit=3`)).json()
    assert.equal(visible.ok, true)
    assert.equal(visible.items.length, 3)
    assert.equal(visible.total, 288, '默认该给全部 288 组，不做内容筛选')
    assert.ok(typeof visible.items[0].cover.viewId === 'string', '要带封面视角 id，面板才能取图')
    assert.ok(Array.isArray(visible.items[0].angleIds), '要带实际角度列表，前端按它画按钮')

    // 2) safe=1 才收窄到常规那 98 组
    const safeOnly = await (await fetch(`${base}/poses?safe=1&limit=1`)).json()
    assert.equal(safeOnly.total, 98)

    // 3) 统计与随包目录一致
    const stats = await (await fetch(`${base}/poses/stats`)).json()
    assert.equal(stats.poseCount, 288)
    assert.equal(stats.viewCount, 1439)
    assert.equal(stats.adultPoseCount, 190)
    assert.equal(stats.safePoseCount, 98)
    assert.equal(stats.systems.length, 4)
    assert.ok(stats.attribution.includes('ギア'), '要把版权人写进统计，面板底部直接显示')

    // 4) 体系筛选与 safe 独立：pair 55 组默认可见，safe=1 之后是 0
    const pairPlain = await (await fetch(`${base}/poses?system=pair`)).json()
    assert.equal(pairPlain.total, 55, 'pair 体系 55 组，默认就该在结果里')
    const pairSafe = await (await fetch(`${base}/poses?system=pair&safe=1`)).json()
    assert.equal(pairSafe.total, 0, 'safe=1 把 pair 收干净')

    // 5) 写接口：POST 放行到 handler（id 不存在 → 404，而不是 405）
    //    这里写完整路径而不是拼 base：`arch-write-routes.mjs` 会在本文件里找
    //    `api/poses/` 这个字面量，拼接出来的字符串匹配不到，检查就会误判成"没测"。
    const fetchMissing = await fetch(`${app.origin}/comfyui-workbench/api/poses/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'no_such_pose_front' }),
    })
    assert.equal(fetchMissing.status, 404, '405 就说明 router 的 selfManaged 漏了 /poses/')
    assert.equal((await fetchMissing.json()).error, 'unknown-pose')

    // 6) 代理图：同样先过索引
    const imageMissing = await fetch(`${base}/poses/image?id=no_such_pose_front`)
    assert.equal(imageMissing.status, 404)

    // 7) 同一条路径不接受 GET —— 证明上一步的 404 不是"什么都放行"
    const fetchWithGet = await fetch(`${base}/poses/fetch`)
    assert.equal(fetchWithGet.status, 405, '/poses/fetch 只有 POST 语义')
  } finally {
    await app.close()
  }
})

/**
 * 服装库走真实入口。与 `api/poses` 同构：
 * `POST /costumes/fetch` 必须被 `selfManaged` 放行（要 404 而不是 405），
 * 同一条路径的 GET 必须被拦（405）—— 两个码合起来才说明分派层按方法分流。
 */
test('api/costumes：搜索、统计，以及 /costumes/fetch 的写方法真的被放行', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 默认全给 1407 套，不做内容筛选
    const all = await (await fetch(`${base}/costumes?limit=3`)).json()
    assert.equal(all.ok, true)
    assert.equal(all.items.length, 3)
    assert.equal(all.total, 1407, '默认该给全部，不藏任何一套')
    assert.ok(typeof all.items[0].keywords === 'string' && all.items[0].keywords !== '', '每条都要带英文关键词')

    // 2) safe=1 收窄到 1014 套（排除内衣/泳装/性感三个分类共 393）
    const safeOnly = await (await fetch(`${base}/costumes?safe=1&limit=1`)).json()
    assert.equal(safeOnly.total, 1014)

    // 3) 统计
    const stats = await (await fetch(`${base}/costumes/stats`)).json()
    assert.equal(stats.total, 1407)
    assert.equal(stats.adultCount, 393)
    assert.equal(stats.safeCount, 1014)
    assert.equal(Object.keys(stats.categories).length, 8)
    assert.ok(stats.attribution.includes('ギア'), '版权人要进统计，面板底部直接显示')

    // 4) 分类筛选与 safe 独立
    const winter = await (await fetch(`${base}/costumes?category=${encodeURIComponent('冬季穿搭')}`)).json()
    assert.equal(winter.total, 253, '冬季 253 套，默认可见')
    const lingerie = await (await fetch(`${base}/costumes?category=${encodeURIComponent('内衣・睡衣')}`)).json()
    assert.equal(lingerie.total, 199, '内衣也是默认可见（不做内容过滤）')

    // 5) 写接口：POST 放行到 handler（id 不存在 → 404，而不是 405）
    const fetchMissing = await fetch(`${app.origin}/comfyui-workbench/api/costumes/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'NO-SUCH-0001' }),
    })
    assert.equal(fetchMissing.status, 404, '405 就说明 router 的 selfManaged 漏了 /costumes/')
    assert.equal((await fetchMissing.json()).error, 'unknown-costume')

    // 6) 代理图同样先过索引
    assert.equal((await fetch(`${base}/costumes/image?id=NO-SUCH-0001`)).status, 404)
    // 7) 同一路径不接受 GET
    assert.equal((await fetch(`${base}/costumes/fetch`)).status, 405, '/costumes/fetch 只有 POST 语义')
  } finally {
    await app.close()
  }
})

/**
 * 角色库：`POST /characters/fetch` 必须被 `selfManaged` 放行（要 404 而不是 405）。
 *
 * 覆盖写接口 api/characters/ 的真实入口（arch-write-routes.mjs 按这个字面量认账）。
 *
 * 不真的拉图：既不希望 CI 依赖 GitHub，也不该在测试里触碰素材字节（上游禁止再分发）。
 * 所以只验「分派层按方法分流 + 索引能挡住不存在的 id」这两件在真机上会安静坏掉的事。
 */
test('api/characters：搜索、统计，以及 /characters/fetch 的写方法真的被放行', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 列表：默认给全部，每条带 id / 名字 / 品牌 / 可用槽位
    const all = await (await fetch(`${base}/characters?limit=3`)).json()
    assert.equal(all.ok, true)
    assert.equal(all.items.length, 3)
    assert.equal(all.total, 20, '库内 20 个角色')
    assert.ok(typeof all.items[0].name === 'string' && all.items[0].name !== '')
    assert.ok(Array.isArray(all.items[0].slots) && all.items[0].slots.includes('turnaround'), '必须报告可用槽位')

    // 2) 搜索走描述里的词：`狐娘` 只在副标题 / alt 里出现，光搜 name 搜不到
    const fox = await (await fetch(`${base}/characters?q=${encodeURIComponent('狐娘')}`)).json()
    assert.ok(fox.total >= 1, '副标题与 alt 里的词也要能命中')

    // 3) 品牌筛选
    const ds = await (await fetch(`${base}/characters?brand=${encodeURIComponent('DeepSeek')}`)).json()
    assert.equal(ds.total, 4, 'DeepSeek 系列 4 个条目')

    // 4) 统计带许可与来源
    const stats = await (await fetch(`${base}/characters/stats`)).json()
    assert.equal(stats.characterCount, 20)
    assert.equal(Object.keys(stats.brands).length, 15)
    assert.ok(stats.license.includes('CC BY-NC-SA'), '许可要进统计，面板底部直接显示')

    // 5) 写接口：POST 放行到 handler（id 不存在 → 404，而不是 405）
    const fetchMissing = await fetch(`${base}/characters/fetch?id=NOPE&slot=turnaround`, { method: 'POST' })
    assert.equal(fetchMissing.status, 404, '405 就说明 router 的 selfManaged 漏了 /characters/')
    assert.equal((await fetchMissing.json()).error, 'not-found')

    // 6) 非法槽位要被挡（不能拼出任意路径）
    const badSlot = await fetch(`${base}/characters/fetch?id=c01&slot=../../etc`, { method: 'POST' })
    assert.equal(badSlot.status, 400)
    assert.equal((await badSlot.json()).error, 'bad-slot')

    // 7) 代理图同样先过索引
    assert.equal((await fetch(`${base}/characters/image?id=NOPE&slot=preview`)).status, 404)
    // 8) 同一路径不接受 GET
    assert.equal((await fetch(`${base}/characters/fetch?id=c01&slot=turnaround`)).status, 405, '/characters/fetch 只有 POST 语义')
  } finally {
    await app.close()
  }
})

/**
 * 五个写接口的真入口覆盖：api/delete、api/delete-many、api/assets/rebuild、
 * api/free、api/service/stop。
 *
 * `arch-write-routes.mjs` 的 `KNOWN_UNTESTED` 一直是历史债：路径进了 `router.ts` 的
 * 三张表，但 `api.test.mjs` 里没有一条走真实 `boot()` + `fetch` 的用例 —— 于是
 * "分派层把 POST 拦成 405" 这类错只有真机才发现（这个坑踩过四次）。
 *
 * 断言重点不是业务结果，而是**分派层真的放行了**：任何一条回 405，就说明
 * `WRITABLE` / `POST_ONLY` 里漏了它。
 */
test('写接口真入口：/delete、/delete-many、/assets/rebuild、/free、/service/stop 都不再 405', async () => {
  const dirs = tmpDirs()
  const imageA = path.join(dirs.out, 'del-a.png')
  const imageB = path.join(dirs.out, 'del-b.png')
  const sidecarOf = name => JSON.stringify({
    plugin: 'dsh-comfyui-workbench',
    workflowId: 'text2img-basic',
    workflowHash: 'h'.repeat(16),
    createdAt: new Date().toISOString(),
    vars: { prompt: name },
    comfy: { url: 'http://127.0.0.1:8188', promptId: `pid-${name}` },
    tags: [],
  })
  fs.writeFileSync(imageA, TINY_PNG)
  fs.writeFileSync(imageB, TINY_PNG)
  fs.writeFileSync(`${imageA}.json`, sidecarOf('a'))
  fs.writeFileSync(`${imageB}.json`, sidecarOf('b'))

  // `baseUrl` 故意指到不可达端口：`/free` 的 client 接了 `ensure: supervisor.ensureReady()`，
  // 而 ensureReady 会 probe 真实地址，探通就直接 `POST /free {unload_models:true, free_memory:true}`。
  // 用默认的 127.0.0.1:8188 时，一台**正开着 ComfyUI** 的机器跑 npm test 会真的卸载模型
  // （出图中也会）—— 这条用例只想验分派层，不该有这个副作用。
  //
  // **还关掉了 autoStart/autoDetect**：默认开着时，连不上（127.0.0.1:1 必然连不上）会触发
  // supervisor 自己去拉起本机安装的 ComfyUI —— 实测这条用例因此跑满 180 秒冷启动超时，
  // 并在安装目录里留下写入痕迹。测试不该动用户的服务。
  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads,
    indexFile: dirs.index,
    baseUrl: 'http://127.0.0.1:1',
    autoStart: false,
    autoDetect: false,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 重建索引：真扫目录、真读 sidecar
    const rebuild = await fetch(`${base}/assets/rebuild`, { method: 'POST' })
    assert.equal(rebuild.status, 200, '405 就说明 WRITABLE 漏了 /assets/rebuild')
    const rebuilt = await rebuild.json()
    assert.equal(rebuilt.ok, true)
    assert.equal(rebuilt.rebuilt, 2, `该从两份 sidecar 重建出两条，实际 ${rebuilt.rebuilt}`)

    // 2) 删单张：图与 sidecar 一起走，否则重建会把已删的图复活
    const del = await fetch(`${base}/delete?path=${encodeURIComponent(imageA)}`, { method: 'POST' })
    assert.equal(del.status, 200, '405 就说明 WRITABLE 漏了 /delete')
    const delBody = await del.json()
    assert.equal(delBody.ok, true)
    assert.ok(delBody.removed.includes(imageA), 'removed 要包含图本身')
    assert.ok(delBody.removed.includes(`${imageA}.json`), 'sidecar 也要出现在 removed 里')
    assert.equal(fs.existsSync(imageA), false)
    assert.equal(fs.existsSync(`${imageA}.json`), false, 'sidecar 必须跟着删')

    // 3) 批量删
    const many = await fetch(`${base}/delete-many`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paths: [imageB] }),
    })
    assert.equal(many.status, 200, '405 就说明 WRITABLE 漏了 /delete-many')
    assert.equal((await many.json()).ok, true)
    assert.equal(fs.existsSync(imageB), false)

    // 4) 释放显存：地址不可达，所以必然是结构化失败 —— 但**不是 405**。
    //    断言 ok === false 同时锁住"这条真打到了 client"：只断 status 200 的话，
    //    一个永远返回 {ok:false} 的空实现也能通过。
    const free = await fetch(`${base}/free`, { method: 'POST' })
    assert.equal(free.status, 200, '405 就说明 POST_ONLY 漏了 /free')
    assert.equal((await free.json()).ok, false, '地址不可达时该是结构化失败')

    // 5) 停托管服务：supervisor 在本测试里没拉起任何进程，stop 应是幂等的
    const stop = await fetch(`${base}/service/stop`, { method: 'POST' })
    assert.equal(stop.status, 200, '405 就说明 WRITABLE 漏了 /service/stop')
    assert.equal(typeof (await stop.json()).ok, 'boolean')
  } finally {
    await app.close()
  }
})

/**
 * 相册检索面：`/items?q=` 要能按**底模**与**工作流名**命中。
 *
 * 原来 haystack 只有文件名 + 提示词 + 负向提示词。真实的检索意图却常常是
 * 「那张 SDXL 出的」「那个放大工作流跑的」—— 用户记得用的是哪套工具，不记得文件名。
 * 这两种意图在旧实现里全部落空，而且没有任何提示（结果就是 0 条）。
 */
test('GET /items?q=：按底模、工作流名与提示词都能命中', async () => {
  const dirs = tmpDirs()
  const write = (name, meta) => {
    const file = path.join(dirs.out, name)
    fs.writeFileSync(file, TINY_PNG)
    fs.writeFileSync(`${file}.json`, JSON.stringify({
      plugin: 'dsh-comfyui-workbench',
      createdAt: new Date().toISOString(),
      vars: { prompt: meta.prompt },
      prompt: meta.prompt,
      checkpoint: meta.checkpoint,
      workflowId: meta.workflowId,
      comfy: { url: 'http://127.0.0.1:8188', promptId: `pid-${name}` },
    }))
    return file
  }
  write('sdxl-cat.png', { prompt: '一只猫', checkpoint: 'sd_xl_base_1.0.safetensors', workflowId: 'text2img-basic' })
  write('flux-dog.png', { prompt: '一只狗', checkpoint: 'flux-dev.safetensors', workflowId: '放大-upscale' })

  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    const search = async q => (await (await fetch(`${base}/items?q=${encodeURIComponent(q)}`)).json())

    // 底模名：旧实现里这条恒为 0 条
    const byCheckpoint = await search('sd_xl_base')
    assert.equal(byCheckpoint.total, 1, '按底模名要能命中')
    assert.equal(byCheckpoint.items[0].name, 'sdxl-cat.png')

    // 工作流名（中文，非文件名的一部分）
    const byWorkflow = await search('放大')
    assert.equal(byWorkflow.total, 1, '按工作流名要能命中')
    assert.equal(byWorkflow.items[0].name, 'flux-dog.png')

    // 提示词检索不能因此坏掉（这是原来的能力）
    assert.equal((await search('一只猫')).items[0].name, 'sdxl-cat.png')

    // 命中不到时仍然是 0，而不是"什么都能匹配"
    assert.equal((await search('绝不可能存在的词')).total, 0)
  } finally {
    await app.close()
  }
})

/**
 * 控制条与模板管理的真入口：api/interrupt、api/service/stats、api/workflows/audit、
 * 以及 `DELETE /workflows/:id`。
 *
 * 同样是指针问题：这些路径要么只接受 POST（进 `POST_ONLY`），要么藏在 `/workflows/`
 * 这个 `selfManaged` 前缀下 —— 直接调 handler 会绕过方法校验层，测试绿而真机 405。
 */
test('控制条接口：中断、显存统计、体检与删模板都走真实分派', async () => {
  const dirs = tmpDirs()
  importWorkflowFile(dirs.workflows, SAMPLE)
  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads,
    indexFile: dirs.index,
    // 不可达端口 + 关掉自动拉起：这三条会真的打 ComfyUI（中断 / 系统统计 / 节点清单），
    // 一台正开着 ComfyUI 的机器跑测试时不该被我们打断或读走状态；
    // 而默认 autoStart 会在连不上时尝试自己拉起一个进程，测试会挂在那儿。
    baseUrl: 'http://127.0.0.1:1',
    autoStart: false,
    autoDetect: false,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 中断：分派层放行，服务不可达时是结构化失败（不是 405、也不是 500）
    const interrupt = await fetch(`${base}/interrupt`, { method: 'POST' })
    assert.equal(interrupt.status, 200, '405 就说明 POST_ONLY 漏了 /interrupt')
    // 不可达时必须 ok:false：`client.interrupt()` 原来把异常吞了，面板永远显示"已中断"，
    // 服务离线和真中断分辨不出来
    assert.equal((await interrupt.json()).ok, false, '服务不可达时不能回 ok:true')

    // 2) 显存与活跃任务：服务离线时 gpu 为空、service 仍要报状态
    const stats = await fetch(`${base}/service/stats`)
    assert.equal(stats.status, 200, '405 就说明 /service/stats 没注册成 GET')
    const statsBody = await stats.json()
    assert.equal(statsBody.ok, true)
    assert.deepEqual(statsBody.gpu, [], '不可达时没有 GPU 数据，但不能因此整块失败')
    assert.ok(Array.isArray(statsBody.active))
    assert.ok(statsBody.service !== null && typeof statsBody.service === 'object', '服务状态要能报出来')

    // 3) 体检：拿不到节点清单时明确说"无法体检"，不假装全部健康
    const audit = await fetch(`${base}/workflows/audit`)
    assert.equal(audit.status, 200)
    const auditBody = await audit.json()
    assert.equal(auditBody.ok, false, '拿不到 object_info 时不能报 ok:true')
    assert.match(String(auditBody.error), /节点清单/)

    // 4) 删模板：把刚导入的那份删掉，文件要真的消失
    const workflowFile = path.join(dirs.workflows, 'text2img-basic.json')
    assert.equal(fs.existsSync(workflowFile), true)
    const del = await fetch(`${base}/workflows/text2img-basic`, { method: 'DELETE' })
    assert.equal(del.status, 200, `DELETE 要放行，实际 ${del.status}`)
    assert.equal((await del.json()).ok, true)
    assert.equal(fs.existsSync(workflowFile), false, '模板文件要真的被删掉')

    // 再删一次：404，而不是静默成功
    const again = await fetch(`${base}/workflows/text2img-basic`, { method: 'DELETE' })
    assert.equal(again.status, 404)

    // 5) 路径穿越：`%2f` 解码后是 `/`，必须在**解码之后**拦下。
    //    先判原始片段再解码的话，`..%2fvictim` 会变成 `../victim` 交给 path.join ——
    //    实测能把工作流目录外的任意 `.json` 删掉。
    const victim = path.join(dirs.base, 'victim.json')
    fs.writeFileSync(victim, '{}')
    const evil = await fetch(`${base}/workflows/..%2fvictim.json`, { method: 'DELETE' })
    assert.equal(evil.status, 404, '非法 id 一律拒绝')
    assert.equal(fs.existsSync(victim), true, '工作流目录外的文件不能被动到')
    fs.rmSync(victim, { force: true })
  } finally {
    await app.close()
  }
})
