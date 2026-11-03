/**
 * 组件：用户面板 · 标签库。
 *
 * 只读浏览 + 搜索 Danbooru 的四类标签（99372 条），带语义大类筛选与一键复制。
 * 与 `tool-danbooru`（模型侧工具）共用同一份数据与分类，不共进程状态 ——
 * 面板要 tag + 中文名 + 热度一起显示，工具只要 tag。
 */
import fs from 'node:fs'
import path from 'node:path'

import { createTagsIndex } from '../components/panel-tags/server/api.js'
import { createTagsRoutes } from '../components/panel-tags/server/routes.js'
import { resolveSettings } from '../shared/host/config.js'
import { pluginDataDir } from '../shared/host/paths.js'
import type { HostContext } from '../shared/host/types.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:tags'

export const inject = ['webServer', 'workspaceRegistry']

/** 把失败原因落盘：宿主会吞掉 apply 的异常，不写下来就无从排查。 */
function recordFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ''}` : String(error)
  try {
    const dir = pluginDataDir()
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'last-error.log'), `[${new Date().toISOString()}] tags entry
${message}
`, 'utf8')
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
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('panel.tags')) {
    console.warn('[comfyui-workbench] 组件 panel.tags 已按配置关闭。')
    return
  }

  const rt = acquire(ctx, config)
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'tags: runtime')
  ensureHttp(ctx, rt)

  // 索引只建一次，路由与统计共享它；数据文件变了由 `invalidate()` 触发重建
  const index = createTagsIndex(pluginDataDir())
  const routes = createTagsRoutes(index)

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => mountRoutes(ctx, 'panel.tags', { exact: routes.exact }), 'tags: routes')
  } else {
    mountRoutes(ctx, 'panel.tags', { exact: routes.exact })
  }
  rt.info('[comfyui-workbench] 标签库面板已上线')
}
