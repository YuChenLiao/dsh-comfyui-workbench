/**
 * 组件：模型工具 · 生图。
 *
 * 提供 workflow_list / workflow_inspect / comfyui_run 三个工具。
 * 与面板无关 —— 关掉面板，模型照样能出图。
 */
import { registerTools, TOOL_GROUPS } from '../components/tool-generate/index.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { acquire, release } from '../runtime.js'

/** 组件被配置关闭时的统一提示。 */
function warnDisabled(id: string): void {
  console.warn(`[comfyui-workbench] 组件 ${id} 已按配置关闭。`)
}

export const name = 'dsh-comfyui-workbench:generate'

/** 工具需要宿主 tools 服务。 */
export const inject = ['tools', 'workspaceRegistry']

export function apply(ctx: HostContext, config: unknown): void {
  // 先看配置：被关掉的组件不该白建一份运行时（acquire 会构造客户端与监督器）。
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('tool.generate')) {
    warnDisabled('tool.generate')
    return
  }

  const rt = acquire(ctx, config)

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'generate: runtime')

  const tools = ctx.get?.('tools') as { register: (spec: unknown) => (() => void) | void } | undefined
  if (tools === undefined || typeof tools.register !== 'function') {
    rt.warn('[comfyui-workbench] 拿不到 tools 服务，生图工具未注册。')
    return
  }

  const report = registerTools(TOOL_GROUPS, {
    client: rt.client,
    workflowsDir: rt.flowDir,
    outputDir: rt.outputDir,
    resolveOutputDirFor: rt.resolveOutputDirFor,
    timeoutMs: rt.settings.timeoutMs,
    pollIntervalMs: rt.settings.pollIntervalMs,
    overrides: new Map(),
    index: rt.index,
    assertWritable: rt.assertWritable,
    logger: rt.logger,
  }, {
    enabled: TOOL_GROUPS.filter(group => group.component === 'tool.generate').map(group => group.name),
    register: spec => rt.track(tools.register(spec)),
    warn: rt.warn,
  })

  rt.tools.registered.push(...report.registered)
  rt.tools.failed.push(...report.failed)
  rt.tools.skipped.push(...report.skipped)
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] 工具 ${failure.name} 未注册：${failure.message}`)
  rt.info(`[comfyui-workbench] 生图工具已注册 ${report.registered.length} 个`)
}
