/**
 * 组件：用户面板 · ComfyUI 终端。
 *
 * 独立的 loader entry —— 宿主插件页里能看到它、能单独关掉。
 * 关掉后终端的路由随之下线（404），其它面板与工具不受影响。
 *
 * 它**不** acquire 运行时之外的东西：缓冲在 runtime 上，进程由 runtime 拉起。
 * 这个 entry 只负责把读取接口挂出去。
 */
import { createTerminalRoutes } from '../components/panel-terminal/server/routes.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { acquire, ensureHttp, mountRoutes, release } from '../runtime.js'

export const name = 'dsh-comfyui-workbench:terminal'

/** 组件被配置关闭时的统一提示。 */
function warnDisabled(id: string): void {
  console.warn(`[comfyui-workbench] 组件 ${id} 已按配置关闭。`)
}

/** 终端要提供 HTTP 接口，并建共享运行时（工作区探测要等服务就绪）。 */
export const inject = ['webServer', 'workspaceRegistry']

export function apply(ctx: HostContext, config: unknown): void {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('panel.terminal')) {
    warnDisabled('panel.terminal')
    return
  }

  const rt = acquire(ctx, config)

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'terminal: runtime')
  ensureHttp(ctx, rt)

  const table = createTerminalRoutes({
    buffer: rt.terminal,
    status: () => rt.supervisor.status(),
    // 不等就绪：启动要几十秒，接口立刻返回，进度由轮询的 status 反映。
    start: () => {
      void rt.supervisor.ensureReady().catch(() => { /* 原因在 status.detail 里，界面会显示 */ })
    },
  })

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, 'panel.terminal', { exact: table })
      return () => { unmount() }
    }, 'terminal: routes')
  } else {
    mountRoutes(ctx, 'panel.terminal', { exact: table })
  }
  rt.info('[comfyui-workbench] 终端面板已上线')
}
