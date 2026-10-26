/**
 * 架构自检：组件边界与分层方向。
 *
 * 重构后 src 按"面向谁 + 对象"划分：
 *   src/components/panel-gallery/        用户面板 · 相册（server + client）
 *   src/components/panel-workflow/       用户面板 · 工作流
 *   src/components/tool-generate/        模型工具 · 生图
 *   src/components/tool-workflow-edit/   模型工具 · 工作流编辑
 *   src/shared/                          公用逻辑（host / comfy / workflow / run / tools / http）
 *   src/client/                          UI 外壳（页签、api、i18n、图标）
 *
 * 只钉三条真正会退化的约束，而不是维护一张精密的层级表：
 *   1. shared 内部单向：host 最底层，上层不得反向依赖
 *   2. 组件的 server 侧不得依赖任何 client（后端不该认识界面）
 *   3. client 公共模块不得依赖具体组件（外壳不能被某个组件绑死）
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

/** shared 内部允许依赖的下层。 */
const SHARED_ALLOWED = {
  'shared/host': [],
  // 工具规格里要写 client / logger 的类型，所以允许向下依赖这两层
  'shared/tools': ['shared/host', 'shared/comfy', 'shared/workflow'],
  'shared/http': [],
  // 授权根要读 workspace 与配置，所以依赖 host
  'shared/authz': ['shared/host'],
  'shared/workflow': ['shared/host'],
  'shared/comfy': ['shared/host', 'shared/workflow'],
  'shared/media': [],
  'shared/run': ['shared/host', 'shared/comfy', 'shared/workflow', 'shared/media'],
}

/** 外壳里允许组装组件的文件（其余必须与组件无关）。 */
const SHELL_ASSEMBLY = new Set(['src/client/index.tsx', 'src/client/components/Workbench.tsx'])

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sources(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 剥掉注释：注释里写 import('sharp') 不该被当成真实依赖。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function importsOf(source) {
  const targets = []
  const patterns = [
    /\bimport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bexport\s+[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) targets.push(match[1])
  }
  return targets
}

/** 源码路径 → 所属单元（两级粒度）。 */
function unitOf(rel) {
  const parts = rel.split('/')
  if (parts[0] !== 'src') return null
  if (parts[1] === 'shared') return `shared/${parts[2] ?? ''}`
  if (parts[1] === 'components') {
    return parts[3] === 'server' || parts[3] === 'client' ? `components/${parts[2]}/${parts[3]}` : `components/${parts[2]}`
  }
  if (parts[1] === 'client') return 'client'
  if (parts[1] === 'http') return 'http'
  return 'root'
}

const violations = []
const files = sources(path.join(root, 'src'))

for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/')
  const from = unitOf(rel)
  if (from === null) continue
  const source = stripComments(fs.readFileSync(file, 'utf8'))

  for (const target of importsOf(source)) {
    if (target.startsWith('node:') || target === 'react' || target === 'react-dom' || target === 'react/jsx-runtime') continue
    if (!target.startsWith('.')) {
      violations.push(`${rel} 引入了外部包：${target}（运行时必须零依赖）`)
      continue
    }

    const resolved = path.resolve(path.dirname(file), target)
    const to = unitOf(path.relative(root, resolved).split(path.sep).join('/'))
    if (to === null || to === from) continue

    // 1. shared 内部单向
    if (from.startsWith('shared/') && to.startsWith('shared/')) {
      const allowed = SHARED_ALLOWED[from] ?? []
      if (!allowed.includes(to)) violations.push(`${rel}：${from} 不允许依赖 ${to}`)
      continue
    }

    // 2. server 不得依赖 client
    if (from.includes('/server') && (to.includes('/client') || to === 'client')) {
      violations.push(`${rel}：后端（${from}）不允许依赖界面（${to}）`)
      continue
    }

    // 3. 外壳公共模块不得依赖具体组件
    if (from === 'client' && to.startsWith('components/') && !SHELL_ASSEMBLY.has(rel)) {
      violations.push(`${rel}：外壳模块不该依赖 ${to}（只有装配层可以）`)
    }
  }
}

assert.deepEqual(violations, [], `组件边界被打破：\n  ${violations.join('\n  ')}`)

// ── patch 文件与 Settings 字段一致 ──
// 加了配置项却忘了写进 cordis.patch.yml，用户就不知道有这个开关。
const configPath = path.join(root, 'src', 'shared', 'host', 'config.ts')
const configLines = fs.readFileSync(configPath, 'utf8').split(String.fromCharCode(10))
const settingsStart = configLines.findIndex(line => line.includes('export interface Settings'))
assert.ok(settingsStart >= 0, '找不到 Settings 接口')

const fields = []
for (const line of configLines.slice(settingsStart + 1)) {
  if (line.startsWith('}')) break
  const match = /^\s{2}([a-zA-Z][a-zA-Z0-9]*)\??:/.exec(line)
  if (match !== null) fields.push(match[1])
}

const patch = fs.readFileSync(path.join(root, 'cordis.patch.yml'), 'utf8')
const missing = fields.filter(field => !new RegExp(`^\\s*${field}:`, 'm').test(patch))
assert.deepEqual(missing, [], `这些配置项没写进 cordis.patch.yml：${missing.join(', ')}`)

const units = new Set(files.map(file => unitOf(path.relative(root, file).split(path.sep).join('/'))))
// 组件 entry 的 inject 必须有守护：漏了 workspaceRegistry 会让探测静默失效（踩过一次）。
// 只有创建共享 runtime 的 entry 需要注入 workspaceRegistry（产物目录探测要用）。
// danbooru 不碰 runtime，单独校验它的注入。
const entryFiles = ['gallery', 'workflow', 'generate', 'edit', 'terminal']
for (const entry of entryFiles) {
  const mod = await import(pathToFileURL(path.join(root, 'lib', 'entries', `${entry}.js`)).href)
  assert.ok(Array.isArray(mod.inject) && mod.inject.includes('workspaceRegistry'), `entries/${entry}.js 的 inject 必须含 workspaceRegistry，实际：${JSON.stringify(mod.inject)}`)
}
const danbooruMod = await import(pathToFileURL(path.join(root, 'lib', 'entries', 'danbooru.js')).href)
assert.ok(Array.isArray(danbooruMod.inject) && danbooruMod.inject.includes('tools'), 'entries/danbooru.js 应当只依赖 tools')
assert.ok(!danbooruMod.inject.includes('workspaceRegistry'), 'danbooru 不建 runtime，不该被要求注入 workspaceRegistry')

// 终端面板要建共享运行时（缓冲挂在 runtime 上），注入要求与其它面板一致。
const terminalMod = await import(pathToFileURL(path.join(root, 'lib', 'entries', 'terminal.js')).href)
assert.ok(Array.isArray(terminalMod.inject) && terminalMod.inject.includes('webServer'), 'entries/terminal.js 应当注入 webServer')

const coreMod = await import(pathToFileURL(path.join(root, 'lib', 'index.js')).href)
assert.ok(coreMod.inject.includes('workspaceRegistry'), '包根 entry 的 inject 必须含 workspaceRegistry')

console.log(`arch: 全部通过（${files.length} 个文件，${units.size} 个单元，组件边界与配置一致，7 条 entry 注入齐备）`)
