#!/usr/bin/env node
/**
 * 从 danbooru-tags-data-zh 导入中文标签库（四类：角色 / 画师 / 作品 / 通用）。
 *
 * 数据源：https://github.com/amenorira/danbooru-tags-data-zh （MIT）
 * 收录 Danbooru 上图片数 > 50 的标签，CSV 表头 `tag, category, aliases, zh, count, notes`。
 *
 * 真正的下载与解析在 `src/components/tool-danbooru/server/upstream.ts` ——
 * 面板上的「更新标签」按钮走同一条路，所以这里只做参数解析与输出。
 *
 * 用法：
 *   node scripts/import-danbooru-zh.mjs                    # 四类全导
 *   node scripts/import-danbooru-zh.mjs --kind general     # 只导通用
 *   node scripts/import-danbooru-zh.mjs --kind character --kind artist
 *   node scripts/import-danbooru-zh.mjs --dry              # 只下载与解析，写到临时目录
 */
import os from 'node:os'
import path from 'node:path'

/** 插件数据目录。默认与运行时相同；DSH_COMFYUI_DATA 只有本脚本认（运行时不读它）。 */
function pluginDataDir() {
  const explicit = process.env.DSH_COMFYUI_DATA
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit.trim())
  return path.join(os.homedir(), '.dsh-comfyui-workbench')
}

const ALL_KINDS = ['character', 'artist', 'copyright', 'general']

const args = process.argv.slice(2)
/** 取重复出现的 `--name value`。 */
const flags = name => {
  const out = []
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] !== `--${name}`) continue
    const value = args[i + 1]
    if (value !== undefined && !value.startsWith('--')) out.push(value)
  }
  return out
}

const requested = flags('kind')
const kinds = requested.length === 0
  ? ALL_KINDS
  : requested.filter(kind => {
    if (ALL_KINDS.includes(kind)) return true
    console.warn(`忽略未知类别：${kind}（可选 ${ALL_KINDS.join(' / ')}）`)
    return false
  })
// 全都被过滤掉时不能静默成功：那样 `--kind typo` 会以退出码 0 结束，看起来像导完了
if (kinds.length === 0) {
  console.error(`没有任何可导入的类别。可选：${ALL_KINDS.join(' / ')}`)
  process.exit(1)
}
const dry = args.includes('--dry')
const dataDir = pluginDataDir()
/** dry run 写到系统临时目录：既不碰正式库，也不在用户目录或仓库里留垃圾。 */
const targetDir = dry ? path.join(os.tmpdir(), 'dsh-danbooru-dry') : dataDir

// 需要构建产物（lib/）。旧版 `--dry` 在 import 之前就结束，所以未构建的 clone 也能跑；
// 现在 dry 也走真实导入，必须先 build。`predanbooru:zh` 已挂在 npm script 上。
const { importUpstream, ownStorePath } = await import('../lib/index.js')

console.log(`数据目录：${targetDir}${dry ? '（dry run：只下载与解析，不动正式库）' : ''}`)
console.log(`类别：${kinds.join(' / ')}`)

for (const kind of kinds) {
  try {
    const result = await importUpstream(kind, {
      dataDir: targetDir,
      log: message => console.log(message),
    })
    const pct = result.records === 0 ? '0' : ((result.withNames / result.records) * 100).toFixed(1)
    console.log(
      `  ${kind.padEnd(9)} ${String(result.records).padStart(6)} 条` +
      ` | 有中文/别名 ${pct}%` +
      ` | ${(result.bytes / 1024 / 1024).toFixed(1)} MB CSV` +
      ` | 跳过 ${result.skipped} 行`,
    )
    if (!dry) console.log(`  → ${ownStorePath(dataDir, kind)}`)
  } catch (error) {
    console.error(`  ${kind} 导入失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  }
}
