/**
 * 类名自检：组件里用到的每一个 cwb-/cwf-/cfa- 类，样式表里必须有定义。
 *
 * 这条检查是一次次真事故换来的：
 *   - 重写版式时漏掉 ImagePicker 的 10 个类 → 上传区变成裸文字
 *   - 把外壳容器改名却留下旧类名 → 相册高度链断了、滚动条消失
 * 两次都是"组件引用了样式表里不存在的类"，肉眼看不出来，只能靠机器盯。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '..')
const clientDir = path.join(root, 'src', 'client')
// 组件拆分后 UI 分散在 src/components/*/client，扫描要覆盖整个 src
const srcDir = path.join(root, 'src')

/** 收集一个目录下所有源码。 */
function sources(dir) {
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...sources(full))
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 样式表文件（它们定义类名）。 */
// 样式表按组件分散：相册的在 panel-gallery/client、工作台外壳的在自己目录
const STYLE_FILES = [
  path.join(root, 'src', 'components', 'panel-gallery', 'client', 'styles.ts'),
  path.join(clientDir, 'styles-workbench.ts'),
]

/** 样式表里定义过的类名。 */
const defined = new Set()
for (const file of STYLE_FILES) {
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\.((?:cwb|cwf|cfa)-[a-z0-9-]+)/g)) defined.add(match[1])
}

/** 组件源码里引用过的类名（含模板字符串里的静态片段）。 */
const used = new Map()
for (const file of sources(srcDir)) {
  if (STYLE_FILES.includes(file)) continue
  const text = fs.readFileSync(file, 'utf8')
  for (const match of text.matchAll(/\b((?:cwb|cwf|cfa)-[a-z0-9-]+)/g)) {
    const name = match[1]
    // `cwf-field-${type}` 这种动态拼接只会命中前缀，跳过
    if (name.endsWith('-')) continue
    if (!used.has(name)) used.set(name, new Set())
    used.get(name).add(path.relative(root, file))
  }
}

const missing = [...used.entries()]
  .filter(([name]) => !defined.has(name))
  .map(([name, files]) => `${name}（${[...files].join(', ')}）`)

assert.deepEqual(missing, [], `这些类名在样式表里没有定义：\n  ${missing.join('\n  ')}`)

const unused = [...defined].filter(name => !used.has(name))
console.log(`classes: 全部通过（${used.size} 个类名都有定义${unused.length === 0 ? '' : `；${unused.length} 个已定义但没用到`}）`)
