/**
 * `comfyui_compose`：把素材整理成一次可以直接交给 `comfyui_run` 的调用。
 *
 * 补的是链路最后一段：素材库能搜、能取图，但"这套衣服这张姿势该塞进哪个槽、
 * 提示词怎么拼"原来全靠模型临场推理 —— 它每次都要重新判断，还不稳定。
 * 这里把这段固化成一次确定性调用，把不确定性压进 `assumptions` 那几行文字里。
 *
 * **不执行**：只产出参数。出图仍然只有 `comfyui_run` 一条路，这样 seed 记录、
 * 运行记录、产物归处都还是同一条链路。
 */
import fs from 'node:fs'
import path from 'node:path'

import type { MaterialItem, MaterialSource, ToolDeps, ToolSpec } from '../../../shared/tools/types.js'
import { asRecord, asString, jsonOutput } from '../../../shared/tools/types.js'
import { readEntry } from '../../../shared/workflow/index.js'
import type { IOSlot } from '../../../shared/workflow/types.js'
import { buildPrompt } from './compose-prompt.js'
import { planSlots, ROLE_CN } from './compose-slots.js'
import type { MaterialRole } from './compose-slots.js'

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

/** 素材角色能放进的槽位类型：mask 专门接蒙版，其余走 image。 */
const IMAGE_SLOTS = new Set(['image', 'mask'])

/** 列工作流目录里的 id（不带 .json）。 */
function requireList(dir: string): string[] | undefined {
  try {
    return fs
      .readdirSync(dir)
      .filter(name => name.endsWith('.json') && !name.endsWith('.meta.json'))
      .map(name => path.basename(name, '.json'))
  } catch {
    return undefined
  }
}

/** 槽位「靠语义」还是「靠顺序」：顺序推断出来的不能当成工作流适配的证据。 */
function isByOrder(why: string): boolean {
  return why.startsWith('按槽位顺序')
}

function imageSlotsOf(inputs: readonly IOSlot[]): IOSlot[] {
  return inputs.filter(slot => IMAGE_SLOTS.has(String(slot.type)))
}

/**
 * 没指定工作流时挑一个。
 *
 * 两条判据，缺一不可：
 *
 * 1. **角色必须靠语义匹配上至少一个槽**（`label` 或默认文件名）。只按图槽数量挑会把
 *    服装参考塞进"img2img 要重绘的底图"—— 那等于把底图换成衣服。
 * 2. 角色为 0（只给 prompt）时**优先无图槽的纯文生图工作流**，否则会误用一个
 *    "等着默认 LoadImage 文件名"的 img2img 模板。
 *
 * 返回完整输入面：提示词、seed 这些槽后面还要用，只留图片槽会让它们凭空消失。
 */
function pickWorkflow(
  deps: ToolDeps,
  roles: readonly MaterialRole[],
): { workflowId: string; inputs: IOSlot[]; matched: number } | undefined {
  const names = requireList(deps.workflowsDir)
  if (names === undefined) return undefined

  interface Candidate { workflowId: string; inputs: IOSlot[]; imageCount: number; matched: number }
  const candidates: Candidate[] = []

  for (const workflowId of names) {
    let entry: ReturnType<typeof readEntry>
    try {
      entry = readEntry(deps.workflowsDir, workflowId)
    } catch {
      continue
    }
    if (entry === undefined || !entry.surface.enabled) continue
    const inputs = entry.surface.inputs
    const imageCount = imageSlotsOf(inputs).length

    const plan = planSlots(
      imageSlotsOf(inputs).map(slot => ({ name: slot.name, label: slot.label, default: slot.default, required: slot.required, type: slot.type })),
      roles,
    )
    const matched = plan.assignments.filter(assignment => !isByOrder(assignment.why)).length
    // 有素材要放，却一个都没靠语义匹配上：这个工作流跟这组素材没关系
    if (roles.length > 0 && matched === 0) continue
    if (roles.length > 0 && imageCount === 0) continue
    candidates.push({ workflowId, inputs, imageCount, matched })
  }

  if (candidates.length === 0) return undefined

  candidates.sort((a, b) => {
    // 只给 prompt：优先没有图槽的（真正的文生图），否则会误用等默认 LoadImage 的模板
    if (roles.length === 0) return a.imageCount - b.imageCount || a.workflowId.localeCompare(b.workflowId)
    if (a.matched !== b.matched) return b.matched - a.matched
    return Math.abs(a.imageCount - roles.length) - Math.abs(b.imageCount - roles.length) || a.workflowId.localeCompare(b.workflowId)
  })
  const best = candidates[0]
  return best === undefined ? undefined : { workflowId: best.workflowId, inputs: best.inputs, matched: best.matched }
}

/** 提示词槽：只认「明确是正向」的那个，宁可退回模板默认也不塞进别的文本槽。 */
const NEGATIVE_WORDS = /negative|负向|反向|反面/i
const PREFIX_WORDS = /prefix|文件名|前缀/i
const POSITIVE_WORDS = /prompt|positive|正面|正向/i

function pickPromptSlot(inputs: readonly IOSlot[]): IOSlot | undefined {
  const text = inputs.filter(slot => slot.type === 'string')
  const usable = text.filter(slot => {
    const words = `${slot.name} ${slot.label ?? ''}`
    return !NEGATIVE_WORDS.test(words) && !PREFIX_WORDS.test(words)
  })
  const explicit = usable.find(slot => POSITIVE_WORDS.test(`${slot.name} ${slot.label ?? ''}`))
  if (explicit !== undefined) return explicit
  // 没有任何正向标记时，只有一个候选才敢写 —— 多个文本槽里猜哪个是正向，猜错的代价是毁图
  return usable.length === 1 ? usable[0] : undefined
}

/** 取一个素材（元数据 + 落盘路径）。 */
async function resolveMaterial(
  source: MaterialSource,
  role: 'pose' | 'costume',
  id: string,
  size: 'full' | 'thumb',
): Promise<{ item: MaterialItem; file: string }> {
  const lookup = role === 'pose' ? source.pose : source.costume
  const fetch = role === 'pose' ? source.fetchPose : source.fetchCostume
  const label = ROLE_CN[role]
  if (lookup === undefined || fetch === undefined) {
    throw new Error(`${label}库没有启用（或被关掉了），拿不到 ${id}。`)
  }
  const item = lookup(id)
  if (item === undefined) {
    throw new Error(
      `${label}库里没有 ${id}。先用 ${role === 'pose' ? 'comfyui_pose' : 'comfyui_costume'} 搜一下（给 query，不是 id）。`,
    )
  }
  const file = await fetch(id, size)
  return { item, file }
}

/**
 * 组装一次运行参数。
 *
 * @param deps - 工具依赖（只为读工作流目录与拿素材面）。
 */
export function composeTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_compose',
    description:
      '把素材（衣装 / 姿势 / 标签 / 自由描述）整理成**一次可以直接交给 comfyui_run 的调用**：'
      + '选好工作流、把素材图落进 uploads、按槽位语义填好 vars、拼好提示词。'
      + '它**不出图**，只产出参数 —— 拿到返回里的 call 原样喂 comfyui_run 就行。'
      + '典型场景：「用这套衣服 + 这个姿势出一张」。'
      + '返回里的 assumptions 是槽位映射的推断依据，**请读一遍**：不对就用 extraVars 覆盖。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        costumeId: { type: 'string', description: '衣装库的 id（如 SPR-0001），来自 comfyui_costume 的搜索结果。' },
        poseId: {
          type: 'string',
          description: '姿势的 id 或视角 id（如 full_single_P012 或 full_single_P012_side），来自 comfyui_pose 的搜索结果。',
        },
        size: { type: 'string', enum: ['full', 'thumb'], description: '取图尺寸，默认 full（当参考图用 thumb 就够）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '已转好的 Danbooru tag（由 danbooru_lookup 得到）。' },
        prompt: { type: 'string', description: '用户的自由描述，中文也行。' },
        workflowId: { type: 'string', description: '指定工作流；不给就按素材挑一个有对应图槽的。' },
        baseImage: { type: 'string', description: '要处理的底图绝对路径（局部重绘这类工作流用）。' },
        maskImage: { type: 'string', description: '重绘蒙版的绝对路径（工作流得有 type=mask 的槽）。' },
        extraVars: { type: 'object', additionalProperties: true, description: '原样并入 vars，优先级最高（用它覆盖任何推断）。' },
      },
    },
    output: jsonOutput(),
    execute: async args => {
      const materials = deps.getMaterials?.()
      const size = asString(args.size) === 'thumb' ? 'thumb' : 'full'

      // 1. 素材 → 角色 + 落盘路径
      const wanted: Array<{ role: MaterialRole; file: string; item?: MaterialItem }> = []
      const assumptions: string[] = []
      const costumeId = asString(args.costumeId).trim()
      const poseId = asString(args.poseId).trim()
      const baseImage = asString(args.baseImage).trim()
      const maskImage = asString(args.maskImage).trim()

      if (poseId !== '') {
        if (materials === undefined) return { ok: false, error: '姿势库还没就绪（或被关掉了），拿不到素材。' }
        const { item, file } = await resolveMaterial(materials, 'pose', poseId, size)
        wanted.push({ role: 'pose', file, item })
      }
      if (costumeId !== '') {
        if (materials === undefined) return { ok: false, error: '衣装库还没就绪（或被关掉了），拿不到素材。' }
        const { item, file } = await resolveMaterial(materials, 'costume', costumeId, size)
        wanted.push({ role: 'costume', file, item })
      }
      if (baseImage !== '') wanted.push({ role: 'base', file: baseImage })
      if (maskImage !== '') wanted.push({ role: 'mask', file: maskImage })

      // 2. 选工作流
      const workflowIdArg = asString(args.workflowId).trim()
      let workflowId = workflowIdArg
      let inputs: IOSlot[]
      if (workflowId !== '') {
        const entry = readEntry(deps.workflowsDir, workflowId)
        if (entry === undefined) {
          return { ok: false, error: `没有这个工作流：${workflowId}。先用 comfyui_workflow_list 看有哪些。` }
        }
        if (!entry.surface.enabled) return { ok: false, error: `工作流 ${workflowId} 已被停用。` }
        inputs = entry.surface.inputs
      } else {
        if (wanted.length === 0 && asString(args.prompt).trim() === '' && asStringArray(args.tags).length === 0) {
          return {
            ok: false,
            error: '什么都没给：至少给一个素材（costumeId / poseId / baseImage）、一段 prompt，或指定 workflowId。',
          }
        }
        const picked = pickWorkflow(deps, wanted.map(item => item.role))
        if (picked === undefined) {
          return {
            ok: false,
            error:
              wanted.length === 0
                ? `工作流目录读不到或没有可用模板：${deps.workflowsDir}`
                : `没有找到能放这些素材的工作流（${wanted.map(item => ROLE_CN[item.role]).join('、')}）。`
                  + '只按图槽数量硬塞会把参考图放进"待重绘的底图"，所以这种情况宁可报错。'
                  + '用 comfyui_workflow_list { inputs: "image" } 看看哪些带图槽，或直接指定 workflowId。',
          }
        }
        workflowId = picked.workflowId
        inputs = picked.inputs
        assumptions.push(
          `没指定工作流，按槽位语义匹配挑了 ${workflowId}（${picked.matched} 个槽位有语义依据）`,
        )
      }

      // 3. 槽位规划
      const imageSlots = imageSlotsOf(inputs)
      const plan = planSlots(
        imageSlots.map(slot => ({ name: slot.name, label: slot.label, default: slot.default, required: slot.required, type: slot.type })),
        wanted.map(item => item.role),
      )
      assumptions.push(...plan.assumptions)

      // 4. 拼 vars
      const vars: Record<string, unknown> = {}
      const filled: Array<{ slot: string; from: string; why: string }> = []
      for (const assignment of plan.assignments) {
        const material = wanted.find(item => item.role === assignment.role)
        if (material === undefined) continue
        vars[assignment.slot] = material.file
        filled.push({
          slot: assignment.slot,
          from: material.item === undefined ? assignment.role : `${assignment.role}:${material.item.id}`,
          why: assignment.why,
        })
      }

      // 提示词：衣装关键词 + 标签 + 自由描述
      const costume = wanted.find(item => item.role === 'costume')?.item
      const prompt = buildPrompt({
        keywords: costume?.keywords,
        tags: asStringArray(args.tags),
        prompt: asString(args.prompt),
      })
      const promptSlot = pickPromptSlot(inputs)
      if (prompt !== '') {
        if (promptSlot !== undefined) vars[promptSlot.name] = prompt
        else assumptions.push('没有识别到明确的正向提示词槽（怕写进 negative 或文件名前缀），prompt 没有写进 vars')
      }

      // 5. 用户覆盖最后落，优先级最高
      Object.assign(vars, asRecord(args.extraVars))

      // 6. 必填但没给的槽，列出来而不是猜
      const unfilled = inputs
        .filter(slot => slot.required === true && vars[slot.name] === undefined)
        .map(slot => slot.name)

      return {
        ok: true,
        call: { workflow: { id: workflowId }, vars },
        filled,
        dropped: plan.dropped.map(role => ({ role, why: '工作流没有多余的图槽放它' })),
        assumptions,
        unfilled,
        next: '把 call 原样交给 comfyui_run',
      }
    },
  }
}
