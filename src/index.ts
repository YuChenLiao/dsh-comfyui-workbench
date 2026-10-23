/**
 * dsh-comfyui-workbench —— 宿主侧入口。
 *
 * 装配职责只有三件：解析配置、注册 HTTP 路由、注册工具。具体逻辑分层在：
 *   scan/      读磁盘与图片内嵌元数据（只依赖 node:*）
 *   host/      宿主最小面、logger、配置、路径
 *   assets/    根目录授权、扫描缓存、缩略图、去重、删除、ZIP
 *   workflow/  模板、IO 面推断、变量应用
 *   comfy/     ComfyUI 传输与错误分类
 *   run/       预检 → 提交 → 轮询 → 取产物 → sidecar
 *   tools/     四个模型工具
 *   http/      解析请求 → 调 service → 写响应
 */
import fs from 'node:fs'

import { ComfyClient, ComfySupervisor } from './comfy/index.js'
import { resolveSettings } from './host/config.js'
import { resolveLogger } from './host/logger.js'
import { pluginDataDir, workflowsDir } from './host/paths.js'
import type { HostContext, WebServerLike } from './host/types.js'
import { createHandler, PREFIX } from './http/router.js'
import { AssetIndex } from './store/index.js'
import { createTools } from './tools/index.js'
import type { ToolSpec } from './tools/index.js'

/** 插件名（同时是 loader entry 的默认 id）。 */
export const name = 'dsh-comfyui-workbench'

/** 需要的宿主服务：HTTP 路由载体。tools 走可选获取，缺它不该让整个插件停摆。 */
export const inject = ['webServer']

/** 宿主 tools 服务的最小面。 */
interface ToolsLike {
  register: (spec: ToolSpec) => (() => void) | void
}

/**
 * 读当前 package.json 的版本号。
 *
 * 每次调用都重新读：宿主重载插件时会复用 ESM 模块缓存，把版本写死在模块顶层
 * 会让健康检查一直报旧版本。
 */
function readVersion(): string {
  try {
    const parsed = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: unknown }
    return typeof parsed.version === 'string' ? parsed.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

/** 版本号，随 package.json 走。 */
export const VERSION = readVersion()

/**
 * 插件入口。
 *
 * @param ctx - 宿主上下文。
 * @param config - loader 传入的配置。
 */
export function apply(ctx: HostContext, config: unknown): void {
  const settings = resolveSettings(config)
  const logger = resolveLogger(ctx, name)
  const warn = logger?.warn ?? console.warn
  const info = logger?.info ?? console.info

  /** 工作流目录：配置可覆盖，默认 $HOME/.dsh-comfyui-workbench/workflows。 */
  const flowDir = settings.workflowsDir ?? workflowsDir()

  // 服务托管：外部在跑就只用不托管；没跑且装了才拉起；只停自己拉起的那个。
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...(settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand }),
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger,
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => () => supervisor.dispose(), `${name}: supervisor`)

  // 构造客户端不产生连接，HTTP 路由与工具共用同一个实例（object_info 缓存也共用）。
  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady(),
  })

  const track = (dispose: (() => void) | void): void => {
    if (typeof dispose === 'function' && typeof ctx.effect === 'function') {
      // 交给宿主在卸载时调用
      ctx.effect(() => dispose, `${name}: disposer`)
    }
  }

  const assetIndex = new AssetIndex()

  // ── HTTP 路由 ──
  const server = ctx.get?.('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.register !== 'function') {
    warn(`[${name}] 拿不到 webServer 服务，资产库 API 未注册。`)
  } else {
    const handler = createHandler(ctx, settings, assetIndex, flowDir, client, supervisor)
    if (typeof ctx.effect === 'function') {
      ctx.effect(() => server.register({ kind: 'prefix', path: PREFIX, handler }), `${name}: http routes`)
    } else {
      server.register({ kind: 'prefix', path: PREFIX, handler })
    }
    info(`[${name}] v${VERSION} 资产库 API 就绪：${PREFIX}（最大深度 ${settings.maxDepth}）`)
  }

  // ── 工具（可选） ──
  const tools = ctx.get?.('tools') as ToolsLike | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    warn(`[${name}] 拿不到 tools 服务，工作流工具未注册（资产库仍可用）。`)
    return
  }

  for (const spec of createTools({
    client,
    workflowsDir: flowDir,
    outputDir: settings.outputDir ?? process.cwd(),
    timeoutMs: settings.timeoutMs,
    pollIntervalMs: settings.pollIntervalMs,
    overrides: new Map(),
    index: assetIndex,
    logger,
  })) {
    track(tools.register(spec))
  }

  info(`[${name}] 工作流工具已注册：list / inspect / run / edit（数据目录 ${pluginDataDir()}）`)
}
