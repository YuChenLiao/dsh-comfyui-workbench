/**
 * 姿势库的数据层：读随包目录、按条件筛、给面板与工具同一份结果。
 *
 * ## 数据从哪来
 *
 * `data/poses/catalog.json` 由 `scripts/import-poses.mjs` 从上游
 * （`anhao/ai-pose-gallery-zh` 的 `data/pose-zh.json`，原始素材出自 ギア / @giaaibusi）
 * 聚合而来：上游是 1439 条「姿势 × 角度」的扁平淡，这里聚成 288 组、每组 5 个角度。
 *
 * **只有名称、分类和图地址随包**，一张线稿都不带 —— 图在运行时经服务端代理按需读取。
 * 版权与使用限制写在 `data/poses/NOTICE.md`，改这份数据前先读那一份。
 *
 * ## 为什么这里不做倒排索引
 *
 * 标签库有 99372 条，必须建 2-gram；姿势只有 288 组，线性扫一遍是微秒级。
 * 给 288 条建索引是负优化 —— 先花时间建、再花内存存，换回一点谁也测不出来的收益。
 * 「上游怎么做的就照着做」不如先量一下规模。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { searchWithPrefixFallback } from '../../../shared/search/fallback.js'

/** 一组姿势（含它的所有角度）。 */
export interface PoseRecord {
  id: string
  systemId: string
  system: string
  code: string
  category: string
  name: string
  /** 成人向判定由导入脚本按体系与分类作出，不是这里猜的。 */
  adult: boolean
  views: PoseView[]
  /** 检索别名：分类的英文与中文同义词（由 import 脚本生成）。 */
  aliases?: string
}

/** 一个角度。 */
export interface PoseView {
  id: string
  /** 中文角度名（正面 / 斜侧 / 侧面 / 俯视 / 仰视）。 */
  angle: string
  /** 角度 id（front / diag / side / high / low），与图地址后缀一致。 */
  angleId: string
  /** 相对路径，如 `thumbs/full_single_P001_front.jpg`。 */
  thumb: string
  full: string
}

/** 随包目录的结构（与 `scripts/import-poses.mjs` 的输出一一对应）。 */
export interface PoseCatalog {
  version: number
  source: string
  upstream: string
  author: string
  origin: string
  attribution: string
  poseCount: number
  viewCount: number
  adultPoseCount: number
  systems: Array<{ id: string; name: string; adult: boolean; poseCount: number; viewCount: number }>
  categories: Record<string, number>
  poses: PoseRecord[]
}

/** 面板上的一条结果。 */
export interface PoseHit {
  id: string
  name: string
  system: string
  systemId: string
  code: string
  category: string
  adult: boolean
  /** 这个姿势有几个角度。 */
  viewCount: number
  /**
   * 实际存在哪些角度（`front` / `diag` / …）。
   *
   * 不能在前端写死五个：有一组只有 4 个角度，多列一个出来点下去就是 404 破图。
   */
  angleIds: string[]
  /** 正面那个角度的缩略/原图地址，列表直接用它做封面。 */
  cover: { viewId: string; thumb: string; full: string; angle: string }
}

export interface PoseSearchOptions {
  query?: string
  systemId?: string
  category?: string
  /**
   * **只看常规**（排除标了 `adult` 的 190 组）。默认 `false` —— 默认全给。
   *
   * 这是个可选的收窄，不是默认门槛：内容筛选是使用者自己的事，
   * 插件不该替他决定"你先看到什么"。
   */
  onlySafe?: boolean
  limit?: number
  offset?: number
}

export interface PoseSearchResult {
  items: PoseHit[]
  total: number
  /** 实际用来查的词（零命中时可能被逐字砍尾过）。 */
  usedQuery?: string
  /** 是否发生过前缀回退。 */
  fellBack?: boolean
  /** 回退时被砍掉的尾部。 */
  droppedTail?: string
}

export interface PoseStats {
  systems: Array<{ id: string; name: string; adult: boolean; poseCount: number; viewCount: number }>
  categories: Record<string, number>
  poseCount: number
  viewCount: number
  adultPoseCount: number
  /** 标了常规（非成人向）的组数。仅作统计，不是默认可见范围。 */
  safePoseCount: number
  attribution: string
  source: string
  origin: string
}

export interface PosesIndex {
  search: (options: PoseSearchOptions) => PoseSearchResult
  stats: () => PoseStats
  get: (id: string) => PoseRecord | undefined
  /** 按视角 id 找（`full_single_P001_front`），也接受姿势 id（回落到正面）。 */
  findView: (id: string) => { pose: PoseRecord; view: PoseView } | undefined
  invalidate: () => void
}

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 40

/**
 * 随包目录的位置：从本文件往上找到带 `package.json` 与 `data/` 的那层。
 *
 * 不用相对层数硬算 —— 源码跑（`src/`）与构建后跑（`lib/`）层数不同，
 * 写死 `../../..` 会在其中一种形态下指错地方，而那种错只有在真机上才暴露。
 */
export function bundledCatalogPath(fromUrl: string = import.meta.url): string {
  let dir = path.dirname(fileURLToPath(fromUrl))
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'data'))) {
      return path.join(dir, 'data', 'poses', 'catalog.json')
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return path.join(path.dirname(fileURLToPath(fromUrl)), '..', '..', '..', 'data', 'poses', 'catalog.json')
}

function readCatalog(file: string): PoseCatalog {
  const raw = fs.readFileSync(file, 'utf8')
  const parsed = JSON.parse(raw) as PoseCatalog
  if (!Array.isArray(parsed.poses) || parsed.poses.length === 0) throw new Error(`姿势目录为空或格式不对：${file}`)
  return parsed
}

/**
 * 建一个姿势索引。
 *
 * 数据文件变了会自动重建（比 mtime + size 的指纹），面板是常驻的，
 * 用户重跑导入脚本后不该还看到旧数据。
 */
export function createPosesIndex(dataDir: string, bundledFile?: string): PosesIndex {
  const bundled = bundledFile ?? bundledCatalogPath()
  let catalog: PoseCatalog | null = null
  let byPose = new Map<string, PoseRecord>()
  let byView = new Map<string, { pose: PoseRecord; view: PoseView }>()
  let stats: PoseStats | null = null
  let stamp = ''

  const fileOf = (): string => {
    const own = path.join(dataDir, 'poses', 'catalog.json')
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
    byPose = new Map()
    byView = new Map()
    stats = null
  }

  const ensure = (): PoseCatalog => {
    const now = stampOf()
    if (now !== stamp) {
      stamp = now
      reset()
    }
    if (catalog === null) {
      const loaded = readCatalog(fileOf())
      catalog = loaded
      for (const pose of loaded.poses) {
        byPose.set(pose.id, pose)
        for (const view of pose.views) byView.set(view.id, { pose, view })
      }
    }
    return catalog
  }

  const hitOf = (pose: PoseRecord): PoseHit => {
    const cover = pose.views.find(view => view.angleId === 'front') ?? pose.views[0]
    if (cover === undefined) throw new Error(`姿势 ${pose.id} 没有任何角度，目录数据坏了`)
    return {
      id: pose.id,
      name: pose.name,
      system: pose.system,
      systemId: pose.systemId,
      code: pose.code,
      category: pose.category,
      adult: pose.adult,
      viewCount: pose.views.length,
      angleIds: pose.views.map(view => view.angleId),
      cover: { viewId: cover.id, thumb: cover.thumb, full: cover.full, angle: cover.angle },
    }
  }

  const matches = (pose: PoseRecord, parts: string[]): boolean => {
    if (parts.length === 0) return true
    // aliases 是分类的英文与中文同义词（sitting / 躺 …），由 scripts/import-poses.mjs 生成 ——
    // 没有它，`sitting` / `standing` / `躺` 这些词永远零命中（数据只有中文分类词）
    const hay = `${pose.name} ${pose.code} ${pose.category} ${pose.system} ${pose.id} ${pose.aliases ?? ''}`.toLowerCase()
    return parts.every(part => hay.includes(part))
  }

  return {
    search: options => {
      const loaded = ensure()
      const query = (options.query ?? '').trim().toLowerCase()
      const parts = query === '' ? [] : query.split(/\s+/).filter(Boolean)
      const systemId = options.systemId ?? ''
      const category = options.category ?? ''
      const onlySafe = options.onlySafe === true
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT)
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0)

      const filterWith = (raw: string): PoseRecord[] => {
        const list: PoseRecord[] = []
        const split = raw.trim() === '' ? [] : raw.trim().toLowerCase().split(/\s+/).filter(Boolean)
        for (const pose of loaded.poses) {
          if (onlySafe && pose.adult) continue
          if (systemId !== '' && pose.systemId !== systemId) continue
          if (category !== '' && pose.category !== category) continue
          if (!matches(pose, split)) continue
          list.push(pose)
        }
        return list
      }

      // 零命中时逐字砍尾再试（`坐着` → `坐`）。回退过的词要回报给调用方，
      // 否则模型会以为这 58 条对应的是"坐着"。
      const outcome = searchWithPrefixFallback(query, filterWith)
      return {
        total: outcome.list.length,
        items: outcome.list.slice(offset, offset + limit).map(hitOf),
        usedQuery: outcome.usedQuery,
        fellBack: outcome.fellBack,
        droppedTail: outcome.droppedTail,
      }
    },
    stats: () => {
      const loaded = ensure()
      if (stats !== null) return stats
      stats = {
        systems: loaded.systems,
        categories: loaded.categories,
        poseCount: loaded.poseCount,
        viewCount: loaded.viewCount,
        adultPoseCount: loaded.adultPoseCount,
        safePoseCount: loaded.poses.filter(pose => !pose.adult).length,
        attribution: loaded.attribution,
        source: loaded.source,
        origin: loaded.origin,
      }
      return stats
    },
    get: id => {
      ensure()
      return byPose.get(id)
    },
    findView: id => {
      ensure()
      const direct = byView.get(id)
      if (direct !== undefined) return direct
      // 也接受姿势 id：面板点「复制」时给的是组，取正面那张
      const pose = byPose.get(id)
      if (pose === undefined) return undefined
      const view = pose.views.find(item => item.angleId === 'front') ?? pose.views[0]
      return view === undefined ? undefined : { pose, view }
    },
    invalidate: () => {
      reset()
      stamp = ''
    },
  }
}
