/**
 * dsh-comfyui-workbench —— 宿主侧入口。
 *
 * 装配职责只有三件：解析配置、注册 HTTP 路由、把失败说清楚。
 * 具体逻辑分层在：
 *   scan/     读磁盘与图片内嵌元数据（只依赖 node:*）
 *   assets/   根目录授权、扫描缓存、缩略图、去重、删除、ZIP
 *   http/     解析请求 → 调 service → 写响应
 *   workflow/ 工作流模板、IO 面、执行（后续版本）
 */
import fs from 'node:fs'

import { resolveSettings } from './host/config.js'
import { resolveLogger } from './host/logger.js'
import type { HostContext, WebServerLike } from './host/types.js'
import { createHandler, PREFIX } from './http/router.js'

/** 插件名（同时是 loader entry 的默认 id）。 */
export const name = 'dsh-comfyui-workbench'

/** 需要的宿主服务：HTTP 路由载体。 */
export const inject = ['webServer']

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

  const server = ctx.get?.('webServer') as WebServerLike | undefined
  if (server === undefined || typeof server.register !== 'function') {
    warn(`[${name}] 拿不到 webServer 服务，资产库 API 未注册。`)
    return
  }

  const handler = createHandler(ctx, settings)
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => server.register({ kind: 'prefix', path: PREFIX, handler }), `${name}: http routes`)
  } else {
    server.register({ kind: 'prefix', path: PREFIX, handler })
  }

  info(`[${name}] v${VERSION} 资产库 API 就绪：${PREFIX}（最大深度 ${settings.maxDepth}）`)
}
