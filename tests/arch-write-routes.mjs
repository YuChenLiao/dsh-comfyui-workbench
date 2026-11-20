/**
 * 结构性检查：**写操作必须走真实入口**。
 *
 * 守的是一个反复出现的坑：给组件加了写接口（POST / 切换方法），忘了在 router 的
 * `selfManaged` 里登记，于是分派器在 handler 之前就 405 —— 而测试直接调
 * `routes.exact[...]`，绕过了方法校验层，**测试全绿、真机不通**。
 *
 * 已经踩过四次：/workflows（批量导出）、/terminal、/config、/tags/sync。
 * 光靠每次审查提醒不管用，写成结构性检查：凡是进了三张表之一的路径，
 * `tests/api.test.mjs` 里必须有一条走 `boot()` + 真实 fetch 的用例。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')

const routerText = fs.readFileSync(path.join(root, 'src', 'http', 'router.ts'), 'utf8')

/**
 * 从 `const NAME = new Set([...])` 里取字符串成员。
 *
 * 用 indexOf 切段而不是 `new RegExp`：模板字符串里的转义在不同环境下会被吃，
 * 这个检查本身不能因为一个反斜杠就挂掉。
 */
function setMembers(name) {
  const head = `const ${name} = new Set([`
  const at = routerText.indexOf(head)
  if (at < 0) return []
  const from = at + head.length
  const to = routerText.indexOf('])', from)
  if (to < 0) return []
  const body = routerText.slice(from, to)
  return [...body.matchAll(/'([^']+)'/g)].map(match => match[1])
}

/**
 * `selfManaged` 是表达式：只抓 `sub === 'x'` 与 `sub.startsWith('x')`。
 *
 * 根路径 `'/'` 要剔掉：它是 `if (sub === '/')` 的健康检查，不是写接口，
 * 而 `api${'/'}` = `api/` 这个子串在 api.test.mjs 里到处都是，
 * 留着它会让分母虚高并让覆盖率看起来比实际好。宁可少算一条接口，
 * 也不要让这个检查自己变成"看起来通过"。
 */
function selfManagedPaths() {
  return [
    ...[...routerText.matchAll(/sub === '([^']+)'/g)].map(match => match[1]),
    ...[...routerText.matchAll(/sub\.startsWith\('([^']+)'\)/g)].map(match => match[1]),
  ].filter(item => item !== '/' && item !== '')
}

const writePaths = [...new Set([...setMembers('WRITABLE'), ...setMembers('POST_ONLY'), ...selfManagedPaths()])]
assert.ok(
  writePaths.length >= 8,
  `没抓到写接口路径（实际 ${writePaths.length} 条）—— router.ts 的结构可能变了，这个检查本身需要跟着改`,
)

// 真实入口测试：`boot()` 起真 server + fetch 打过去，才叫覆盖分派层。
const apiTests = fs.readFileSync(path.join(root, 'tests', 'api.test.mjs'), 'utf8')
assert.match(apiTests, /applyAll\(/, 'api.test.mjs 必须走 applyAll 装配，而不是手工拼 handler')

/**
 * 已知缺真实入口测试的写接口 —— **现在是空的，请保持为空**。
 *
 * 这五条历史债（/delete、/delete-many、/assets/rebuild、/service/stop、/free）
 * 已在 `tests/api.test.mjs` 的「写接口真入口」用例里补齐：走 `boot()` + 真实 fetch，
 * 并断言分派层不再把它们拦成 405。
 *
 * 往这里加新条目等于给新接口开一张豁免单，而这条检查存在的全部意义就是防这个。
 */
const KNOWN_UNTESTED = new Set([])

const missing = writePaths.filter(item => !apiTests.includes(`api${item}`) && !KNOWN_UNTESTED.has(item))
assert.deepEqual(
  missing,
  [],
  `这些写接口在 tests/api.test.mjs 里没有走真实入口（boot() + fetch）的用例：${missing.join(' / ')}`
    + ' —— 直接调 routes.exact 会绕过方法校验层，测试绿但真机 405。',
)

const stillKnown = writePaths.filter(item => KNOWN_UNTESTED.has(item) && !apiTests.includes(`api${item}`))
if (stillKnown.length > 0) {
  console.log(`arch: 写接口真实入口覆盖 ${writePaths.length - stillKnown.length}/${writePaths.length}`
    + `（仍缺：${stillKnown.join(' ')} —— 见 arch-write-routes.mjs 的 KNOWN_UNTESTED）`)
} else {
  console.log(`arch: 写接口真实入口覆盖 ${writePaths.length} 条（全部有测试）`)
}
