#!/usr/bin/env node
/**
 * 逐个真跑工作流，验证插件与这些工作流的兼容性。
 *
 *   node scripts/smoke-workflows.mjs [--gui URL] [--comfy URL] [--only 关键词] [--limit N]
 *
 * 参数一律压到最小（512 长边、1–2 步），只求"能提交、能出图、能取回产物"，
 * 不评价画质。缺权重的工作流跳过 —— 那是环境问题，不是插件问题。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { availableModels, missingModels } from '../lib/comfy.js'
import { listEntries } from '../lib/workflow.js'

const argv = process.argv.slice(2)
const argOf = (name, fallback) => {
  const index = argv.indexOf(name)
  return index >= 0 ? argv[index + 1] : fallback
}
const GUI = argOf('--gui', 'http://127.0.0.1:8994').replace(/\/+$/, '')
const COMFY = argOf('--comfy', 'http://127.0.0.1:8188').replace(/\/+$/, '')
const only = argOf('--only', '').toLowerCase()
const limit = Number(argOf('--limit', '0'))
const API = `${GUI}/comfyui-workbench/api`
const dataDir = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh-comfyui-workbench')

/** 参考图：任意一张已上传的 jpg。 */
function referenceImage() {
  const dir = path.join(dataDir, 'uploads')
  const name = fs.readdirSync(dir).find(entry => entry.endsWith('.jpg'))
  return name === undefined ? undefined : path.join(dir, name)
}

async function json(url, init) {
  const res = await fetch(url, init)
  let body = null
  try {
    body = await res.json()
  } catch {
    body = null
  }
  return { status: res.status, body }
}

/** 按槽位类型压参数：能缩的全缩到最小。 */
function varsFor(inputs, refImage) {
  const vars = {}
  for (const slot of inputs) {
    if (slot.type === 'image' || slot.type === 'mask') {
      if (refImage !== undefined) vars[slot.name] = refImage
      continue
    }
    const name = slot.name.toLowerCase()
    if (name === 'width' || name === 'height') {
      vars[slot.name] = 512
      continue
    }
    if (name === 'steps' || name === 'smz_steps') {
      vars[slot.name] = 1
      continue
    }
    if (name === 'megapixels') {
      vars[slot.name] = 0.25
      continue
    }
    if (name === 'batch_size') {
      vars[slot.name] = 1
      continue
    }
    if (slot.required && slot.default === undefined) {
      vars[slot.name] = slot.type === 'number' ? 1 : ''
      continue
    }
    if (slot.default !== undefined) vars[slot.name] = slot.default
  }
  return vars
}

const ref = referenceImage()
const list = await json(`${API}/workflows`)
const httpItems = list.body?.workflows ?? []

// 兼容性判断自己做，不依赖 HTTP 响应里的 missingModels —— 那个字段要重启后才有，
// 拿 undefined 当"没有缺失"会把缺权重的工作流全放进来（首轮 0/5 就是这么来的）。
const info = await (await fetch(`${COMFY}/object_info`, { signal: AbortSignal.timeout(30_000) })).json()
const known = new Set(Object.keys(info))
const models = availableModels(info)
const wfDir = path.join(dataDir, 'workflows')
const local = new Map(listEntries(wfDir).entries.map(entry => [entry.id, entry]))

const skipped = []
const workflows = httpItems.filter(item => {
  if (only !== '' && !item.workflowId.toLowerCase().includes(only)) return false
  const entry = local.get(item.workflowId)
  if (entry === undefined) { skipped.push(`${item.workflowId}（读不出）`); return false }
  const absentNodes = [...new Set(Object.values(entry.workflow).map(node => String(node.class_type ?? '')).filter(name => name !== '' && !known.has(name)))]
  const absentModels = missingModels(entry.surface.models, models)
  if (absentNodes.length > 0) { skipped.push(`${item.workflowId}（缺节点 ${absentNodes.slice(0, 2).join(',')}）`); return false }
  if (absentModels.length > 0) { skipped.push(`${item.workflowId}（缺模型 ${absentModels.slice(0, 2).join(',')}）`); return false }
  return true
})

if (skipped.length > 0) {
  console.log(`跳过 ${skipped.length} 个（环境缺依赖，非插件问题）：`)
  for (const line of skipped.slice(0, 8)) console.log(`  - ${line}`)
  console.log('')
}
const targets = limit > 0 ? workflows.slice(0, limit) : workflows

console.log(`参考图：${ref ?? '（没有，img2img 类会失败）'}`)
console.log(`待测：${targets.length} 个工作流\n`)

const results = []
for (const item of targets) {
  const detail = await json(`${API}/workflows/${encodeURIComponent(item.workflowId)}`)
  const inputs = detail.body?.surface?.inputs ?? []
  const vars = varsFor(inputs, ref)
  const startedAt = Date.now()

  const submit = await json(`${API}/run`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ workflowId: item.workflowId, vars }),
  })

  if (submit.body?.ok !== true || typeof submit.body?.promptId !== 'string') {
    results.push({ id: item.workflowId, ok: false, detail: `提交失败：${submit.body?.message ?? submit.status}`, ms: Date.now() - startedAt })
    console.log(`✗ ${item.workflowId}　提交失败：${submit.body?.message ?? submit.status}`)
    continue
  }

  const promptId = submit.body.promptId
  let outcome = null
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, 3000))
    const poll = await json(`${API}/run`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ promptId }),
    })
    if (poll.body?.pending !== true) {
      outcome = poll.body
      break
    }
    if (Date.now() - startedAt > 180_000) {
      outcome = { ok: false, message: '超过 180 秒未完成' }
      break
    }
  }

  const ms = Date.now() - startedAt
  const ok = outcome?.ok === true && Array.isArray(outcome.artifacts) && outcome.artifacts.length > 0
  const detailText = ok
    ? `${outcome.artifacts.length} 个产物 · ${Math.round(ms / 1000)} 秒`
    : `${outcome?.code ?? outcome?.error ?? 'failed'}：${String(outcome?.message ?? '').slice(0, 110)}`
  results.push({ id: item.workflowId, ok, detail: detailText, ms })
  console.log(`${ok ? '✓' : '✗'} ${item.workflowId}　${detailText}`)
}

const passed = results.filter(item => item.ok).length
console.log(`\n${passed}/${results.length} 跑通`)
if (passed < results.length) {
  console.log('\n未通过：')
  for (const item of results.filter(entry => !entry.ok)) console.log(`  - ${item.id}：${item.detail}`)
}
