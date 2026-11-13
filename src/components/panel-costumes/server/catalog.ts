/**
 * 服装库的数据层。
 *
 * 与姿势库同构（元数据随包、图不随包），但有两处不同：
 * - **一条一套**，没有"组 + 角度"这层（服装是单张平铺图）
 * - **自带英文关键词**（`ivory frill knit denim mini skirt…`），可以直接拼进提示词。
 *   这是这套数据相对姿势库多出来的价值，所以搜索会把它当主字段之一。
 *
 * 索引同样不做倒排：1407 条线性扫是毫秒级，建 2-gram 是负优化。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { searchWithPrefixFallback } from '../../../shared/search/fallback.js'

/** 一套服装。 */
export interface CostumeItem {
  id: string
  category: string
  /** 中文完整描述（"象牙白荷叶边针织衫・牛仔迷你半身裙・大衣…"）。 */
  name: string
  /** 中文标签。 */
  tags: string[]
  /** 英文关键词串，可直接写进提示词。 */
  keywords: string
  /** 成人向标记。只用于标注与可选收窄，不是默认过滤器。 */
  adult: boolean
  thumb: string
  preview: string
  full: string
}

export interface CostumeCatalog {
  version: number
  source: string
  upstream: string
  author: string
  origin: string
  attribution: string
  total: number
  adultCount: number
  categories: Record<string, number>
  items: CostumeItem[]
}

export interface CostumeSearchOptions {
  query?: string
  category?: string
  /** 只看常规（排除内衣/泳装/性感三个分类）。默认 false，全给。 */
  onlySafe?: boolean
  limit?: number
  offset?: number
}

export interface CostumeSearchResult {
  items: CostumeItem[]
  total: number
  /** 实际用来查的词（零命中时可能被逐字砍尾过）。 */
  usedQuery?: string
  /** 是否发生过前缀回退。 */
  fellBack?: boolean
  /** 回退时被砍掉的尾部。 */
  droppedTail?: string
}

export interface CostumeStats {
  total: number
  adultCount: number
  /** 标了常规（非成人向）的套数。仅作统计，不是默认可见范围。 */
  safeCount: number
  categories: Record<string, number>
  attribution: string
  source: string
  origin: string
}

export interface CostumesIndex {
  search: (options: CostumeSearchOptions) => CostumeSearchResult
  stats: () => CostumeStats
  get: (id: string) => CostumeItem | undefined
  invalidate: () => void
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 40

/** 随包目录位置：往上找带 `package.json` 与 `data/` 的那层（source 与 lib 层数不同）。 */
/**
 * 随包数据的相对目录。
 *
 * `costumes` 是写实版（1407 套），`costumes-anime` 是动画版（1320 套）——
 * 两者同一个作者、同一套规格（不含人物的衣装搭配），只是画风不同。
 */
export type CostumeStyle = 'real' | 'anime'

/** 每个库对应的随包目录名（`data/<dir>/catalog.json`）。 */
const STYLE_DIR: Record<CostumeStyle, string> = { real: 'costumes', anime: 'costumes-anime' }

export function bundledCostumePath(fromUrl: string = import.meta.url, style: CostumeStyle = 'real'): string {
  let dir = path.dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'data'))) {
      return path.join(dir, 'data', STYLE_DIR[style], 'catalog.json')
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(path.dirname(fileURLToPath(fromUrl)), '..', '..', '..', 'data', 'costumes', 'catalog.json')
}

function readCatalog(file: string): CostumeCatalog {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CostumeCatalog
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error(`服装目录为空或格式不对：${file}`)
  return parsed
}

/**
 * 建一个服装索引。
 *
 * 插件数据目录里的副本优先（用户自己跑过导入就用它），回退随包快照；
 * 文件变了按 mtime + size 指纹自动重建。
 */
export function createCostumesIndex(dataDir: string, bundledFile?: string, style: CostumeStyle = 'real'): CostumesIndex {
  const bundled = bundledFile ?? bundledCostumePath(import.meta.url, style)
  let catalog: CostumeCatalog | null = null
  let byId = new Map<string, CostumeItem>()
  let stats: CostumeStats | null = null
  let stamp = ''

  const fileOf = (): string => {
    const own = path.join(dataDir, STYLE_DIR[style], 'catalog.json')
    return fs.existsSync(own) ? own : bundled
  }

  const stampOf = (): string => {
    try {
      const stat = fs.statSync(fileOf())
      return `${stat.mtimeMs}:${stat.size}`
    } catch {
      return '-'
    }
  }

  const reset = (): void => {
    catalog = null
    byId = new Map()
    stats = null
  }

  const ensure = (): CostumeCatalog => {
    const now = stampOf()
    if (now !== stamp) {
      stamp = now
      reset()
    }
    if (catalog === null) {
      const loaded = readCatalog(fileOf())
      catalog = loaded
      for (const item of loaded.items) byId.set(item.id, item)
    }
    return catalog
  }

  /** 一条记录的可检索文本：编号、分类、中文名、标签、英文关键词都算。 */
  const haystack = (item: CostumeItem): string =>
    `${item.id} ${item.category} ${item.name} ${item.tags.join(' ')} ${item.keywords}`.toLowerCase()

  return {
    search: options => {
      const loaded = ensure()
      const query = (options.query ?? '').trim().toLowerCase()
      const parts = query === '' ? [] : query.split(/\s+/).filter(Boolean)
      const category = options.category ?? ''
      const onlySafe = options.onlySafe === true
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0)

      const filterWith = (raw: string): CostumeItem[] => {
        const list: CostumeItem[] = []
        const split = raw.trim() === '' ? [] : raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
        for (const item of loaded.items) {
          if (onlySafe && item.adult) continue
          if (category !== '' && item.category !== category) continue
          if (split.length > 0) {
            const hay = haystack(item)
            if (!split.every(part => hay.includes(part))) continue
          }
          list.push(item)
        }
        return list
      }

      // 零命中时逐字砍尾再试（`白裙子` → `白`）。回退过的词要回报给调用方。
      const outcome = searchWithPrefixFallback(query, filterWith)
      return {
        total: outcome.list.length,
        items: outcome.list.slice(offset, offset + limit),
        usedQuery: outcome.usedQuery,
        fellBack: outcome.fellBack,
        droppedTail: outcome.droppedTail,
      }
    },
    stats: () => {
      const loaded = ensure()
      if (stats !== null) return stats
      stats = {
        total: loaded.total,
        adultCount: loaded.adultCount,
        safeCount: loaded.items.filter(item => !item.adult).length,
        categories: loaded.categories,
        attribution: loaded.attribution,
        source: loaded.source,
        origin: loaded.origin,
      }
      return stats
    },
    get: id => {
      ensure()
      return byId.get(id)
    },
    invalidate: () => {
      reset()
      stamp = ''
    },
  }
}
