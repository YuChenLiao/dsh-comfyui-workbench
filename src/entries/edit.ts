/**
 * 组件：模型工具 · 工作流编辑。
 *
 * 只提供 comfyui_workflow_edit（改标题、说明、变量覆盖、节点参数）。
 * 与生图分开：它只写本地元数据，不碰 ComfyUI。
 */
import { registerTools, TOOL_GROUPS } from '../components/tool-generate/index.js'
import { createHostToolRegistrar, onHostDispose } from '../shared/host/adapter.js'
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

  onHostDispose(ctx, 'edit: runtime', () => release(ctx))

  const registerHost = createHostToolRegistrar(ctx, {
    label: 'edit',
    track: dispose => rt.track(dispose),
    warn: rt.warn,
  })
  if (registerHost === undefined) {
    rt.warn('[comfyui-workbench] 拿不到 tools 服务，工作流编辑工具未注册。')
    return
  }

  const report = registerTools(TOOL_GROUPS, {
    client: rt.client,
    workflowsDir: rt.flowDir,
    outputDir: rt.outputDir,
    timeoutMs: rt.settings.timeoutMs,
    pollIntervalMs: rt.settings.pollIntervalMs,
    // 不传 runWait / runWaitMaxMs / syncWait：这条 entry 只注册 tool.workflow-edit 那一组，
    // 而它们全在 tool.generate 组里（registry 先按 enabled 跳过再 build，所以传了也用不上）。
    // 想要同步等待的语义，改 generate.ts —— 那是唯一真正装配这三个工具的地方。
    overrides: new Map(),
    runs: rt.runs,
    index: rt.index,
    assertWritable: rt.assertWritable,
    logger: rt.logger,
  }, {
    enabled: TOOL_GROUPS.filter(group => group.component === 'tool.workflow-edit').map(group => group.name),
    register: registerHost,
    warn: rt.warn,
  })

  rt.tools.registered.push(...report.registered)
  rt.tools.failed.push(...report.failed)
  rt.tools.skipped.push(...report.skipped)
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] 工具 ${failure.name} 未注册：${failure.message}`)
  rt.info(`[comfyui-workbench] 工作流编辑工具已注册 ${report.registered.length} 个`)
}
