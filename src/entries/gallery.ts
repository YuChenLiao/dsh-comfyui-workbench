/**
 * 组件：用户面板 · 相册。
 *
 * 独立的 loader entry —— 宿主插件页里能看到它、能单独关掉。
 * 关掉后相册的路由随之下线（404），工作流与工具不受影响。
 */
import { createGalleryRoutes } from '../components/panel-gallery/server/routes.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:gallery'

/** 组件被配置关闭时的统一提示。 */
function warnDisabled(id: string): void {
  console.warn(`[comfyui-workbench] 组件 ${id} 已按配置关闭。`)
}

/** 相册要提供 HTTP 接口。 */
export const inject = ['webServer', 'workspaceRegistry']

export function apply(ctx: HostContext, config: unknown): void {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('panel.gallery')) {
    warnDisabled('panel.gallery')
    return
  }

  const rt = acquire(ctx, config)

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'gallery: runtime')
  ensureHttp(ctx, rt)

  const table = createGalleryRoutes({
    ctx,
    settings: rt.settings,
    index: rt.index,
    uploadsDir: rt.uploadsDir,
    defaultOutputDir: rt.outputDir,
  })

  // 批量导出的实现在这里，但路由归工作流组件（同一路径的 GET 是列表）。
  // 这里只把它交给 runtime，由工作流的 POST /workflows 转发，避免两边抢同一路径。
  const { ['/workflows']: exporter, ...exact } = table
  rt.exportWorkflows = exporter

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, 'panel.gallery', { exact })
      return () => {
        rt.exportWorkflows = undefined
        unmount()
      }
    }, 'gallery: routes')
  } else {
    mountRoutes(ctx, 'panel.gallery', { exact })
  }
  rt.info('[comfyui-workbench] 相册已上线')
}
