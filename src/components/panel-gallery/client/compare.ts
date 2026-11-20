/**
 * 双图参数对比：找出两次生成之间**真正变了的那几个字段**。
 *
 * 抽成纯函数是为了能测：面板上"对比"最没用的实现是把两张卡的 sidecar 并排贴出来，
 * 用户得自己一行行找差异。这里只回答"哪里不一样"。
 *
 * 字段顺序按"影响画面最大"排：提示词 → 种子 → 采样参数 → 模型 → 尺寸。
 */
import type { GalleryItem } from '../../../client/types.js'

export interface DiffRow {
  /** 字段名（技术名，中英界面通用）。 */
  key: string
  a: string
  b: string
  /** 两边是否相同。相同的行默认折叠。 */
  same: boolean
}

/** 参与对比的字段，顺序即展示顺序。 */
const FIELDS = [
  'prompt',
  'negativePrompt',
  'seed',
  'steps',
  'cfgScale',
  'samplerName',
  'scheduler',
  'checkpoint',
  'workflowId',
  'width',
  'height',
  'mode',
] as const

/** 空值统一显示成破折号：`undefined` 与 `''` 并排看只会让人猜。 */
function show(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
}

/**
 * 逐字段对比两张图。
 *
 * @param a - 左图。
 * @param b - 右图。
 * @returns 全量字段列表（含相同的行，组件自己决定折不折）。
 */
export function diffItems(a: GalleryItem, b: GalleryItem): DiffRow[] {
  return FIELDS.map(key => {
    const left = show((a as Record<string, unknown>)[key])
    const right = show((b as Record<string, unknown>)[key])
    return { key, a: left, b: right, same: left === right }
  })
}

/** 差异项（组件用来决定"要不要显示'没有差异'"）。 */
export function changedRows(rows: readonly DiffRow[]): DiffRow[] {
  return rows.filter(row => row.same === false)
}

/** 只保留标量：对象/数组并排显示出来只是噪音。 */
function scalar(value: unknown): string | undefined {
  if (typeof value === 'string') return value === '' ? undefined : value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

/**
 * 把一份 sidecar（`GET /meta` 的返回）压平成"字段 → 文本"。
 *
 * **为什么要拉 `/meta` 而不是用列表项**：列表项只透出十来个摘要字段，而插件自己写的
 * sidecar 把参数全放在 `vars` 里（`ckpt_name`/`steps`/`cfg`/`sampler_name`…）——
 * 直接对比列表项会让两张只差采样参数的图显示成"完全相同"。
 *
 * `vars` 在前、顶层字段在后：同名时以顶层为准（`seed` 这类字段两处都有，取更可靠的那份）。
 */
export function flattenMeta(meta: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (meta === null || typeof meta !== 'object') return out
  const bag = meta as Record<string, unknown>
  const vars = bag.vars !== null && typeof bag.vars === 'object' && Array.isArray(bag.vars) === false
    ? (bag.vars as Record<string, unknown>)
    : {}
  for (const source of [vars, bag]) {
    for (const [key, value] of Object.entries(source)) {
      // `comfy` 是 { url, promptId }、`artifacts` 是数组：压平成 "[object Object]" 只会误导
      const text = scalar(value)
      if (text === undefined) continue
      out[key] = text
    }
  }
  return out
}

/**
 * 对比两份压平后的记录。
 *
 * 排序：`FIELDS` 里列过的排前面（按那个顺序），其余按字母 —— 采样参数永远在最上面，
 * 而自定义工作流的 `foo_ref` 之类沉到后面。
 */
export function diffRecords(a: Record<string, string>, b: Record<string, string>): DiffRow[] {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const known = FIELDS.filter(key => keys.has(key)) as string[]
  const rest = [...keys].filter(key => (FIELDS as readonly string[]).includes(key) === false).sort()
  return [...known, ...rest].map(key => {
    const left = a[key] ?? '—'
    const right = b[key] ?? '—'
    return { key, a: left, b: right, same: left === right }
  })
}
