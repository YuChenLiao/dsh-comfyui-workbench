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

test('GET /run-preview：有帧回图片字节、无帧回 found:false、非 GET 405', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    const base = `${app.origin}/comfyui-workbench/api/run-preview`

    // 缺 promptId：说清楚要什么
    assert.equal((await fetch(base)).status, 400)

    // 没有帧：不是错误，是"这会儿还没有预览"
    const absent = await fetch(`${base}?promptId=nope`)
    assert.equal(absent.status, 200)
    const body = await absent.json()
    assert.equal(body.ok, true)
    assert.equal(body.found, false)

    // 有帧：直接回图片字节（不是 JSON），Content-Type 跟着帧的 mime 走
    const runtime = app.runtime
    assert.ok(runtime !== undefined, 'applyAll 该把 runtime 回出来')
    runtime.runs.submit('p-preview', 'wf')
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    runtime.runs.setPreview('p-preview', 'image/png', png)

    const hit = await fetch(`${base}?promptId=p-preview`)
    assert.equal(hit.status, 200)
    assert.equal(hit.headers.get('content-type'), 'image/png', '预览帧要按图片回，不能包一层 JSON')
    assert.equal(hit.headers.get('cache-control'), 'no-store', '播放中的帧不能被缓存')
    const bytes = new Uint8Array(await hit.arrayBuffer())
    assert.deepEqual([...bytes], [...png], '回的必须是与写入时逐字节相同的图')

    // 进终态后帧要消失：否则每次出图都会泄漏几十 KB
    runtime.runs.update('p-preview', { state: 'done' })
    const gone = await fetch(`${base}?promptId=p-preview`)
    assert.equal(gone.status, 200)
    assert.equal((await gone.json()).found, false, '运行结束后不该还有预览帧')

    // 非 GET 一律 405
    assert.equal((await fetch(`${base}?promptId=x`, { method: 'POST' })).status, 405)
  } finally {
    await app.close()
  }
})

test('GET /doctor：返回五项自检结论；服务不可用时 service=fail 但接口本身 200', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/doctor`)
    assert.equal(res.status, 200, '自检本身不该因为服务没起而报错')
    const body = await res.json()
    assert.equal(body.ok, true)
    assert.equal(Array.isArray(body.report.items), true)
    assert.deepEqual(body.report.items.map(item => item.id), ['service', 'models', 'workflows', 'output', 'gpu'])
    // 测试环境里 ComfyUI 没起：service 必须如实说 fail，而不是含糊的 warn
    assert.equal(body.report.items.find(item => item.id === 'service').level, 'fail')
    assert.equal(body.report.ok, false)
  } finally {
    await app.close()
  }
})

test('POST /workflows/bootstrap：没有模型时拒绝生成；GET 回 405', async () => {
  const dirs = tmpDirs()
  const app = await boot({
    roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads, indexFile: dirs.index,
    autoStart: false, autoDetect: false,
  })
  try {
    const base = `${app.origin}/comfyui-workbench/api/workflows/bootstrap`
    assert.equal((await fetch(base)).status, 405, '生成模板是写动作')

    const res = await fetch(base, { method: 'POST' })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.equal(body.ok, true)
    // ComfyUI 没起 → 拿不到 checkpoint 列表 → 明确 blocked，而不是静默生成空模板
    assert.deepEqual(body.created, [])
    assert.match(String(body.blocked), /checkpoint/)
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

    // 2) 删单张：这里显式 `soft=0` 走物理删除（软删除的路径由「回收站」那条用例覆盖）
    const del = await fetch(`${base}/delete?path=${encodeURIComponent(imageA)}&soft=0`, { method: 'POST' })
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

/**
 * 回收站：软删除 → 列表 → 恢复 → 清空。
 *
 * 产物旁边的 `.json` sidecar 是"再来一张一模一样的"唯一凭据，而面板上删除是一次点击。
 * 所以默认走软删除（移进 `<root>/.trash/`），`soft=0` 才是物理删除。
 *
 * 同时覆盖写接口登记：api/trash/restore、api/trash/empty（漏进 WRITABLE 就是真机 405）。
 */
test('回收站：软删除、列表、恢复（含 sidecar）、清空，以及 .trash 不进图库', async () => {
  const dirs = tmpDirs()
  const image = path.join(dirs.out, 'trash-me.png')
  const sidecar = `${image}.json`
  fs.writeFileSync(image, TINY_PNG)
  fs.writeFileSync(sidecar, JSON.stringify({
    plugin: 'dsh-comfyui-workbench',
    workflowId: 'text2img-basic',
    createdAt: new Date().toISOString(),
    vars: { prompt: '删了要能回来' },
    comfy: { url: 'http://127.0.0.1:8188', promptId: 'pid-trash' },
  }))

  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index, autoStart: false, autoDetect: false })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    // 1) 默认软删除：图从原处消失，但文件还在（在 .trash 下）
    const del = await fetch(`${base}/delete?path=${encodeURIComponent(image)}`, { method: 'POST' })
    assert.equal(del.status, 200, `405 就说明 WRITABLE 漏了 /delete，实际 ${del.status}`)
    const delBody = await del.json()
    assert.equal(delBody.ok, true)
    assert.ok(typeof delBody.trashed === 'string' && delBody.trashed !== '', '软删除要带回回收站目录')
    // `removed` 里也要有原路径：前端按它算"要从列表里撤掉哪些卡片"。
    // 只回 `trashed` 的话前端得到一个空集合 —— 卡片留在原地、总数却 -1。
    assert.ok(delBody.removed.includes(image), `软删除也要把原路径放进 removed，实际 ${JSON.stringify(delBody.removed)}`)
    assert.equal(fs.existsSync(image), false, '原处不该还有这张图')
    assert.equal(fs.existsSync(sidecar), false, 'sidecar 要跟着一起移走')

    // 2) .trash 不能出现在图库里（SKIP_DIRS）：否则用户看到的是"删了还在"
    const items = await (await fetch(`${base}/items?all=1&limit=100`)).json()
    assert.equal(items.items.some(row => row.name === 'trash-me.png'), false, '.trash 里的图不该回流到列表')

    // 3) 列表能看见这一份
    const list = await (await fetch(`${base}/trash`)).json()
    assert.equal(list.ok, true)
    assert.equal(list.total, 1, `回收站该有 1 条，实际 ${JSON.stringify(list)}`)
    const entry = list.entries[0]
    assert.equal(entry.name, 'trash-me.png')
    assert.equal(entry.original, image)

    // 4) 恢复：图与 sidecar 都要回来
    const restore = await fetch(`${base}/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: entry.dir }),
    })
    assert.equal(restore.status, 200, `405 就说明 WRITABLE 漏了 /trash/restore，实际 ${restore.status}`)
    assert.equal((await restore.json()).ok, true)
    assert.equal(fs.existsSync(image), true, '图要回来')
    assert.equal(fs.existsSync(sidecar), true, 'sidecar 也要回来（没有它就没法再来一张）')

    // 5) 再删一次，然后清空
    await fetch(`${base}/delete?path=${encodeURIComponent(image)}`, { method: 'POST' })
    const empty = await fetch(`${base}/trash/empty`, { method: 'POST' })
    assert.equal(empty.status, 200, `405 就说明 WRITABLE 漏了 /trash/empty，实际 ${empty.status}`)
    assert.equal((await (await fetch(`${base}/trash`)).json()).total, 0, '清空后不该还有条目')

    // 6) 恢复一个不在回收站里的目录：403，不能靠它把任意路径搬回来
    const evil = await fetch(`${base}/trash/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: dirs.base }),
    })
    assert.equal(evil.status, 403)
  } finally {
    await app.close()
  }
})

/**
 * 回收站的两条回归：
 *
 * 1. `includeHidden: true` 时，`.trash` 里的图**不能**回流到图库。
 *    这条是审查抓到的真漏洞：`.trash` 最初只加进 `shared/media/constants.ts`，
 *    而扫描实际用的是 `scan/constants.ts` 那份副本 —— 默认配置下看不出来
 *    （`.trash` 以点开头被"隐藏目录"规则挡住），一旦显示隐藏文件就全回来了，
 *    连索引重建都会把它收进去。
 * 2. 两张同名图先后进回收站，恢复时不能互相覆盖（`renameSync` 会覆盖既有文件）。
 */
test('回收站回归：includeHidden 下不回流、同名恢复不互相覆盖', async () => {
  const dirs = tmpDirs()
  // 两个不同目录里的同名文件：回收站路径不同、恢复目标相同
  const dirA = path.join(dirs.out, 'a')
  const dirB = path.join(dirs.out, 'b')
  fs.mkdirSync(dirA, { recursive: true })
  fs.mkdirSync(dirB, { recursive: true })
  const first = path.join(dirA, 'dup.png')
  const second = path.join(dirB, 'dup.png')
  fs.writeFileSync(first, Buffer.concat([TINY_PNG, Buffer.from('A')]))
  fs.writeFileSync(second, Buffer.concat([TINY_PNG, Buffer.from('BB')]))
  fs.writeFileSync(`${first}.json`, JSON.stringify({ plugin: 'dsh-comfyui-workbench', workflowId: 'wf-a' }))
  fs.writeFileSync(`${second}.json`, JSON.stringify({ plugin: 'dsh-comfyui-workbench', workflowId: 'wf-b' }))

  const app = await boot({
    roots: [dirs.out],
    outputDir: dirs.out,
    workflowsDir: dirs.workflows,
    uploadsDir: dirs.uploads,
    indexFile: dirs.index,
    autoStart: false,
    autoDetect: false,
    // 关键：显示隐藏文件。默认 false 时 `.trash` 会被"隐藏目录"规则挡住，
    // 这条用例就永远绿 —— 上一版就是这么漏过去的。
    includeHidden: true,
  })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    for (const file of [first, second]) {
      const res = await fetch(`${base}/delete?path=${encodeURIComponent(file)}`, { method: 'POST' })
      assert.equal(res.status, 200)
    }

    // 1) includeHidden 下也不能看到回收站里的图
    const items = await (await fetch(`${base}/items?all=1&limit=100&refresh=1`)).json()
    assert.equal(items.items.filter(row => row.name === 'dup.png').length, 0, '.trash 里的图不能回流到图库')
    // 重建索引也不该把它收进去
    const rebuilt = await (await fetch(`${base}/assets/rebuild`, { method: 'POST' })).json()
    assert.equal(rebuilt.rebuilt, 0, `索引重建不能收回收站里的图，实际 ${rebuilt.rebuilt}`)

    // 2) 恢复撞名：删掉之后又生成了同名新图，恢复不能覆盖它
    //    审查实测过的真场景 —— 只查一次 `original` 时 `renameSync` 会覆盖既有文件，
    //    两次都回 ok:true，先恢复的那份被静默顶掉。
    const list = await (await fetch(`${base}/trash`)).json()
    assert.equal(list.total, 2)
    const restored = []
    for (const [index, entry] of list.entries.entries()) {
      // 恢复第一份之前，先在它的原路径上放一个"新生成的同名图"（内容不同）
      if (index === 0) fs.writeFileSync(entry.original, Buffer.concat([TINY_PNG, Buffer.from('NEW')]))
      const res = await fetch(`${base}/trash/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir: entry.dir }),
      })
      const body = await res.json()
      assert.equal(body.ok, true, JSON.stringify(body))
      restored.push(body.restored)
    }
    assert.equal(new Set(restored).size, 2, `两次恢复不能落到同一个路径：${JSON.stringify(restored)}`)
    assert.equal(fs.existsSync(restored[0]), true)
    assert.equal(fs.existsSync(restored[1]), true)
    // 撞名那份必须带后缀，原路径上的新图不能被覆盖
    assert.notEqual(restored[0], list.entries[0].original, '原路径被新图占着时必须改名，不能覆盖')
    assert.equal(
      fs.readFileSync(list.entries[0].original).toString('base64'),
      Buffer.concat([TINY_PNG, Buffer.from('NEW')]).toString('base64'),
      '原路径上的新图必须原封不动',
    )
    // 两份内容不同（回收站里的 A / BB）：如果发生覆盖，两份会变成同一份
    assert.notEqual(
      fs.readFileSync(restored[0]).toString('base64'),
      fs.readFileSync(restored[1]).toString('base64'),
      '恢复时不能互相覆盖',
    )
  } finally {
    await app.close()
  }
})

/**
 * 相册的结构化筛选：/items 的 `workflow` / `checkpoint` / `aspect`。
 *
 * 与 `q` 互补：`q` 是"我记得点什么"，这些是"我只要这一类"。
 * `aspect` 走 5% 容差 —— 1536×1500 在视觉上就是方图，严格相等会把它判成横图。
 */
test('GET /items：按工作流、底模、方向筛选', async () => {
  const dirs = tmpDirs()
  const write = (name, meta) => {
    const file = path.join(dirs.out, name)
    fs.writeFileSync(file, TINY_PNG)
    fs.writeFileSync(`${file}.json`, JSON.stringify({
      plugin: 'dsh-comfyui-workbench',
      createdAt: new Date().toISOString(),
      workflowId: meta.workflowId,
      checkpoint: meta.checkpoint,
      width: meta.width,
      height: meta.height,
      vars: { prompt: name },
      comfy: { url: 'http://127.0.0.1:8188', promptId: `pid-${name}` },
    }))
  }
  write('wide.png', { workflowId: 'text2img-basic', checkpoint: 'sd_xl_base_1.0.safetensors', width: 1920, height: 1080 })
  write('tall.png', { workflowId: 'upscale-4x', checkpoint: 'flux-dev.safetensors', width: 1080, height: 1920 })
  write('square.png', { workflowId: 'text2img-basic', checkpoint: 'sd_xl_base_1.0.safetensors', width: 1024, height: 1000 })

  // 插件自己写的 sidecar 是**这种形态**：顶层没有 checkpoint、没有 workflow，
  // 参数全在 vars 里（shared/run/runner.ts）。只测手写形态的话，
  // "按底模筛选对自家产物恒为 0" 这个 bug 永远发现不了。
  const runnerFile = path.join(dirs.out, 'runner.png')
  fs.writeFileSync(runnerFile, TINY_PNG)
  fs.writeFileSync(`${runnerFile}.json`, JSON.stringify({
    plugin: 'dsh-comfyui-workbench',
    createdAt: new Date().toISOString(),
    workflowId: 'text2img-basic',
    workflowHash: 'h'.repeat(16),
    vars: { ckpt_name: 'SDXL_Turbo_1.0.safetensors', steps: 20, cfg: 7, sampler_name: 'euler', prompt: 'a cat' },
    prompt: 'a cat',
    seed: 42,
    width: 1536,
    height: 1024,
    comfy: { url: 'http://127.0.0.1:8188', promptId: 'pid-runner' },
  }))

  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index, autoStart: false, autoDetect: false })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    const MINE = ['wide.png', 'tall.png', 'square.png', 'runner.png']
    const names = async query => {
      const body = await (await fetch(`${base}/items?all=1&limit=200${query}`)).json()
      // rootsOf 会连进程 cwd 一起扫（仓库里有 docs/screenshots 的图），只取这三条
      return body.items.map(row => row.name).filter(name => MINE.includes(name)).sort()
    }

    assert.deepEqual(await names(''), ['runner.png', 'square.png', 'tall.png', 'wide.png'], '不筛选时四条都在')
    // total 是 UI 的计数来源，也得跟着过滤走
    const totalOf = async query => (await (await fetch(`${base}/items?all=1&limit=50${query}`)).json()).total
    assert.equal(await totalOf('&workflow=text2img-basic'), 3, 'runner / square / wide 都属于这个工作流')
    // 工作流：精确 id（runner 那张也属于这个工作流）
    assert.deepEqual(await names('&workflow=text2img-basic'), ['runner.png', 'square.png', 'wide.png'])
    assert.deepEqual(await names('&workflow=upscale-4x'), ['tall.png'])
    // 底模：子串（用户记得 sdxl，不记得完整文件名）
    // 顶层 checkpoint（ComfyUI 内嵌块形态）
    assert.deepEqual(await names('&checkpoint=sd_xl'), ['square.png', 'wide.png'])
    // **大小写不敏感**：占位提示让人打的就是小写，而真实底模名常是大写（`SDXL_*`）
    assert.deepEqual(await names('&checkpoint=SD_XL'), ['square.png', 'wide.png'])
    // vars 形态（插件自己写的 sidecar）：这是相册里的绝大多数，必须也能筛到
    assert.deepEqual(await names('&checkpoint=sdxl_turbo'), ['runner.png'], 'checkpoint 要能从 vars 里取')
    assert.deepEqual(await names('&checkpoint=SDXL_TURBO'), ['runner.png'], 'vars 形态同样不区分大小写')
    // 方向：1024×1000 的宽高比是 1.024，落在 5% 容差内 → 方图；runner 是 1536×1024 → 横
    assert.deepEqual(await names('&aspect=landscape'), ['runner.png', 'wide.png'])
    assert.deepEqual(await names('&aspect=portrait'), ['tall.png'])
    assert.deepEqual(await names('&aspect=square'), ['square.png'])
    // 非法 aspect 被忽略（不是 400、也不是筛成空）
    assert.equal((await names('&aspect=diagonal')).length, 4)
  } finally {
    await app.close()
  }
})

/**
 * 视频 / 音频也是资产：扫描、MIME、缩略图回退、删除都要认。
 *
 * 工作流会顺带产出视频（AnimateDiff、SVD 这类），把它们排除在资产库之外
 * 意味着"生成了却看不见"—— 而用户往往正是想找那段动图。
 */
test('视频与音频：进图库、MIME 正确、缩略图回退原文件、可删除', async () => {
  const dirs = tmpDirs()
  const clip = path.join(dirs.out, 'clip.mp4')
  const voice = path.join(dirs.out, 'voice.mp3')
  fs.writeFileSync(clip, Buffer.from('fake-mp4-bytes'))
  fs.writeFileSync(voice, Buffer.from('fake-mp3-bytes'))

  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index, autoStart: false, autoDetect: false })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    const listed = await (await fetch(`${base}/items?all=1&limit=100`)).json()
    const byName = name => listed.items.find(row => row.name === name)
    assert.equal(byName('clip.mp4')?.kind, 'video', `视频要标成 video，实际 ${JSON.stringify(byName('clip.mp4'))}`)
    assert.equal(byName('voice.mp3')?.kind, 'audio')

    // MIME：浏览器靠它决定能不能播；给成 octet-stream 的话 <video> 会直接空着
    const videoRes = await fetch(`${base}/file?path=${encodeURIComponent(clip)}`)
    assert.equal(videoRes.status, 200)
    assert.equal(videoRes.headers.get('content-type'), 'video/mp4')

    // 缩略图请求要回退原文件（视频没有缩略图，不能回 404 也不能回 image/webp）
    const thumbRes = await fetch(`${base}/file?path=${encodeURIComponent(clip)}&thumb=1`)
    assert.equal(thumbRes.status, 200)
    assert.equal(thumbRes.headers.get('content-type'), 'video/mp4', '视频的 thumb 请求要回退原文件')

    // 删除：视频也能删（白名单按扩展名判，别把 mp4 当成"不是图片"）
    const del = await fetch(`${base}/delete?path=${encodeURIComponent(clip)}&soft=0`, { method: 'POST' })
    assert.equal(del.status, 200, JSON.stringify(await del.json()))
    assert.equal(fs.existsSync(clip), false)
  } finally {
    await app.close()
  }
})

/**
 * `/file` 的 Range 支持：视频能不能拖动进度条全看它。
 *
 * 不支持 Range 时 `<video controls>` 的进度条在 Chrome/Firefox 里**拖不动**，
 * 用户看到的是"播放器坏了"；而且卡片网格一页 60 个 `<video preload="metadata">`
 * 会各自从字节 0 拉整个文件（几十 MB）。
 */
test('/file：Range 返回 206 与正确的 Content-Range，整文件请求带 Accept-Ranges', async () => {
  const dirs = tmpDirs()
  const clip = path.join(dirs.out, 'range.mp4')
  const bytes = Buffer.alloc(4096, 7)
  fs.writeFileSync(clip, bytes)
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows, uploadsDir: dirs.uploads, indexFile: dirs.index, autoStart: false, autoDetect: false })
  const base = `${app.origin}/comfyui-workbench/api`
  const fileUrl = `${base}/file?path=${encodeURIComponent(clip)}`
  try {
    // 整文件：200 + Accept-Ranges（播放器据此才知道可以发 Range）
    const full = await fetch(fileUrl)
    assert.equal(full.status, 200)
    assert.equal(full.headers.get('accept-ranges'), 'bytes')
    assert.equal((await full.arrayBuffer()).byteLength, 4096)

    // 前 100 字节
    const head = await fetch(fileUrl, { headers: { Range: 'bytes=0-99' } })
    assert.equal(head.status, 206)
    assert.equal(head.headers.get('content-range'), 'bytes 0-99/4096')
    assert.equal(head.headers.get('content-length'), '100')
    assert.equal((await head.arrayBuffer()).byteLength, 100)

    // 从 4000 到结尾
    const tail = await fetch(fileUrl, { headers: { Range: 'bytes=4000-' } })
    assert.equal(tail.status, 206)
    assert.equal(tail.headers.get('content-range'), 'bytes 4000-4095/4096')
    assert.equal((await tail.arrayBuffer()).byteLength, 96)

    // 末尾 96 字节（bytes=-96 是"最后 N 字节"）
    const suffix = await fetch(fileUrl, { headers: { Range: 'bytes=-96' } })
    assert.equal(suffix.status, 206)
    assert.equal(suffix.headers.get('content-range'), 'bytes 4000-4095/4096')

    // 越界：416 + 总长，播放器会自己退回从头请求
    const bad = await fetch(fileUrl, { headers: { Range: 'bytes=99999-' } })
    assert.equal(bad.status, 416)
    assert.equal(bad.headers.get('content-range'), 'bytes */4096')

    // 缩略图请求仍然优先回缩略图（这里没有 sharp，回退原图，但 Range 不该生效）
    const thumb = await fetch(`${fileUrl}&thumb=1`)
    assert.equal(thumb.status, 200)
  } finally {
    await app.close()
  }
})

/**
 * 预设从面板侧可见、可删。
 *
 * 预设住在 `<id>.meta.json` 的 `presets`，模型用 `comfyui_run { preset }` 套用。
 * 面板至少要让用户看得见「这套模板能套哪几组参数」，否则它们等于隐形。
 */
test('工作流预设：列表项带出名字，删除预设只动 presets 不动别的 meta 字段', async () => {
  const dirs = tmpDirs()
  importWorkflowFile(dirs.workflows, SAMPLE)
  const metaFile = path.join(dirs.workflows, 'text2img-basic.meta.json')
  fs.writeFileSync(metaFile, JSON.stringify({
    enabled: true,
    description: '已有的备注',
    presets: {
      night: { steps: 30, cfg: 5 },
      quick: { steps: 8 },
      // 形状不对的预设：与运行侧共用 normalizedPresets，两边都不该认
      broken: 'not-an-object',
    },
  }))

  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })
  const base = `${app.origin}/comfyui-workbench/api`
  try {
    const list = await (await fetch(`${base}/workflows`)).json()
    const item = list.workflows.find(row => row.workflowId === 'text2img-basic')
    assert.ok(item !== undefined)
    assert.deepEqual(item.presets.sort(), ['night', 'quick'], `列表项要带预设名，实际 ${JSON.stringify(item.presets)}`)

    // 详情也带（面板展开某张卡时用的就是它）
    const detail = await (await fetch(`${base}/workflows/text2img-basic`)).json()
    assert.deepEqual(detail.presets.sort(), ['night', 'quick'])

    // 删一个预设
    const res = await fetch(`${base}/workflows/text2img-basic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removePreset: 'night' }),
    })
    assert.equal(res.status, 200)
    const body = await res.json()
    assert.deepEqual(body.presets, ['quick'], `删完只剩 quick，实际 ${JSON.stringify(body.presets)}`)

    // 删**最后一个**：服务端必须无条件回  —— 省略字段的话前端对象展开
    // 不会删掉旧键，卡片会继续显示已经删掉的预设名。
    const last = await (await fetch(`${base}/workflows/text2img-basic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removePreset: 'quick' }),
    })).json()
    assert.deepEqual(last.presets, [], `删完最后一个要给空数组，实际 ${JSON.stringify(last.presets)}`)

    // 删一个不存在的预设：不能回 200 让面板显示"已删除"
    const ghost = await fetch(`${base}/workflows/text2img-basic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ removePreset: 'ghost' }),
    })
    assert.equal(ghost.status, 404, '删不存在的预设要 404')

    // 落盘检查：别的字段（描述 / enabled）不能被顺手抹掉
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'))
    assert.deepEqual(Object.keys(meta.presets), [], '两个预设都删完后 presets 是空对象')
    assert.equal(meta.description, '已有的备注', '删预设不该影响用途备注')
    assert.equal(meta.enabled, true, '删预设不该影响可用开关')
  } finally {
    await app.close()
  }
})
