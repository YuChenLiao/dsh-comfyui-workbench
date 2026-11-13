/**
 * 组件：服装参考库（面板 + 模型工具）。
 *
 * 1407 套现实风格衣装（图里没有人物），来自 ギア 的 COSTUME-DB-01，
 * 中文名与英文关键词由 Anhao 的中文版镜像维护。
 *
 * ## 与姿势库的关系
 *
 * 同一套接入方式（元数据随包、图经服务端代理按需取），共用同一个取图实现
 * （`createImageCache`），只是换了路径白名单（多一层 `costume/`、格式是 webp）
 * 与缓存目录。**没有再写一份缓存/单飞/冷却逻辑** —— 那些复制一遍必然漂移。
 *
 * ## 数据
 *
 * `data/costumes/catalog.json` 只有编号、中文描述、中文标签、**英文关键词**与图地址。
 * 一张图都不在仓库里；著作权与使用限制见 `data/costumes/NOTICE.md`。
 */
import fs from 'node:fs'
import path from 'node:path'

import { createCostumeRoutes } from '../components/panel-costumes/server/routes.js'
import { bundledCostumePath, createCostumesIndex } from '../components/panel-costumes/server/catalog.js'
import { costumeTool } from '../components/panel-costumes/server/tools.js'
import type { CostumesIndex } from '../components/panel-costumes/server/catalog.js'
import { createImageCache } from '../components/panel-poses/server/images.js'
import type { PoseImages } from '../components/panel-poses/server/images.js'
import { resolveSettings } from '../shared/host/config.js'
import { pluginDataDir } from '../shared/host/paths.js'
import type { HostContext } from '../shared/host/types.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:costumes'

export const inject = ['webServer', 'workspaceRegistry', 'tools']

/** 组件 id，可单独关（`disabledComponents: ['panel.costumes']`）。 */
export const COMPONENT = 'panel.costumes'

/**
 * 服装图的路径白名单。**与 `scripts/import-costumes.mjs` 那条必须逐字一致。**
 *
 * 与姿势库那条的差别：多一层 `costume/`、id 带连字符、格式是 webp。
 */
export const COSTUME_PATH = /^(thumbs|img)\/costume\/[A-Za-z0-9_-]+\.webp$/

/**
 * 动画版服装图的路径白名单。**与 `scripts/import-costumes-anime.mjs` 那条必须逐字一致。**
 *
 * 与写实版的差别：**少一层 `costume/`**，而且原图是 **png** 不是 webp。
 */
export const COSTUME_ANIME_PATH = /^(thumbs|img)\/[A-Z]+-\d+\.webp$|^png\/[A-Z]+-\d+\.png$/

/** 动画版原站（与写实版不是同一个域）。 */
export const COSTUME_ANIME_ORIGIN = 'https://ai-costume-anime-gallery.pages.dev'

/**
 * 索引与取图器的模块级单例（理由同姿势库：apply 重跑不该把冷却与缓存清零）。
 *
 * 两个库各一份：写实版与动画版**原站不同、路径白名单不同、缓存目录也不同** ——
 * 混用一份的话，动画版的 png 会被写实版的 webp 白名单挡掉，反之亦然。
 */
interface Store { index: CostumesIndex; images: PoseImages; uploadsDir: () => string }
let realSingleton: { key: string; store: Store } | null = null
let animeSingleton: { key: string; store: Store } | null = null

function realStore(dataDir: string, origin: string, uploadsDir: () => string): Store {
  const key = `${dataDir}|${origin}`
  if (realSingleton !== null && realSingleton.key === key) return realSingleton.store
  const index = createCostumesIndex(dataDir, undefined, 'real')
  const images = createImageCache({
    cacheDir: path.join(dataDir, 'cache', 'costumes'),
    origin,
    pathPattern: COSTUME_PATH,
    // 服装图是两级目录；不传这个，磁盘上限与 /costumes/cache 统计都会失效
    cacheSubdirs: ['thumbs/costume', 'img/costume'],
  })
  const store = { index, images, uploadsDir }
  realSingleton = { key, store }
  return store
}

function animeStore(dataDir: string, uploadsDir: () => string): Store {
  const key = dataDir
  if (animeSingleton !== null && animeSingleton.key === key) return animeSingleton.store
  const index = createCostumesIndex(dataDir, undefined, 'anime')
  const images = createImageCache({
    cacheDir: path.join(dataDir, 'cache', 'costumes-anime'),
    origin: COSTUME_ANIME_ORIGIN,
    pathPattern: COSTUME_ANIME_PATH,
    cacheSubdirs: ['thumbs', 'img', 'png'],
  })
  // 动画版落到 uploads/anime/ 子目录：两库 id 同格式（SPR-xxxx），materialize 又按 basename
  // 落盘，共用目录会互相覆盖 —— 工作流里那条旧路径会悄悄换成另一画风的图。
  const animeUploads = (): string => path.join(uploadsDir(), 'anime')
  const store = { index, images, uploadsDir: animeUploads }
  animeSingleton = { key, store }
  return store
}

/** 把失败原因落盘：宿主会吞掉 apply 的异常。 */
function recordFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  try {
    const dir = pluginDataDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'last-error.log'), `[${new Date().toISOString()}] costumes entry\n${message}\n`, 'utf8')
  } catch {
    // 连日志都写不了就只能放弃
  }
}

export function apply(ctx: HostContext, config: unknown): void {
  try {
    applyInner(ctx, config)
  } catch (error) {
    recordFailure(error)
    throw error
  }
}

function applyInner(ctx: HostContext, config: unknown): void {
  const settings = resolveSettings(config, process.env)
  if (new Set(settings.disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] 组件 ${COMPONENT} 已按配置关闭。`)
    return
  }

  const dataDir = pluginDataDir()
  // 服装图与姿势图在同一个图床，共用一个 origin 配置项
  const real = realStore(dataDir, settings.posesOrigin, () => settings.uploadsDir ?? path.join(dataDir, 'uploads'))
  const { index, images } = real
  // 动画版是独立原站；catalog 缺失时返回 undefined，工具会给出可读报错而不是崩
  const anime = fs.existsSync(path.join(dataDir, 'costumes-anime', 'catalog.json'))
    || fs.existsSync(bundledCostumePath(import.meta.url, 'anime'))
    ? animeStore(dataDir, () => settings.uploadsDir ?? path.join(dataDir, 'uploads'))
    : undefined
  const uploadsDir = (): string => settings.uploadsDir ?? path.join(dataDir, 'uploads')

  const routes = createCostumeRoutes({ index, images, uploadsDir, ...(anime === undefined ? {} : { anime }) })

  const rt = acquire(ctx, config)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'costumes: runtime')

  // 素材面的另一半（与姿势库各占一半，工具侧惰性取）。
  // 动画版是独立的一对：两库 id 同格式（SPR-xxxx），共用一个函数就会静默取错库。
  rt.materials = {
    ...rt.materials,
    costume: id => {
      const item = index.get(id)
      return item === undefined ? undefined : { id: item.id, name: item.name, keywords: item.keywords }
    },
    fetchCostume: async (id, size) => {
      const item = index.get(id)
      if (item === undefined) throw new Error(`没有这套衣装：${id}`)
      const relative = size === 'thumb' ? item.thumb : item.full
      const { file } = await images.materialize(relative, uploadsDir())
      return file
    },
    ...(anime === undefined
      ? {}
      : {
        costumeAnime: id => {
          const item = anime.index.get(id)
          return item === undefined ? undefined : { id: item.id, name: item.name, keywords: item.keywords }
        },
        fetchCostumeAnime: async (id, size) => {
          const item = anime.index.get(id)
          if (item === undefined) throw new Error(`动画版衣装库里没有：${id}`)
          const relative = size === 'thumb' ? item.thumb : item.full
          const { file } = await anime.images.materialize(relative, anime.uploadsDir())
          return file
        },
      }),
  }
  ensureHttp(ctx, rt)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => mountRoutes(ctx, COMPONENT, { exact: routes.exact }), 'costumes: routes')
  } else {
    mountRoutes(ctx, COMPONENT, { exact: routes.exact })
  }

  const tools = ctx.get?.('tools') as { register: (spec: unknown) => (() => void) | void } | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    console.warn('[comfyui-workbench] 拿不到 tools 服务，服装工具未注册。')
  } else {
    const deps = { index, images, uploadsDir, ...(anime === undefined ? {} : { anime }) }
    for (const spec of [costumeTool(deps)]) {
      try {
        const dispose = tools.register(spec)
        if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
          ctx.effect(() => () => dispose(), `costumes: tool ${spec.name}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[comfyui-workbench] 工具 ${spec.name} 未注册：${message}`)
      }
    }
  }

  const stats = index.stats()
  rt.info(`[comfyui-workbench] 服装库已上线：${stats.total} 套 / ${Object.keys(stats.categories).length} 类`)
}
