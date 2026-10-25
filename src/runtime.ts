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
  ctx: HostContext
  settings: Settings
  client: ComfyClient
  supervisor: ComfySupervisor
  index: AssetIndex
  flowDir: string
  outputDir: string
  outputSource: 'config' | 'env' | 'service' | 'cwd' | 'data'
  uploadsDir: string
  assertWritable: (dir: string) => void
  logger: ReturnType<typeof resolveLogger>
  warn: (message: string) => void
  info: (message: string) => void
  track: (dispose: (() => void) | void) => void
  /** HTTP 前缀是否已挂载（幂等标记）。 */
  httpMounted: boolean
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

let current: Runtime | undefined
let refs = 0

/** 已挂载的组件路由表：组件 entry 上线时挂进来，下架时摘掉。 */
const tables = new Map<string, RouteTable>()

/** 挂载一个组件的路由。 */
export function mountRoutes(componentId: string, table: RouteTable): () => void {
  tables.set(componentId, table)
  return () => { tables.delete(componentId) }
}

/** 取出当前所有组件的路由，合成一张表（后挂的覆盖先挂的同名路径）。 */
export function mergedRoutes(): RouteTable {
  const exact: Record<string, RouteHandler> = {}
  const prefix: Array<{ base: string; handle: RouteHandler }> = []
  for (const table of tables.values()) {
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
export function ensureHttp(rt: Runtime): void {
  if (rt.httpMounted) return
  rt.httpMounted = true
  const server = rt.ctx.get?.('webServer') as { register?: (route: unknown) => (() => void) | void } | undefined
  if (server === undefined || typeof server.register !== 'function') {
    rt.warn('[comfyui-workbench] 拿不到 webServer 服务，面板接口未注册。')
    return
  }
  const { createDispatch, PREFIX } = httpModule
  const dispose = server.register({ kind: 'prefix', path: PREFIX, handler: createDispatch() })
  if (typeof dispose === 'function' && typeof rt.ctx.effect === 'function') {
    rt.ctx.effect(() => dispose, 'comfyui-workbench: http prefix')
  }
  rt.info(`[comfyui-workbench] API 就绪：${PREFIX}`)
}

/** 是否已经初始化（供 entry 判断要不要带配置）。 */
export function runtimeReady(): boolean {
  return current !== undefined
}

/**
 * 取运行时（首次调用时初始化）。
 *
 * 引用计数：四条 entry 各自 acquire，最后一条 release 时才真正销毁，
 * 否则先卸载的那条会把别人还在用的 supervisor 一起关掉。
 */
export function acquire(ctx: HostContext, config: unknown): Runtime {
  // 宿主换了（测试里每个用例一个新 ctx）就重建：否则会拿上一个宿主的客户端与目录。
  if (current !== undefined && current.ctx !== ctx) {
    current.supervisor.dispose()
    stopAllWatchers()
    tables.clear()
    current = undefined
    refs = 0
  }
  refs += 1
  if (current !== undefined) return current
  current = create(ctx, config)
  return current
}

/** 释放；计数归零才销毁。 */
export function release(): void {
  refs -= 1
  if (refs > 0 || current === undefined) return
  current.supervisor.dispose()
  stopAllWatchers()
  tables.clear()
  current = undefined
  refs = 0
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

  const track = (dispose: (() => void) | void): void => {
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') ctx.effect(() => dispose, 'comfyui-workbench: disposer')
  }

  info(`[comfyui-workbench] 运行时就绪：产物 ${outputDir}（来源 ${resolved.source}）`)

  return {
    ctx,
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
    httpMounted: false,
    tools: { registered: [], failed: [], skipped: [] },
  }
}
