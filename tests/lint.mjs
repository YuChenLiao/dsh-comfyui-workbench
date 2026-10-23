/**
 * 轻量静态检查：事件回调里引用的裸标识符必须在本文件内有定义。
 *
 * 起因是一次真实事故——批量操作条写了 `onClick: selectNone`，但只定义了
 * `selectAllShown`，于是点击「清除」时抛 `selectNone is not defined`。
 * 语法检查抓不到这种错，SSR 测试也覆盖不到（默认不进入选择模式）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const target = process.argv[2] ?? path.join(here, '..', 'lib', 'client.js')
const source = fs.readFileSync(target, 'utf8')

const PROPERTY = 'on[A-Z][A-Za-z0-9]*'
const references = new Map()
// 只认「裸标识符」：排除属性访问（props.onCancel）、函数调用（act('x')）与箭头函数参数（entry => …）。
const pattern = new RegExp(`\\b(${PROPERTY}):\\s*([A-Za-z_$][\\w$]*)\\b(?!\\s*(?:[.(]|=>))`, 'g')
for (const match of source.matchAll(pattern)) {
  const callback = match[2]
  if (callback === 'undefined' || callback === 'null' || callback === 'true' || callback === 'false') continue
  if (!references.has(callback)) references.set(callback, new Set())
  references.get(callback).add(match[1])
}

/** 是否在本文件里声明过这个名字（const/let/var、函数声明、解构具名）。 */
function isDeclared(name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`\\b(?:const|let|var)\\s+${escaped}\\s*=`),
    new RegExp(`\\b(?:const|let|var)\\s*\\[[^\\]]*\\b${escaped}\\b[^\\]]*\\]`),
    new RegExp(`\\b(?:const|let|var)\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`),
    new RegExp(`\\bfunction\\s+${escaped}\\b`),
  ]
  return patterns.some(one => one.test(source))
}

const missing = []
for (const [callback, usedBy] of references) {
  if (isDeclared(callback)) continue
  missing.push(`${callback}（用于 ${[...usedBy].join(' / ')}）`)
}

assert.deepEqual(missing, [], `事件回调引用了未定义的标识符：\n  ${missing.join('\n  ')}`)
console.log(`lint: 全部通过（${references.size} 个事件回调标识符均有定义）`)
