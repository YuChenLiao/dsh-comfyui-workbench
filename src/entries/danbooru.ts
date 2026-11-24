/**
 * 组件：模型工具 · Danbooru 标签库。
 *
 * 两个工具：`danbooru_lookup`（按中文名、日文名或 tag 查角色 / 画师 / 作品 / 通用四类标签 ——
 * 给 `query` 查一个、给 `queries` 查一批）与 `danbooru_sync`（从 Danbooru 抓热门段到本地）。
 *
 * 这条 entry 刻意**不碰 ComfyUI 运行时**：它只读一个数据目录、注册两个纯本地工具。
 * 走 `acquire` 会顺带建出客户端、监督器与资产索引（还要等 workspaceRegistry 就绪），
 * 与它无关 —— 所以这里直接用宿主 ctx，不参与共享 runtime 的引用计数。
 *
 * 可以在宿主「设置 → 插件」里单独关掉，也能用 `disabledComponents: ['tool.danbooru']`。
 */
import { DANBOORU_COMPONENT, DEFAULT_SYNC, createTagCache, danbooruLookupTool, danbooruSyncTool } from '../components/tool-danbooru/index.js'
import { registerHostTools } from '../shared/host/adapter.js'
import { resolveSettings } from '../shared/host/config.js'
import { pluginDataDir } from '../shared/host/paths.js'
import type { HostContext, LoggerLike } from '../shared/host/types.js'

export const name = 'dsh-comfyui-workbench:danbooru'

export const inject = ['tools']

export function apply(ctx: HostContext, config: unknown): void {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has(DANBOORU_COMPONENT)) {
    console.warn(`[comfyui-workbench] 组件 ${DANBOORU_COMPONENT} 已按配置关闭。`)
    return
  }

  const dataDir = pluginDataDir()
  const cache = createTagCache(dataDir)
  const logger: LoggerLike = {
    info: (...args: unknown[]) => console.log(...args),
    warn: (...args: unknown[]) => console.warn(...args),
    error: (...args: unknown[]) => console.error(...args),
  }
  const deps = { dataDir, logger, cache }

  const registered = registerHostTools(ctx, [danbooruLookupTool(deps), danbooruSyncTool(deps, DEFAULT_SYNC)], {
    label: 'danbooru',
    missingMessage: '[comfyui-workbench] 拿不到 tools 服务，Danbooru 工具未注册。',
  })
  if (registered === 0) return

  console.log(`[comfyui-workbench] Danbooru 工具已注册 ${registered} 个（数据目录 ${dataDir}）`)
}
