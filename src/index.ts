/**
 * 包根入口（name 必须是不带子路径的包名）。
 *
 * 为什么需要它：宿主只给**包根说明符**装配浏览器端
 * （`dsh-client-modules` 的 `exactPackageSpecifier` 明确排除包子路径）。
 * 四个组件是 `dsh-comfyui-workbench/<name>` 这样的子路径 entry，能注册服务端，
 * 但挂不上 client —— 少了这条包根 entry，侧栏图标与 better-sidebar 页签根本不会被加载。
 *
 * 所以这条 entry 只做两件事：让包根的 `exports["./client"]` 被装配、
 * 把共享运行时初始化好（四条组件 entry 直接复用）。
 */
import { apply as applyEdit } from './entries/edit.js'
import { apply as applyGallery } from './entries/gallery.js'
import { apply as applyGenerate } from './entries/generate.js'
import { apply as applyWorkflow } from './entries/workflow.js'
import type { HostContext } from './shared/host/types.js'
import { acquire } from './runtime.js'

export const name = 'dsh-comfyui-workbench'

/** 不注入任何服务：这里不注册路由、不注册工具、不碰 webServer。 */
export const inject: string[] = []

export function apply(ctx: HostContext, config: unknown): void {
  // 只初始化共享运行时；真正的注册在 entries/*.ts 里。
  acquire(ctx, config)
}

/**
 * 一次装载全部四个组件（测试与"只想挂一条 entry"的场景用）。
 *
 * 生产环境不用它：`cordis.patch.yml` 里是五条 entry（一条包根 + 四条组件），
 * 每条各自注册，宿主才能单独开关。
 */
export function applyAll(ctx: HostContext, config: unknown): void {
  applyGallery(ctx, config)
  applyWorkflow(ctx, config)
  applyGenerate(ctx, config)
  applyEdit(ctx, config)
}

// 测试与诊断用：这些能力要能被单独验证。
export { resolveOutputDir, workspaceDirOf } from './shared/host/workspace.js'
export { registerTools, TOOL_GROUPS } from './components/tool-generate/index.js'
export { acquire, release, componentStateOf, mergedRoutes } from './runtime.js'
