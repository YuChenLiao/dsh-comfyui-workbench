import type { IncomingMessage, ServerResponse } from 'node:http'

import { ComfyClient, ComfySupervisor } from './shared/comfy/index.js'
import { isAuthorized } from './shared/authz/authorize.js'
import { rootsOf } from './shared/authz/roots.js'
import type { Settings } from './shared/host/config.js'
import { resolveSettings } from './shared/host/config.js'
import { resolveLogger } from './shared/host/logger.js'
import { ensureDir, pluginDataDir, workflowsDir } from './shared/host/paths.js'
import type { HostContext } from './shared/host/types.js'
import { resolveOutputDir, workspaceDirOf } from './shared/host/workspace.js'
import { AssetIndex } from './components/panel-gallery/server/store/index.js'
import { stopAllWatchers } from './shared/run/index.js'
import * as httpModule from './http/router.js'

/** 路由处理器。 */
export type RouteHandler = (url: URL, res: ServerResponse, req: IncomingMessage) => void | Promise<void>

/**
 * 一个组件的路由表。
 *
 * `exact` 是精确路径；`prefix` 用来承接动态段（`/workflows/<id>` 这种）。
 * 组件的路由随组件 entry 上下线，不由前缀注册那一层决定。
 */
export interface RouteTable {
  exact: Record<string, RouteHandler>
  prefix?: Array<{ base: string; handle: RouteHandler }>
}

/**
 * 跨 entry 共享的运行时。
 *
 * 四个组件是**四条独立的 loader entry**（宿主界面里能看到并单独开关），
 * 但它们共用一份 ComfyUI 客户端、进程托管、资产索引与输出目录 ——
 * 各建一份会重复拉起服务、重复读索引。
 */
export interface Runtime {
  settings: Settings
  client: ComfyClient
  supervisor: ComfySupervisor
  index: AssetIndex
  flowDir: string
  outputDir: string
  outputSource: 'config' | 'env' | 'service' | 'cwd' | 'data'
  uploadsDir: string
  assertWritable: (dir: string) => void
  /** 创建者的 ctx，仅用于记录来源；注册类操作一律用调用方的 ctx。 */
  ownerCtx?: unknown
  logger: ReturnType<typeof resolveLogger>
  warn: (message: string) => void
  info: (message: string) => void
  track: (dispose: (() => void) | void) => void
  /** 批量导出（相册组件提供；工作流组件的 POST /workflows 调它）。 */
  exportWorkflows?: RouteHandler
  /** 各工具 entry 的注册结果（供 /config 展示）。 */
  tools: { registered: string[]; failed: Array<{ name: string; message: string }>; skipped: string[] }
}

/** 组件启用状态：由配置的 disabledComponents 推导。 */
export function componentStateOf(rt: Runtime): Record<string, boolean> {
  const disabled = new Set(rt.settings.disabledComponents)
  return {
    'panel.gallery': !disabled.has('panel.gallery'),
    'panel.workflow': !disabled.has('panel.workflow'),
    'tool.generate': !disabled.has('tool.generate'),
    'tool.workflow-edit': !disabled.has('tool.workflow-edit'),
  }
}

/**
 * 共享状态的容器。
 *
 * 每条组件 entry 是一个独立 bundle，esbuild 会把本模块各内联一份 —— 模块级变量
 * 在多个 bundle 之间**不共享**。曾因此踩坑：gallery 注册的路由在它自己的副本里，
 * workflow 的 prefix handler 看不到，`/config`、`/workflows` 全 404。
 *
 * 用 globalThis 上的单槽位让同进程内的所有副本指向同一份状态。
 */
interface Shared {
  current: Runtime | undefined
  refs: number
  tables: Map<string, RouteTable>
  /** HTTP 前缀是否已注册（跨 bundle 共享，避免重复注册被宿主拒绝）。 */
  httpMounted: boolean
  /** 最近一次 acquire 的调用方 ctx：注册类操作要用它，而不是创建者的。 */
  currentCaller?: HostContext
}

/**
 * 重建时机。
 *
 * 原本想按 fiber 是否失效来判断，但 cordis 4.0.5 的 Fiber 只有 uid / state，
 * 没有 `active` —— 那个判据恒不成立，属于死代码（复审实测）。真正的兜底是：
 * `acquire` 的引用计数配对（core 也 release）+ 全卸载后 `current === undefined`
 * 时重置前缀状态。所以这里只在"上一轮已全卸载"时重建。
 */

const SHARED_PROP = '__dshComfyuiWorkbench'

/**
 * 取共享状态。
 *
 * 关键：锚点是 **ctx.root**，不是 entry 自己的 ctx，更不是模块作用域或 globalThis。
 * 已由真实 cordis 4.0.5 实测：每条 entry 的 ctx 是 `parent.extend({ fiber })` 出来的
 * 独立对象（兄弟之间不共享自有属性），模块级变量在多 bundle 下也各一份。
 * 只有 `ctx.root` 是所有 entry 共同的原点。
 */
function sharedOf(ctx: HostContext): Shared {
  // cordis 里每条 entry 的 ctx 是 `parent.extend({ fiber })` 出来的**独立对象**，
  // 兄弟之间不共享自有属性 —— 挂在 ctx 上等于各建一份（已由真实 cordis 实测确认）。
  // `ctx.root` 是所有 entry 共同的原点，只有它指向同一个对象。
  const anchor = ((ctx as unknown as { root?: unknown }).root ?? ctx) as Record<string, Shared | undefined>
  let slot = anchor[SHARED_PROP]
  if (slot === undefined) {
    slot = { current: undefined, refs: 0, tables: new Map(), httpMounted: false }
    anchor[SHARED_PROP] = slot
  }
  return slot
}

/** 挂载一个组件的路由。 */
export function mountRoutes(ctx: HostContext, componentId: string, table: RouteTable): () => void {
  const tables = sharedOf(ctx).tables
  tables.set(componentId, table)
  return () => { tables.delete(componentId) }
}

/** 取出当前所有组件的路由，合成一张表（后挂的覆盖先挂的同名路径）。 */
export function mergedRoutes(ctx: HostContext): RouteTable {
  const exact: Record<string, RouteHandler> = {}
  const prefix: Array<{ base: string; handle: RouteHandler }> = []
  for (const table of sharedOf(ctx).tables.values()) {
    Object.assign(exact, table.exact)
    if (table.prefix !== undefined) prefix.push(...table.prefix)
  }
  return { exact, prefix }
}

/**
 * 挂载 HTTP 前缀（幂等）。
 *
 * 前缀只该注册一次；具体路径由各组件 entry 自己挂进路由表，
 * 关掉组件时它那份路由跟着消失，前缀本身不反复注册。
 */
export function ensureHttp(ctx: HostContext, rt: Runtime): void {
  const shared = sharedOf(ctx)
  if (shared.httpMounted) return

  const server = ctx.get?.('webServer') as { register?: (route: unknown) => (() => void) | void } | undefined
  if (server === undefined || typeof server.register !== 'function') {
    rt.warn('[comfyui-workbench] 拿不到 webServer 服务，面板接口未注册。')
    return
  }
  const { createDispatch, PREFIX } = httpModule
  try {
    const dispose = server.register({ kind: 'prefix', path: PREFIX, handler: createDispatch(ctx) })
    // 只有真的注册成功才置位 —— 先置位再注册会让热重载后永久跳过注册。
    shared.httpMounted = true
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
      ctx.effect(() => () => {
        // 卸载时复位：下次 apply 还要重新注册，否则重载后面板 API 静默消失。
        shared.httpMounted = false
        dispose()
      }, 'comfyui-workbench: http prefix')
    }
    rt.info(`[comfyui-workbench] API 就绪：${PREFIX}`)
  } catch (error) {
    // 热重载时前缀已存在：沿用现有的 handler（它查的是 ctx 上的那张表）。
    // 这里必须吞掉 —— 抛出去会让整条 entry 的 apply 中断，路由一条都挂不上。
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('duplicate prefix route')) throw error
    rt.info('[comfyui-workbench] HTTP 前缀已存在（重载），沿用现有实例')
  }
}

/** 是否已经初始化（供 entry 判断要不要带配置）。 */
/**
 * 取运行时（首次调用时初始化）。
 *
 * 引用计数：四条 entry 各自 acquire，最后一条 release 时才真正销毁，
 * 否则先卸载的那条会把别人还在用的 supervisor 一起关掉。
 */
export function acquire(ctx: HostContext, config: unknown): Runtime {
  const shared = sharedOf(ctx)
  shared.refs += 1
  shared.currentCaller = ctx
  if (shared.current !== undefined) return shared.current
  // 走到这里说明上一轮已经全卸载（current 为 undefined）：前缀状态一并复位。
  // 否则新的一轮会误判"前缀已注册"而跳过注册，靠旧 handler 支撑 —— 能跑但状态是错的。
  shared.httpMounted = false
  shared.current = create(ctx, config)
  shared.current.ownerCtx = ctx
  return shared.current
}

/** 释放；计数归零才销毁。 */
export function release(ctx: HostContext): void {
  const shared = sharedOf(ctx)
  shared.refs -= 1
  if (shared.refs > 0 || shared.current === undefined) return
  shared.current.supervisor.dispose()
  stopAllWatchers()
  shared.tables.clear()
  shared.current = undefined
  shared.refs = 0
}

function create(ctx: HostContext, config: unknown): Runtime {
  const settings = resolveSettings(config, process.env)
  const logger = resolveLogger(ctx, 'comfyui-workbench')
  const warn = (message: string): void => { logger?.warn?.(message) }
  const info = (message: string): void => { logger?.info?.(message) }

  const flowDir = settings.workflowsDir ?? workflowsDir()
  const uploadsDir = settings.uploadsDir ?? `${pluginDataDir()}/uploads`
  ensureDir(uploadsDir)

  const guess = workspaceDirOf(ctx)
  const resolved = resolveOutputDir(settings.outputDir, guess, pluginDataDir())
  const outputDir = resolved.dir
  ensureDir(outputDir)

  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...(settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand }),
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger,
  })

  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady(),
  })

  const index = settings.indexFile === null ? new AssetIndex() : new AssetIndex(settings.indexFile)

  const rootsSettings = { ...settings, resolvedOutputDir: outputDir }
  const assertWritable = (dir: string): void => {
    const roots = rootsOf(ctx, rootsSettings)
    if (roots.length === 0) return
    if (!isAuthorized(dir, roots)) {
      throw new Error(`输出目录不在授权范围内：${dir}。请在配置的 assetRoots 里加上它，或改用 workspace 内的目录。`)
    }
  }

  // track 用调用方的 ctx：创建者 entry 卸载后，rt.ctx 已失效，再挂 effect 会抛
  // `cannot create effect on inactive context`。
  const track = (dispose: (() => void) | void): void => {
    if (typeof dispose !== 'function') return
    const owner = sharedOf(ctx).currentCaller ?? ctx
    if (typeof owner.effect === 'function') owner.effect(() => dispose, 'comfyui-workbench: disposer')
  }

  info(`[comfyui-workbench] 运行时就绪：产物 ${outputDir}（来源 ${resolved.source}）`)

  return {
    settings,
    client,
    supervisor,
    index,
    flowDir,
    outputDir,
    outputSource: resolved.source,
    uploadsDir,
    assertWritable,
    logger,
    warn,
    info,
    track,
    tools: { registered: [], failed: [], skipped: [] },
  }
}
