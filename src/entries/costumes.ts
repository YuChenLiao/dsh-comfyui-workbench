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
import { createCostumesIndex } from '../components/panel-costumes/server/catalog.js'
import { costumeFetchTool, costumeSearchTool } from '../components/panel-costumes/server/tools.js'
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

/** 索引与取图器的模块级单例（理由同姿势库：apply 重跑不该把冷却与缓存清零）。 */
let singleton: { key: string; index: CostumesIndex; images: PoseImages } | null = null

function shared(dataDir: string, origin: string): { index: CostumesIndex; images: PoseImages } {
  const key = `${dataDir}|${origin}`
  if (singleton !== null && singleton.key === key) return singleton
  const index = createCostumesIndex(dataDir)
  const images = createImageCache({
    cacheDir: path.join(dataDir, 'cache', 'costumes'),
    origin,
    pathPattern: COSTUME_PATH,
    // 服装图是两级目录；不传这个，磁盘上限与 /costumes/cache 统计都会失效
    cacheSubdirs: ['thumbs/costume', 'img/costume'],
  })
  singleton = { key, index, images }
  return singleton
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
  const { index, images } = shared(dataDir, settings.posesOrigin)
  const uploadsDir = (): string => settings.uploadsDir ?? path.join(dataDir, 'uploads')

  const routes = createCostumeRoutes({ index, images, uploadsDir })

  const rt = acquire(ctx, config)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'costumes: runtime')
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
    const deps = { index, images, uploadsDir }
    for (const spec of [costumeSearchTool(deps), costumeFetchTool(deps)]) {
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
