/**
 * 组件隔离自检。
 *
 * 拆分的目的不是"文件分开放"，而是：关掉一个组件只少了它那份能力，
 * 且某个组件构建失败时其他组件照常上线。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { listenSafe } from './helpers.mjs'


import { registerTools } from '../lib/index.js'

// 主目录隔离：否则会扫到本机真实的产物与索引
const isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-comp-'))
process.env.USERPROFILE = isoHome
process.env.HOME = isoHome
const { applyAll } = await import('../lib/index.js')

/** 最小假宿主：只提供 webServer 与 tools。 */
async function boot(config) {
  const routes = []
  const tools = []
  const ctx = {
    effect: factory => { factory() },
    get: name => {
      if (name === 'webServer') return { register: route => { routes.push(route); return () => {} } }
      if (name === 'tools') return { register: spec => { tools.push(spec); return () => {} } }
      return undefined
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
  }
  applyAll(ctx, config)

  const route = routes.find(item => item.path === '/comfyui-workbench/api')
  const server = http.createServer(route.handler)
  const port = await listenSafe(server)
  const origin = `http://127.0.0.1:${port}`
  return {
    origin,
    tools: tools.map(spec => spec.name),
    get: async pathname => {
      const res = await fetch(origin + pathname)
      return { status: res.status, body: await res.json().catch(() => null) }
    },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}

function dirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-comp-run-'))
  const out = path.join(base, 'out')
  const wf = path.join(base, 'wf')
  const up = path.join(base, 'up')
  for (const dir of [out, wf, up]) fs.mkdirSync(dir, { recursive: true })
  return { base, out, wf, up, index: path.join(base, 'assets.jsonl') }
}

const baseConfig = d => ({
  roots: [d.out],
  outputDir: d.out,
  workflowsDir: d.wf,
  uploadsDir: d.up,
  indexFile: d.index,
  autoStart: false,
  autoDetect: false,
})

test('默认全开：两组路由与四个工具都在', async () => {
  const d = dirs()
  const app = await boot(baseConfig(d))
  try {
    assert.equal((await app.get('/comfyui-workbench/api/items')).status, 200)
    assert.equal((await app.get('/comfyui-workbench/api/workflows')).status, 200)
    assert.equal(app.tools.length, 4)
  } finally {
    await app.close()
  }
})

test('关掉相册：/items 404，工作流仍可用', async () => {
  const d = dirs()
  const app = await boot({ ...baseConfig(d), disabledComponents: ['panel.gallery'] })
  try {
    assert.equal((await app.get('/comfyui-workbench/api/items')).status, 404, '相册路由应消失')
    assert.equal((await app.get('/comfyui-workbench/api/workflows')).status, 200, '工作流不该被牵连')
    const config = await app.get('/comfyui-workbench/api/config')
    assert.equal(config.body.config.components['panel.gallery'], false)
    assert.equal(config.body.config.components['panel.workflow'], true)
  } finally {
    await app.close()
  }
})

test('关掉工作流面板：/workflows 与 /run 404，相册仍可用', async () => {
  const d = dirs()
  const app = await boot({ ...baseConfig(d), disabledComponents: ['panel.workflow'] })
  try {
    assert.equal((await app.get('/comfyui-workbench/api/workflows')).status, 404)
    // 关掉工作流面板后 /run 整条路由消失（404），而不是"存在但方法不对"（405）
    assert.equal((await app.get('/comfyui-workbench/api/run')).status, 404)
    assert.equal((await app.get('/comfyui-workbench/api/items')).status, 200)
  } finally {
    await app.close()
  }
})

test('关掉工作流编辑：那个工具不注册，生图工具照常', async () => {
  const d = dirs()
  const app = await boot({ ...baseConfig(d), disabledComponents: ['tool.workflow-edit'] })
  try {
    assert.ok(app.tools.includes('comfyui_run'), '生图工具应在线')
    assert.ok(!app.tools.includes('comfyui_workflow_edit'), '编辑工具应被关掉')
  } finally {
    await app.close()
  }
})

test('某个工具构建抛错，其余工具照常注册', () => {
  const registered = []
  const warnings = []
  const report = registerTools(
    [
      { name: 'good-a', component: 'tool.generate', title: '', build: () => ({ name: 'a', description: '', parameters: {}, output: { type: 'text' }, execute: async () => ({}) }) },
      { name: 'bad', component: 'tool.generate', title: '', build: () => { throw new Error('schema 构造失败') } },
      { name: 'good-b', component: 'tool.generate', title: '', build: () => ({ name: 'b', description: '', parameters: {}, output: { type: 'text' }, execute: async () => ({}) }) },
    ],
    {},
    { register: spec => registered.push(spec.name), warn: message => warnings.push(message) },
  )

  assert.deepEqual(registered, ['a', 'b'], '坏的那个不该拖累其他')
  assert.equal(report.failed.length, 1)
  assert.match(report.failed[0].message, /schema/)
  assert.match(warnings[0], /其余工具不受影响/)
})
