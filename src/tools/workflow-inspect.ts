import { availableModels, missingModels, suggestModels } from '../comfy/index.js'
import { readEntry } from '../workflow/index.js'
import type { ApiNode, IOSlot, ModelRef, WorkflowIOSurface } from '../workflow/types.js'
import { asString, jsonOutput } from './types.js'
import type { ToolDeps, ToolSpec } from './types.js'

/** 敏感字段：展示时打码，日志与工具输出里不出现原值。 */
const SECRET_KEY = /(api_?key|token|secret|passw(or)?d|credential|auth)/i

/** 值看起来像敏感信息（键名命中，或槽位被标 secret）。 */
function isSecret(key: string, slots: readonly IOSlot[], bindOf: string): boolean {
  if (SECRET_KEY.test(key)) return true
  return slots.some(slot => slot.secret === true && slot.bind === bindOf)
}

/** 展示用值：secret 打码，其它原样（数组即连线，标出上游）。 */
function displayValue(value: unknown, secret: boolean): unknown {
  if (secret) return '[redacted]'
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === 'number') {
    return `← node ${String(value[0])}[${value[1]}]`
  }
  return value
}

/** 单节点视图：完整 inputs + 标题。 */
function nodeView(workflowId: string, nodeId: string, node: ApiNode, surface: WorkflowIOSurface): Record<string, unknown> {
  const inputs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(node.inputs)) {
    inputs[key] = displayValue(value, isSecret(key, surface.inputs, `${nodeId}.inputs.${key}`))
  }
  return {
    workflowId,
    nodeId,
    classType: typeof node.class_type === 'string' ? node.class_type : '',
    title: node._meta !== undefined && node._meta !== null && typeof node._meta.title === 'string' ? node._meta.title : '',
    inputs,
    note: '带 ← 的是上游连线（由别的节点提供），改它不会生效。',
  }
}

/** 节点清单：只给 id / class_type / title，够定位到某个节点再下钻。 */
function nodeList(workflow: Record<string, ApiNode>): Array<Record<string, unknown>> {
  return Object.entries(workflow)
    .filter(([, node]) => node !== null && typeof node === 'object' && typeof node.class_type === 'string')
    .map(([id, node]) => ({
      nodeId: id,
      classType: String(node.class_type),
      title: node._meta !== undefined && node._meta !== null && typeof node._meta.title === 'string' ? node._meta.title : '',
    }))
}

/** IO 面视图：模型要的就是这些。 */
function surfaceView(surface: WorkflowIOSurface, missing: string[]): Record<string, unknown> {
  const primary = surface.models.find((model: ModelRef) => model.primary === true) ?? surface.models[0]
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    workflowHash: surface.workflowHash,
    models: { primary: primary?.name ?? '', kind: primary?.kind ?? '', others: surface.models.filter(model => model !== primary).map(model => model.name) },
    inputs: surface.inputs.map(slot => ({
      name: slot.name,
      label: slot.label,
      type: slot.type,
      required: slot.required,
      ...(slot.default === undefined ? {} : { default: slot.default }),
      ...(slot.options === undefined ? {} : { options: slot.options }),
      ...(slot.min === undefined ? {} : { min: slot.min }),
      ...(slot.max === undefined ? {} : { max: slot.max }),
      group: slot.group,
      ...(slot.secret === true ? { secret: true } : {}),
    })),
    outputs: surface.outputs,
    nodes: surface.meta.nodeCount,
    missingNodes: missing,
  }
}

/**
 * `comfyui_workflow_inspect`：看细节。
 *
 * `nodeId` 的有无就是档位：不传给 IO 面 + 节点清单，传了给那一个节点的完整配置。
 * 这样"先看清单、再点开某一个"是两跳、一个工具，不额外占一份 schema。
 *
 * @param deps - 依赖。
 */
export function workflowInspectTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_workflow_inspect',
    description:
      '查看工作流细节。不传 nodeId：返回输入输出面 + 节点清单（id/classType/title）+ 缺失节点预检。传 nodeId：返回该节点的完整配置（含连线来源）。改参数前先用它确认现状。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['workflowId'],
      properties: {
        workflowId: { type: 'string', description: '工作流 id（用 comfyui_workflow_list 查）' },
        nodeId: { type: 'string', description: '只看这一个节点' },
      },
    },
    output: jsonOutput(),
    async execute(args) {
      const workflowId = asString(args.workflowId).trim()
      if (workflowId === '') return { ok: false, message: '需要 workflowId。' }

      const entry = readEntry(deps.workflowsDir, workflowId)
      if (entry === undefined) {
        return { ok: false, message: `没有这个工作流：${workflowId}。先用 comfyui_workflow_list 看有哪些。` }
      }

      const nodeId = asString(args.nodeId).trim()
      if (nodeId !== '') {
        const node = entry.workflow[nodeId]
        if (node === undefined) {
          return { ok: false, message: `工作流 ${workflowId} 里没有节点 ${nodeId}。`, nodes: nodeList(entry.workflow) }
        }
        return { ok: true, ...nodeView(workflowId, nodeId, node, entry.surface) }
      }

      // 预检：拿不到节点清单时降级成"不预检"，不要因此看不到 IO 面。
      let missing: string[] = []
      let absentModels: string[] = []
      let modelHint = ''
      try {
        const info = await deps.client.objectInfo()
        const known = new Set(Object.keys(info))
        if (known.size > 0) {
          missing = [...new Set(Object.values(entry.workflow).map(node => String(node.class_type ?? '')).filter(name => name !== '' && !known.has(name)))]
          const available = availableModels(info)
          absentModels = missingModels(entry.surface.models, available)
          if (absentModels.length > 0) {
            const primary = entry.surface.models.find(model => model.primary === true) ?? entry.surface.models[0]
            modelHint = `本机没有：${absentModels.join('、')}。可用的替代：${suggestModels(available, primary?.kind ?? 'checkpoint').join('、') || '（一个都没有）'}`
          }
        }
      } catch (error) {
        deps.logger?.warn?.(`[${workflowId}] 预检跳过：${error instanceof Error ? error.message : String(error)}`)
      }

      return {
        ok: true,
        ...surfaceView(entry.surface, missing),
        ...(absentModels.length === 0 ? {} : { missingModels: absentModels, modelHint }),
        nodes: nodeList(entry.workflow),
        hint: '要看某个节点的具体参数，用同一个工具加 nodeId。',
      }
    },
  }
}
