/**
 * 一次性参数覆盖（`comfyui_workflow_edit` 的 `persist: false`）如何落到一次运行上。
 *
 * ## 为什么不能直接改 workflow
 *
 * 直觉做法是把 patch 直接写进工作流节点，然后交给 `applyVariables`。**这条路是错的**：
 * `applyVariables` 会遍历每个槽位，按 `slot.default` 重写它绑定的那条路径 ——
 * 刚改进去的值立刻被冲掉。更糟的是无 `default` 的必填槽位（image / mask），
 * `applyVariables` 根本不看工作流现值，直接抛 `variable_unbound`。
 *
 * 所以分两种情形：
 * - 目标是**槽位**（`bind` 能对上 `nodeId.inputs.input`）→ 转成 vars，
 *   让 `applyVariables` 用覆盖值去写。
 * - 目标**不是槽位**（内部参数）→ 直接改 workflow，`applyVariables` 不会碰它。
 *
 * 这样"临时调参"对普通槽位与内部参数都能生效。
 */

import type { WorkflowIOSurface } from '../workflow/types.js'

/**
 * 一条覆盖。
 *
 * 结构上与 `shared/tools` 的 `Override` 相同，但这里不 import 它 ——
 * `shared/run` 不允许依赖 `shared/tools`（同级单向约束，见 tests/arch.mjs）。
 * TS 的结构化类型让两边可以直接互传。
 */
export interface OverridePatch {
  nodeId: string
  input: string
  value: unknown
}

/** 应用结果，`note` 用于回给用户。 */
export interface OverrideOutcome {
  /** 合并后的变量（含被覆盖的那些）。 */
  vars: Record<string, unknown>
  /** 直接改在 workflow 上的内部参数条数。 */
  internal: number
  /** 转成变量的条数。 */
  viaVars: number
}

/**
 * 把一批覆盖应用到一次运行上。
 *
 * `vars` 里显式给的值**优先级低于覆盖** —— 覆盖是"我刚刚改了这个参数，下一次就这么跑"，
 * 比调用方随手传的 vars 更明确。
 *
 * @param workflow - 会被就地修改（只改内部参数那部分）。
 * @param surface - 用于反查槽位。
 * @param vars - 调用方给的变量。
 * @param patches - 要应用的覆盖。
 */
export function applyOverrides(
  workflow: Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
  surface: WorkflowIOSurface,
  vars: Record<string, unknown>,
  patches: readonly OverridePatch[] | undefined,
): OverrideOutcome {
  const merged: Record<string, unknown> = { ...vars }
  if (patches === undefined || patches.length === 0) {
    return { vars: merged, internal: 0, viaVars: 0 }
  }

  let internal = 0
  let viaVars = 0
  for (const patch of patches) {
    const slot = surface.inputs.find(candidate => candidate.bind === `${patch.nodeId}.inputs.${patch.input}`)
    if (slot !== undefined) {
      merged[slot.name] = patch.value
      viaVars += 1
      continue
    }
    const node = workflow[patch.nodeId]
    if (node !== undefined && node.inputs !== null && typeof node.inputs === 'object') {
      node.inputs[patch.input] = patch.value
      internal += 1
    }
  }

  return { vars: merged, internal, viaVars }
}

/** 给用户的说明；没有覆盖时返回空数组。 */
export function overrideNotes(outcome: OverrideOutcome): string[] {
  if (outcome.viaVars === 0 && outcome.internal === 0) return []
  const parts: string[] = []
  if (outcome.viaVars > 0) parts.push(`${outcome.viaVars} 处参数槽位`)
  if (outcome.internal > 0) parts.push(`${outcome.internal} 处内部参数`)
  return [`已应用 ${parts.join(' + ')}的一次性覆盖（未写入模板）。`]
}
