/**
 * 组件：模型工具 · 生图。
 *
 * 提供 workflow_list / workflow_inspect / comfyui_run 三个工具。
 * 与面板无关 —— 关掉面板，模型照样能出图。
 */
import { registerTools, TOOL_GROUPS } from '../components/tool-generate/index.js'
import { createHostToolRegistrar, onHostDispose } from '../shared/host/adapter.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { effectiveProgressStream, effectiveRunWait, readToggles } from '../shared/host/toggles.js'
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

  onHostDispose(ctx, 'generate: runtime', () => release(ctx))

  const registerHost = createHostToolRegistrar(ctx, {
    label: 'generate',
    track: dispose => rt.track(dispose),
    warn: rt.warn,
  })
  if (registerHost === undefined) {
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
    runWait: () => effectiveRunWait(rt.settings, readToggles()),
    runWaitMaxMs: rt.settings.runWaitMaxMs,
    // 与面板同源：工具侧也能吃到 /ws 进度与潜空间预览（默认关，开关改完下一次提交生效）。
    progressStream: () => effectiveProgressStream(rt.settings, readToggles()),
    // 组件 tool.sync-wait 关掉时，三个出图工具不再暴露 wait 参数。
    syncWait: !new Set(rt.settings.disabledComponents).has('tool.sync-wait'),
    overrides: new Map(),
    runs: rt.runs,
    index: rt.index,
    assertWritable: rt.assertWritable,
    // 惰性取：姿势库/衣装库的 apply 可能晚于本 entry
    getMaterials: () => rt.materials,
    logger: rt.logger,
  }, {
    enabled: TOOL_GROUPS.filter(group => group.component === 'tool.generate').map(group => group.name),
    register: registerHost,
    warn: rt.warn,
  })

  rt.tools.registered.push(...report.registered)
  rt.tools.failed.push(...report.failed)
  rt.tools.skipped.push(...report.skipped)
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] 工具 ${failure.name} 未注册：${failure.message}`)
  rt.info(`[comfyui-workbench] 生图工具已注册 ${report.registered.length} 个`)
}
