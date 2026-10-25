import { modelFromWorkflow } from './graph.js'
import type { MetaRecord, SummaryFields } from './types.js'

/** 提示词在列表里的截断上限：1200 字符覆盖实际提示词，也够灯箱展示。 */
const PROMPT_CLIP = 1200
/** 负向提示词上限。 */
const NEGATIVE_CLIP = 800

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
 * 把 sidecar 压成列表条目需要的字段。
 *
 * @param meta - sidecar 内容。
 */
export function metaSummary(meta: MetaRecord | undefined): SummaryFields {
  if (meta === undefined) return { hasMeta: false }
  return {
    hasMeta: true,
    // sidecar 是插件自己的记录；embedded 表示从 PNG 的 prompt 块现读出来的。
    metaSource: text(meta.source),
    prompt: clip(text(meta.prompt), PROMPT_CLIP),
    negativePrompt: clip(text(meta.negativePrompt), NEGATIVE_CLIP),
    mode: text(meta.mode),
    seed: num(meta.seed),
    width: num(meta.width),
    height: num(meta.height),
    steps: num(meta.steps),
    cfgScale: num(meta.cfgScale),
    strength: num(meta.strength),
    samplerName: text(meta.samplerName),
    scheduler: text(meta.scheduler),
    checkpoint: text(meta.checkpoint) ?? modelFromWorkflow(meta.workflow),
    createdAt: text(meta.createdAt),
    workflow: meta.workflow !== undefined && meta.workflow !== null,
  }
}
