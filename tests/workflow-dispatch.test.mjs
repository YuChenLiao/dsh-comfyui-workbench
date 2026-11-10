/**
 * `comfyui_workflow` 的**分派层**：四档靠参数决定，参数给错必须报错而不是静默降档。
 *
 * 这组用例的存在理由（审查提的）：底层三个函数各自有测试，但没人测 `workflowTool` 本身 ——
 * 把 `audit` 分支整个删掉，全量测试照样全绿。而"模型给了 audit 却拿到列表"这种错，
 * 恰恰是最难从对话里看出来的。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { workflowTool } from '../lib/index.js'

const WF = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'good.safetensors' } },
  3: { class_type: 'KSampler', inputs: { seed: 1, model: ['1', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
}

function makeDeps() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfdisp-'))
  fs.writeFileSync(path.join(dir, 'one.json'), JSON.stringify(WF))
  const client = {
    baseUrl: 'http://x',
    async objectInfo() {
      return {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['good.safetensors']] } } },
        KSampler: { input: {} },
        EmptyLatentImage: { input: {} },
        SaveImage: { input: {} },
      }
    },
  }
  return { deps: { client, workflowsDir: dir }, dir }
}

test('分派：什么都不给 → 列表', async () => {
  const { deps, dir } = makeDeps()
  const result = await workflowTool(deps).execute({})
  assert.equal(result.mode, 'list')
  assert.equal(result.count, 1)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：给 workflowId → 详情（带 IO 面与节点清单）', async () => {
  const { deps, dir } = makeDeps()
  const result = await workflowTool(deps).execute({ workflowId: 'one' })
  assert.equal(result.mode, 'inspect')
  assert.equal(result.workflowId, 'one')
  assert.ok(Array.isArray(result.nodes))
  assert.ok(Array.isArray(result.inputs))
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：workflowId + nodeId → 单节点', async () => {
  const { deps, dir } = makeDeps()
  const result = await workflowTool(deps).execute({ workflowId: 'one', nodeId: '3' })
  assert.equal(result.mode, 'node')
  assert.equal(result.nodeId, '3')
  assert.equal(result.classType, 'KSampler')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：audit 走体检（布尔、字符串、数字三种真值都认）', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowTool(deps)
  for (const value of [true, 'true', 1, '1']) {
    const result = await tool.execute({ audit: value })
    assert.equal(result.mode, 'audit', `audit=${JSON.stringify(value)} 应走体检`)
    assert.equal(result.ok, true)
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：audit 与 workflowId 同时给时以体检为准', async () => {
  const { deps, dir } = makeDeps()
  const result = await workflowTool(deps).execute({ audit: true, workflowId: 'one' })
  assert.equal(result.mode, 'audit')
  assert.equal(result.total, 1, '体检扫的是全库，不是那一个')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：只给 nodeId 必须报错，不能静默回列表', async () => {
  const { deps, dir } = makeDeps()
  const result = await workflowTool(deps).execute({ nodeId: '3' })
  assert.equal(result.ok, false, '这个组合走不通，不能假装成功')
  assert.equal(result.mode, 'node')
  assert.match(result.message, /workflowId/)
  assert.equal(result.workflows, undefined, '不该回退成列表')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('分派：失败路径也要带 mode，不能让人不知道是哪一档失败的', async () => {
  const { deps, dir } = makeDeps()
  const tool = workflowTool(deps)

  const noSuchWorkflow = await tool.execute({ workflowId: 'nope' })
  assert.equal(noSuchWorkflow.ok, false)
  assert.equal(noSuchWorkflow.mode, 'inspect')

  const noSuchNode = await tool.execute({ workflowId: 'one', nodeId: '99' })
  assert.equal(noSuchNode.ok, false)
  assert.equal(noSuchNode.mode, 'node')
  assert.ok(Array.isArray(noSuchNode.nodes), '要给节点清单，让模型知道有哪些')

  fs.rmSync(dir, { recursive: true, force: true })
})
