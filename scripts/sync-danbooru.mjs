#!/usr/bin/env node
/**
 * 同步 Danbooru 的角色 / 画师标签到本地库。
 *
 * 用法：
 *   node scripts/sync-danbooru.mjs                    # 默认：角色 + 画师，热度 ≥ 100，每类最多 3000 条
 *   node scripts/sync-danbooru.mjs --kind character    # 只同步角色
 *   node scripts/sync-danbooru.mjs --min 50 --max 0    # 放宽热度、不限条数（慢，几十分钟）
 *   node scripts/sync-danbooru.mjs --dry               # 只看会拉多少条，不写盘
 *
 * 产物：`<插件数据目录>/danbooru/{characters,artists}.jsonl`
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 插件数据目录。默认与运行时相同；DSH_COMFYUI_DATA 只有本脚本认（运行时不读它）。 */
function pluginDataDir() {
  const explicit = process.env.DSH_COMFYUI_DATA
  if (typeof explicit === 'string' && explicit.trim() !== '') return path.resolve(explicit.trim())
  return path.join(os.homedir(), '.dsh-comfyui-workbench')
}

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  if (index < 0) return fallback
  const value = args[index + 1]
  return value === undefined || value.startsWith('--') ? true : value
}

const kindArg = String(flag('kind', 'all'))
const kinds = kindArg === 'character' ? ['character'] : kindArg === 'artist' ? ['artist'] : ['character', 'artist']
// 与工具路径对齐：非法值回默认。
// 注意先挡类型：`--min` 不带值时 flag() 返回布尔 true（Number(true)=1），
// 空串则 Number('')=0 —— 两者都会静默变成"全量/不限"，症状是同步跑几十小时
//（全量 40 万条，8 并发实测 3~4 条/秒，约 30 小时）。
const asCount = (raw, fallback) => {
  if (typeof raw === 'boolean') return fallback
  if (typeof raw === 'string' && raw.trim() === '') return fallback
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? Math.floor(value) : fallback
}
const minPostCount = asCount(flag('min', 100), 100)
const maxTags = asCount(flag('max', 3000), 3000)
const dry = flag('dry', false) === true

const { DEFAULT_SYNC, syncKind, storePath, readStore } = await import('../lib/index.js')
const dataDir = pluginDataDir()

console.log(`数据目录：${dataDir}`)
console.log(`参数：热度 ≥ ${minPostCount}，每类最多 ${maxTags === 0 ? '不限' : maxTags} 条${dry ? '（dry run，不写盘）' : ''}`)

if (dry) {
  // 不用 process.exit：undici 的句柄还活着时退出会触发 libuv 断言（Windows 上 exit 127）。
  // 让它自然跑完即可 —— 下面用 if/else 包住真实同步。
  const res = await fetch('https://danbooru.donmai.us/tags.json?search[category]=4&search[post_count]=' + encodeURIComponent('>=' + minPostCount) + '&limit=1', {
    headers: { 'User-Agent': 'dsh-comfyui-workbench' },
  })
  console.log(`可达 Danbooru：${res.status}（dry run 到此为止）`)
} else {

for (const kind of kinds) {
  const started = Date.now()
  const records = await syncKind(kind, {
    dataDir,
    minPostCount,
    pageSize: DEFAULT_SYNC.pageSize,
    maxTags,
    concurrency: DEFAULT_SYNC.concurrency,
    log: message => console.log(message),
    onProgress: progress => {
      if (progress.done % 500 === 0) {
        process.stdout.write(`\r  ${progress.done}/${progress.total}（有中文名 ${progress.withNames}）`)
      }
    },
  })
  const seconds = ((Date.now() - started) / 1000).toFixed(0)
  const file = storePath(dataDir, kind)
  const size = fs.existsSync(file) ? (fs.statSync(file).size / 1024 / 1024).toFixed(1) : '0'
  console.log(`\n${kind}: ${records.length} 条，${size} MB，用时 ${seconds}s → ${file}`)
  console.log(`  抽样：${records.slice(0, 3).map(r => `${r.tag}(${r.names[0] ?? '-'})`).join(', ')}`)
}

for (const kind of kinds) {
    const file = storePath(dataDir, kind)
    console.log(`校验 ${kind}: 读回 ${readStore(file).length} 条`)
  }
}
