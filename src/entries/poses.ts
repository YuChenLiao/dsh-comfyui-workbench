/**
 * 组件：姿势参考库（面板 + 模型工具）。
 *
 * 288 组人体姿势、1439 个角度，来自 Danbooru 社区的中文图库
 * （`anhao/ai-pose-gallery-zh`，原始素材出自 ギア / @giaaibusi）。
 *
 * ## 面板与工具为什么合成一条 entry
 *
 * 两者共用同一份索引与同一个取图器：拆成两条 entry，索引会被建两遍、
 * 磁盘缓存会各写一次、成人向开关会有两个来源。而这条 entry 的写入面
 * （`POST /poses/fetch`）本来就只为"给工作流当输入图"服务，与面板是同一件事。
 *
 * ## 数据与图片是分开的
 *
 * 名称 / 分类 / 图地址随包（`data/poses/catalog.json`）；**线稿一张都不在仓库里**，
 * 运行时经服务端代理按需读取并落盘缓存。著作权不在本项目，使用限制见
 * `data/poses/NOTICE.md`。
 */
import fs from 'node:fs'
import path from 'node:path'

import { createPosesIndex } from '../components/panel-poses/server/catalog.js'
import { createPoseImages } from '../components/panel-poses/server/images.js'
import { createPosesRoutes } from '../components/panel-poses/server/routes.js'
import { poseTool } from '../components/panel-poses/server/tools.js'
import type { PosesIndex } from '../components/panel-poses/server/catalog.js'
import type { PoseImages } from '../components/panel-poses/server/images.js'
import { resolveSettings } from '../shared/host/config.js'
import { pluginDataDir } from '../shared/host/paths.js'
import type { HostContext } from '../shared/host/types.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:poses'

export const inject = ['webServer', 'workspaceRegistry', 'tools']

/** 组件 id，与其它面板一致，可单独关（`disabledComponents: ['panel.poses']`）。 */
export const COMPONENT = 'panel.poses'

/**
 * 索引与取图器的**模块级**单例。
 *
 * 与 tags entry 同理由：apply 会在热重载、宿主重新 apply 时重跑，
 * 每次新建一个取图器就等于把内存缓存与失败冷却清零 —— 而冷却恰好是
 * 上游挂掉时唯一能救面板的东西。挂在模块级才真的跨 apply 唯一。
 */
let singleton: { key: string; index: PosesIndex; images: PoseImages } | null = null

function shared(dataDir: string, origin: string): { index: PosesIndex; images: PoseImages } {
  const key = `${dataDir}|${origin}`
  if (singleton !== null && singleton.key === key) return singleton
  const index = createPosesIndex(dataDir)
  const images = createPoseImages({ cacheDir: path.join(dataDir, 'cache', 'poses'), origin })
  singleton = { key, index, images }
  return singleton
}

/** 把失败原因落盘：宿主会吞掉 apply 的异常，不写下来就无从排查。 */
function recordFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error)
  try {
    const dir = pluginDataDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'last-error.log'), `[${new Date().toISOString()}] poses entry\n${message}\n`, 'utf8')
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
  const { index, images } = shared(dataDir, settings.posesOrigin)
  const uploadsDir = (): string => settings.uploadsDir ?? path.join(dataDir, 'uploads')

  const routes = createPosesRoutes({ index, images, uploadsDir })

  // 面板走共享 runtime（HTTP 前缀由它注册一次）
  const rt = acquire(ctx, config)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'poses: runtime')

  // 素材面的一半：compose 工具要把姿势线稿塞进工作流，而它不该 import 本组件。
  rt.materials = {
    ...rt.materials,
    pose: id => {
      const found = index.findView(id)
      return found === undefined ? undefined : { id: found.view.id, name: found.pose.name }
    },
    fetchPose: async (id, size) => {
      const found = index.findView(id)
      if (found === undefined) throw new Error(`没有这个姿势视角：${id}`)
      const { file } = await images.materialize(size === 'thumb' ? found.view.thumb : found.view.full, uploadsDir())
      return file
    },
  }
  ensureHttp(ctx, rt)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => mountRoutes(ctx, COMPONENT, { exact: routes.exact }), 'poses: routes')
  } else {
    mountRoutes(ctx, COMPONENT, { exact: routes.exact })
  }

  // 工具不经过 runtime：它们只读索引，与 ComfyUI 无关
  const tools = ctx.get?.('tools') as { register: (spec: unknown) => (() => void) | void } | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    console.warn('[comfyui-workbench] 拿不到 tools 服务，姿势工具未注册。')
  } else {
    const deps = { index, images, uploadsDir }
    for (const spec of [poseTool(deps)]) {
      try {
        const dispose = tools.register(spec)
        if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
          ctx.effect(() => () => dispose(), `poses: tool ${spec.name}`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.warn(`[comfyui-workbench] 工具 ${spec.name} 未注册：${message}`)
      }
    }
  }

  const stats = index.stats()
  rt.info(`[comfyui-workbench] 姿势库已上线：${stats.poseCount} 组 / ${stats.viewCount} 个角度`)
}
