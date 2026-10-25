/**
 * 组件：用户面板 · 相册。
 *
 * 独立的 loader entry —— 宿主插件页里能看到它、能单独关掉。
 * 关掉后相册的路由随之下线（404），工作流与工具不受影响。
 */
import { createGalleryRoutes } from '../components/panel-gallery/server/routes.js'
import type { HostContext } from '../shared/host/types.js'
import { acquire, componentStateOf, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:gallery'

/** 相册要提供 HTTP 接口。 */
export const inject = ['webServer']

export function apply(ctx: HostContext, config: unknown): void {
  const rt = acquire(ctx, config)
  // 配置里点名关掉的组件不注册（与在宿主里关掉这条 entry 等效）。
  if (!componentStateOf(rt)['panel.gallery']) {
    rt.info('[comfyui-workbench] 组件 panel.gallery 已按配置关闭。')
    return
  }

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(), 'gallery: runtime')
  ensureHttp(rt)

  const table = createGalleryRoutes({
    ctx,
    settings: rt.settings,
    index: rt.index,
    uploadsDir: rt.uploadsDir,
    defaultOutputDir: rt.outputDir,
  })

  // 批量导出要读图、读 sidecar、打包，依赖都在相册这边；工作流的 POST /workflows 用它。
  rt.exportWorkflows = table['/workflows']

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const unmount = mountRoutes('panel.gallery', { exact: table })
      return () => {
        rt.exportWorkflows = undefined
        unmount()
      }
    }, 'gallery: routes')
  } else {
    mountRoutes('panel.gallery', { exact: table })
  }
  rt.info('[comfyui-workbench] 相册已上线')
}
