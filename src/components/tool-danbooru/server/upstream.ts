/**
 * 从上游 `danbooru-tags-data-zh` 导入标签库。
 *
 * 数据源：https://github.com/amenorira/danbooru-tags-data-zh （MIT）
 * 每个类别一个 CSV，表头 `tag, category, aliases, zh, count, notes`。
 *
 * **为什么不用逐条查 Danbooru wiki**：那份方案要发几千到几十万次请求（实测 8 并发
 * 3~4 条/秒，400 条就要 100 秒），而且画师 wiki 几乎不填 `other_names`，拿不到中文名。
 * 这里一次下载几 MB 就全有了，覆盖更广、别名质量更高（含社区昵称）、还带注释。
 *
 * 这段逻辑原先只在 `scripts/import-danbooru-zh.mjs` 里。面板上的「更新标签」按钮
 * 也要走同一条路，所以提到 `src/` —— 否则脚本与 HTTP 端点会各写一份（本仓库在
 * 「同一概念两份实现」上栽过多次）。
 */
import path from 'node:path'

import { ownStorePath, pruneSharedAliases, writeStore } from './store.js'
import type { TagKind, TagRecord } from './store.js'

/** 上游 raw 地址。注意 `github.com` 在部分网络下不可达，`raw.githubusercontent.com` 才是数据入口。 */
export const UPSTREAM_BASE = 'https://raw.githubusercontent.com/amenorira/danbooru-tags-data-zh/main/tags'

/** 类别 → 上游文件名。 */
export const UPSTREAM_FILES: Record<TagKind, string> = {
  character: 'character.csv',
  artist: 'artist.csv',
  general: 'general.csv',
  copyright: 'copyright.csv',
}

/**
 * 上游 CSV 的 `category` 列 → 我们的 kind。
 *
 * 数字是 Danbooru 的标签分类号：0=general、1=artist、3=copyright、4=character。
 * 2（deprecated）与 5（meta）不导入。
 */
export const KIND_OF_CATEGORY: Record<number, TagKind | undefined> = {
  0: 'general',
  1: 'artist',
  3: 'copyright',
  4: 'character',
}

/** 一行 CSV 的解析结果。 */
export interface UpstreamRow {
  tag: string
  category: number
  aliases: string
  zh: string
  count: number
  notes: string
}

/**
 * 解析一行 CSV（状态机，尊重双引号）。
 *
 * 不能按逗号硬切：`aliases` / `zh` 里可能出现被引号包住、内含逗号的值
 * （例如 `f4samurai` 的 `"f4samurai, Inc."`），硬切会整行解析失败并静默丢数据。
 *
 * @param line - 一行 CSV。
 * @returns 六个字段；字段不足时返回 undefined（该行跳过）。
 */
export function parseCsvLine(line: string): UpstreamRow | undefined {
  const fields: string[] = []
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

/**
 * 把一行转成库记录：中文名排第一，其余别名附后。
 *
 * @param row - 已解析的 CSV 行。
 * @param kind - 类别。
 */
export function rowToRecord(row: UpstreamRow, kind: TagKind): TagRecord {
  const names: string[] = []
  const seen = new Set<string>()
  const push = (name: string): void => {
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

/** 一次导入的结果。 */
export interface UpstreamResult {
  kind: TagKind
  /** 写入的记录数。 */
  records: number
  /** 其中有中文名或别名的条数。 */
  withNames: number
  /** CSV 字节数。 */
  bytes: number
  /** 被 `pruneSharedAliases` 去掉的共用别名个数。 */
  prunedAliases: number
  /** 解析失败被跳过的行数。 */
  skipped: number
  /** 落盘路径。 */
  file: string
  seconds: number
}

/**
 * 下载并导入一个类别。
 *
 * 只写**用户数据目录**（`ownStorePath`），绝不动随包数据 —— `writeStore` 里还有一层
 * 护栏会拒绝写进 `data/danbooru/`。
 *
 * @param kind - 要导入的类别。
 * @param options - 数据目录、日志与网络参数。
 * @returns 导入统计。
 */
export async function importUpstream(
  kind: TagKind,
  options: {
    dataDir: string
    log?: (message: string) => void
    /** 注入 fetch，便于测试与离线替换。 */
    fetchImpl?: typeof fetch
    timeoutMs?: number
  },
): Promise<UpstreamResult> {
  const started = Date.now()
  const file = UPSTREAM_FILES[kind]
  const doFetch = options.fetchImpl ?? fetch
  const res = await doFetch(`${UPSTREAM_BASE}/${file}`, {
    headers: { 'User-Agent': 'dsh-comfyui-workbench' },
    signal: AbortSignal.timeout(options.timeoutMs ?? 180_000),
  })
  if (!res.ok) throw new Error(`下载 ${file} 失败：HTTP ${res.status}`)

  const text = await res.text()
  const lines = text.replace(/^\uFEFF/, '').split('\n')
  const header = lines[0]
  if (header === undefined || !header.startsWith('tag,')) {
    throw new Error(`${file} 表头不符合预期：${String(header).slice(0, 40)}`)
  }

  const records: TagRecord[] = []
  let skipped = 0
  for (const line of lines.slice(1)) {
    if (line.trim() === '') continue
    const row = parseCsvLine(line)
    if (row === undefined) { skipped += 1; continue }
    // 只收与目标类别一致的行（上游一个文件本就只有一类，防御性判断）
    if (KIND_OF_CATEGORY[row.category] !== kind) continue
    if (row.tag === '') { skipped += 1; continue }
    records.push(rowToRecord(row, kind))
  }

  // 去掉被多条记录共用的别名：这份库的 aliases 里有大量 CP 名/组合名，
  // 不去重的话查「初音未来」会返回 20 条（19 条是同一个 tag 的各种变体）。
  const prunedAliases = pruneSharedAliases(records)
  const target = ownStorePath(options.dataDir, kind)
  writeStore(target, records)

  const result: UpstreamResult = {
    kind,
    records: records.length,
    withNames: records.filter(record => record.names.length > 0).length,
    bytes: Buffer.byteLength(text, 'utf8'),
    prunedAliases,
    skipped,
    file: target,
    seconds: Number(((Date.now() - started) / 1000).toFixed(1)),
  }
  options.log?.(`${kind}: ${result.records} 条入 ${path.basename(target)}（${result.seconds}s，去掉 ${prunedAliases} 个共用别名）`)
  return result
}
