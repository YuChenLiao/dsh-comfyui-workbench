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

import { apply } from '../lib/index.js'
import { importWorkflowFile } from '../lib/workflow.js'

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

  apply(ctx, config)

  const registered = prefixRoutes[0]
  assert.ok(registered !== undefined, '应当注册 HTTP 路由')

  const server = http.createServer((req, res) => {
    void registered.handler(req, res)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  return {
    origin,
    tools,
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function tmpDirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-api-'))
  const workflows = path.join(base, 'workflows')
  const out = path.join(base, 'out')
  fs.mkdirSync(workflows, { recursive: true })
  fs.mkdirSync(out, { recursive: true })
  return { base, workflows, out }
}

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
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })

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

test('GET /workflows/{id} 不接受写方法', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })
  try {
    const res = await fetch(`${app.origin}/comfyui-workbench/api/workflows/text2img-basic`, { method: 'POST' })
    assert.equal(res.status, 405)
  } finally {
    await app.close()
  }
})

test('POST /workflows 仍是批量导出（无 body 时 400）', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })
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
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })
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

test('工具注册：4 个工具都带必要字段', async () => {
  const dirs = tmpDirs()
  const app = await boot({ roots: [dirs.out], outputDir: dirs.out, workflowsDir: dirs.workflows })
  try {
    const names = app.tools.map(spec => spec.name).sort()
    assert.deepEqual(names, ['comfyui_run', 'comfyui_workflow_edit', 'comfyui_workflow_inspect', 'comfyui_workflow_list'])
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
