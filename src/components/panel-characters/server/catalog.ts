/**
 * 角色库：AI 娘设定图（三视图 / 表情 / 服装 / 道具）。
 *
 * 与姿势库、衣装库同一套模式：随包只带元数据（`data/characters/catalog.json`），
 * 图片由 `createImageCache` 运行时按需代理、落本机缓存、不再分发。
 *
 * 三个库的差别在「一个条目挂几张图」：姿势是「一组多角度」，衣装是「一套一张」，
 * 角色是「一个角色五个固定槽位」。所以这里的检索单位是角色，取图要 `id + slot`
 * 两个参数 —— 只给 id 不知道你要三视图还是表情。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 一个角色某个槽位的图。`bytes` 来自导入期，仅用于展示与上限判断。 */
export interface CharacterSlot {
  path: string
  bytes: number
  label: string
}

export interface CharacterRecord {
  id: string
  dir: string
  name: string
  subtitle: string
  alt: string
  brand: string
  preview: string
  slots: Record<string, CharacterSlot>
}

export interface CharacterCatalog {
  version: number
  source: string
  upstream: string
  commit: string
  origin: string
  license: string
  attribution: string
  note: string
  characterCount: number
  categories: Record<string, number>
  characters: CharacterRecord[]
}

/** 列表项：不带完整路径，只给能画卡片的信息。 */
export interface CharacterHit {
  id: string
  name: string
  subtitle: string
  brand: string
  alt: string
  /** 缩略图（webp，约 40 KB）。 */
  preview: string
  /** 有哪些槽位，面板据此决定显示几个按钮。 */
  slots: string[]
}

export interface CharacterSearchOptions {
  query?: string
  brand?: string
  limit?: number
  offset?: number
}

export interface CharacterSearchResult {
  items: CharacterHit[]
  total: number
}

export interface CharacterStats {
  characterCount: number
  brands: Record<string, number>
  slotCount: number
  license: string
  attribution: string
  source: string
  origin: string
  commit: string
}

export interface CharactersIndex {
  search: (options: CharacterSearchOptions) => CharacterSearchResult
  stats: () => CharacterStats
  get: (id: string) => CharacterRecord | undefined
  /** 取某角色某槽位的相对路径。槽位不存在时返回 undefined。 */
  slotOf: (id: string, slot: string) => CharacterSlot | undefined
  invalidate: () => void
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 40

/** 随包目录：往上找带 `package.json` 与 `data/` 的那层（源码与构建后层数不同）。 */
export function bundledCharacterCatalogPath(fromUrl: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'data'))) {
      return path.join(dir, 'data', 'characters', 'catalog.json')
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(path.dirname(fileURLToPath(fromUrl)), '..', '..', '..', 'data', 'characters', 'catalog.json')
}

function readCatalog(file: string): CharacterCatalog {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CharacterCatalog
  if (!Array.isArray(parsed.characters) || parsed.characters.length === 0) {
    throw new Error(`角色目录为空或格式不对：${file}`)
  }
  return parsed
}

/**
 * 建角色索引。
 *
 * 与姿势库同样的做法：目录文件变了（mtime + size 指纹）就重建，面板是常驻的，
 * 重跑导入脚本后不该还看到旧数据。
 */
export function createCharactersIndex(dataDir: string, bundledFile?: string): CharactersIndex {
  const bundled = bundledFile ?? bundledCharacterCatalogPath()
  let catalog: CharacterCatalog | null = null
  let byId = new Map<string, CharacterRecord>()
  let stats: CharacterStats | null = null
  let stamp = ''

  const fileOf = (): string => {
    const own = path.join(dataDir, 'characters', 'catalog.json')
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

  const ensure = (): CharacterCatalog => {
    const now = stampOf()
    if (now !== stamp) {
      stamp = now
      reset()
    }
    if (catalog === null) {
      const loaded = readCatalog(fileOf())
      catalog = loaded
      for (const item of loaded.characters) byId.set(item.id, item)
    }
    return catalog
  }

  const hitOf = (item: CharacterRecord): CharacterHit => ({
    id: item.id,
    name: item.name,
    subtitle: item.subtitle,
    brand: item.brand,
    alt: item.alt,
    preview: item.preview,
    slots: Object.keys(item.slots),
  })

  const matches = (item: CharacterRecord, parts: string[]): boolean => {
    if (parts.length === 0) return true
    // `alt` 里是「智谱 GLM 娘（阔耳狐娘）的横版设定图」这类完整描述，
    // 搜索「狐娘」「阔耳」都能命中 —— 光靠 name 是搜不到副标题里的词的。
    const hay = `${item.name} ${item.subtitle} ${item.brand} ${item.alt} ${item.id}`.toLowerCase()
    return parts.every(part => hay.includes(part))
  }

  return {
    search: options => {
      const loaded = ensure()
      const query = (options.query ?? '').trim().toLowerCase()
      const parts = query === '' ? [] : query.split(/\s+/).filter(Boolean)
      const brand = options.brand ?? ''
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0)

      const list = loaded.characters.filter(item => {
        if (brand !== '' && item.brand !== brand) return false
        return matches(item, parts)
      })

      return { total: list.length, items: list.slice(offset, offset + limit).map(hitOf) }
    },
    stats: () => {
      const loaded = ensure()
      if (stats === null) {
        const brands: Record<string, number> = {}
        let slotCount = 0
        for (const item of loaded.characters) {
          brands[item.brand] = (brands[item.brand] ?? 0) + 1
          slotCount += Object.keys(item.slots).length
        }
        stats = {
          characterCount: loaded.characters.length,
          brands,
          slotCount,
          license: loaded.license,
          attribution: loaded.attribution,
          source: loaded.source,
          origin: loaded.origin,
          commit: loaded.commit,
        }
      }
      return stats
    },
    get: id => {
      ensure()
      return byId.get(id)
    },
    slotOf: (id, slot) => {
      ensure()
      return byId.get(id)?.slots[slot]
    },
    invalidate: () => {
      reset()
      stamp = ''
    },
  }
}
