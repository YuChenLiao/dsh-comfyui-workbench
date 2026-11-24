/**
 * 组件：用户面板 · 相册。
 *
 * 独立的 loader entry —— 宿主插件页里能看到它、能单独关掉。
 * 关掉后相册的路由随之下线（404），工作流与工具不受影响。
 */
import { clearScanCache } from '../components/panel-gallery/server/assets/scan-cache.js'
import { createGalleryRoutes } from '../components/panel-gallery/server/routes.js'
import { mountHostRoutes, onHostDispose } from '../shared/host/adapter.js'
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

  onHostDispose(ctx, 'gallery: runtime', () => release(ctx))
  ensureHttp(ctx, rt)

  const table = createGalleryRoutes({
    ctx,
    settings: rt.settings,
    index: rt.index,
    uploadsDir: rt.uploadsDir,
    defaultOutputDir: rt.outputDir,
    extraRoots: () => [...rt.sessionOutputDirs],
  })

  // 批量导出的实现在这里，但路由归工作流组件（同一路径的 GET 是列表）。
  // 这里只把它交给 runtime，由工作流的 POST /workflows 转发，避免两边抢同一路径。
  const { ['/workflows']: exporter, ...exact } = table
  rt.exportWorkflows = exporter

  mountHostRoutes(ctx, 'gallery: routes', () => {
    // 工具侧出图完成后会写共享的 rt.index：订阅它的变更来清掉本 bundle 里的扫描缓存，
    // 否则 30 秒 TTL 内切到相册页签看不到刚出的新图。
    const offMutate = rt.index.onMutate(clearScanCache)
    const unmount = mountRoutes(ctx, 'panel.gallery', { exact })
    return () => {
      offMutate()
      rt.exportWorkflows = undefined
      unmount()
    }
  })
  rt.info('[comfyui-workbench] 相册已上线')
}
