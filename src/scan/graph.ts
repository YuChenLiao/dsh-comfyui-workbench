import type { MetaRecord } from './types.js'

/** 判定为节点的最小形状：有 inputs 对象的对象。 */
interface GraphNode {
  class_type?: unknown
  inputs: Record<string, unknown>
}

/** 从工作流图里抽出的、列表与灯箱要展示的字段。 */
export interface ExtractedGraph {
  prompt?: string
  negativePrompt?: string
  seed?: number
  steps?: number
  cfgScale?: number
  samplerName?: string
  scheduler?: string
  width?: number
  height?: number
  checkpoint?: string
  workflow: MetaRecord
}

/** 把 graph 里所有形似节点的条目取出来。 */
function entriesOf(graph: MetaRecord): Array<[string, GraphNode]> {
  const out: Array<[string, GraphNode]> = []
  for (const [id, node] of Object.entries(graph)) {
    if (node === null || typeof node !== 'object') continue
    const inputs = (node as { inputs?: unknown }).inputs
    if (inputs === null || typeof inputs !== 'object') continue
    out.push([id, { class_type: (node as { class_type?: unknown }).class_type, inputs: inputs as Record<string, unknown> }])
  }
  return out
}

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * 从 ComfyUI 的 API 格式工作流里抽出要展示的字段。
 *
 * 正负提示词靠 KSampler 的 positive / negative 连线回溯（最多三层，覆盖
 * CLIPTextEncode 直接相连与经过 ConditioningCombine 的情况）。
 *
 * @param graph - API 格式工作流。
 */
export function extractFromGraph(graph: MetaRecord): ExtractedGraph | undefined {
  const entries = entriesOf(graph)
  if (entries.length === 0) return undefined
  const byId = new Map(entries.map(([id, node]) => [id, node]))

  const followText = (link: unknown, depth: number): string | undefined => {
    if (depth > 3 || !Array.isArray(link) || link.length === 0) return undefined
    const node = byId.get(String(link[0]))
    if (node === undefined) return undefined
    const own = text(node.inputs.text)
    if (own !== undefined) return own
    for (const key of Object.keys(node.inputs)) {
      const value = node.inputs[key]
      if (Array.isArray(value)) {
        const found = followText(value, depth + 1)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  const samplerEntry = entries.find(([, node]) =>
    /sampler/i.test(String(node.class_type)) &&
    node.inputs.positive !== undefined &&
    node.inputs.negative !== undefined,
  )
  const samplerInputs: Record<string, unknown> = samplerEntry === undefined ? {} : samplerEntry[1].inputs
  const allTexts = entries
    .map(([, node]) => text(node.inputs.text))
    .filter((value): value is string => value !== undefined)

  const positive = samplerEntry === undefined ? undefined : followText(samplerInputs.positive, 0)
  const negative = samplerEntry === undefined ? undefined : followText(samplerInputs.negative, 0)
  // 兜底只在拿不到采样器连线时启用：第一个文本当正向、最后一个当负向。
  // 多段拼接的正向提示词可能被拆开，所以这条路径的结果只能算"够用"。
  const fallbackPositive = allTexts.length > 0 ? allTexts[0] : undefined
  const fallbackNegative = allTexts.length > 1 ? allTexts[allTexts.length - 1] : undefined

  const sizeNode = entries
    .map(([, node]) => node)
    .find(node => typeof node.inputs.width === 'number' && typeof node.inputs.height === 'number')
  const checkpoint = entries
    .map(([, node]) => node.inputs.ckpt_name ?? node.inputs.unet_name ?? node.inputs.model_name)
    .find((value): value is string => typeof value === 'string' && value !== '')

  return {
    prompt: positive ?? fallbackPositive,
    negativePrompt: negative ?? fallbackNegative,
    seed: num(samplerInputs.seed) ?? num(samplerInputs.noise_seed),
    steps: num(samplerInputs.steps),
    cfgScale: num(samplerInputs.cfg),
    samplerName: text(samplerInputs.sampler_name),
    scheduler: text(samplerInputs.scheduler),
    width: sizeNode === undefined ? undefined : num(sizeNode.inputs.width),
    height: sizeNode === undefined ? undefined : num(sizeNode.inputs.height),
    checkpoint,
    workflow: graph,
  }
}

/**
 * 从 ComfyUI 工作流里取模型名。
 *
 * 顶层 `checkpoint` 只在插件认出底模时才写；换了 UNET/GGUF 之类的工作流就没有
 * 这个字段，但节点参数里仍有名字。按节点顺序取第一个权重名，够列表与灯箱展示。
 *
 * @param workflow - API 格式工作流。
 */
export function modelFromWorkflow(workflow: unknown): string | undefined {
  if (workflow === null || typeof workflow !== 'object') return undefined
  for (const node of Object.values(workflow as MetaRecord)) {
    if (node === null || typeof node !== 'object') continue
    const inputs = (node as { inputs?: unknown }).inputs
    if (inputs === null || typeof inputs !== 'object') continue
    const bag = inputs as Record<string, unknown>
    for (const key of ['ckpt_name', 'unet_name', 'model_name']) {
      const value = bag[key]
      if (typeof value === 'string' && value !== '') return value
    }
  }
  return undefined
}
