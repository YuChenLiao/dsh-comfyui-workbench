import type { ApiWorkflow } from './types.js'

/** UI 格式里的一个节点。 */
interface UiNode {
  id: number | string
  type?: unknown
  title?: unknown
  mode?: unknown
  inputs?: Array<{ name?: unknown; type?: unknown; link?: unknown }>
  outputs?: Array<{ name?: unknown; type?: unknown; links?: unknown }>
  widgets_values?: unknown
  [key: string]: unknown
}

/** UI 格式工作流（ComfyUI 界面保存的那种）。 */
interface UiWorkflow {
  nodes?: unknown
  links?: unknown
  [key: string]: unknown
}

/** `/object_info` 里一个节点的输入定义。 */
interface NodeInputSpec {
  required?: Record<string, unknown>
  optional?: Record<string, unknown>
}

/** 转换结果。 */
export interface UiConversion {
  workflow: ApiWorkflow
  /** 转换过程中值得记录的取舍（被丢掉的 UI 专用节点等）。 */
  notes: string[]
}

/** UI 专用、不该进 API 格式的节点类型。 */
const UI_ONLY = new Set(['Note', 'MarkdownNote', 'Reroute', 'PrimitiveNode', 'PreviewAny'])

/** widget 值里表示"生成后再随机"的控制项，占一个槽位但不是输入。 */
const CONTROL_VALUES = new Set(['fixed', 'randomize', 'increment', 'decrement'])

/** 输入的声明是否代表一个可填值的 widget（而不是连线）。 */
function isWidget(decl: unknown): boolean {
  if (!Array.isArray(decl) || decl.length === 0) return false
  const type = decl[0]
  if (Array.isArray(type)) return true // COMBO：候选值数组
  if (typeof type !== 'string') return false
  return ['INT', 'FLOAT', 'STRING', 'BOOLEAN', 'COMBO'].includes(type)
}

/**
 * 按 object_info 的声明顺序列出某个 class_type 的 widget 输入名。
 *
 * ComfyUI 前端就是按这个顺序把 `widgets_values` 逐个配上去的，所以顺序必须与
 * `required` 后接 `optional` 的键序一致 —— 顺序错了会把 steps 填进 cfg。
 */
/** 该输入是否是可选项列表（COMBO）。 */
function comboOptionsOf(decl: unknown): string[] | undefined {
  if (!Array.isArray(decl) || decl.length === 0) return undefined
  return Array.isArray(decl[0]) ? (decl[0] as string[]) : undefined
}

function widgetSpecsOf(spec: NodeInputSpec): Map<string, unknown> {
  const out = new Map<string, unknown>()
  for (const bag of [spec.required, spec.optional]) {
    if (bag === undefined || bag === null) continue
    for (const [name, decl] of Object.entries(bag)) {
      if (isWidget(decl)) out.set(name, decl)
    }
  }
  return out
}

/** link 表：linkId → 源节点与源槽位。 */
function linkMapOf(links: unknown): Map<number, { nodeId: string; slot: number }> {
  const map = new Map<number, { nodeId: string; slot: number }>()
  if (!Array.isArray(links)) return map
  for (const link of links) {
    if (!Array.isArray(link) || link.length < 5) continue
    const [id, originId, originSlot] = link as [unknown, unknown, unknown]
    if (typeof id !== 'number' || typeof originSlot !== 'number') continue
    map.set(id, { nodeId: String(originId), slot: originSlot })
  }
  return map
}

/**
 * 沿连线找到真正的来源。
 *
 * Reroute 只是转发、PrimitiveNode 提供常量 —— 两者都不进 API 格式，
 * 必须在转换时展开，否则提交会在这些节点上报未知类型。
 */
function resolveOrigin(
  linkId: number,
  byId: Map<string, UiNode>,
  links: Map<number, { nodeId: string; slot: number }>,
  depth = 0,
): { kind: 'link'; nodeId: string; slot: number } | { kind: 'value'; value: unknown } | undefined {
  if (depth > 8) return undefined
  const origin = links.get(linkId)
  if (origin === undefined) return undefined
  const node = byId.get(origin.nodeId)
  if (node === undefined) return undefined

  const type = typeof node.type === 'string' ? node.type : ''
  if (type === 'Reroute') {
    const inner = node.inputs?.find(input => typeof input.link === 'number')
    return typeof inner?.link === 'number' ? resolveOrigin(inner.link, byId, links, depth + 1) : undefined
  }

  // bypass（mode 4）在 ComfyUI 里的语义是"直通"：输出等于类型匹配的那个输入。
  // 直接删掉节点会留下悬空引用，所以这里顺着它的输入继续往上找。
  if (node.mode === 4) {
    const forwarded = bypassSourceOf(node, origin.slot)
    return forwarded === undefined ? undefined : resolveOrigin(forwarded, byId, links, depth + 1)
  }
  if (type === 'PrimitiveNode') {
    const values = Array.isArray(node.widgets_values) ? node.widgets_values : []
    return { kind: 'value', value: values[0] }
  }
  return { kind: 'link', nodeId: origin.nodeId, slot: origin.slot }
}

/**
 * bypass 节点的直通源：按输出槽的类型，找第一个类型相同的已连线输入。
 *
 * ComfyUI 界面就是这么做的（旁路节点的输出直接由同类型输入顶替）。
 */
function bypassSourceOf(node: UiNode, outputSlot: number): number | undefined {
  const outputs = node.outputs
  if (!Array.isArray(outputs)) return undefined
  const slot = outputs[outputSlot] as { type?: unknown } | undefined
  const wanted = typeof slot?.type === 'string' ? slot.type : ''
  if (wanted === '') return undefined
  for (const input of node.inputs ?? []) {
    const type = typeof input.type === 'string' ? input.type : ''
    if (type !== wanted) continue
    if (typeof input.link === 'number') return input.link
  }
  return undefined
}

/** 把 widgets_values 按 widget 名配对（含 seed 后面那个 control_after_generate 槽位）。 */
function widgetValuesOf(node: UiNode, names: readonly string[]): Record<string, unknown> {
  const raw = node.widgets_values
  const out: Record<string, unknown> = {}

  // 新版 ComfyUI 对部分节点直接给对象，按名取即可。
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const name of names) {
      if (name in (raw as Record<string, unknown>)) out[name] = (raw as Record<string, unknown>)[name]
    }
    return out
  }

  const list = Array.isArray(raw) ? raw : []
  let cursor = 0
  for (const name of names) {
    if (cursor >= list.length) break
    out[name] = list[cursor]
    cursor += 1
    // seed / noise_seed 后面常跟着一个控制项（fixed / randomize…），它不是输入。
    const next = list[cursor]
    if (typeof next === 'string' && CONTROL_VALUES.has(next) && /seed/i.test(name)) cursor += 1
  }
  return out
}

/**
 * UI 格式 → API 格式。
 *
 * 需要 `/object_info`：widget 顺序只能从节点定义里读，猜不出来。
 * 缺某个节点定义时该节点会被跳过并记一条 note，而不是让整份工作流失败。
 *
 * @param ui - UI 格式工作流。
 * @param objectInfo - `/object_info` 的返回。
 */
export function convertUiToApi(ui: UiWorkflow, objectInfo: Record<string, unknown>): UiConversion {
  const notes: string[] = []
  const nodes = Array.isArray(ui.nodes) ? (ui.nodes as UiNode[]) : []
  const links = linkMapOf(ui.links)
  const byId = new Map(nodes.map(node => [String(node.id), node]))

  const workflow: ApiWorkflow = {}
  let skipped = 0
  let muted = 0
  let placeholders = 0
  let bypassed = 0

  for (const node of nodes) {
    const type = typeof node.type === 'string' ? node.type : ''
    if (type === '') continue
    if (UI_ONLY.has(type)) continue
    // mode: 0=正常, 2=静音, 4=旁路。两者都不写进提交：
    // - 旁路：下游对它的引用由 resolveOrigin 顺到它同类型的输入上（直通）；
    //   若把它也提交，它会成为没有下游的孤立节点被执行，反而报类型错。
    // - 静音：真不执行。
    if (node.mode === 2 || node.mode === 4) {
      if (node.mode === 2) muted += 1
      else bypassed += 1
      continue
    }

    const spec = objectInfo[type] as { input?: NodeInputSpec } | undefined
    if (spec === undefined) {
      notes.push(`节点 ${node.id}（${type}）不在 /object_info 里，已跳过（可能缺自定义节点）。`)
      skipped += 1
      continue
    }

    const inputs: Record<string, unknown> = {}
    const specInput = spec.input ?? {}

    // 1. 连线：节点上明确标了 link 的输入。
    for (const input of node.inputs ?? []) {
      const name = typeof input.name === 'string' ? input.name : ''
      const linkId = input.link
      if (name === '' || typeof linkId !== 'number') continue
      const resolved = resolveOrigin(linkId, byId, links)
      if (resolved === undefined) continue
      inputs[name] = resolved.kind === 'link' ? [resolved.nodeId, resolved.slot] : resolved.value
    }

    // 2. widget 值。
    const specs = widgetSpecsOf(specInput)
    for (const [name, value] of Object.entries(widgetValuesOf(node, [...specs.keys()]))) {
      if (name in inputs) continue // 连线优先

      // UI 里有些 combo 的"当前值"其实是提示文案（"Select Wildcard 🟢 Full Cache"、
      // "Select the LoRA to add to the text"），提交上去 ComfyUI 会判 value_not_in_list。
      // 不在候选里的就丢掉，让它用节点默认。
      const options = comboOptionsOf(specs.get(name))
      if (options !== undefined && typeof value === 'string' && value !== '' && !options.includes(value)) {
        // 占位值不能用；但整个删掉会让必填项缺失，所以退到第一个有效选项。
        const fallback = options[0]
        placeholders += 1
        if (fallback !== undefined) inputs[name] = fallback
        continue
      }
      inputs[name] = value
    }

    workflow[String(node.id)] = {
      class_type: type,
      inputs,
      ...(typeof node.title === 'string' && node.title !== '' ? { _meta: { title: node.title } } : {}),
    }
  }

  if (skipped > 0) notes.push(`${skipped} 个节点的定义缺失，转换结果可能无法直接运行。`)
  if (muted > 0) notes.push(`${muted} 个节点在 UI 里被静音（不执行），已跳过。`)
  if (bypassed > 0) notes.push(`${bypassed} 个节点在 UI 里被旁路，已按直通接续下游。`)
  if (placeholders > 0) notes.push(`${placeholders} 个下拉框的当前值是界面提示语（不是有效选项），已按节点默认处理。`)
  if (Object.keys(workflow).length === 0) notes.push('转换后没有任何节点可提交。')

  return { workflow, notes }
}
