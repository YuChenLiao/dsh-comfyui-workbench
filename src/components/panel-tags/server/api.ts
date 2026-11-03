import fs from 'node:fs'

/**
 * 标签面板的数据层：搜索、分类计数、按大类筛。
 *
 * 复用 `danbooru_lookup` 那套数据与索引（93 类共 99372 条 + 91 个分组的
 * 15064 条分类），差别只在呈现：工具只要 tag，面板要 tag + 中文名 + 别名 + 热度。
 *
 * 索引与计数都是懒加载一次、`invalidate()` 后重建 —— 面板每敲一个字都查一次，
 * 每次重读 20 MB JSONL 是不行的。
 */
import { categoryMapPath, categoryOf, groupsPath, readCategoryMap, readGroups } from '../../tool-danbooru/server/groups.js'
import type { CategoryMap } from '../../tool-danbooru/server/groups.js'
import { readStore, storePath, TAG_KINDS } from '../../tool-danbooru/server/store.js'
import type { TagKind, TagRecord } from '../../tool-danbooru/server/store.js'
import { TagIndex } from '../../tool-danbooru/server/tag-index.js'

/** 面板上的一行。 */
export interface TagHit {
  tag: string
  kind: TagKind
  postCount: number
  /** 中文名（没有就是空串）。 */
  zh: string
  /** 除中文名以外的别名，最多几个够看。 */
  aliases: string[]
  /** 大类 key（`action` / `clothing` …），归不了就是 `other`。 */
  category: string
  /** Danbooru 的原始组名，用于显示"它属于哪个 wiki 分组"。 */
  groups: string[]
}

/** 一次查询的结果。 */
export interface TagSearchResult {
  items: TagHit[]
  /** 命中总数（不受 limit 限制）。 */
  total: number
}

/** 面板初始化时要的统计。 */
export interface TagStats {
  /** 四类各多少条。 */
  kinds: Record<string, number>
  /** 各大类多少条（只统计能归类的；`other` 含归不了的）。 */
  categories: Record<string, number>
  /** 大类 key → 中文名。 */
  labels: Record<string, string>
  /** 总条数。 */
  total: number
}

/** 面板用的标签索引。 */
export interface TagsIndex {
  search: (options: { query?: string; kind?: string; category?: string; limit?: number; offset?: number }) => TagSearchResult
  stats: () => TagStats
  invalidate: () => void
}

/** 单次查询最多返回多少条。 */
const MAX_LIMIT = 100
/** 面板一次显示多少条。 */
const DEFAULT_LIMIT = 50

/**
 * 建一个面板用的索引。
 *
 * **数据变了要自动重建**：面板是常驻的，用户跑完 `danbooru:zh` 或
 * `danbooru:groups` 之后不该还看到旧数据。所以每次查询前比一次源文件的
 * mtime+size（5 次 stat，可忽略），变了就丢掉重建 —— 而不是指望谁记得调
 * `invalidate()`（早先它根本没有生产调用点，三处注释都在说一句没人做的事）。
 *
 * @param dataDir - 插件数据目录。
 */
export function createTagsIndex(dataDir: string): TagsIndex {
  let records: TagRecord[] | null = null
  let index: TagIndex<TagRecord> | null = null
  let groups: Map<string, string[]> | null = null
  let map: CategoryMap | null = null
  let stats: TagStats | null = null
  /** 上次建索引时源文件的指纹。 */
  let stamp = ''

  /**
   * 源文件指纹。
   *
   * 读不到的条目记 `-`：文件不存在本身就是一种状态（用户可能删了运行时的副本）。
   */
  const stampOf = (): string => {
    const files = [
      ...TAG_KINDS.map(kind => storePath(dataDir, kind)),
      groupsPath(dataDir),
      categoryMapPath(dataDir),
    ]
    return files.map(file => {
      try {
        const stat = fs.statSync(file)
        return `${stat.mtimeMs}:${stat.size}`
      } catch {
        return '-'
      }
    }).join('|')
  }

  const reset = (): void => {
    records = null
    index = null
    groups = null
    map = null
    stats = null
  }

  const ensure = (): { records: TagRecord[]; index: TagIndex<TagRecord>; groups: Map<string, string[]>; map: CategoryMap } => {
    const now = stampOf()
    if (now !== stamp) {
      stamp = now
      reset()
    }
    if (records === null || index === null || groups === null || map === null) {
      const loaded: TagRecord[] = []
      for (const kind of TAG_KINDS) loaded.push(...readStore(storePath(dataDir, kind)))
      records = loaded
      index = new TagIndex(loaded)
      groups = readGroups(dataDir)
      map = readCategoryMap(dataDir)
    }
    return { records, index, groups, map }
  }

  const categoryOfTag = (tag: string, groups: Map<string, string[]>, map: CategoryMap): string =>
    categoryOf(groups.get(tag) ?? [], map)

  return {
    search: options => {
      const { index: idx, groups: groupMap, map: categoryMap } = ensure()
      const query = (options.query ?? '').trim()
      const kind = options.kind ?? ''
      const category = options.category ?? ''
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0)

      // 空查询时也给结果（按热度排），否则面板一打开就是一片空白
      const candidates = query === ''
        ? ensure().records
        : idx.search(query, Number.MAX_SAFE_INTEGER).map(match => match.record as TagRecord)

      const filtered = candidates.filter(record => {
        if (kind !== '' && record.kind !== kind) return false
        if (category !== '') return categoryOfTag(record.tag, groupMap, categoryMap) === category
        return true
      })

      // 空查询按热度排；有查询时 `TagIndex` 已按档位排好，保持原序
      if (query === '') filtered.sort((a, b) => b.postCount - a.postCount)

      return {
        total: filtered.length,
        items: filtered.slice(offset, offset + limit).map(record => toHit(record, groupMap, categoryMap)),
      }
    },
    stats: () => {
      const { records: all, groups: groupMap, map: categoryMap } = ensure()
      if (stats !== null) return stats
      const kinds: Record<string, number> = {}
      const categories: Record<string, number> = {}
      for (const record of all) {
        kinds[record.kind] = (kinds[record.kind] ?? 0) + 1
        const category = categoryOfTag(record.tag, groupMap, categoryMap)
        categories[category] = (categories[category] ?? 0) + 1
      }
      stats = { kinds, categories, labels: categoryMap.labels, total: all.length }
      return stats
    },
    invalidate: () => {
      reset()
      // 指纹也清掉：下次 ensure 会无条件重建，而不是拿旧指纹比出"没变"
      stamp = ''
    },
  }
}

/** 把一条记录转成面板要的形状。 */
function toHit(record: TagRecord, groups: Map<string, string[]>, map: CategoryMap): TagHit {
  const groupList = groups.get(record.tag) ?? []
  return {
    tag: record.tag,
    kind: record.kind,
    postCount: record.postCount,
    zh: record.names[0] ?? '',
    aliases: record.names.slice(1, 4),
    category: categoryOf(groupList, map),
    groups: groupList,
  }
}
