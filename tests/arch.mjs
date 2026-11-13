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
const entryFiles = ['gallery', 'workflow', 'tags', 'poses', 'costumes', 'generate', 'edit', 'terminal']
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

// ── 页签与组件诊断表必须一一对应 ──
// 这个坑踩过三次（workflow、tags、poses）：新加一个面板组件、忘了在 `componentStateOf`
// 里补一行，于是 `/config` 的 components 里没有这个键，前端 `enabled[x] !== false` 恒真
// → 用户关掉该组件，页签还照样显示、点进去 404。
// 比对 `Workbench.tsx` 的 TABS（页面上的真页签）与 `runtime.ts` 的 componentStateOf
// （配置诊断），两边键集必须一致，否则就是漏了一处。
const workbenchText = fs.readFileSync(path.join(root, 'src', 'client', 'components', 'Workbench.tsx'), 'utf8')
const tabComponents = [...workbenchText.matchAll(/component:\s*'([^']+)'/g)].map(match => match[1])
const runtimeText = fs.readFileSync(path.join(root, 'src', 'runtime.ts'), 'utf8')
const stateStart = runtimeText.indexOf('export function componentStateOf')
assert.ok(stateStart >= 0, '找不到 componentStateOf')
const stateBody = runtimeText.slice(stateStart, runtimeText.indexOf('\n}', stateStart))
const stateKeys = [...stateBody.matchAll(/^\s*'([^']+)':/gm)].map(match => match[1])

assert.deepEqual(
  tabComponents.filter(item => !stateKeys.includes(item)),
  [],
  '这些页签在 Workbench 的 TABS 里，但 componentStateOf 没有对应的键 —— 关掉组件时页签不会消失',
)
assert.deepEqual(
  stateKeys.filter(item => item.startsWith('panel.') && !tabComponents.includes(item)),
  [],
  '这些 panel.* 在 componentStateOf 里，但 TABS 里没有 —— 要么页签被漏了，要么诊断表残留',
)

// ── 图路径白名单：生产与导入脚本必须逐字一致 ──
// 这条闸是服务端代理唯一的路径校验（挡住 SSRF 与任意文件读取）。它天生会被写成多份：
// 生产一份、导入脚本一份（用来校验上游数据）。两份漂了就会一边放行、一边拒绝，
// 而"放行"的那份没人发现。姿势库与服装库各一对。
function regexLiteralOf(file, constName) {
  const text = fs.readFileSync(path.join(root, file), 'utf8')
  const at = text.indexOf(constName)
  if (at < 0) return ''
  const line = text.slice(at, text.indexOf(String.fromCharCode(10), at))
  const open = line.indexOf('/^')
  const close = line.lastIndexOf('/')
  return open < 0 || close <= open ? '' : line.slice(open, close + 1)
}

const WHITELIST_PAIRS = [
  ['姿势库', 'src/components/panel-poses/server/images.ts', 'SAFE_PATH', 'scripts/import-poses.mjs'],
  ['服装库·写实', 'src/entries/costumes.ts', 'COSTUME_PATH', 'scripts/import-costumes.mjs'],
  ['服装库·动画', 'src/entries/costumes.ts', 'COSTUME_ANIME_PATH', 'scripts/import-costumes-anime.mjs'],
]
for (const [label, prodFile, prodName, scriptFile] of WHITELIST_PAIRS) {
  const prod = regexLiteralOf(prodFile, prodName)
  const script = regexLiteralOf(scriptFile, 'SAFE_PATH')
  assert.ok(prod !== '', `${label}：${prodFile} 里找不到 ${prodName}（白名单没了？）`)
  assert.ok(script !== '', `${label}：${scriptFile} 里找不到 SAFE_PATH`)
  assert.equal(
    script,
    prod,
    `${label}的图路径白名单两份不一致：生产 ${prod} / 导入脚本 ${script} —— 必须逐字相同`,
  )
}

// ── 两个画风库都必须真的挂到工具上 ──
// 动画版是可选组件：catalog 缺失时可以不挂。但"挂了"这件事本身没有运行时测试守着 ——
// 忘在 deps 里传 `anime`，整库测试照样全绿，而工具会永远回「这个安装没接动画版衣装库」。
// 这里退一步守接线：apply 里必须建 animeStore 并把它传进 costumeTool 的 deps。
{
  const text = fs.readFileSync(path.join(root, 'src/entries/costumes.ts'), 'utf8')
  assert.match(text, /animeStore\(/, '服装 entry 必须建动画版 store')
  assert.match(text, /anime === undefined \? \{\} : \{ anime \}|\{ \.\.\.\(anime === undefined/, '动画版 store 必须传进工具 deps')
}

// ── 两个画风库的落盘目录必须分开 ──
// `materialize` 按 basename 落盘，而两库 id 同格式（SPR-xxxx）——
// 共用目录时，写实版 SPR-0001 与动画版 SPR-0001 会互相覆盖，
// 工作流里那条旧路径会悄悄换成另一画风的图。双库测试用的是假 images，抓不到这条。
{
  const text = fs.readFileSync(path.join(root, 'src/entries/costumes.ts'), 'utf8')
  assert.match(text, /animeUploads[^\n]*path\.join\(uploadsDir\(\), 'anime'\)/, '动画版必须落到 uploads/anime 子目录')
}

// ── 样式必须写在 `.css` 里，不许写成 TS 字符串常量 ──
// 每个组件几十 KB 的 CSS 塞进 `.ts` 的后果：编辑器没有语法高亮、没有工具能校验、
// 逻辑文件被样式淹掉。构建时按文本导入（`loader: { '.css': 'text' }`），
// 运行时照样 `<style>` 注入 —— 分离的是**源码**，不是运行方式。
const cssInTs = files
  .filter(file => /\.tsx?$/.test(file))
  .filter(file => {
    const text = fs.readFileSync(file, 'utf8')
    // `export const X_CSS = \`...\`` / `const CSS = [ '...', ... ]` 这两种都算
    return /\bconst\s+[A-Za-z_$][\w$]*(?:CSS|Css|css)\s*(?::[^=]+)?=\s*[`'[]/.test(text)
  })
  .map(file => path.relative(root, file).split(path.sep).join('/'))

assert.deepEqual(
  cssInTs,
  [],
  `这些文件把样式写成了 TS 字符串常量，应改成独立的 .css 文件（构建时按文本导入）：${cssInTs.join(' / ')}`,
)

// ── 隐私开关必须持久化 ──
// 隐藏 NSFW / 只看常规这类开关如果只活在 `useState` 里，切页签卸载面板就会重置成"全显示"。
// 这是用户报过的社死场景，而它**没有任何运行时测试能覆盖**（面板卸载/重挂的过程在 SSR 里不存在），
// 所以退一步守接线：每个开关的读与写都必须同时出现在对应文件里 —— 删掉任一半就红。
const PERSISTED_SWITCHES = [
  ['src/components/panel-gallery/client/Gallery.tsx', 'gallery.hideNsfw'],
  ['src/components/panel-poses/client/PosesPanel.tsx', 'poses.onlySafe'],
  ['src/components/panel-costumes/client/CostumesPanel.tsx', 'costumes.onlySafe'],
]
for (const [rel, key] of PERSISTED_SWITCHES) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8')
  const escaped = key.replace('.', '\\.')
  assert.match(text, new RegExp(`readPref\\('${escaped}'`), `${rel}：${key} 的初值必须从 readPref 读，否则切页签就重置`)
  assert.match(text, new RegExp(`writePref\\('${escaped}'`), `${rel}：${key} 变化时必须 writePref，否则读得到旧值`)
}

console.log(`arch: 全部通过（${files.length} 个文件，${units.size} 个单元，组件边界与配置一致，${entryFiles.length + 2} 条 entry 注入齐备，${tabComponents.length} 个页签与诊断表对齐，${WHITELIST_PAIRS.length} 组白名单与导入脚本一致，${PERSISTED_SWITCHES.length} 个隐私开关读写成对）`)

