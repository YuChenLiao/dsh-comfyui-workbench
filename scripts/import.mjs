#!/usr/bin/env node
/**
 * 导入一份 API 格式工作流。
 *
 *   node scripts/import.mjs <workflow.json> [更多文件…]
 *   node scripts/import.mjs --list
 *
 * 为什么是脚本而不是 `dsh workbench import`：dsh 是否支持插件注册 CLI 子命令尚未确认
 * （见设计方案 §7）。脚本走的是同一套 lib/workflow.js，宿主支持命令后只需加一层转发。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { importWorkflowFile, listEntries } from '../lib/workflow.js'

/** 与 host/paths.ts 保持一致：工作流固定放数据目录下。 */
function workflowsDir() {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
  return path.join(home, '.dsh-comfyui-workbench', 'workflows')
}

/** 把 IO 面压成几行，便于确认"导入进来的东西对不对"。 */
function summarize(surface) {
  const lines = []
  lines.push(`  标题：${surface.title}`)
  lines.push(`  说明：${surface.description === '' ? '（空 —— 模型无法判断它该不该被用，建议补一条）' : surface.description}`)
  const model = surface.models.find(entry => entry.primary === true) ?? surface.models[0]
  lines.push(`  模型：${model === undefined ? '（未识别）' : `${model.name}（${model.kind}）`}`)
  const basic = surface.inputs.filter(slot => slot.group === 'basic')
  const advanced = surface.inputs.filter(slot => slot.group === 'advanced')
  lines.push(`  输入：${basic.length} 个基础（${basic.map(slot => slot.name).join(', ') || '无'}），${advanced.length} 个高级`)
  lines.push(`  输出：${surface.outputs.map(slot => `${slot.kind}×${slot.count}`).join(', ') || '（未识别）'}`)
  lines.push(`  节点：${surface.meta.nodeCount} 个，hash ${surface.workflowHash.slice(0, 8)}`)
  if (surface.meta.source === 'inferred') lines.push('  提示：这是自动推断的结果；要改名字/分组/枚举，编辑对应的 <id>.schema.json。')
  return lines.join('\n')
}

const args = process.argv.slice(2)
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('用法：node scripts/import.mjs <workflow.json> […] | --list')
  process.exit(args.length === 0 ? 1 : 0)
}

const dir = workflowsDir()

if (args[0] === '--list') {
  const { entries, broken } = listEntries(dir)
  if (entries.length === 0 && broken.length === 0) {
    console.log(`工作流目录是空的：${dir}`)
    process.exit(0)
  }
  for (const entry of entries) {
    const model = entry.surface.models.find(item => item.primary === true) ?? entry.surface.models[0]
    console.log(`${entry.id}\n  ${entry.surface.title}${model === undefined ? '' : ` · ${model.name}`}\n  ${entry.surface.description || '（无说明）'}`)
  }
  if (broken.length > 0) console.log(`\n跳过 ${broken.length} 个不可用文件：${broken.join(', ')}`)
  process.exit(0)
}

let failed = 0
for (const input of args) {
  const absolute = path.resolve(input)
  if (!fs.existsSync(absolute)) {
    console.error(`找不到文件：${absolute}`)
    failed += 1
    continue
  }
  try {
    const { id, surface } = importWorkflowFile(dir, absolute)
    console.log(`已导入 ${path.basename(absolute)} → ${id}\n${summarize(surface)}\n`)
  } catch (error) {
    console.error(`导入失败：${path.basename(absolute)}\n  ${error instanceof Error ? error.message : String(error)}`)
    failed += 1
  }
}

process.exit(failed === 0 ? 0 : 1)
