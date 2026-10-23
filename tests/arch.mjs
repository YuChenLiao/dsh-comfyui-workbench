/**
 * 架构自检：依赖方向必须单向，且各域只依赖允许的下层。
 *
 * 这不是风格检查，是把设计方案里的一句话变成可执行约束：
 *   scan   ← 只读磁盘，只依赖 node:*
 *   host   ← 宿主最小面，只依赖 node:*
 *   assets ← 依赖 scan / host
 *   http   ← 依赖 assets / scan / host
 *   index  ← 装配，可依赖全部
 *
 * 反向依赖（例如 scan import assets）会让"最底层"变成一句空话：
 * 上层一改，底层跟着重编译，测试也没法单独跑。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')

/** 每个域允许的跨域依赖（同域相对导入总是允许）。 */
const ALLOWED = {
  scan: [],
  host: [],
  assets: ['scan', 'host'],
  workflow: ['host'],
  comfy: ['host', 'workflow'],
  run: ['comfy', 'workflow', 'scan', 'host'],
  store: ['host', 'scan'],
  tools: ['run', 'comfy', 'workflow', 'store', 'host'],
  http: ['assets', 'scan', 'host', 'workflow', 'run', 'comfy', 'store'],
  client: [], // 客户端只依赖自身与 react / react-dom（由宿主注入）
}

/** 收集一个目录下的所有源码。 */
function sources(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 剥掉块注释与整行注释：注释里写 `import('sharp')` 不该被当成真实依赖。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

/** 从源码里抽出所有静态 import 与动态 import 的目标。 */
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

const violations = []

function checkDomain(domain, file) {
  const source = stripComments(fs.readFileSync(file, 'utf8'))
  const allowed = ALLOWED[domain] ?? []
  for (const target of importsOf(source)) {
    if (target.startsWith('node:') || target === 'react' || target === 'react-dom' || target === 'react/jsx-runtime') continue
    if (target.startsWith('.')) {
      // 相对导入：算出它落在哪个域
      const resolved = path.resolve(path.dirname(file), target)
      const rel = path.relative(root, resolved).split(path.sep).join('/')
      const segments = rel.split('/')
      // src/<domain>/... 或 src/<domain>.ts
      const domainOfTarget = segments[0] === 'src' ? segments[1].replace(/\.(ts|tsx)$/, '') : null
      if (domainOfTarget === null) continue // 指向仓库外（理论上不该出现）
      if (domainOfTarget === domain) continue
      if (allowed.includes(domainOfTarget)) continue
      // client 内部跨子目录是允许的（components / hooks / 同域）
      violations.push(`${rel.replace('src/', '')} ← ${domain} 不允许依赖 ${domainOfTarget}`)
      continue
    }
    violations.push(`${path.relative(root, file)} 引入了外部包：${target}（运行时必须零依赖）`)
  }
}

for (const domain of Object.keys(ALLOWED)) {
  const dir = path.join(root, 'src', domain)
  if (!fs.existsSync(dir)) continue
  for (const file of sources(dir)) checkDomain(domain, file)
}

assert.deepEqual(violations, [], `架构违规：\n  ${violations.join('\n  ')}`)
console.log(`arch: 全部通过（${Object.keys(ALLOWED).length} 个域的依赖方向符合约束）`)
