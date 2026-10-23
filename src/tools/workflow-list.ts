import { listEntries } from '../workflow/index.js'
import type { WorkflowIOSurface } from '../workflow/types.js'
import { asString, jsonOutput } from './types.js'
import type { ToolDeps, ToolSpec } from './types.js'

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
      },
    },
    output: jsonOutput(),
    async execute(args) {
      const query = asString(args.q).trim().toLowerCase()
      const { entries, broken } = listEntries(deps.workflowsDir)
      const items = entries
        .map(entry => toListItem(entry.surface))
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
        ...(items.length === 0 && broken.length === 0
          ? { hint: '工作流目录是空的。用 dsh workbench import <file> 导入一份 API 格式工作流（ComfyUI 里 Export (API)）。' }
          : {}),
      }
    },
  }
}
