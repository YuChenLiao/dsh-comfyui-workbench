import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { listEntries } from '../../../shared/workflow/index.js'
import type { WorkflowIOSurface } from '../../../shared/workflow/types.js'
import { asString, jsonOutput } from '../../../shared/tools/types.js'
import type { ToolDeps, ToolSpec } from '../../../shared/tools/types.js'

/** 列表项：够模型判断"该用哪个"，又不把节点拓扑塞进上下文。 */
function toListItem(surface: WorkflowIOSurface): Record<string, unknown> {
  const primary = surface.models.find(model => model.primary === true) ?? surface.models[0]
  const others = surface.models.filter(model => model !== primary).map(model => model.name)
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    undescribed: surface.description === '',
    models: {
      primary: primary?.name ?? '',
      kind: primary?.kind ?? '',
      others,
    },
    inputKinds: [...new Set(surface.inputs.map(slot => slot.type).filter(type => type !== 'number' && type !== 'boolean' && type !== 'enum'))],
    inputs: surface.inputs.map(slot => ({ name: slot.name, type: slot.type, required: slot.required })),
    outputs: surface.outputs.map(slot => ({ kind: slot.kind, count: slot.count })),
    nodes: surface.meta.nodeCount,
    enabled: surface.enabled,
  }
}

/**
 * `comfyui_workflow_list`：列出可用工作流。
 *
 * 用户没指定工作流时，模型全靠这个清单挑。所以每项都带**模型名**与**作用备注** ——
 * 这两个是区分"同名但不同底模/不同用途"的唯一依据，只给 id 等于让模型瞎猜。
 *
 * @param deps - 依赖（工作流目录）。
 */
export function workflowListTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_workflow_list',
    description:
      '列出本机可用的 ComfyUI 工作流。每项含 id、标题、作用备注、底模名、输入种类（text/image/mask）与输出形状。用户没有指定工作流时用它在其中挑选；用户已指定时不必调用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        q: { type: 'string', description: '按标题 / 备注 / 模型名过滤（不区分大小写）' },
        includeDisabled: { type: 'boolean', description: '连被管理员停用的工作流一起列出（默认只看可用的）' },
      },
    },
    output: jsonOutput(),
    async execute(args) {
      const query = asString(args.q).trim().toLowerCase()
      const { entries, broken } = listEntries(deps.workflowsDir)

      // 本机有哪些模型：拿不到 object_info（ComfyUI 离线）就跳过这项检查，
      // 而不是把"没联网"报成"缺模型"。
      let available: Set<string> | null = null
      try {
        available = availableModels(await deps.client.objectInfo())
      } catch {
        available = null
      }

      // 被停用的工作流默认不出现在清单里：它们不该被模型挑中。
      const showDisabled = args.includeDisabled === true
      const hidden = showDisabled ? 0 : entries.filter(entry => !entry.surface.enabled).length
      const visible = showDisabled ? entries : entries.filter(entry => entry.surface.enabled)

      const items = visible
        .map(entry => {
          const item = toListItem(entry.surface)
          if (available === null) return item
          const missing = missingModels(entry.surface.models, available)
          if (missing.length === 0) return item
          const primary = entry.surface.models.find(model => model.primary === true) ?? entry.surface.models[0]
          return {
            ...item,
            missingModels: missing,
            modelHint: `本机没有：${missing.join('、')}。可用的替代：${suggestModels(available, primary?.kind ?? 'checkpoint').join('、') || '（一个都没有）'}`,
          }
        })
        .filter(item => {
          if (query === '') return true
          const haystack = `${String(item.title)} ${String(item.description)} ${String((item.models as { primary?: unknown }).primary)}`.toLowerCase()
          return haystack.includes(query)
        })

      return {
        ok: true,
        count: items.length,
        workflows: items,
        ...(broken.length > 0 ? { broken, brokenHint: '这些文件不是可用的 API 格式工作流，已跳过。' } : {}),
        ...(hidden > 0 ? { hiddenCount: hidden, hiddenHint: `另有 ${hidden} 个工作流被停用（面板里可重新启用）。` } : {}),
        ...(items.length === 0 && broken.length === 0
          ? { hint: '没有可用的工作流。用面板启用一个，或导入一份 API 格式工作流（ComfyUI 里 Export (API)）。' }
          : {}),
      }
    },
  }
}
