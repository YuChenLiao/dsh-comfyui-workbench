#!/usr/bin/env node
/**
 * 从 dsh-comfyui-album 迁移到本插件。
 *
 *   node scripts/migrate-album.mjs [--write]
 *
 * 只迁移**配置**，不碰任何产物文件：相册的 roots / 扫描上限与本插件语义一致，
 * 抄过去即可；产物本来就在磁盘上，索引会自己重建。
 *
 * 不自动改 profile：装载行的增删由用户执行 —— 插件不该越过用户改宿主配置。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = process.env.USERPROFILE ?? process.env.HOME ?? ''
const profilesDir = path.join(home, '.dsh', 'profiles')
const dataDir = path.join(home, '.dsh-comfyui-workbench')
const configFile = path.join(dataDir, 'config.json')

/** 能在哪些 profile 里找到相册装载行。 */
function findAlbumEntries() {
  const found = []
  let names = []
  try {
    names = fs.readdirSync(profilesDir)
  } catch {
    return found
  }
  for (const name of names) {
    // 装载行可能在 profile 自己的 cordis.yml，也可能在插件的 patch 文件里，两处都看。
    for (const file of ['cordis.patch.yml', 'cordis.yml']) {
      const target = path.join(profilesDir, name, file)
      let text = ''
      try {
        text = fs.readFileSync(target, 'utf8')
      } catch {
        continue
      }
      if (!text.includes('comfyui-album')) continue
      found.push({ profile: `${name}/${file}`, file: target, text })
    }
  }
  return found
}

/**
 * 从 patch 文本里抠出相册那条装载行的 config 键值。
 *
 * 用正则而不是 YAML 解析器：这个文件是我们自己生成的固定结构，
 * 引一个 parser 只为读五行配置不值当。解析不出来时下面会退回打印原文。
 */
function parseAlbumConfig(text) {
  const line = text.split('\n').find(item => /^\s*-\s+id:\s*comfyui-album\s*$/.test(item))
  if (line === undefined) return undefined
  const start = text.indexOf(line)
  const rest = text.slice(start)
  const config = {}

  const scalar = key => {
    const match = new RegExp(`^\\s+${key}:\\s*(.+)$`, 'm').exec(rest)
    if (match === null) return undefined
    const raw = (match[1] ?? '').replace(/\s+#.*$/, '').trim()
    if (raw === '') return undefined
    if (raw === 'true') return true
    if (raw === 'false') return false
    if (/^-?\d+$/.test(raw)) return Number(raw)
    return raw.replace(/^['"]|['"]$/g, '')
  }

  for (const key of ['maxDepth', 'maxItems', 'cacheMs', 'includeHidden']) {
    const value = scalar(key)
    if (value !== undefined) config[key] = value
  }

  // roots 可能是 [] 或块状列表，两种都认。
  const inline = /^\s+roots:\s*\[(.*)\]\s*$/m.exec(rest)
  if (inline !== null) {
    const body = (inline[1] ?? '').trim()
    config.roots = body === '' ? [] : body.split(',').map(item => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
  } else {
    const block = /^\s+roots:\s*\n((?:\s+-\s+.+\n?)+)/m.exec(rest)
    if (block !== null) {
      config.roots = (block[1] ?? '')
        .split('\n')
        .map(item => item.replace(/^\s*-\s+/, '').trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    }
  }
  return config
}

const write = process.argv.includes('--write')
const entries = findAlbumEntries()

console.log('── 相册迁移检查 ──')
console.log(`数据目录：${dataDir}`)
console.log(`配置文件：${configFile}（${fs.existsSync(configFile) ? '已存在' : '不存在'}）`)

if (entries.length === 0) {
  console.log('\n没有在 profile 里找到 comfyui-album 的装载行（可能已经卸载）。')
  console.log('如果只是要重建索引：启动 DSH 后调用 POST /comfyui-workbench/api/assets/rebuild。')
  process.exit(0)
}

let merged = {}
for (const entry of entries) {
  const config = parseAlbumConfig(entry.text)
  console.log(`\nprofile：${entry.profile}`)
  if (config === undefined) {
    console.log('  没能自动解析出 config，请手动把这段抄到本插件的装载行：')
    console.log(entry.text.split('\n').filter(item => item.includes('comfyui-album') || item.trim().startsWith('config') || item.trim().startsWith('roots') || item.trim().startsWith('max')).join('\n'))
    continue
  }
  console.log(`  config：${JSON.stringify(config)}`)
  merged = { ...merged, ...config }
}

if (Object.keys(merged).length === 0) {
  console.log('\n没有可迁移的配置。')
  process.exit(0)
}

const next = { ...merged }
if (write) {
  fs.mkdirSync(dataDir, { recursive: true })
  let existing = {}
  try {
    existing = JSON.parse(fs.readFileSync(configFile, 'utf8'))
  } catch {
    existing = {}
  }
  fs.writeFileSync(configFile, `${JSON.stringify({ ...existing, ...next }, null, 2)}\n`, 'utf8')
  console.log(`\n已写入 ${configFile}`)
} else {
  console.log(`\n将写入的内容（加 --write 真正落盘）：\n${JSON.stringify(next, null, 2)}`)
}

console.log('\n剩下两步由你完成：')
console.log('  1. dsh plugin --profile <profile> add link:<本仓库>')
console.log('  2. dsh plugin --profile <profile> remove dsh-comfyui-album')
