import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { listEntries } from '../../../shared/workflow/index.js'
import type { WorkflowIOSurface } from '../../../shared/workflow/types.js'
import { asString } from '../../../shared/tools/types.js'
import type { ToolDeps } from '../../../shared/tools/types.js'

/**
 * 列表项（**模型侧**）：够判断「该用哪个」，又不把节点拓扑塞进上下文。
 *
 * 与面板侧那份（`panel-workflow/server/workflows-api.ts` 的 `toPanelItem`）字段已分叉，
 * 理由见那边的注释。共同字段（workflowId / title / description / undescribed / enabled）
 * 由 `tests/workflow-list-shape.test.mjs` 钉住不能漂。
 */
export function toModelItem(surface: WorkflowIOSurface): Record<string, unknown> {
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
 * 列出可用工作流（`comfyui_workflow` 的列表路径）。
 *
 * 用户没指定工作流时，模型全靠这个清单挑。所以每项都带**模型名**与**作用备注** ——
 * 这两个是区分"同名但不同底模/不同用途"的唯一依据，只给 id 等于让模型瞎猜。
 *
 * @param deps - 依赖（工作流目录）。
 * @param args - `q` / `inputs` / `includeDisabled`。
 */
export async function listWorkflows(deps: ToolDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const query = asString(args.q).trim().toLowerCase()
  const wantInput = asString(args.inputs).trim().toLowerCase()
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
      const item = toModelItem(entry.surface)
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
      // 按输入类型筛：找"能吃图的工作流"时用这个，比让模型自己翻 inputKinds 强
      if (wantInput !== '') {
        const slots = Array.isArray(item.inputs) ? (item.inputs as Array<{ name?: unknown; type?: unknown }>) : []
        const matched = slots.filter(slot => String(slot.type ?? '').toLowerCase() === wantInput)
        if (matched.length === 0) return false
        // 把"该往哪个键里传图"直接告诉模型，省掉一次 inspect
        item.imageSlots = matched.map(slot => String(slot.name ?? ''))
        item.needsImage = wantInput === 'image'
      }
      if (query === '') return true
      const haystack = `${String(item.title)} ${String(item.description)} ${String((item.models as { primary?: unknown }).primary)}`.toLowerCase()
      return haystack.includes(query)
    })

  return {
    ok: true,
    mode: 'list',
    count: items.length,
    workflows: items,
    ...(broken.length > 0 ? { broken, brokenHint: '这些文件不是可用的 API 格式工作流，已跳过。' } : {}),
    ...(hidden > 0 ? { hiddenCount: hidden, hiddenHint: `另有 ${hidden} 个工作流被停用（面板里可重新启用）。` } : {}),
    ...(items.length === 0 && broken.length === 0
      ? {
        // 按输入类型筛空时要专门说 —— 通用那句会让人以为"一个工作流都没有"
        hint: wantInput === ''
          ? '没有可用的工作流。用面板启用一个，或导入一份 API 格式工作流（ComfyUI 里 Export (API)）。'
          : `本机没有需要 ${wantInput} 输入的工作流。去掉 inputs 参数可以看全部。`,
      }
      : {}),
  }
}
