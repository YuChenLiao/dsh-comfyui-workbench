#!/usr/bin/env node
/**
 * 跑一个工作流并等它出结果 —— 给"等待子代理"用的命令行入口。
 *
 *   node scripts/run-once.mjs [workflow.json] [--wait 240] [--out <dir>]
 *
 * 与插件的工具走同一台 ComfyUI，但**不依赖插件进程**：直接 POST /prompt 再轮询。
 * 子代理跑完把最后一行（产物路径）返回，主对话就能拿到结果。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const args = process.argv.slice(2)
const file = args.find(arg => !arg.startsWith('--') && !/^\d+$/.test(arg)) ?? path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), '..', 'samples', 'text2img-basic.json')
const waitArg = args.indexOf('--wait')
const waitSec = waitArg >= 0 ? Number(args[waitArg + 1]) : 300
const outArg = args.indexOf('--out')
const outDir = outArg >= 0 ? args[outArg + 1] : path.join(process.env.USERPROFILE ?? process.env.HOME ?? '', '.dsh-comfyui-workbench', 'outputs')

const base = (process.env.COMFYUI_URL ?? 'http://127.0.0.1:8188').replace(/\/+$/, '')

/** 等 ComfyUI 就绪，返回是否成功。 */
async function waitReady(limitSec) {
  const deadline = Date.now() + limitSec * 1000
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(4000) })
      if (res.ok) return true
    } catch {
      // 还没起来
    }
    await new Promise(resolve => setTimeout(resolve, 5000))
  }
  return false
}

if (!fs.existsSync(file)) {
  console.error(`找不到工作流文件：${file}`)
  process.exit(1)
}

console.log(`等待 ComfyUI 就绪：${base}（最多 ${waitSec} 秒）`)
if (!(await waitReady(waitSec))) {
  console.error('ComfyUI 一直没起来。')
  process.exit(2)
}
console.log('就绪。')

const workflow = JSON.parse(fs.readFileSync(file, 'utf8'))
const submit = await fetch(`${base}/prompt`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ prompt: workflow, client_id: `run-once-${Date.now()}` }),
})
if (!submit.ok) {
  console.error(`提交失败：HTTP ${submit.status} ${(await submit.text()).slice(0, 300)}`)
  process.exit(3)
}
const { prompt_id: promptId } = await submit.json()
console.log(`已提交：${promptId}`)

// 轮询直到完成
const deadline = Date.now() + waitSec * 1000
let entry
for (;;) {
  await new Promise(resolve => setTimeout(resolve, 3000))
  const res = await fetch(`${base}/history/${promptId}`, { signal: AbortSignal.timeout(15_000) })
  if (!res.ok) continue
  const body = await res.json()
  const found = body?.[promptId]
  if (found === undefined) {
    if (Date.now() > deadline) {
      console.error(`等了 ${waitSec} 秒还没完成（prompt ${promptId}）。`)
      process.exit(4)
    }
    continue
  }
  entry = found
  break
}

if (entry.status?.status_str === 'error') {
  console.error('执行失败：', JSON.stringify(entry.status).slice(0, 500))
  process.exit(5)
}

// 下载产物
fs.mkdirSync(outDir, { recursive: true })
const saved = []
for (const bag of Object.values(entry.outputs ?? {})) {
  for (const value of Object.values(bag ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) {
      if (item === null || typeof item !== 'object' || typeof item.filename !== 'string') continue
      const params = new URLSearchParams({ filename: item.filename, subfolder: item.subfolder ?? '', type: item.type ?? 'output' })
      const res = await fetch(`${base}/view?${params}`, { signal: AbortSignal.timeout(120_000) })
      if (!res.ok) continue
      const bytes = Buffer.from(await res.arrayBuffer())
      const target = path.join(outDir, path.basename(item.filename))
      fs.writeFileSync(target, bytes)
      saved.push({ path: target, bytes: bytes.length })
    }
  }
}

if (saved.length === 0) {
  console.error('执行完成但没拿到产物。')
  process.exit(6)
}

for (const item of saved) console.log(`ARTIFACT ${item.path} (${Math.round(item.bytes / 1024)} KB)`)
console.log('DONE')
