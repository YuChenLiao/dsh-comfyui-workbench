import { modelFromVars, modelFromWorkflow } from './graph.js'
import type { MetaRecord, SummaryFields } from './types.js'

/**
 * 提示词在列表里的截断上限：4000 字符覆盖绝大多数长 tag 串，
 * 同时防止极端巨型文本撑爆单页列表；超限时附带 `promptClipped: true` 让前端回读 `/meta`。
 */
const PROMPT_CLIP = 4000
/** 负向提示词上限；超限时附带 `negativePromptClipped: true`。 */
const NEGATIVE_CLIP = 2000

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

/** 截断超长文本：列表一次返回几十条，不设上限会被个别巨型提示词撑爆。 */
function clip(value: string | undefined, max: number): string | undefined {
  if (value === undefined) return undefined
  return value.length > max ? `${value.slice(0, max)}…` : value
}

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * sidecar 里的 `comfy.promptId` —— 那次运行的唯一标识。
 *
 * 列表去重要靠它：同一 seed、同一提示词跑两次是**两张不同的图**，
 * 只有同一次运行产生的多份副本才算重复（见 `dedupe.ts`）。
 */
function promptIdOf(meta: MetaRecord): string | undefined {
  const comfy = meta.comfy
  if (comfy === null || typeof comfy !== 'object') return undefined
  return text((comfy as Record<string, unknown>).promptId)
}

/**
 * 把 sidecar 压成列表条目需要的字段。
 *
 * @param meta - sidecar 内容。
 */
export function metaSummary(meta: MetaRecord | undefined): SummaryFields {
  if (meta === undefined) return { hasMeta: false }
  const rawPrompt = text(meta.prompt)
  const rawNegative = text(meta.negativePrompt)
  const promptClipped = rawPrompt !== undefined && rawPrompt.length > PROMPT_CLIP
  const negativePromptClipped = rawNegative !== undefined && rawNegative.length > NEGATIVE_CLIP
  return {
    hasMeta: true,
    // sidecar 是插件自己的记录；embedded 表示从 PNG 的 prompt 块现读出来的。
    metaSource: text(meta.source),
    prompt: clip(rawPrompt, PROMPT_CLIP),
    ...(promptClipped ? { promptClipped: true } : {}),
    negativePrompt: clip(rawNegative, NEGATIVE_CLIP),
    ...(negativePromptClipped ? { negativePromptClipped: true } : {}),
    mode: text(meta.mode),
    seed: num(meta.seed),
    width: num(meta.width),
    height: num(meta.height),
    steps: num(meta.steps),
    cfgScale: num(meta.cfgScale),
    strength: num(meta.strength),
    samplerName: text(meta.samplerName),
    scheduler: text(meta.scheduler),
    // 三个来源按可靠性排：顶层字段（ComfyUI 内嵌块）→ `vars`（**插件自己写的 sidecar**，
    // 参数全在这里）→ 内嵌 `workflow` 图。漏掉中间那条的话，"按底模筛选"对自家产物恒为 0。
    checkpoint: text(meta.checkpoint) ?? modelFromVars(meta.vars) ?? modelFromWorkflow(meta.workflow),
    createdAt: text(meta.createdAt),
    // 相册能按工作流名检索时，`q` 的命中断言才有意义（见 service.ts 的 haystack）
    workflowId: text(meta.workflowId),
    promptId: promptIdOf(meta),
    workflow: meta.workflow !== undefined && meta.workflow !== null,
  }
}
