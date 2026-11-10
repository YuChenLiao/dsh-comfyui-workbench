/**
 * `comfyui_workflow { audit: true }`：升级后"哪套模板已经跑不起来了"。
 *
 * 这是新手而非文本工具，所以用例都走真实目录 + 假 objectInfo，
 * 三档结论（必然跑不起来 / 可能跑偏 / 健康）各自钉一条。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { auditWorkflows } from '../lib/index.js'

/** 节点全在的模板（模型也在）。 */
const HEALTHY = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'good.safetensors' } },
  3: { class_type: 'KSampler', inputs: { seed: 1, model: ['1', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
}

/** 用了一个本机没有的节点 → 必然跑不起来。 */
const DEAD_NODE = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'good.safetensors' } },
  3: { class_type: 'TotallyMissingNode', inputs: {} },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
}

/** 节点都在，但底模本机没有 → 能提交，会跑偏或报错。 */
const DEGRADED_MODEL = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'absent.safetensors' } },
  3: { class_type: 'KSampler', inputs: { seed: 1, model: ['1', 0], latent_image: ['5', 0] } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
}

/** 节点没了、模型也没了 → 该进 dead（先修节点才有意义），不该同时进 degraded。 */
const BOTH_MISSING = {
  1: { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'absent.safetensors' } },
  3: { class_type: 'TotallyMissingNode', inputs: {} },
  7: { class_type: 'SaveImage', inputs: { images: ['3', 0] } },
}
/** objectInfo 的假实现：只认这些节点，模型里只有一个 good.safetensors。 */
function fakeInfo() {
  const node = (ckptList) => ({ input: ckptList === undefined ? {} : { required: { ckpt_name: [ckptList] } } })
  return {
    CheckpointLoaderSimple: node(['good.safetensors']),
    KSampler: node(),
    EmptyLatentImage: node(),
    SaveImage: node(),
  }
}

function makeDeps(objectInfo) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-'))
  fs.writeFileSync(path.join(dir, 'healthy.json'), JSON.stringify(HEALTHY))
  fs.writeFileSync(path.join(dir, 'dead-node.json'), JSON.stringify(DEAD_NODE))
  fs.writeFileSync(path.join(dir, 'degraded-model.json'), JSON.stringify(DEGRADED_MODEL))
  fs.writeFileSync(path.join(dir, 'both-missing.json'), JSON.stringify(BOTH_MISSING))
  return {
    deps: { client: { baseUrl: 'http://x', objectInfo }, workflowsDir: dir },
    dir,
  }
}

test('体检：分三档 —— 健康 / 缺节点（必然跑不起来）/ 缺模型（会跑偏）', async () => {
  const { deps, dir } = makeDeps(async () => fakeInfo())
  const result = await auditWorkflows(deps)

  assert.equal(result.ok, true)
  assert.equal(result.mode, 'audit')
  assert.equal(result.total, 4)
  assert.equal(result.healthy, 1, '只有节点与模型都齐的那套算健康')

  const dead = result.dead.map(row => row.workflowId)
  assert.deepEqual(dead, ['both-missing', 'dead-node'], '缺节点的必然跑不起来；节点和模型都缺的只进 dead')
  assert.deepEqual(result.dead[0].missingNodes, ['TotallyMissingNode'])

  const degraded = result.degraded.map(row => row.workflowId)
  assert.deepEqual(degraded, ['degraded-model'], '节点齐但缺模型的那套只是会跑偏')
  assert.deepEqual(result.degraded[0].missingModels, ['absent.safetensors'])
  assert.match(result.degraded[0].modelHint, /good\.safetensors/, '要给出能用的替代模型')

  assert.match(result.verdict, /1 套能用/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：拿不到节点清单时明说"无法体检"，绝不假装全部健康', async () => {
  const { deps, dir } = makeDeps(async () => { throw new Error('connect ECONNREFUSED') })
  const result = await auditWorkflows(deps)

  assert.equal(result.ok, false)
  assert.match(result.error, /无法体检/)
  assert.match(result.error, /ECONNREFUSED/)
  assert.equal(result.healthy, undefined, '不能给出健康数 —— 那会让人以为查过了')
  assert.match(result.hint, /自动拉起/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：节点清单是空的也要明说，不当成"全都没有"', async () => {
  const { deps, dir } = makeDeps(async () => ({}))
  const result = await auditWorkflows(deps)

  assert.equal(result.ok, false)
  assert.match(result.error, /空的/)
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：全部健康时 verdict 与提示都不制造焦虑', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-ok-'))
  fs.writeFileSync(path.join(dir, 'healthy.json'), JSON.stringify(HEALTHY))
  const result = await auditWorkflows({ client: { baseUrl: 'http://x', objectInfo: async () => fakeInfo() }, workflowsDir: dir })

  assert.equal(result.ok, true)
  assert.deepEqual(result.dead, [])
  assert.deepEqual(result.degraded, [])
  assert.match(result.verdict, /全部可用/)
  assert.equal(result.hint, '', '没问题时不该给建议')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：同时缺节点又缺模型时只进 dead（先修节点才有意义）', async () => {
  const { deps, dir } = makeDeps(async () => fakeInfo())
  const result = await auditWorkflows(deps)
  const both = result.dead.find(row => row.workflowId === 'both-missing')
  assert.ok(both !== undefined, '该进 dead')
  assert.equal(result.degraded.some(row => row.workflowId === 'both-missing'), false, '不该在 degraded 里再出现一次')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：空目录不说"全部可用"—— 那等于告诉模型可以开跑了', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-empty-'))
  const result = await auditWorkflows({ client: { baseUrl: 'http://x', objectInfo: async () => fakeInfo() }, workflowsDir: dir })
  assert.equal(result.ok, false)
  assert.match(result.error, /没有可用的模板/)
  assert.equal(result.verdict, undefined, '不能给出"全部可用"的结论')
  fs.rmSync(dir, { recursive: true, force: true })
})

test('体检：停用的模板不算健康（comfyui_run 会直接拒它）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'audit-disabled-'))
  fs.writeFileSync(path.join(dir, 'on.json'), JSON.stringify(HEALTHY))
  fs.writeFileSync(path.join(dir, 'off.json'), JSON.stringify(HEALTHY))
  fs.writeFileSync(path.join(dir, 'off.meta.json'), JSON.stringify({ enabled: false }))
  const result = await auditWorkflows({ client: { baseUrl: 'http://x', objectInfo: async () => fakeInfo() }, workflowsDir: dir })
  assert.equal(result.ok, true)
  assert.equal(result.healthy, 1, '只有启用的那套算能用')
  assert.equal(result.disabledCount, 1)
  assert.match(result.disabledHint, /未计入/)
  fs.rmSync(dir, { recursive: true, force: true })
})
