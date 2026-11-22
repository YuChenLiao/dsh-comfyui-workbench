/**
 * 工作流列表的分组、筛选与折叠状态。
 *
 * 抽成纯函数（不碰 React / DOM）是为了能测：这一层最容易出"看起来对、实际错"的毛病 ——
 * 把放大模型当底模、Windows 与 POSIX 的斜杠把同一套底模拆成两组、搜索命中却因为
 * 组是折叠的而"看不见"。这些都在这里用单元测试钉住。
 */
import type { WorkflowListItem } from '../../../client/types.js'

/** 列表的筛选胶囊。 */
export type WorkflowFilter = 'all' | 'enabled' | 'image' | 'warning' | 'disabled'

export interface WorkflowGroup {
  /** 分组键（已归一：小写、斜杠统一）。 */
  key: string
  /** 组头显示名（底模文件名去扩展名）。 */
  label: string
  /** 底模类别（`checkpoint` / `diffusion` / `''` 表示兜底组）。 */
  kind: string
  items: WorkflowListItem[]
  /** 组内启用的条数。 */
  enabledCount: number
  /** 组内是否有告警（缺模型 / 体检缺节点）。 */
  warning: boolean
  /** 是否是末尾的「后处理 / 通用工具」组。 */
  tail: boolean
}

/**
 * 兜底组的键。用 `\u0000` 开头：底模文件名不可能以它开头，所以永远不会撞上真实分组。
 */
const TAIL_KEY = '\u0000tail'

/** 兜底组的显示名。 */
export const TAIL_LABEL = '后处理 / 通用工具'

/** 权重文件扩展名：组头显示名要去掉它。 */
const WEIGHT_EXT = /\.(safetensors|ckpt|gguf|pt|pth|bin)$/i

/**
 * 只有 `checkpoint` / `diffusion` 才算"底模"。
 *
 * `infer.ts` 的 primary 规则是 `checkpoint → diffusion → found[0]`，所以纯放大工作流
 * 的 `model` 会是 `4x-UltraSharp.pth`。按底模分组时把放大 / VAE / 其它归到兜底组，
 * 否则"底模"列表里会冒出几个 4x 放大模型，用户没法按底模管理。
 */
const MODEL_KINDS = new Set(['checkpoint', 'diffusion'])

/** 路径归一：斜杠统一 + 小写。Windows 存档里混着 `\\` 与 `/`，不归一就会拆成两组。 */
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').trim().toLowerCase()
}

/** 组头显示名：取 basename 并去掉权重扩展名。 */
function labelOf(model: string): string {
  const normalized = model.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  return base.replace(WEIGHT_EXT, '')
}

/**
 * 一条工作流属于哪个底模组。
 *
 * @param item - 列表项。
 * @returns 分组键、显示名、类别；底模缺失或不是 checkpoint/diffusion 时进兜底组。
 */
export function modelGroupOf(item: WorkflowListItem): { key: string; label: string; kind: string; tail: boolean } {
  const model = typeof item.model === 'string' ? item.model.trim() : ''
  const kind = typeof item.modelKind === 'string' ? item.modelKind : ''
  if (model === '' || MODEL_KINDS.has(kind) === false) {
    return { key: TAIL_KEY, label: TAIL_LABEL, kind: '', tail: true }
  }
  return { key: normalizePath(model), label: labelOf(model), kind, tail: false }
}

/** 搜索命中的字段：标题、id、底模、用途备注。 */
function matchesQuery(item: WorkflowListItem, query: string): boolean {
  if (query === '') return true
  const haystack = `${item.title} ${item.workflowId} ${item.model} ${item.description}`.toLowerCase()
  return haystack.includes(query)
}

/**
 * 一条工作流是否通过当前筛选。
 *
 * `warning` 依赖 `missingModels`（拿不到 `object_info` 时后端不会给这个字段）——
 * 拿不到时它不算"有告警"，而不是把全部工作流都标成有告警。
 */
export function matchesFilter(item: WorkflowListItem, filter: WorkflowFilter): boolean {
  if (filter === 'enabled') return item.enabled !== false
  if (filter === 'disabled') return item.enabled === false
  if (filter === 'image') return (item.imageSlots?.length ?? 0) > 0
  if (filter === 'warning') return (item.missingModels?.length ?? 0) > 0
  return true
}

/**
 * 分组 + 筛选 + 排序。
 *
 * 排序：启用数多的组在前（主力底模最常用），其余按名字；兜底组固定置底。
 */
export function groupWorkflows(
  items: readonly WorkflowListItem[],
  options: { query?: string; filter?: WorkflowFilter } = {},
): WorkflowGroup[] {
  const query = (options.query ?? '').trim().toLowerCase()
  const filter = options.filter ?? 'all'
  const groups = new Map<string, WorkflowGroup>()

  for (const item of items) {
    if (matchesFilter(item, filter) === false) continue
    if (matchesQuery(item, query) === false) continue
    const shape = modelGroupOf(item)
    const existing = groups.get(shape.key)
    if (existing === undefined) {
      groups.set(shape.key, {
        key: shape.key,
        label: shape.label,
        kind: shape.kind,
        items: [item],
        enabledCount: item.enabled === false ? 0 : 1,
        warning: (item.missingModels?.length ?? 0) > 0,
        tail: shape.tail,
      })
    } else {
      existing.items.push(item)
      if (item.enabled !== false) existing.enabledCount += 1
      if ((item.missingModels?.length ?? 0) > 0) existing.warning = true
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.tail !== b.tail) return a.tail ? 1 : -1
    if (a.enabledCount !== b.enabledCount) return b.enabledCount - a.enabledCount
    return a.label.localeCompare(b.label)
  })
}

/**
 * 当前该展开哪些组。
 *
 * 三条规则：
 * 1. 有搜索词或非「全部」筛选时**全部展开** —— 否则用户搜到了却因为组是折叠的看不见，
 *    会以为搜索坏了；
 * 2. 否则用持久化的记录（用户上次手动展开过哪几组）；
 * 3. 没有任何记录时**全部收起**（首屏简洁，配合顶部「全部展开」快速切换）。
 *
 * @param groups - 分组结果。
 * @param saved - 持久化的展开状态（`key → 是否展开`）。
 * @param forceExpandAll - 是否因为搜索/筛选强制全展。
 */
export function resolveExpanded(
  groups: readonly WorkflowGroup[],
  saved: Record<string, boolean>,
  forceExpandAll: boolean,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const group of groups) {
    out[group.key] = forceExpandAll ? true : saved[group.key] === true
  }
  return out
}

/** 搜索词或筛选是否"正在过滤"（用来决定强制展开、以及空态文案）。 */
export function isFiltering(query: string, filter: WorkflowFilter): boolean {
  return query.trim() !== '' || filter !== 'all'
}

/**
 * 组内是否有告警需要"体检后自动展开"。
 *
 * 体检结果不在列表项里（它来自另一次请求），所以由调用方把 `workflowId` 集合传进来。
 */
export function groupsToExpandForAudit(
  groups: readonly WorkflowGroup[],
  audited: ReadonlySet<string>,
): string[] {
  return groups
    .filter(group => group.items.some(item => audited.has(item.workflowId)))
    .map(group => group.key)
}
