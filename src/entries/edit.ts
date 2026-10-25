/**
 * 组件：模型工具 · 工作流编辑。
 *
 * 只提供 comfyui_workflow_edit（改标题、说明、变量覆盖、节点参数）。
 * 与生图分开：它只写本地元数据，不碰 ComfyUI。
 */
import { registerTools, TOOL_GROUPS } from '../components/tool-generate/index.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { acquire, release } from '../runtime.js'

/** 组件被配置关闭时的统一提示。 */
function warnDisabled(id: string): void {
  console.warn(`[comfyui-workbench] 组件 ${id} 已按配置关闭。`)
}

export const name = 'dsh-comfyui-workbench:edit'

export const inject = ['tools', 'workspaceRegistry']

export function apply(ctx: HostContext, config: unknown): void {
  // 先看配置：被关掉的组件不该白建一份运行时（acquire 会构造客户端与监督器）。
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('tool.workflow-edit')) {
    warnDisabled('tool.workflow-edit')
    return
  }

  const rt = acquire(ctx, config)

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'edit: runtime')

  const tools = ctx.get?.('tools') as { register: (spec: unknown) => (() => void) | void } | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    rt.warn('[comfyui-workbench] 拿不到 tools 服务，工作流编辑工具未注册。')
    return
  }

  const report = registerTools(TOOL_GROUPS, {
    client: rt.client,
    workflowsDir: rt.flowDir,
    outputDir: rt.outputDir,
    timeoutMs: rt.settings.timeoutMs,
    pollIntervalMs: rt.settings.pollIntervalMs,
    overrides: new Map(),
    index: rt.index,
    assertWritable: rt.assertWritable,
    logger: rt.logger,
  }, {
    enabled: TOOL_GROUPS.filter(group => group.component === 'tool.workflow-edit').map(group => group.name),
    register: spec => rt.track(tools.register(spec)),
    warn: rt.warn,
  })

  rt.tools.registered.push(...report.registered)
  rt.tools.failed.push(...report.failed)
  rt.tools.skipped.push(...report.skipped)
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] 工具 ${failure.name} 未注册：${failure.message}`)
  rt.info(`[comfyui-workbench] 工作流编辑工具已注册 ${report.registered.length} 个`)
}
