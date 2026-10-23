import type { ApiNode, ApiWorkflow, IOSlot, ModelRef, OutputSlot, VarType } from './types.js'

/** 推断结果：UI 面需要的全部素材。 */
export interface Inferred {
  slots: IOSlot[]
  models: ModelRef[]
  outputs: OutputSlot[]
  /** 推断过程中值得让人知道的事（同名冲突、未识别的末端节点等）。 */
  notes: string[]
}

/** 内部参数：这些是"模板的实现细节"，不是用户该调的旋钮。 */
const INTERNAL_INPUT: RegExp[] = [
  /^(ckpt_name|unet_name|model_name|lora_name|vae_name|control_net_name|clip_name|style_model_name)$/i,
  /^(vae|clip|batch_size|filename_prefix|sampler_state|widgets_values|noise_seed_offset)$/i,
  /^(save_prefix|save_to_comfyui|output_dir)$/i,
]

/** ComfyUI 的连线：`[nodeId, outputIndex]`。 */
function isLink(value: unknown): value is [string | number, number] {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[1] === 'number' &&
    (typeof value[0] === 'string' || typeof value[0] === 'number')
}

/** 把工作流筛成"真节点"列表。 */
function nodesOf(workflow: ApiWorkflow): Array<[string, ApiNode]> {
  const out: Array<[string, ApiNode]> = []
  for (const [id, node] of Object.entries(workflow)) {
    if (node === null || typeof node !== 'object') continue
    if (typeof node.class_type !== 'string') continue
    if (node.inputs === null || typeof node.inputs !== 'object') continue
    out.push([id, node])
  }
  return out
}

/** 节点标题：`_meta.title` → class_type。 */
function titleOf(node: ApiNode): string {
  const title = node._meta !== undefined && node._meta !== null ? node._meta.title : undefined
  if (typeof title === 'string' && title.trim() !== '') return title
  return typeof node.class_type === 'string' ? node.class_type : 'node'
}

/**
 * 沿一条连线找到真正持有文本的节点。
 *
 * 采样器的 positive/negative 可能直连 CLIPTextEncode，也可能经过
 * ConditioningCombine 之类的中间节点，所以最多下钻 3 层。
 */
function traceText(
  byId: Map<string, ApiNode>,
  link: unknown,
  depth = 0,
): { nodeId: string; key: string } | undefined {
  if (depth > 3 || !isLink(link)) return undefined
  const node = byId.get(String(link[0]))
  if (node === undefined) return undefined
  for (const [key, value] of Object.entries(node.inputs)) {
    if (typeof value === 'string' && value.trim() !== '' && /^(text|prompt|text_g|text_l|positive)$/i.test(key)) {
      return { nodeId: String(link[0]), key }
    }
  }
  for (const value of Object.values(node.inputs)) {
    if (isLink(value)) {
      const found = traceText(byId, value, depth + 1)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** 输入名看起来是图像/遮罩，或值本身就是图片路径。 */
function imageKindOf(key: string, value: unknown): 'image' | 'mask' | undefined {
  const nameHit = /(input_?image|image|mask|init_image|reference)/i.test(key)
  const pathHit = typeof value === 'string' && /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(value)
  if (!nameHit && !pathHit) return undefined
  return /mask/i.test(key) ? 'mask' : 'image'
}

/** 值 → 类型。数组与对象（非连线）不是可编辑的字面量，直接跳过。 */
function typeOf(key: string, value: unknown): VarType | undefined {
  const image = imageKindOf(key, value)
  if (image !== undefined) return image
  if (typeof value === 'string') return 'string'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  return undefined
}

/** 模型加载节点：class_type 特征 → 字段名 → kind。 */
const MODEL_RULES: Array<{ pattern: RegExp; fields: string[]; kind: ModelRef['kind'] }> = [
  { pattern: /checkpoint/i, fields: ['ckpt_name'], kind: 'checkpoint' },
  { pattern: /(unet|diffusion)/i, fields: ['unet_name', 'model_name'], kind: 'diffusion' },
  { pattern: /lora/i, fields: ['lora_name'], kind: 'lora' },
  { pattern: /vae/i, fields: ['vae_name'], kind: 'vae' },
  { pattern: /upscale/i, fields: ['model_name'], kind: 'upscale' },
]

const MODEL_EXT = /\.(safetensors|ckpt|pt|pth|gguf|bin)$/i

/** 提取工作流引用的模型。 */
function inferModels(nodes: Array<[string, ApiNode]>): ModelRef[] {
  const found: ModelRef[] = []
  for (const [id, node] of nodes) {
    const classType = typeof node.class_type === 'string' ? node.class_type : ''
    const rule = MODEL_RULES.find(entry => entry.pattern.test(classType))
    for (const key of rule?.fields ?? []) {
      const value = node.inputs[key]
      if (typeof value === 'string' && value !== '') {
        found.push({ name: value, kind: rule?.kind ?? 'other', nodeId: id })
        break
      }
    }
    if (rule !== undefined) continue
    // 兜底：字段名像模型、值也像模型文件。
    for (const [key, value] of Object.entries(node.inputs)) {
      if (/(ckpt|checkpoint|unet|model|lora|vae).*name$/i.test(key) && typeof value === 'string' && MODEL_EXT.test(value)) {
        found.push({ name: value, kind: 'other', nodeId: id })
        break
      }
    }
  }

  // primary：checkpoint 优先，其次 diffusion，再次第一个。
  const primary = found.find(entry => entry.kind === 'checkpoint')
    ?? found.find(entry => entry.kind === 'diffusion')
    ?? found[0]
  if (primary !== undefined) primary.primary = true

  // 去重（同名同 kind 只留一条）。
  const seen = new Set<string>()
  return found.filter(entry => {
    const key = `${entry.kind}|${entry.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** 被其它节点引用过的节点 id（即"不是末端"）。 */
function referencedIds(nodes: Array<[string, ApiNode]>): Set<string> {
  const used = new Set<string>()
  for (const [, node] of nodes) {
    for (const value of Object.values(node.inputs)) {
      if (isLink(value)) used.add(String(value[0]))
    }
  }
  return used
}

/** 末端节点的产物类型。不按节点全名匹配，只按类名里的关键词。 */
function outputKindOf(classType: string): OutputSlot['kind'] {
  if (/video|animated|gif|mp4|webm|h264/i.test(classType)) return 'video'
  if (/audio|sound|wave|mp3|flac/i.test(classType)) return 'audio'
  if (/image|png|jpeg|webp|preview|save/i.test(classType)) return 'image'
  return 'file'
}

/** 推断输出槽位。 */
function inferOutputs(nodes: Array<[string, ApiNode]>, notes: string[]): OutputSlot[] {
  const used = referencedIds(nodes)
  const terminals = nodes.filter(([id]) => !used.has(id))
  const outputs: OutputSlot[] = []

  for (const [id, node] of terminals) {
    const classType = typeof node.class_type === 'string' ? node.class_type : ''
    // 明显的非输出末端（比如只喂给别处的编码器）跳过。
    if (/loader|encode|sampler|conditioning|lora|vae|clip/i.test(classType) && !/save|preview/i.test(classType)) continue
    outputs.push({ nodeId: id, key: 'images', kind: outputKindOf(classType), count: 'dynamic', label: titleOf(node) })
  }

  if (outputs.length === 0) {
    notes.push('没有识别出末端输出节点：模板可能缺少 SaveImage / PreviewImage，运行后可能拿不到产物。')
  }
  return outputs
}

/**
 * 从 API 格式工作流推断 IO 面。
 *
 * 规则（对应设计 §3.8）：
 *   - 连线不是旋钮 → 跳过
 *   - 内部参数（模型名、vae、batch_size、filename_prefix）→ 跳过
 *   - 正负提示词按采样器连线回溯命名，比 input 键名（text）可读得多
 *   - basic 只收提示词与图像输入，其余进 advanced
 *
 * @param workflow - API 格式工作流。
 * @param extraInternal - 额外视为内部参数的 input 名（来自 schema）。
 */
export function inferSurface(workflow: ApiWorkflow, extraInternal: readonly string[] = []): Inferred {
  const nodes = nodesOf(workflow)
  const notes: string[] = []
  const byId = new Map(nodes.map(([id, node]) => [id, node]))

  const sampler = nodes.find(([, node]) =>
    /sampler/i.test(String(node.class_type)) &&
    node.inputs.positive !== undefined &&
    node.inputs.negative !== undefined,
  )
  const positive = sampler === undefined ? undefined : traceText(byId, sampler[1].inputs.positive)
  const negative = sampler === undefined ? undefined : traceText(byId, sampler[1].inputs.negative)

  const slots: IOSlot[] = []
  const taken = new Map<string, IOSlot>()

  for (const [id, node] of nodes) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLink(value)) continue
      if (INTERNAL_INPUT.some(pattern => pattern.test(key))) continue
      if (extraInternal.includes(key)) continue
      const type = typeOf(key, value)
      if (type === undefined) continue

      // 语义命名：正负提示词优先，其次 input 键名。
      let name = key
      if (positive !== undefined && positive.nodeId === id && positive.key === key) name = 'prompt'
      else if (negative !== undefined && negative.nodeId === id && negative.key === key) name = 'negative_prompt'

      const existing = taken.get(name)
      if (existing !== undefined) {
        if (existing.type === type && existing.default === (value as string | number | boolean)) continue
        // 同名不同值：加节点后缀，别让两个参数共用一个名字。
        const renamed = `${name}_${id}`
        notes.push(`参数 ${name} 在节点 ${id} 上另有取值，已重命名为 ${renamed}。`)
        name = renamed
      }

      // 只有"必须给一张图却没有"才算必填。其余参数模板里本来就有值（哪怕是空串），
      // 把空串一律当"缺"会让复杂节点（wildcard 之类）在运行时误报 variable_unbound。
      const empty = value === '' || value === null || value === undefined
      const required = empty && (type === 'image' || type === 'mask')
      const slot: IOSlot = {
        name,
        bind: `${id}.inputs.${key}`,
        label: titleOf(node),
        type,
        required,
        group: classify({ name, type, required }),
        ...(required ? {} : { default: value as string | number | boolean }),
      }
      slots.push(slot)
      taken.set(name, slot)
    }
  }

  // basic 兜底：整合包的提示词常叫 text / character / action，不叫 prompt。
  // 一个 basic 都没有时，把最像提示词的提上来 —— 否则界面第一屏是空的。
  if (!slots.some(slot => slot.group === 'basic')) {
    const candidates = slots.filter(slot => slot.type === 'string' && /text|prompt|character|action|caption|description|wildcard/i.test(slot.name))
    for (const slot of candidates.slice(0, 2)) {
      slot.group = 'basic'
      notes.push(`没有识别出标准提示词参数，已把 ${slot.name} 提为常用参数。`)
    }
  }

  // basic 段上限 3：提示词优先，其余下沉。
  const basicCount = slots.filter(slot => slot.group === 'basic').length
  if (basicCount > 3) {
    let kept = 0
    for (const slot of slots) {
      if (slot.group !== 'basic') continue
      kept += 1
      if (kept > 3) slot.group = 'advanced'
    }
    notes.push(`基础参数超过 3 个，其余 ${basicCount - 3} 个已折进"更多参数"。`)
  }

  return {
    slots: limitSlots(slots, notes),
    models: inferModels(nodes),
    outputs: inferOutputs(nodes, notes),
    notes,
  }
}

/** 单份工作流最多暴露多少个参数。整合包的 PromptAndLoraLoader 能塞出三百个（lora_name_1..49）。 */
const MAX_EXPOSED_SLOTS = 24

/** 参数名的优先级：提示词 > 常见旋钮 > 采样/模型 > 其余。 */
const PRIORITY: RegExp[] = [
  /^(prompt|negative_prompt|text|text_g|text_l|caption|character|action|wildcard)$/i,
  /^(seed|noise_seed|steps|cfg|denoise|strength|width|height|batch_size|guidance)$/i,
  /^(sampler_name|scheduler|checkpoint|model|lora_name)$/i,
]

/** 一个槽位的排序权重（越小越靠前）。 */
function rankOf(slot: IOSlot): number {
  if (slot.group === 'basic') return 0
  for (let index = 0; index < PRIORITY.length; index += 1) {
    if ((PRIORITY[index] as RegExp).test(slot.name)) return index + 1
  }
  return PRIORITY.length + 1
}

/**
 * 限制暴露的参数数量。
 *
 * 三百个 lora 权重对用户和模型都是灾难：模型选不出该改哪个，界面上也无从下手。
 * 按优先级保留前 N 个，其余不暴露（仍然留在模板里，需要时用 `persist` 改节点）。
 */
function limitSlots(slots: IOSlot[], notes: string[]): IOSlot[] {
  if (slots.length <= MAX_EXPOSED_SLOTS) return slots
  const kept = slots
    .map((slot, index) => ({ slot, index, rank: rankOf(slot) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
    .slice(0, MAX_EXPOSED_SLOTS)
    .sort((a, b) => a.index - b.index)
    .map(item => item.slot)

  notes.push(`参数太多（${slots.length} 个），只暴露了最相关的 ${MAX_EXPOSED_SLOTS} 个；其余仍可用 persist 改节点。`)
  return kept
}

/**
 * 哪些参数进第一屏：提示词与**必填的**图像输入。
 *
 * 非必填的 mask（noise_mask、sam_mask_hint_threshold 之类）是节点的高级选项，
 * 归进 basic 只会把用户的注意力从"填提示词"上带走。
 */
function classify(slot: { name: string; type: VarType; required: boolean }): IOSlot['group'] {
  if (slot.required && (slot.type === 'image' || slot.type === 'mask')) return 'basic'
  if (slot.type === 'image' && /^(input_image|image|init_image|reference|image_path)$/i.test(slot.name)) return 'basic'
  if (slot.type === 'string' && /^(prompt|negative_prompt|text)$/i.test(slot.name)) return 'basic'
  return 'advanced'
}
