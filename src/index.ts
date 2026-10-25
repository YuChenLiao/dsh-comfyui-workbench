/**
 * 全量入口：一次装载全部四个组件。
 *
 * 默认安装走 `cordis.patch.yml` 里的四条 entry —— 那样宿主插件页能看到四个独立组件，
 * 也能单独开关。这个入口留给"只想挂一条"的场景（脚本、测试、临时调试）。
 */
import { apply as applyEdit } from './entries/edit.js'
import { apply as applyGallery } from './entries/gallery.js'
import { apply as applyGenerate } from './entries/generate.js'
import { apply as applyWorkflow } from './entries/workflow.js'
import type { HostContext } from './shared/host/types.js'

export const name = 'dsh-comfyui-workbench'

/** 全量装载需要面板与工具两类服务。 */
export const inject = ['webServer', 'tools']

export function apply(ctx: HostContext, config: unknown): void {
  applyGallery(ctx, config)
  applyWorkflow(ctx, config)
  applyGenerate(ctx, config)
  applyEdit(ctx, config)
}

// 测试与诊断用：产物目录解析、组件注册器都要能被单独验证。
export { resolveOutputDir, workspaceDirOf } from './shared/host/workspace.js'
export { registerTools, TOOL_GROUPS } from './components/tool-generate/index.js'
export { acquire, release, componentStateOf, mergedRoutes } from './runtime.js'
