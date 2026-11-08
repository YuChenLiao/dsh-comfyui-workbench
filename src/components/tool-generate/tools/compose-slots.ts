/**
 * 把素材分配到工作流的图片槽位。
 *
 * 实测过两个真实工作流，语义线索只有三种，可靠性依次下降：
 *
 * 1. **label** —— 作者给节点起过名就有用（`原图`、`蒙版图（白色=重绘区）`），
 *    没起名就是类名（`LoadImage`），不可用
 * 2. **默认文件名** —— 常带语义（`pose_ref_bath2.png`、`inpaint_mask.png`）
 * 3. **槽位顺序** —— 前三轮都没命中时兜底，**必须写进 assumptions**，不许静默
 *
 * 这一层刻意不碰 DOM / 文件 / 网络：全是纯函数，测试能直接喂假数据。
 */

/** 素材角色。`base` / `mask` 是工作流要的输入图，不是我们库里的素材。 */
export type MaterialRole = 'pose' | 'costume' | 'base' | 'mask'

/** 角色中文名（写给模型看的说明用）。 */
export const ROLE_CN: Record<MaterialRole, string> = {
  pose: '姿势参考',
  costume: '服装参考',
  base: '待处理的底图',
  mask: '重绘蒙版',
}

/** 一个可放图的槽位（来自工作流的输入面）。 */
export interface SlotLike {
  name: string
  label?: string | undefined
  default?: unknown
  required?: boolean | undefined
  /** 槽位类型（image / mask）。mask 只可能是蒙版，比任何文字线索都准。 */
  type?: string | undefined
}

export interface SlotAssignment {
  slot: string
  role: MaterialRole
  /** 为什么这么配（模型与人都要能复核）。 */
  why: string
}

export interface SlotPlan {
  assignments: SlotAssignment[]
  /** 槽位不够、没能放下的角色。 */
  dropped: MaterialRole[]
  /** 线索不足的推断，**必须原样展示给用户**。 */
  assumptions: string[]
}

/** 各角色的关键词：中英都收，命中即认。 */
const ROLE_WORDS: Array<[MaterialRole, string[]]> = [
  ['pose', ['姿势', '姿态', '骨架', 'pose', 'openpose', 'skeleton']],
  ['costume', ['服装', '衣装', '衣服', 'costume', 'cloth', 'outfit', 'dress']],
  ['base', ['原图', '底图', '原照', 'source', 'base', 'photo']],
  ['mask', ['蒙版', '遮罩', 'mask', 'inpaint', '重绘']],
]

function matchRole(text: string): MaterialRole | undefined {
  const lower = text.toLowerCase()
  for (const [role, words] of ROLE_WORDS) {
    if (words.some(word => lower.includes(word.toLowerCase()))) return role
  }
  return undefined
}

/**
 * 按三级线索把角色配到槽位。
 *
 * @param slots - 工作流的图片槽（顺序即工作流声明顺序）。
 * @param roles - 这次要放进去的角色，按优先级排（例：先 pose 后 costume）。
 */
export function planSlots(slots: readonly SlotLike[], roles: readonly MaterialRole[]): SlotPlan {
  const assignments: SlotAssignment[] = []
  const assumptions: string[] = []
  const pending = roles.slice()
  const used = new Set<string>()

  const take = (slot: SlotLike, role: MaterialRole, why: string): void => {
    assignments.push({ slot: slot.name, role, why })
    used.add(slot.name)
    const at = pending.indexOf(role)
    if (at >= 0) pending.splice(at, 1)
  }

  // 第零轮：类型直配 —— type=mask 的槽只可能是蒙版，比文字线索可靠
  for (const slot of slots) {
    if (slot.type !== 'mask' || !pending.includes('mask')) continue
    take(slot, 'mask', '槽位类型是 mask')
  }

  // 第一轮：label（作者起的节点名）
  for (const slot of slots) {
    if (slot.label === undefined || slot.label === '') continue
    const role = matchRole(slot.label)
    if (role === undefined || !pending.includes(role)) continue
    take(slot, role, `label「${slot.label}」指向${ROLE_CN[role]}`)
  }

  // 第二轮：默认文件名
  for (const slot of slots) {
    if (used.has(slot.name)) continue
    const fallback = typeof slot.default === 'string' ? slot.default : ''
    if (fallback === '') continue
    const role = matchRole(fallback)
    if (role === undefined || !pending.includes(role)) continue
    take(slot, role, `默认文件名「${fallback}」指向${ROLE_CN[role]}`)
  }

  // 第三轮：剩下一律按顺序，并且**必须**说出来
  const freeSlots = slots.filter(slot => !used.has(slot.name))
  for (const [index, role] of pending.slice().entries()) {
    const slot = freeSlots[index]
    if (slot === undefined) break
    take(slot, role, '按槽位顺序分配（没有 label 或默认文件名线索）')
    assumptions.push(`槽位「${slot.name}」没有语义线索，按顺序推断为${ROLE_CN[role]} —— 不对就改 vars 覆盖`)
  }

  return { assignments, dropped: pending, assumptions }
}
