import { readEntry, writeMeta, writeWorkflow } from '../../../shared/workflow/index.js'
import { applyVariables } from '../../../shared/workflow/variables.js'
import type { ApiWorkflow, IOSlot } from '../../../shared/workflow/types.js'
import { asRecord, asString, jsonOutput } from '../../../shared/tools/types.js'
import type { Override, ToolDeps, ToolSpec } from '../../../shared/tools/types.js'

/** 一个 input 是否被工作流的变量控制。 */
function boundSlot(slots: readonly IOSlot[], nodeId: string, input: string): IOSlot | undefined {
  const bind = `${nodeId}.inputs.${input}`
  return slots.find(slot => slot.bind === bind)
}

/** 按槽位类型校验值。 */
function coerce(slot: IOSlot | undefined, value: unknown): string | number | boolean {
  if (slot === undefined) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
    throw new Error('值只能是字符串、数字或布尔。')
  }
  if (slot.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(n)) throw new Error(`${slot.name} 需要数字。`)
    return n
  }
  if (slot.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${slot.name} 需要 true / false。`)
    return value
  }
  if (slot.type === 'enum') {
    const text = String(value)
    if (slot.options !== undefined && slot.options.length > 0 && !slot.options.includes(text)) {
      throw new Error(`${slot.name} 只接受：${slot.options.join(' / ')}。`)
    }
    return text
  }
  return typeof value === 'string' ? value : String(value)
}

/**
 * `comfyui_workflow_edit`：改说明、调参数。
 *
 * 两个关键边界（见设计 §3.10）：
 *   - `patches` 默认只作用于**下一次运行**，模板文件不动 —— 模型随手调个 seed，
 *     一旦写进模板，用户之后每张图都被固定住且完全无感。
 *   - `persist: true` 必须带 `expectHash`：模板在读取之后被改过就拒绝写入。
 *
 * @param deps - 依赖。
 */
export function workflowEditTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_workflow_edit',
    description:
      '修改工作流的用途备注，或调整某个节点的参数。patches 默认只影响下一次运行（不写模板）；要写回模板必须带 persist=true 与 expectHash。被变量控制（bind）的参数不能直接 patch，应先改那个变量。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workflowId'],
      properties: {
        workflowId: { type: 'string' },
        notes: {
          type: 'object',
          description: '用途备注：title / description / tags。写进 <id>.meta.json，用户与模型都可改。',
          properties: {
            title: { type: 'string' },
            description: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
          },
        },
        patches: {
          type: 'array',
          description: '节点参数修改',
          items: {
            type: 'object',
            required: ['nodeId', 'input', 'value'],
            properties: {
              nodeId: { type: 'string' },
              input: { type: 'string' },
              value: { type: ['string', 'number', 'boolean'] },
            },
          },
        },
        persist: { type: 'boolean', description: 'true 才写回模板（默认 false）' },
        expectHash: { type: 'string', description: 'persist=true 时必填：读取时拿到的 workflowHash' },
      },
    },
    output: jsonOutput(),
    async execute(args) {
      const workflowId = asString(args.workflowId).trim()
      if (workflowId === '') return { ok: false, message: '需要 workflowId。' }

      const entry = readEntry(deps.workflowsDir, workflowId)
      if (entry === undefined) return { ok: false, message: `没有这个工作流：${workflowId}。` }

      const changed: Array<{ nodeId: string; input: string; before: unknown; after: unknown }> = []
      const notes = asRecord(args.notes)
      const patchesRaw = Array.isArray(args.patches) ? args.patches : []
      const persist = args.persist === true

      // ── 备注 ──
      if (Object.keys(notes).length > 0) {
        const next = {
          title: typeof notes.title === 'string' ? notes.title : entry.meta?.title,
          description: typeof notes.description === 'string' ? notes.description : entry.meta?.description,
          tags: Array.isArray(notes.tags) ? notes.tags.filter((tag): tag is string => typeof tag === 'string') : entry.meta?.tags,
          updatedBy: 'agent' as const,
        }
        writeMeta(deps.workflowsDir, workflowId, next)
      }

      // ── 参数 ──
      const overrides: Override[] = []
      for (const item of patchesRaw) {
        const patch = item !== null && typeof item === 'object' ? (item as Record<string, unknown>) : {}
        const nodeId = asString(patch.nodeId)
        const input = asString(patch.input)
        if (nodeId === '' || input === '') return { ok: false, message: '每条 patch 都需要 nodeId 与 input。' }

        const node = entry.workflow[nodeId]
        if (node === undefined) {
          return { ok: false, message: `工作流 ${workflowId} 里没有节点 ${nodeId}。`, nodes: Object.keys(entry.workflow) }
        }
        if (!(input in node.inputs)) {
          return { ok: false, message: `节点 ${nodeId} 没有输入 ${input}。`, inputs: Object.keys(node.inputs) }
        }
        const current = node.inputs[input]
        if (Array.isArray(current) && current.length === 2 && typeof current[1] === 'number') {
          return {
            ok: false,
            code: 'param_not_editable',
            message: `${nodeId}.inputs.${input} 是上游连线，改它不会生效。`,
            hint: '沿着连线找到真正持有值的节点，改那一个。',
          }
        }

        const slot = boundSlot(entry.surface.inputs, nodeId, input)
        if (slot !== undefined) {
          return {
            ok: false,
            code: 'param_bound',
            message: `${nodeId}.inputs.${input} 由变量 ${slot.name} 控制，直接改会被变量替换覆盖。`,
            hint: `用 comfyui_run 传 ${slot.name}，而不是 patch 节点。`,
          }
        }

        let value: string | number | boolean
        try {
          value = coerce(slot, patch.value)
        } catch (error) {
          return { ok: false, code: 'param_type', message: error instanceof Error ? error.message : String(error) }
        }

        overrides.push({ nodeId, input, value })
        changed.push({ nodeId, input, before: current, after: value })
      }

      // ── 落盘（可选） ──
      let persisted = false
      if (persist && overrides.length > 0) {
        const expectHash = asString(args.expectHash).trim()
        if (expectHash === '') {
          return { ok: false, message: 'persist=true 需要 expectHash（读取时拿到的 workflowHash）。' }
        }
        if (expectHash !== entry.surface.workflowHash) {
          return {
            ok: false,
            code: 'hash_mismatch',
            message: `模板已被改动（当前 ${entry.surface.workflowHash.slice(0, 8)}，你读到的是 ${expectHash.slice(0, 8)}）。`,
            hint: '重新 inspect 一次拿到新 hash，再决定是否覆盖。',
            currentHash: entry.surface.workflowHash,
          }
        }
        const next: ApiWorkflow = structuredClone(entry.workflow)
        for (const patch of overrides) {
          const node = next[patch.nodeId]
          if (node !== undefined) node.inputs[patch.input] = patch.value
        }
        writeWorkflow(deps.workflowsDir, workflowId, next)
        persisted = true
      } else if (overrides.length > 0) {
        // 不落盘：进内存覆盖表，由下一次 run 消费。
        deps.overrides.set(workflowId, overrides)
      }

      return {
        ok: true,
        workflowId,
        changed,
        persisted,
        scope: persisted ? 'template' : 'next-run',
        hint: persisted
          ? '已写回模板，之后的运行都会用新值。'
          : '只对下一次运行生效；要写回模板请再调用一次并带 persist + expectHash。',
        notesUpdated: Object.keys(notes).length > 0,
      }
    },
  }
}
