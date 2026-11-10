/**
 * 模板体检：**升级后哪套工作流已经跑不起来了**。
 *
 * ComfyUI 更新会动的三样东西分别在三个地方失效：
 *
 * - 节点被改名或移除（`class_type` 在 `/object_info` 里查不到）→ 必然跑不起来
 * - 模型文件不在本机（`ckpt_name` / `lora_name` 查不到）→ 能提交，跑偏或直接报错
 * - 输入槽名变了 → 这一版不查（那要按 class_type 逐个对必填项，P0 只做前两条）
 *
 * 分档只分「必然跑不起来」与「可能跑偏」，不再细 —— 模型要的是"现在能跑哪几个"，
 * 不是一份体检报告。
 */
import { availableModels, missingModels, suggestModels } from '../../../shared/comfy/index.js'
import { listEntries } from '../../../shared/workflow/index.js'
import type { ToolDeps } from '../../../shared/tools/types.js'

/** 一套模板的体检结论。 */
interface AuditRow {
  workflowId: string
  title: string
  missingNodes: string[]
  missingModels: string[]
  modelHint?: string
}

/**
 * 扫全部模板，按节点与模型是否还在分档。
 *
 * @param deps - 依赖（工作流目录 + ComfyUI 客户端）。
 * @returns 分好档的结果；拿不到节点清单时 `ok: false`，**不假装健康**。
 */
export async function auditWorkflows(deps: ToolDeps): Promise<Record<string, unknown>> {
  const { entries, broken } = listEntries(deps.workflowsDir)

  let info: Awaited<ReturnType<ToolDeps['client']['objectInfo']>>
  try {
    info = await deps.client.objectInfo()
  } catch (error) {
    // 体检的全部结论都依赖节点清单。拿不到就明说，别让它看起来"全部健康"。
    return {
      ok: false,
      mode: 'audit',
      error: `查不到 ComfyUI 的节点清单，无法体检：${error instanceof Error ? error.message : String(error)}`,
      hint: '服务没起来或连不上。插件通常会自动拉起，等一会儿再试；也可以先用 comfyui_workflow 看模板本身。',
    }
  }

  const known = new Set(Object.keys(info))
  if (known.size === 0) {
    return {
      ok: false,
      mode: 'audit',
      error: 'ComfyUI 返回的节点清单是空的，无法判断哪些节点还在。',
      hint: '这通常说明服务正在启动或装的环境不完整，稍后再试。',
    }
  }

  // 空库（或整个目录都是坏文件）时，"0 套全部可用"是假话 —— 那等于告诉模型"可以开跑了"
  if (entries.length === 0) {
    return {
      ok: false,
      mode: 'audit',
      error: '工作流目录里没有可用的模板，没有东西可以体检。',
      ...(broken.length > 0 ? { skippedFiles: broken } : {}),
      hint: '先导入一份 API 格式工作流（ComfyUI 里 Export (API)），或用面板启用一个。',
    }
  }

  const available = availableModels(info)
  const dead: AuditRow[] = []
  const degraded: AuditRow[] = []
  let healthy = 0
  const disabled: string[] = []

  for (const entry of entries) {
    const surface = entry.surface
    // 停用的模板 comfyui_run 会直接拒，把它算进"能用"是假话
    if (!surface.enabled) { disabled.push(surface.workflowId); continue }
    const missingNodes = [...new Set(
      Object.values(entry.workflow)
        .map(node => String(node?.class_type ?? ''))
        .filter(name => name !== '' && !known.has(name)),
    )]
    const absentModels = missingModels(surface.models, available)

    if (missingNodes.length > 0) {
      // 节点没了就是必然跑不起来，模型缺不缺都无所谓了 —— 不再往 degraded 里放第二遍
      dead.push({ workflowId: surface.workflowId, title: surface.title, missingNodes, missingModels: absentModels })
      continue
    }
    if (absentModels.length > 0) {
      const primary = surface.models.find(model => model.primary === true) ?? surface.models[0]
      degraded.push({
        workflowId: surface.workflowId,
        title: surface.title,
        missingNodes: [],
        missingModels: absentModels,
        modelHint: `本机没有：${absentModels.join('、')}。可用的替代：${suggestModels(available, primary?.kind ?? 'checkpoint').join('、') || '（一个都没有）'}`,
      })
      continue
    }
    healthy += 1
  }

  const total = entries.length
  return {
    ok: true,
    mode: 'audit',
    total,
    healthy,
    // 排序只为输出稳定，否则每次跑出来的顺序都不一样，模型很难比较两份体检
    dead: dead.sort((a, b) => a.workflowId.localeCompare(b.workflowId)),
    degraded: degraded.sort((a, b) => a.workflowId.localeCompare(b.workflowId)),
    ...(broken.length > 0 ? { skippedFiles: broken } : {}),
    ...(disabled.length > 0
      ? { disabledCount: disabled.length, disabledHint: `另有 ${disabled.length} 套被停用，未计入（在面板里可重新启用）。` }
      : {}),
    verdict:
      dead.length === 0 && degraded.length === 0
        ? `${total} 套全部可用。`
        : `${total} 套里 ${healthy} 套能用；${dead.length} 套缺节点（必然跑不起来）、${degraded.length} 套缺模型（能提交但会跑偏或报错）。`,
    hint: dead.length === 0 && degraded.length === 0
      ? ''
      : '缺节点的模板，要么在 ComfyUI 里装回那个节点包，要么换一套模板；缺模型的，改用返回里建议的替代模型，或在面板里把 `models.primary` 指向本机已有的。',
  }
}
