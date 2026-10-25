#!/usr/bin/env node
/**
 * 从 danbooru-tags-data-zh 导入中文标签库。
 *
 * 数据源：https://github.com/amenorira/danbooru-tags-data-zh
 * 收录 Danbooru 上图片数 > 50 的标签（角色 3.5 万、画师 2.5 万），
 * CSV 表头 `tag, category, aliases, zh, count, notes`。
 *
 * 相比逐条查 wiki：那份方案要发几千到几十万次请求（8 并发约 3~4 条/秒），
 * 这里一次下载几 MB 就全有了，且覆盖广、别名质量更高（含社区昵称）、还带注释。
 *
 * 用法：
 *   node scripts/import-danbooru-zh.mjs                # 角色 + 画师
 *   node scripts/import-danbooru-zh.mjs --kind character
 *   node scripts/import-danbooru-zh.mjs --dry          # 只报告会导入多少条
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const BASE = 'https://raw.githubusercontent.com/amenorira/danbooru-tags-data-zh/main/tags'
const FILES = { character: 'character.csv', artist: 'artist.csv' }
/** Danbooru 分类号 → 我们的 kind。 */
const KIND_OF_CATEGORY = { 1: 'artist', 4: 'character' }

/** 插件数据目录（默认与运行时一致）。 */
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
const dry = flag('dry', false) === true
const dataDir = pluginDataDir()

/**
 * 解析一行 CSV（状态机，尊重双引号）。
 *
 * 不能按逗号硬切：`aliases` / `zh` 里可能出现被引号包住、内含逗号的值
 * （例如 `f4samurai` 的 `"f4samurai, Inc."`），硬切会整行解析失败并静默丢数据。
 *
 * @param line - 一行 CSV。
 */
function parseLine(line) {
  const fields = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]
    if (quoted) {
      if (char === '"') {
        // 转义的双引号是 value 的一部分
        if (line[i + 1] === '"') { current += '"'; i += 1 }
        else quoted = false
      } else current += char
      continue
    }
    if (char === '"') { quoted = true; continue }
    if (char === ',') { fields.push(current); current = ''; continue }
    current += char
  }
  fields.push(current)
  if (fields.length < 6) return undefined
  return {
    tag: (fields[0] ?? '').trim(),
    category: Number(fields[1]),
    aliases: fields[2] ?? '',
    zh: (fields[3] ?? '').trim(),
    count: Number(fields[4] || 0),
    // notes 里若还有逗号，全部算注释
    notes: fields.slice(5).join(',').trim(),
  }
}

/** 把一行转成库记录：中文名排第一，其余别名附后。 */
function toRecord(row, kind) {
  const names = []
  const seen = new Set()
  const push = name => {
    const value = String(name).trim()
    if (value === '' || value.toLowerCase() === row.tag.toLowerCase()) return
    const key = value.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    names.push(value)
  }
  if (row.zh !== '') push(row.zh)
  for (const alias of row.aliases.split('|')) push(alias)
  return {
    tag: row.tag,
    kind,
    postCount: row.count,
    names,
    updatedAt: new Date().toISOString(),
    ...(row.notes === '' ? {} : { note: row.notes }),
  }
}

/**
 * 下载并解析一个分类。
 *
 * @param kind - 角色或画师。
 */
async function fetchCategory(kind) {
  const file = FILES[kind]
  const res = await fetch(`${BASE}/${file}`, { signal: AbortSignal.timeout(120_000) })
  if (!res.ok) throw new Error(`下载 ${file} 失败：${res.status}`)
  const text = await res.text()
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  const header = lines[0]
  if (header === undefined || !header.startsWith('tag,')) throw new Error(`${file} 表头不符合预期：${header?.slice(0, 40)}`)

  const records = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const row = parseLine(line)
    if (row === undefined) { skipped += 1; continue }
    // 只收与目标分类一致的行（CSV 里本就只有这一类，防御性判断）
    if (KIND_OF_CATEGORY[row.category] !== kind) continue
    records.push(toRecord(row, kind))
  }
  return { records, bytes: text.length, skipped }
}

for (const kind of kinds) {
  const started = Date.now()
  const { records, bytes, skipped } = await fetchCategory(kind)
  const withNames = records.filter(record => record.names.length > 0).length
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (dry) {
    console.log(`${kind}: ${records.length} 条（${(bytes / 1024 / 1024).toFixed(1)} MB CSV），其中 ${withNames} 条有中文/别名，跳过 ${skipped} 行（解析失败），用时 ${seconds}s —— dry run 不写盘`)
    continue
  }

  const file = path.join(dataDir, 'danbooru', `${kind}s.jsonl`)  // 只写用户目录，不动包内数据
  // 去掉被多条记录共用的别名：这份库的 aliases 里有大量 CP 名/组合名，
  // 不去重的话查「初音未来」会返回 20 条（19 条是 hatasune_miku 的各种变体）。
  const pruned = (await import('../lib/index.js')).pruneSharedAliases(records)
  if (pruned > 0) console.log(`  去掉 ${pruned} 个被多条共用别名`)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const body = records.map(record => JSON.stringify(record)).join('\n')
  fs.writeFileSync(`${file}.${process.pid}.importing`, body === '' ? '' : `${body}\n`, 'utf8')
  fs.renameSync(`${file}.${process.pid}.importing`, file)
  console.log(`${kind}: ${records.length} 条，${withNames} 条有中文/别名${skipped > 0 ? `，跳过 ${skipped} 行` : ''} → ${file}（${seconds}s）`)
  console.log(`  抽样：${records.slice(0, 3).map(r => `${r.tag}(${r.names[0] ?? '-'})`).join(', ')}`)
}
