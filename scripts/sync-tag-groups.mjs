#!/usr/bin/env node
/**
 * 抓 Danbooru 的 tag 分组（语义分类）到本地。
 *
 * 来源是 wiki，不是 API：`tag_groups` 是一篇 wiki 文章，列出 91 个 `Tag group:XXX`
 * 子页面；每个子页面列出成员 tag。两层都要抓，共 92 次请求、约 2.5 分钟。
 *
 * 真正的抓取与解析在 `src/components/tool-danbooru/server/groups.ts` ——
 * 面板上的「更新标签」按钮将来走同一段代码。
 *
 * 用法：
 *   node scripts/sync-tag-groups.mjs              # 抓到插件数据目录
 *   node scripts/sync-tag-groups.mjs --dry        # 只抓不写（看会得到多少）
 *   node scripts/sync-tag-groups.mjs --delay 2000 # 放慢页间间隔
 */
import os from 'node:os'
import path from 'node:path'

/** 插件数据目录。默认与运行时相同；DSH_COMFYUI_DATA 只有本脚本认。 */
function pluginDataDir() {
  const explicit = process.env.DSH_COMFYUI_DATA
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit.trim())
  return path.join(os.homedir(), '.dsh-comfyui-workbench')
}

const args = process.argv.slice(2)
const flag = name => {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return undefined
  const value = args[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const dry = args.includes('--dry')
const bundled = args.includes('--bundled')
const delayRaw = flag('delay')
const delayMs = typeof delayRaw === 'string' && Number.isFinite(Number(delayRaw)) ? Number(delayRaw) : 1_200

const { bundledDir, syncGroups } = await import('../lib/index.js')

const dataDir = dry
  ? path.join(os.tmpdir(), 'dsh-groups-dry')
  // `--bundled` 要把 dataDir 指到随包 data/ 的**父级**：groupsPath 会拼成 `<dataDir>/danbooru/groups.jsonl`
  : bundled ? path.dirname(bundledDir()) : pluginDataDir()
console.log(`数据目录：${dataDir}${bundled ? '（--bundled：写随包 data/danbooru/）' : ''}`)
console.log(`页间间隔：${delayMs}ms${dry ? '（dry：写临时目录，不动正式数据）' : ''}`)

try {
  const result = await syncGroups({
    dataDir,
    // 写随包目录必须显式允许（默认的护栏会拒绝）
    ...(bundled ? { allowBundled: true } : {}),
    delayMs,
    log: message => console.log(message),
  })
  if (result.failed.length > 0) {
    console.warn(`有 ${result.failed.length} 个组抓取失败（已从上一份快照补回）：${result.failed.join(' / ')}`)
  }
  if (result.fromCache) {
    console.error('全部失败，保留了旧快照。')
    process.exitCode = 1
  }
  console.log('')
  console.log(`组数 ${result.groups} / 唯一 tag ${result.tags} / 跨组 ${result.shared} / 用时 ${result.seconds}s`)
  console.log(`→ ${result.file}${bundled ? '' : `（随包副本：${path.join(bundledDir(), 'groups.jsonl')}）`}`)
  console.log(`→ ${result.file}`)
} catch (error) {
  console.error(`抓取失败：${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
