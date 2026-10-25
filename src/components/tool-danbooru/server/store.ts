import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { foldPathCase } from '../../../shared/host/paths.js'

/** 一个收录的标签：Danbooru 原始 tag + 它的中文/别名。 */
export interface TagRecord {
  /** Danbooru 上的 tag 名（下划线形式，如 `hatsune_miku`）。 */
  tag: string
  /** 角色还是画师。 */
  kind: 'character' | 'artist'
  /** Danbooru 帖子数，用来排序与判断热门程度。 */
  postCount: number
  /** 该 tag 的其它写法（中文、繁体、罗马音、日文假名等），已去重、去掉空串。 */
  names: string[]
  /** 上次同步时间（ISO）。 */
  updatedAt: string
}

/** 中日韩文字：用来从 other_names 里挑出"非英文"的那些。 */
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/

/**
 * 判断一个别名是否值得收录。
 *
 * Danbooru 的 `other_names` 里混着大量噪音：二创活动名（`初音ミク誕生祭2014`）、
 * 组合 CP 名（`レンミク`）、纯英文变体（`hatsunemiku`）。只留含中日韩文字的，
 * 且长度不过分（超过 16 字的多半是活动名而不是称呼）。
 *
 * @param name - 候选别名。
 * @param tag - 该 tag 自己的名字（同名的不必重复收录）。
 */
export function worthKeeping(name: string, tag: string): boolean {
  const value = name.trim()
  if (value === '' || value.length > 16) return false
  if (value.toLowerCase() === tag.toLowerCase()) return false
  if (!CJK.test(value)) return false
  // 汉字与日文假名都收：没有中文名时，日文原名就是最有用的替代（用户明确要求）。
  // CP 名不靠字符规则拦 —— 那会把 `初音ミク` 一起砍掉；改用跨记录去重（见 pruneSharedAliases）。
  // 形如 `初音ミク誕生祭2014` 的活动名：结尾带年份
  if (/(19|20)\d{2}$/.test(value)) return false
  // 保守的字符过滤：只挡一眼就是组合名的（带分隔符、字面含 cp/攻受）。
  // 主判据是跨记录共用检测（pruneSharedAliases）—— 纯假名的 `レイマリ` 靠这里拦不住。
  if (/[×✕✖&+＋/~～]/.test(value)) return false
  if (/(cp|攻|受|cross)/i.test(value)) return false
  // 只挡"完全就是一个关系词"的（`兄`、`妹` 这类单独成名的），
  // 像 `寒色兄妹` 这种复合词仍会漏进来 —— 已知噪音，靠下面的共用别名去重清掉大半。
  if (/^(兄|妹|姉|弟|父|母|親|子|友|敵|相方|コンビ)$/.test(value)) return false
  return true
}

/**
 * 从 wiki 的 `other_names` 里挑出可用的别名。
 *
 * @param tag - Danbooru tag 名。
 * @param otherNames - wiki 页给的别名列表。
 */
export function pickNames(tag: string, otherNames: readonly string[] | undefined): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of otherNames ?? []) {
    if (typeof raw !== 'string') continue
    if (!worthKeeping(raw, tag)) continue
    const key = raw.trim().toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw.trim())
  }
  // 中文排在日文/韩文前面：模型与用户更常按中文名找，列表第一个应当是它。
  // 纯汉字（无假名）视为中文；`初音ミク` 这种混写排后面，但仍保留 —— 它也是有效别名。
  const isChinese = (value: string): boolean => /[一-鿿]/.test(value) && !/[぀-ヿ가-힯]/.test(value)
  return out.sort((a, b) => Number(isChinese(b)) - Number(isChinese(a)))
}

/** 数据目录：`<插件数据目录>/danbooru`。 */
export function danbooruDir(dataDir: string): string {
  return path.join(dataDir, 'danbooru')
}

/**
 * 包内自带的标签库目录。
 *
 * 数据来自 danbooru-tags-data-zh（MIT），随包分发，装好就能查、不必先联网同步。
 * 用户跑过 `danbooru:zh` 或 `danbooru:sync` 之后，数据目录里的那份会覆盖它。
 */
export function bundledDir(): string {
  // 起点必须是**本文件所在目录**，不能用 process.cwd() —— 装好之后 cwd 是用户的项目目录，
  // 从那里向上根本找不到 data/danbooru（曾因此让"装好即用"形同虚设）。
  // 产物是 ESM，没有 `__dirname`，用 import.meta.url 换算。
  // 也不能写死相对层级：这段代码会被内联到 lib/index.js 与 lib/entries/*.js，两者深度不同。
  const start = path.dirname(fileURLToPath(import.meta.url))
  let dir = start
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path.join(dir, 'data', 'danbooru')
    if (fs.existsSync(candidate)) return candidate
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(start, '..', '..', '..', '..', 'data', 'danbooru')
}

/**
 * 某一类的 JSONL 路径。
 *
 * 优先用户数据目录（可能被同步/导入更新过），没有则回退到包内自带那份。
 *
 * @param dataDir - 插件数据目录。
 * @param kind - 角色或画师。
 */
export function ownStorePath(dataDir: string, kind: 'character' | 'artist'): string {
  return path.join(danbooruDir(dataDir), `${kind}s.jsonl`)
}

/**
 * 读取用的路径：优先用户数据目录，没有则回退到包内自带那份。
 *
 * **写入绝不能用它** —— 回退到包内会让同步/导入把随包数据覆盖掉
 * （测试里一个空目录就能把 7MB 的库写成一条假记录）。写请用 `ownStorePath`。
 *
 * @param dataDir - 插件数据目录。
 * @param kind - 角色或画师。
 */
export function storePath(dataDir: string, kind: 'character' | 'artist'): string {
  const own = ownStorePath(dataDir, kind)
  if (fs.existsSync(own)) return own
  const bundled = path.join(bundledDir(), `${kind}s.jsonl`)
  return fs.existsSync(bundled) ? bundled : own
}

/**
 * 读整份 JSONL。
 *
 * 坏行直接跳过：这份文件由同步流程追加写入，中途被打断时末尾可能是半行。
 *
 * @param file - JSONL 路径。
 */
/** 模块级缓存：包内数据有 7 MB，反复解析会让每次查询都卡上一秒。 */
const storeCache = new Map<string, { mtimeMs: number; size: number; records: TagRecord[] }>()

export function readStore(file: string): TagRecord[] {
  if (!fs.existsSync(file)) return []
  try {
    const stat = fs.statSync(file)
    const hit = storeCache.get(file)
    if (hit !== undefined && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.records
    const parsed = parseStore(file)
    storeCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, records: parsed })
    return parsed
  } catch {
    return []
  }
}

function parseStore(file: string): TagRecord[] {
  const out: TagRecord[] = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const text = line.trim()
    if (text === '') continue
    try {
      const record = JSON.parse(text) as TagRecord
      if (typeof record.tag !== 'string' || record.tag === '') continue
      // names 必须是字符串数组：坏数据放过去，查询时的 .map 会直接把工具打崩
      if (!Array.isArray(record.names)) record.names = []
      record.names = record.names.filter((name): name is string => typeof name === 'string')
      out.push(record)
    } catch {
      // 半行或损坏，跳过
    }
  }
  return out
}

/**
 * 整份重写（同步是"全量替换"，不做增量合并）。
 *
 * 先写临时文件再 rename：中途失败不会留下半个文件。
 *
 * @param file - JSONL 路径。
 * @param records - 全部记录。
 */
export function writeStore(file: string, records: readonly TagRecord[]): void {
  // 护栏：绝不允许写进随包数据。曾经因为 storePath 会"回退到包内"，
  // 测试里的 writeStore(storePath(...)) 把 12 MB 的库覆盖成了一条假记录。
  // 用折叠大小写后的前缀判定：Windows 上 data/Danbooru/ 与 data/danbooru/ 是同一处，
  // 只比'父目录相等'会被大小写变体绕过（实测把 data/Danbooru/characters.jsonl 写成了空文件）。
  const guard = foldPathCase(path.resolve(path.dirname(file)));
  const bundled = foldPathCase(path.resolve(bundledDir()));
  if (guard === bundled || guard.startsWith(bundled + path.sep)) {
    throw new Error(`拒绝写入随包数据目录：${file}（写入请用 ownStorePath）`)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  // 带上 pid 与时间戳：两个进程同时同步时不会互踩同一个临时文件
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  const body = records.map(record => JSON.stringify(record)).join('\n')
  fs.writeFileSync(tmp, body === '' ? '' : `${body}\n`, 'utf8')
  fs.renameSync(tmp, file)
}

/** 一条匹配结果，附上命中的原因。 */
export interface Match {
  record: TagRecord
  /**
   * 命中方式。`tag` 表示直接命中 tag 名本身（最强），
   * `exact` 是别名精确命中 —— 分清这两者很重要：查 `wlop` 应当先给 `wlop` 这个 tag，
   * 而不是某个别名里含 wlop、热度却更高的 tag。
   */
  how: 'tag' | 'exact' | 'prefix' | 'contains'
}

/**
 * 按关键词查标签。
 *
 * 同时支持中文名与 Danbooru tag：`初音未来`、`初音ミク`、`hatsune_miku` 都能命中。
 * 排序：精确 > 前缀 > 包含，同档按帖子数降序。
 *
 * @param records - 已加载的记录。
 * @param query - 用户给的关键词。
 * @param limit - 最多返回几条。
 */
export function searchTags(records: readonly TagRecord[], query: string, limit = 10): Match[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  // 空格与下划线等价：`hatsune miku` 与 `hatsune_miku` 应当都能命中
  const loose = needle.replace(/[\s_]+/g, '_')
  const spaced = needle.replace(/[_\s]+/g, ' ')

  const matches: Match[] = []
  for (const record of records) {
    const tagName = record.tag.toLowerCase()
    const tagNormalized = tagName.replace(/[\s_]+/g, '_')
    let best: Match['how'] | undefined
    // tag 名本身命中排最前
    if (tagName === needle || tagNormalized === loose) best = 'tag'
    else if (tagName.startsWith(needle) || tagNormalized.startsWith(loose)) best = 'prefix'
    else if (tagName.includes(needle) || tagNormalized.includes(loose)) best = 'contains'

    // tag 名只是"前缀"或"包含"命中时，别名可能精确命中 —— 那档更该优先
    // （`hatsune_miku` 的别名里有 `miku`，查 miku 应当把它提上来）。
    if (best === undefined || best === 'prefix' || best === 'contains') {
      for (const name of record.names) {
        const candidate = name.toLowerCase()
        const normalized = candidate.replace(/[\s_]+/g, '_')
        if (candidate === needle || normalized === loose) { best = 'exact'; break }
        if (candidate.startsWith(needle) || normalized.startsWith(loose)) {
          if (best === undefined) best = 'prefix'
          continue
        }
        if (candidate.includes(needle) || candidate.includes(spaced)) {
          if (best === undefined) best = 'contains'
        }
      }
    }
    if (best !== undefined) matches.push({ record, how: best })
  }

  const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 }

  matches.sort((a, b) => (rank[a.how] - rank[b.how]) || (b.record.postCount - a.record.postCount))
  return matches.slice(0, limit)
}


/**
 * 去掉「共享别名」的歧义。
 *
 * 同一个别名可能挂在不同 tag 上，成因有两类：
 * - **CP / 组合名**：`レイマリ` 分属灵梦与魔理沙 —— 查询时会出现"一个名字查出两个人、都标精确"。
 * - **同一角色的不同命名**：`散兵` 同时挂在 `scaramouche_(genshin_impact)` 和它的别名 tag 上。
 *
 * 两类都靠"谁还在用"来判会出错（后者会被误当成不同角色），所以统一处理：
 * **只保留在热度最高的那条记录上**。这样每个别名最多对应一条结果 —— 查得到，
 * 又不会出现两个 exact。CP 名会归到更热的那一方，属于可接受的取舍。
 *
 * @param records - 要去重的记录（原地修改 `names`）。
 * @returns 被去掉的别名个数。
 */
export function pruneSharedAliases(records: TagRecord[]): number {
  const owners = new Map<string, TagRecord[]>()
  for (const record of records) {
    for (const name of record.names) {
      const key = name.toLowerCase()
      const list = owners.get(key)
      if (list === undefined) owners.set(key, [record])
      else list.push(record)
    }
  }

  let removed = 0
  for (const [name, list] of owners) {
    if (list.length < 2) continue
    const keeper = list.reduce((best, record) => (record.postCount > best.postCount ? record : best), list[0] as TagRecord)
    for (const record of list) {
      if (record === keeper) continue
      const before = record.names.length
      record.names = record.names.filter(item => item.toLowerCase() !== name)
      removed += before - record.names.length
    }
  }
  return removed
}
