import crypto from 'node:crypto'

import { inferSurface } from './infer.js'
import type { IOSlot, ModelRef, WorkflowIOSurface, WorkflowMeta, WorkflowSchema } from './types.js'
import type { ApiWorkflow } from './types.js'

/**
 * 模板内容哈希。
 *
 * IO 面 / 预检结果 / 运行记录都绑这个值：模板一改，hash 就变，缓存自然失效，
 * 也让"落盘时覆盖了别人的修改"能被发现（persist 要带 expectHash）。
 *
 * @param workflow - API 格式工作流。
 */
export function hashWorkflow(workflow: ApiWorkflow): string {
  return crypto.createHash('sha256').update(JSON.stringify(workflow)).digest('hex')
}

/** 用 schema 覆盖一个推断出来的槽位。 */
function mergeSlot(base: IOSlot, override: Partial<IOSlot> & { name: string }): IOSlot {
  const merged: IOSlot = { ...base, ...override, name: override.name }
  // schema 没写的字段保持推断值；写了空值的按"显式清空"处理。
  if (override.bind === undefined && base.bind !== undefined) merged.bind = base.bind
  return merged
}

/** schema 里新增的槽位（模板里没有的）也要能进 IO 面 —— 用于手工补 bind。 */
function extraSlots(slots: IOSlot[], schema: WorkflowSchema | undefined): IOSlot[] {
  if (schema?.vars === undefined) return slots
  const known = new Set(slots.map(slot => slot.name))
  const out = [...slots]
  for (const declared of schema.vars) {
    if (known.has(declared.name)) continue
    out.push({
      name: declared.name,
      label: declared.label ?? declared.name,
      type: declared.type ?? 'string',
      required: declared.required ?? false,
      group: declared.group ?? 'advanced',
      ...(declared.bind === undefined ? {} : { bind: declared.bind }),
      ...(declared.default === undefined ? {} : { default: declared.default }),
      ...(declared.options === undefined ? {} : { options: declared.options }),
      ...(declared.min === undefined ? {} : { min: declared.min }),
      ...(declared.max === undefined ? {} : { max: declared.max }),
      ...(declared.step === undefined ? {} : { step: declared.step }),
      ...(declared.hint === undefined ? {} : { hint: declared.hint }),
      ...(declared.secret === undefined ? {} : { secret: declared.secret }),
    })
  }
  return out
}

/** schema 里的模型声明覆盖自动提取。 */
function mergeModels(inferred: ModelRef[], schema: WorkflowSchema | undefined): ModelRef[] {
  const declared = schema?.models
  if (declared === undefined || declared.length === 0) return inferred
  const out = declared.map(entry => ({
    name: entry.name,
    kind: entry.kind ?? 'other',
    nodeId: entry.nodeId ?? '',
    ...(entry.primary === undefined ? {} : { primary: entry.primary }),
  }))
  if (!out.some(entry => entry.primary === true) && out.length > 0 && out[0] !== undefined) out[0].primary = true
  return out
}

/**
 * 组装 IO 面。
 *
 * 优先人工声明，其次自动推断 —— 两份描述必然漂移，所以自动推断是基线，
 * schema 只覆盖要改的部分。
 *
 * @param input - 模板、id、可选的 schema 与 meta。
 */
export function buildSurface(input: {
  workflowId: string
  workflow: ApiWorkflow
  schema?: WorkflowSchema | undefined
  meta?: WorkflowMeta | undefined
}): WorkflowIOSurface {
  const { workflowId, workflow, schema, meta } = input
  const inferred = inferSurface(workflow, schema?.internalInputs ?? [])

  const declared = schema?.vars ?? []
  const slots = extraSlots(inferred.slots, schema).map(slot => {
    const override = declared.find(entry => entry.name === slot.name)
    return override === undefined ? slot : mergeSlot(slot, override)
  })

  return {
    workflowId,
    title: meta?.title ?? schema?.title ?? workflowId,
    description: meta?.description ?? schema?.description ?? '',
    workflowHash: hashWorkflow(workflow),
    models: mergeModels(inferred.models, schema),
    inputs: slots,
    outputs: inferred.outputs,
    meta: {
      nodeCount: Object.keys(workflow).length,
      missingNodes: [],
      source: declared.length > 0 ? 'declared' : 'inferred',
    },
  }
}
