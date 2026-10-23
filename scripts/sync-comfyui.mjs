#!/usr/bin/env node
/**
 * 同步 ComfyUI 现有的工作流。
 *
 *   node scripts/sync-comfyui.mjs [--url http://127.0.0.1:8188] [--dry] [--only 关键词]
 *
 * ComfyUI 界面保存的是 UI 格式（nodes + links + widgets_values），不能直接提交；
 * 这里按 `/object_info` 的节点定义把它们转成 API 格式再入库。
 *
 * 需要 ComfyUI 在线拿节点定义 —— widget 顺序只能从节点定义里读，猜不出来。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { detectFormat, convertUiToApi, listEntries, sanitizeId, writeWorkflow } from '../lib/workflow.js'
import { detectInstallation } from '../lib/comfy.js'

const urlArg = process.argv.indexOf('--url')
const baseUrl = (urlArg > 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:8188').replace(/\/+$/, '')
const dry = process.argv.includes('--dry')
const onlyArg = process.argv.indexOf('--only')
const only = onlyArg > 0 ? (process.argv[onlyArg + 1] ?? '').toLowerCase() : ''

const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const outDir = path.join(home, '.dsh-comfyui-workbench', 'workflows')

/** ComfyUI 里存工作流的地方。 */
function workflowsDirs(install) {
  const dirs = []
  if (install !== undefined) {
    dirs.push(path.join(install, 'user', 'default', 'workflows'))
    // 部分版本把 user 目录放在安装根外面
    dirs.push(path.join(path.dirname(install), 'user', 'default', 'workflows'))
  }
  dirs.push(path.join(home, '.dsh-comfyui-workbench', 'comfyui-workflows'))
  return dirs
}

const install = detectInstallation()
console.log(`ComfyUI 安装：${install ?? '（未探测到）'}`)

const candidates = workflowsDirs(install).filter(dir => fs.existsSync(dir))
if (candidates.length === 0) {
  console.error('没找到 ComfyUI 的工作流目录。可以用 --dir 指定；或先在 ComfyUI 里保存一个工作流。')
  process.exit(1)
}
for (const dir of candidates) console.log(`工作流目录：${dir}`)

let objectInfo
try {
  const res = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  objectInfo = await res.json()
  console.log(`已取到 /object_info：${Object.keys(objectInfo).length} 个节点定义`)
} catch (error) {
  console.error(`拿不到 /object_info（${baseUrl}）：${error instanceof Error ? error.message : String(error)}`)
  console.error('转换需要节点定义来确定 widget 顺序；先把 ComfyUI 起来再跑。')
  process.exit(1)
}

const existing = new Set(listEntries(outDir).entries.map(entry => entry.id))
const files = []
for (const dir of candidates) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.json')) continue
    if (only !== '' && !name.toLowerCase().includes(only)) continue
    files.push(path.join(dir, name))
  }
}

let imported = 0
let copied = 0
let skipped = 0
const failed = []

for (const file of files) {
  const base = path.basename(file)
  let raw
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    failed.push(`${base}: 读不了（${error instanceof Error ? error.message : String(error)}）`)
    skipped += 1
    continue
  }

  const format = detectFormat(raw)
  let workflow
  let notes = []

  if (format === 'api') {
    workflow = raw
    copied += 1
  } else if (format === 'ui') {
    const converted = convertUiToApi(raw, objectInfo)
    workflow = converted.workflow
    notes = converted.notes
    if (Object.keys(workflow).length === 0) {
      failed.push(`${base}: 转换后没有可提交的节点`)
      skipped += 1
      continue
    }
  } else {
    failed.push(`${base}: 既不是 UI 格式也不是 API 格式`)
    skipped += 1
    continue
  }

  const id = sanitizeId(base)
  if (dry) {
    console.log(`[dry] ${base} → ${id}（${Object.keys(workflow).length} 节点）`)
    continue
  }
  writeWorkflow(outDir, id, workflow)
  imported += 1
  const dup = existing.has(id) ? '（覆盖同名）' : ''
  console.log(`✓ ${base} → ${id}${dup}${notes.length > 0 ? `　注：${notes.join('；')}` : ''}`)
}

console.log(`\n共 ${files.length} 个文件：导入 ${imported}，其中 API 格式原样 ${copied}，跳过 ${skipped}。`)
if (failed.length > 0) {
  console.log(`\n未导入（${failed.length}）：`)
  for (const line of failed.slice(0, 15)) console.log(`  - ${line}`)
  if (failed.length > 15) console.log(`  …还有 ${failed.length - 15} 条`)
}
console.log(`\n工作流目录：${outDir}`)
