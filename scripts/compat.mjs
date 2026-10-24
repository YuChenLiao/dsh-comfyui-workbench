#!/usr/bin/env node
/**
 * 工作流兼容性扫描：不跑图，只判断"这份工作流在这台机器上能不能跑"。
 *
 *   node scripts/compat.mjs [--comfy http://127.0.0.1:8188] [--json]
 *
 * 判据三样：缺节点（class_type 不在 /object_info）、缺模型（权重名不在候选）、
 * 缺必填输入（需要用户提供图之类）。判完再决定要不要真跑某几个。
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
const COMFY = argOf('--comfy', 'http://127.0.0.1:8188').replace(/\/+$/, '')
const asJson = argv.includes('--json')
const dir = path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh-comfyui-workbench', 'workflows')

const info = await (await fetch(`${COMFY}/object_info`, { signal: AbortSignal.timeout(30_000) })).json()
const known = new Set(Object.keys(info))
const available = availableModels(info)
const { entries, broken } = listEntries(dir)

const rows = []
for (const entry of entries) {
  const surface = entry.surface
  const classTypes = [...new Set(Object.values(entry.workflow).map(node => String(node.class_type ?? '')).filter(Boolean))]
  const absentNodes = classTypes.filter(name => !known.has(name))
  const absentModels = missingModels(surface.models, available)
  const imageInputs = surface.inputs.filter(slot => slot.type === 'image' || slot.type === 'mask')
  const requiredInputs = surface.inputs.filter(slot => slot.required)

  // 判定：缺节点最致命；缺模型次之（换一个就行）；其余视为可跑。
  const verdict = absentNodes.length > 0
    ? 'blocked'
    : absentModels.length > 0
      ? 'needs-model'
      : imageInputs.length > 0
        ? 'needs-image'
        : 'ready'

  rows.push({
    id: entry.id,
    nodes: surface.meta.nodeCount,
    inputs: surface.inputs.length,
    absentNodes,
    absentModels,
    imageSlots: imageInputs.map(slot => slot.name),
    required: requiredInputs.map(slot => slot.name),
    primaryModel: (surface.models.find(model => model.primary === true) ?? surface.models[0])?.name ?? '',
    verdict,
  })
}

const order = { ready: 0, 'needs-image': 1, 'needs-model': 2, blocked: 3 }
rows.sort((a, b) => (order[a.verdict] - order[b.verdict]) || a.id.localeCompare(b.id))

if (asJson) {
  console.log(JSON.stringify({ rows, broken }, null, 2))
} else {
  const icon = { ready: '✓', 'needs-image': '◇', 'needs-model': '△', blocked: '✗' }
  for (const row of rows) {
    const extra = [
      row.absentNodes.length > 0 ? `缺节点 ${row.absentNodes.length}：${row.absentNodes.slice(0, 3).join(',')}` : '',
      row.absentModels.length > 0 ? `缺模型：${row.absentModels.slice(0, 2).join(',')}` : '',
      row.imageSlots.length > 0 ? `需图：${row.imageSlots.join(',')}` : '',
    ].filter(Boolean).join(' · ')
    console.log(`${icon[row.verdict]} ${row.id.padEnd(46)} ${String(row.nodes).padStart(4)} 节点  ${extra}`)
  }

  const count = verdict => rows.filter(row => row.verdict === verdict).length
  console.log(`\n共 ${rows.length}：可直接跑 ${count('ready')}，需要选图 ${count('needs-image')}，缺模型 ${count('needs-model')}，缺节点 ${count('blocked')}`)
  if (broken.length > 0) console.log(`另有 ${broken.length} 个文件读不出来：${broken.join(', ')}`)
  console.log(`可用模型 ${available.size} 个（含 lora/vae/upscale）`)
}
