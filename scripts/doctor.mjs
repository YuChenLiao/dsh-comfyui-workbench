#!/usr/bin/env node
/**
 * 安装后自查。
 *
 *   node scripts/doctor.mjs [--url http://127.0.0.1:9141]
 *
 * 逐项检查：产物是否构建、profile 是否登记、插件 API 是否响应、ComfyUI 是否可达、
 * 数据目录里有什么。每项都给"下一步该做什么"，而不是只报一个红叉。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const profileDir = path.join(home, '.dsh', 'profiles', 'desktop')
const dataDir = path.join(home, '.dsh-comfyui-workbench')

const urlArg = process.argv.indexOf('--url')
const guiUrl = urlArg > 0 ? process.argv[urlArg + 1] : 'http://127.0.0.1:9141'

const checks = []
function check(label, ok, detail, next) {
  checks.push({ label, ok, detail, next })
}

// 1. 产物
const hostBundle = path.join(root, 'lib', 'index.js')
const clientBundle = path.join(root, 'lib', 'client.js')
check(
  '构建产物',
  fs.existsSync(hostBundle) && fs.existsSync(clientBundle),
  fs.existsSync(hostBundle) ? `${Math.round(fs.statSync(hostBundle).size / 1024)} KB + ${fs.existsSync(clientBundle) ? Math.round(fs.statSync(clientBundle).size / 1024) + ' KB' : '缺'}` : 'lib/ 不存在',
  '跑 npm run build',
)

// 2. profile 登记
let bundles = []
let dep = ''
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, 'package.json'), 'utf8'))
  bundles = pkg?.dsh?.profile?.bundles ?? []
  dep = pkg?.dependencies?.['dsh-comfyui-workbench'] ?? ''
} catch {
  // 下面统一报
}
check(
  'profile 登记',
  bundles.includes('dsh-comfyui-workbench'),
  dep === '' ? '没有依赖' : `依赖 ${dep}`,
  'dsh plugin --profile desktop add link:' + root.replace(/\\/g, '/'),
)

// 3. 插件 API（GUI 是否已加载插件）
let apiOk = false
let apiDetail = ''
try {
  const res = await fetch(`${guiUrl}/comfyui-workbench/api/roots`, { signal: AbortSignal.timeout(4_000) })
  apiOk = res.ok
  apiDetail = res.ok ? `${guiUrl} 已响应` : `HTTP ${res.status}`
} catch (error) {
  apiDetail = `连不上 ${guiUrl}`
}
check(
  '插件已加载',
  apiOk,
  apiDetail,
  apiOk ? '' : 'GUI 是在插件安装前启动的：退出 DSH 桌面应用再重开',
)

// 4. ComfyUI
let comfyOk = false
let comfyDetail = ''
try {
  const res = await fetch('http://127.0.0.1:8188/system_stats', { signal: AbortSignal.timeout(3_000) })
  comfyOk = res.ok
  comfyDetail = res.ok ? '127.0.0.1:8188 在线' : `HTTP ${res.status}`
} catch {
  comfyDetail = '127.0.0.1:8188 未响应'
}
check('ComfyUI 服务', comfyOk, comfyDetail, comfyOk ? '' : '起 ComfyUI；插件也能自动探测并拉起（autoStart）')

// 5. 数据目录
const workflows = fs.existsSync(path.join(dataDir, 'workflows'))
  ? fs.readdirSync(path.join(dataDir, 'workflows')).filter(name => name.endsWith('.json') && !name.endsWith('.schema.json') && !name.endsWith('.meta.json')).length
  : 0
const indexFile = path.join(dataDir, 'assets.jsonl')
const indexLines = fs.existsSync(indexFile) ? fs.readFileSync(indexFile, 'utf8').split('\n').filter(Boolean).length : 0
check('工作流', true, `${workflows} 个工作流`, workflows === 0 ? 'node scripts/import.mjs samples/text2img-basic.json' : '')
check('资产索引', true, `${indexLines} 行`, '')

for (const item of checks) {
  const mark = item.ok ? '✓' : '✗'
  // 只在没过时给下一步；通过的项不需要额外动作。
  const next = item.ok || item.next === '' ? '' : `　→ ${item.next}`
  console.log(`${mark} ${item.label}　　${item.detail}${next}`)
}

const failed = checks.filter(item => !item.ok)
console.log(failed.length === 0 ? '\n全部就绪。' : `\n${failed.length} 项待处理（见上面的 →）。`)
process.exit(failed.length === 0 ? 0 : 1)
