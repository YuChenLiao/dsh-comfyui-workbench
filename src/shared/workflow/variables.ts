import type { ApiWorkflow, IOSlot } from './types.js'

/** 变量绑定失败的分类。 */
export type VariableErrorCode = 'variable_unbound' | 'variable_type' | 'variable_unknown'

/** 变量处理错误：带分类，便于 runner 映射成对外错误码。 */
export class VariableError extends Error {
  readonly code: VariableErrorCode
  readonly detail: Record<string, unknown>

  constructor(code: VariableErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'VariableError'
    this.code = code
    this.detail = detail
  }
}

/** 一次变量应用的结果。 */
export interface AppliedVariables {
  workflow: ApiWorkflow
  /** 实际生效的值（含默认值补全），回给调用方做"表单 vs 实际"的比对。 */
  effective: Record<string, unknown>
}

/**
 * 按值替换 `{{name}}`。
 *
 * **不能**先 `JSON.stringify` 再字符串替换：那样 `"{{width}}"` 会变成带引号的
 * `"256"`，数字退化成字符串，ComfyUI 会直接拒掉整个工作流。整个字符串就是一个
 * 占位符时，原样返回该值（数字仍是数字）。
 */
function substitute(value: unknown, bag: Record<string, unknown>): unknown {
  if (typeof value === 'string') {
    const exact = /^\{\{(\w+)\}\}$/.exec(value)
    if (exact !== null) {
      const name = exact[1]
      if (name !== undefined && name in bag) return bag[name]
      return value
    }
    return value.replace(/\{\{(\w+)\}\}/g, (match, name: string) => (name in bag ? String(bag[name]) : match))
  }
  if (Array.isArray(value)) return value.map(item => substitute(item, bag))
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) out[key] = substitute(inner, bag)
    return out
  }
  return value
}

/** 按 `'6.inputs.text'` 写入一个值。写入失败（路径不存在）返回 false。 */
function setByBind(workflow: ApiWorkflow, bind: string, value: unknown): boolean {
  const parts = bind.split('.')
  if (parts.length !== 3 || parts[1] !== 'inputs') return false
  const nodeId = parts[0]
  const key = parts[2]
  if (nodeId === undefined || key === undefined) return false
  const node = workflow[nodeId]
  if (node === undefined || node.inputs === null || typeof node.inputs !== 'object') return false
  node.inputs[key] = value
  return true
}

/** 按槽位类型校验并规范化一个值。 */
function coerce(slot: IOSlot, value: unknown): string | number | boolean {
  if (slot.type === 'number') {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
    throw new VariableError('variable_type', `参数 ${slot.name} 需要数字，收到 ${JSON.stringify(value)}。`, { slot: slot.name })
  }
  if (slot.type === 'boolean') {
    if (typeof value === 'boolean') return value
    throw new VariableError('variable_type', `参数 ${slot.name} 需要 true / false，收到 ${JSON.stringify(value)}。`, { slot: slot.name })
  }
  if (slot.type === 'enum') {
    const text = String(value)
    if (slot.options !== undefined && slot.options.length > 0 && !slot.options.includes(text)) {
      throw new VariableError('variable_type', `参数 ${slot.name} 只接受：${slot.options.join(' / ')}。`, { slot: slot.name })
    }
    return text
  }
  if (slot.type === 'image' || slot.type === 'mask') {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new VariableError('variable_type', `参数 ${slot.name} 需要图片路径。`, { slot: slot.name })
    }
    return value
  }
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  throw new VariableError('variable_type', `参数 ${slot.name} 需要字符串，收到 ${JSON.stringify(value)}。`, { slot: slot.name })
}

/**
 * 把变量应用进工作流的一个副本。
 *
 * 顺序：先按 `bind` 精确写节点输入，再对全模板做 `{{name}}` 替换 ——
 * 两者可以混用，老模板（只有占位符）与新模板（有 bind）走同一条路径。
 *
 * @param workflow - 原始模板（不会被修改）。
 * @param slots - IO 面的输入槽位。
 * @param vars - 调用方给的变量。
 */
export function applyVariables(
  workflow: ApiWorkflow,
  slots: readonly IOSlot[],
  vars: Record<string, unknown>,
): AppliedVariables {
  const copy = structuredClone(workflow) as ApiWorkflow
  const effective: Record<string, unknown> = {}

  const known = new Set(slots.map(slot => slot.name))
  const unknown = Object.keys(vars).filter(key => !known.has(key))
  if (unknown.length > 0) {
    throw new VariableError('variable_unknown', `工作流没有这些参数：${unknown.join('、')}。`, { unknown })
  }

  const missing: string[] = []
  for (const slot of slots) {
    const provided = vars[slot.name]
    const value = provided === undefined ? slot.default : provided

    if (value === undefined || value === '') {
      if (slot.required) missing.push(slot.name)
      continue
    }

    const coerced = coerce(slot, value)
    effective[slot.name] = coerced
    if (slot.bind !== undefined) setByBind(copy, slot.bind, coerced)
  }

  if (missing.length > 0) {
    throw new VariableError('variable_unbound', `缺少必填参数：${missing.join('、')}。`, { missing })
  }

  return { workflow: substitute(copy, effective) as ApiWorkflow, effective }
}
