/**
 * 角色库上游体检：确认 `catalog.json` 里的每条路径**真的还能取到**，且字节数没变。
 *
 * ## 为什么需要它
 *
 * 角色库与其他两个素材库同一套模式：**仓库只存元数据，图运行时按需代理**。
 * 所以 catalog 里记的是上游的相对路径 + 导入那一刻的字节数，而没有任何东西保证
 * 那些路径今天还在 —— 上游改名、删目录、重切图，导入脚本都不会知道，
 * 第一个发现的人是点开卡片看到 502 的用户。
 *
 * 离线那边有 `tests/characters.test.mjs` 守着「代码与数据是否对得上」（白名单、
 * 槽位表、路径重复）；这里补的是另一半：**数据与上游是否对得上**。两者不可替代 ——
 * 前者不需要网络，后者只能联网回答。
 *
 * ## 只拿 HEAD 的状态码与长度
 *
 * 上游许可（CC BY-NC-SA 4.0 + 禁止再分发图像数据）意味着这里更不能下载：
 * 默认只发 `HEAD`，拿状态码与 `Content-Length`，正文一字节不读、不落缓存。
 * 上游不给长度时，退一步对那一条发 `Range: bytes=0-0`，只取首字节并从
 * `Content-Range` 读出总长，然后立刻断开 —— 仍然不是"下载图片"。
 *
 * ## 用法
 *
 *   npm run characters:verify                 # 全量体检（120 条）
 *   node scripts/verify-characters.mjs --limit 10
 *   node scripts/verify-characters.mjs --json # 机器可读，给 CI / 面板用
 *   node scripts/verify-characters.mjs --catalog <file>  # 拿别的 catalog 演练故障
 *
 * 退出码：0 全部可达且可核对的字节数相符；1 有任何一条不可达 / 不符 / 无从核对。
 * 「上游没给长度」算失败：说不清就不该报通过。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CATALOG = path.join(ROOT, 'data', 'characters', 'catalog.json')
const UA = 'dsh-comfyui-workbench/verify-characters'

/** 认得的参数。拼错的 flag 不该被静默忽略 —— 那样"跑了但没查"会看起来像通过。 */
const FLAGS = new Set(['--limit', '--concurrency', '--retries', '--catalog', '--json'])

/** 逐段编码：目录名全中文，整串编码会把斜杠编成 %2F —— 与运行时同一套做法。 */
function encodePath(relativePath) {
  return relativePath.split('/').map(segment => encodeURIComponent(segment)).join('/')
}

function numberArg(flag, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const at = process.argv.indexOf(flag)
  if (at === -1) return fallback
  const raw = process.argv[at + 1]
  const value = Number(raw)
  if (raw === undefined || raw.startsWith('--') || Number.isFinite(value) === false) {
    throw new Error(`${flag} 需要一个数字`)
  }
  return Math.min(Math.max(Math.trunc(value), min), max)
}

function stringArg(flag, fallback) {
  const at = process.argv.indexOf(flag)
  if (at === -1) return fallback
  const value = process.argv[at + 1]
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} 需要一个路径`)
  return value
}

/** catalog 里的每条可寻址路径。`bytes` 为 null 表示没有可比对的长度（preview 只有路径）。 */
function targetsOf(catalog) {
  const list = []
  for (const character of catalog.characters) {
    if (typeof character.preview !== 'string' || character.preview === '') {
      throw new Error(`角色 ${character.id ?? '(无 id)'} 没有 preview 路径`)
    }
    list.push({ where: `${character.id}.preview`, rel: character.preview, bytes: null })
    for (const [slot, info] of Object.entries(character.slots ?? {})) {
      list.push({ where: `${character.id}.${slot}`, rel: info.path, bytes: info.bytes })
    }
  }
  return list
}

/**
 * 一次探针的结果 → 判定。
 *
 * 三类**互斥**且相加等于总数：`ok` / `unreachable` / `size-mismatch` / `unmeasured`。
 * 注意顺序：先看长度有没有拿到，再看对不对 —— 「上游没给长度」与「字节数不符」
 * 是两件事，混成一个会让人去查错方向。
 */
function judge(target, outcome) {
  if (outcome.status !== 200) return 'unreachable'
  if (outcome.length === null) return 'unmeasured'
  if (target.bytes === null) return 'ok'
  return outcome.length === target.bytes ? 'ok' : 'size-mismatch'
}

/** `Content-Length` 缺失时 `Number(null)` 是 0 —— 必须显式区分「没有头」与「写的是 0」。 */
function lengthOf(headers) {
  const raw = headers.get('content-length')
  if (raw === null) return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

/** 把 fetch 的失败翻译成人话：`redirect: 'error'` 抛的 TypeError 只说 "fetch failed"。 */
function describeError(error) {
  const cause = error?.cause
  const text = `${cause?.message ?? ''} ${cause?.code ?? ''}`
  if (/redirect/i.test(text)) return '重定向被拒（上游给了 3xx，代理不跟随）'
  return error instanceof Error ? error.message : String(error)
}

/**
 * 问一次上游：状态码 + 声明长度。
 *
 * `redirect: 'error'` 与运行时一致 —— 第一跳 https 之后一个 302 就能把代理变成
 * 任意出口，体检不该比生产宽松。
 */
async function probe(url, { retries = 1, fetchImpl = fetch } = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        method: 'HEAD',
        headers: { 'User-Agent': UA },
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
      })
      const length = lengthOf(response.headers)
      // 5xx 与 429 是抖动，值得再问一次；404 / 403 是确定的，重试只是浪费。
      if ((response.status >= 500 || response.status === 429) && attempt < retries) {
        lastError = `HTTP ${response.status}`
        continue
      }
      if (response.status === 200 && length === null) {
        return { status: response.status, length: await rangedLength(url, fetchImpl) }
      }
      return { status: response.status, length }
    } catch (error) {
      lastError = describeError(error)
      if (attempt >= retries) break
    }
  }
  return { status: 0, length: null, error: lastError ?? '请求失败' }
}

/** 上游没给 Content-Length 时的兜底：读 1 字节，从 `Content-Range` 取总长。 */
async function rangedLength(url, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, {
      headers: { 'User-Agent': UA, Range: 'bytes=0-0' },
      redirect: 'error',
      signal: AbortSignal.timeout(20_000),
    })
    // 206 才有 Content-Range；200 说明上游无视 Range，只能按它这次的 Content-Length 算，
    // 而它既然没给长度，就还是 null —— 不要拿 0 冒充"量到了"。
    const range = response.headers.get('content-range')
    const total = range === null ? lengthOf(response.headers) : Number(/\/(\d+)$/.exec(range)?.[1])
    // 不读正文，直接丢掉，避免把 1 字节之外的东西拉进来
    await response.body?.cancel()
    return Number.isFinite(total) && total !== null && total >= 0 ? total : null
  } catch {
    return null
  }
}

/** 失败也要有可解析的输出：CI 侧看退出码，人看一行话。 */
function abort(message) {
  if (process.argv.includes('--json')) console.log(JSON.stringify({ ok: false, error: message }))
  else console.error(message)
  process.exitCode = 1
}

async function main() {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--') && FLAGS.has(arg) === false) {
      abort(`未知参数：${arg}（可用：${[...FLAGS].join(' / ')}）`)
      return
    }
  }

  const catalogFile = stringArg('--catalog', CATALOG)
  if (fs.existsSync(catalogFile) === false) {
    abort(`没有 catalog：${catalogFile}（先跑 npm run characters:import）`)
    return
  }

  let catalog
  try {
    catalog = JSON.parse(fs.readFileSync(catalogFile, 'utf8'))
  } catch (error) {
    abort(`catalog 不是合法 JSON：${catalogFile}（${error instanceof Error ? error.message : String(error)}）`)
    return
  }

  // 与运行时同一条校验：origin 必须钉在固定 commit 上。
  if (/^[0-9a-f]{40}$/.test(catalog.commit ?? '') === false) {
    abort(`commit 不是 40 位十六进制：${JSON.stringify(catalog.commit)}`)
    return
  }

  // 白名单与 origin 都从生产代码导入，不抄副本：catalog 里若有上游存在、运行时拒收的
  // 路径（`.svg`、含 `..`），或者 origin 被改成了镜像（体检全绿、生产 502），这里必须跟着红。
  let CHARACTER_PATH
  let characterOrigin
  try {
    ({ CHARACTER_PATH, characterOrigin } = await import('../lib/entries/characters.js'))
  } catch {
    abort('读不到 lib/entries/characters.js（先跑 npm run build）')
    return
  }

  const expectedOrigin = characterOrigin(catalog.commit)
  if (catalog.origin !== expectedOrigin) {
    abort(`origin 与生产拼法不一致：期望 ${expectedOrigin}，实际 ${catalog.origin}`)
    return
  }

  const targets = targetsOf(catalog)
  if (targets.length === 0) {
    abort('catalog 里没有任何可寻址路径 —— 什么都没查，不能报通过')
    return
  }
  const rejected = targets.filter(item => CHARACTER_PATH.test(item.rel) === false)
  if (rejected.length > 0) {
    abort(`有 ${rejected.length} 条路径被运行时白名单拒收（上游再可达，生产也取不到）：\n`
      + rejected.map(item => `  ✖ ${item.where}  ${item.rel}`).join('\n'))
    return
  }

  const concurrency = numberArg('--concurrency', 8, { min: 1, max: 32 })
  const retries = numberArg('--retries', 1, { min: 0, max: 3 })
  const limit = numberArg('--limit', targets.length, { min: 1, max: targets.length })
  const asJson = process.argv.includes('--json')
  const checked = targets.slice(0, limit)

  if (asJson === false) {
    console.log(`角色库上游体检：${catalog.source} @ ${catalog.commit.slice(0, 7)}`)
    console.log(`${checked.length} 条路径（并发 ${concurrency}，重试 ${retries}）`)
  }

  const results = new Array(checked.length)
  let cursor = 0
  const worker = async () => {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= checked.length) return
      const target = checked[index]
      const url = `${catalog.origin}/${encodePath(target.rel)}`
      const outcome = await probe(url, { retries })
      results[index] = { ...target, url, ...outcome, verdict: judge(target, outcome) }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, checked.length) }, worker))

  const unreachable = results.filter(item => item.verdict === 'unreachable')
  const mismatched = results.filter(item => item.verdict === 'size-mismatch')
  const unmeasured = results.filter(item => item.verdict === 'unmeasured')
  const bad = [...unreachable, ...mismatched]
  // 只有带 bytes 的条目才谈得上"相符"：20 张 preview 在 catalog 里就只有路径。
  const measurable = results.filter(item => item.bytes !== null)
  const matched = measurable.filter(item => item.verdict === 'ok')

  if (asJson) {
    console.log(JSON.stringify({
      source: catalog.source,
      commit: catalog.commit,
      checked: results.length,
      // 四类互斥，相加等于 checked
      ok: results.length - bad.length - unmeasured.length,
      unreachable,
      sizeMismatch: mismatched,
      unmeasured,
    }, null, 2))
    process.exitCode = bad.length === 0 && unmeasured.length === 0 ? 0 : 1
    return
  }

  for (const item of unreachable) {
    console.log(`  ✖ ${item.where}  HTTP ${item.status}${item.error === undefined ? '' : ` ${item.error}`}`)
    console.log(`      ${item.url}`)
  }
  for (const item of mismatched) {
    console.log(`  ✖ ${item.where}  字节数不符：catalog ${item.bytes} / 上游 ${item.length}`)
    console.log(`      ${item.url}`)
  }
  for (const item of unmeasured) {
    console.log(`  ✖ ${item.where}  可达，但上游没给 Content-Length，无法核对字节数`)
    console.log(`      ${item.url}`)
  }

  if (bad.length === 0 && unmeasured.length === 0) {
    console.log(`✅ ${results.length}/${results.length} 可达；`
      + `${matched.length}/${measurable.length} 条带字节数的条目全部相符`
      + `${results.length === measurable.length ? '' : `（另有 ${results.length - measurable.length} 条只有路径，只验了可达）`}`)
    process.exitCode = 0
    return
  }
  console.log(`✖ ${results.length} 条里：${unreachable.length} 条不可达 / ${mismatched.length} 条字节数不符 / ${unmeasured.length} 条无法核对`)
  process.exitCode = 1
}

// 被当脚本跑才执行；被测试 import 时只拿函数。
const invokedAsScript = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (invokedAsScript) {
  main().catch(error => {
    abort(error instanceof Error ? error.message : String(error))
  })
}

export { FLAGS, describeError, encodePath, judge, lengthOf, main, probe, rangedLength, targetsOf }
