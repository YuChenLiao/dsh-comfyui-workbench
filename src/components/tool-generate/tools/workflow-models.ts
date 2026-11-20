/**
 * `comfyui_workflow { models: … }` 的模型盘点分支。
 *
 * 复用 `comfyui_workflow` 这个已有工具，不新增工具名 —— 工具数量本身就是负担，
 * 而"我本机有哪些模型"和"我有哪些模板"是同一个问题域的两面。
 *
 * 只回答清单，不做推荐：模型要的是"能用什么"，挑哪个由它按任务决定。
 */
import path from 'node:path'

import { catalogModels } from '../../../shared/comfy/catalog.js'
import type { ModelKind } from '../../../shared/comfy/catalog.js'
import { pluginDataDir } from '../../../shared/host/paths.js'
import { asString } from '../../../shared/tools/types.js'
import type { ToolDeps } from '../../../shared/tools/types.js'

/** `models` 参数可以是 `true`（全部）或类别名（只看一类）。 */
const KINDS: readonly ModelKind[] = ['checkpoint', 'lora', 'vae', 'controlnet', 'upscaler', 'other']

export function wantsModels(value: unknown): boolean {
  // 归一化再判：`'TRUE'` / `'1 '` / `'LORA'` 都算 —— 严格比对会让"大小写写错"
  // 静默降级成列工作流，而那正是这个文件要避免的
  const text = String(value).trim().toLowerCase()
  if (text === 'true' || text === '1') return true
  return KINDS.includes(text as ModelKind)
}

/** 合法取值清单（拼进错误信息）。 */
export function modelKindsHint(): string {
  return `true 或 ${KINDS.join(' / ')}`
}

/**
 * 盘点本机模型。
 *
 * @param deps - 依赖（拿 ComfyUI 的节点清单）。
 * @param args - `models` 可以是类别名，只回那一类。
 */
export async function listModels(deps: ToolDeps, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  let info: Awaited<ReturnType<ToolDeps['client']['objectInfo']>>
  try {
    info = await deps.client.objectInfo()
  } catch (error) {
    // 与体检同一个取舍：拿不到节点清单就明说，不假装"本机什么模型都没有"
    return {
      ok: false,
      mode: 'models',
      message: `查不到 ComfyUI 的节点清单，无法盘点模型：${error instanceof Error ? error.message : String(error)}`,
      hint: '服务没起来或连不上。插件通常会自动拉起，等一会儿再试。',
    }
  }

  const triggerFile = path.join(pluginDataDir(), 'loras.json')
  const catalog = catalogModels(info, triggerFile)
  const only = asString(args.models).trim().toLowerCase()
  const kinds = KINDS.includes(only as ModelKind) ? [only as ModelKind] : KINDS

  const models: Record<string, string[]> = {}
  for (const kind of kinds) {
    const list = catalog.byKind[kind]
    if (list.length > 0) models[kind] = list
  }

  // 触发词只对 LoRA 有意义，但也允许用户给 checkpoint 写（有些人确实记在那里）
  const triggers: Record<string, string> = {}
  for (const [name, text] of Object.entries(catalog.triggers)) {
    triggers[name] = text
  }

  return {
    ok: true,
    mode: 'models',
    counts: catalog.counts,
    models,
    ...(Object.keys(triggers).length === 0 ? {} : { triggers }),
    // 没备注时也给出文件位置：模型可以建议用户去写，而不是"没有就是没有"
    triggerFile: catalog.triggerFile,
    // 形状写在 hint 里：否则模型被指到一个文件，却不知道写什么格式
    hint: '触发词备注写在 triggerFile（JSON）：{"模型名": "触发词"}，'
      + '或 {"模型名": {"triggers": "触发词", "note": "备注"}}。'
      + '拼提示词时把 triggers 里的内容原样带上；`comfyui_run` 的 vars 里填模型名要用这里的原样字符串。',
    ...(catalog.triggerError === undefined ? {} : { triggerError: catalog.triggerError }),
  }
}
