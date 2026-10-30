/**
 * ComfyUI 节点索引。
 *
 * `/object_info` 一次返回几 MB（本机十几 MB），里面每个节点都带着 `display_name`、
 * `description`、`category`、`python_module`、`search_aliases`、输入输出类型。
 * 模型想知道"有哪些节点能做放大"时，现在只能靠猜 —— 这个索引把它变成可查的。
 *
 * 纯逻辑：只吃 `object_info` 的原始 JSON，不碰 IO，好单测。
 */

/** 一个节点的精简视图（默认只回这些，不把完整 schema 塞进上下文）。 */
export interface NodeSummary {
  classType: string
  displayName: string
  category: string
  /** `core` 或 `custom_nodes.<包名>`。 */
  pack: string
  /** 一句话说明（取 description，去掉换行）。 */
  summary: string
  /** 命中原因：类名 / 显示名 / 别名 / 描述。 */
  matches: 'name' | 'display' | 'alias' | 'description' | 'type'
  /** 是否终端节点（产出落到磁盘的那种）。 */
  outputNode: boolean
}

/** 一个输入的结构。枚举型输入只给前几个候选 + 总数（全量可能上万条）。 */
export interface NodeInputDetail {
  name: string
  type: string
  options?: string[]
  optionCount?: number
}

/** `detail: true` 时的附加信息。 */
export interface NodeDetail {
  inputs: {
    required: NodeInputDetail[]
    optional: NodeInputDetail[]
  }
  outputs: Array<{ name: string; type: string }>
}

/** `/object_info` 里一个节点的原始形状（只声明用到的字段）。 */
interface RawNode {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }
  output?: unknown
  output_name?: unknown
  display_name?: unknown
  description?: unknown
  category?: unknown
  python_module?: unknown
  search_aliases?: unknown
  output_node?: unknown
}

/** 索引里的一条。 */
interface Entry {
  classType: string
  displayName: string
  category: string
  pack: string
  summary: string
  outputNode: boolean
  /** 小写，供匹配用。 */
  classL: string
  displayL: string
  categoryL: string
  summaryL: string
  aliasesL: string[]
  outputs: string[]
  raw: RawNode
}

/** 查询条件。至少给一个，否则拒绝（"搜全部"没有意义）。 */
export interface NodeQuery {
  query?: string | undefined
  category?: string | undefined
  produces?: string | undefined
  accepts?: string | undefined
  pack?: string | undefined
  hasModel?: string | undefined
  customOnly?: boolean | undefined
  limit?: number | undefined
  detail?: boolean | undefined
}

/** 一次搜索的结果。 */
export interface NodeSearchResult {
  total: number
  shown: number
  nodes: NodeSummary[]
  details?: Record<string, NodeDetail>
}

/**
 * 从原始输入定义里取出类型名。
 *
 * ComfyUI 的输入有三种写法：`"IMAGE"`、`[["a","b"], {opts}]`（枚举）、
 * `["INT", {opts}]`。枚举的候选最多能到六万多个（实测 `MOSSPromptComposer.artist`
 * 有 62,899 字符），**绝不能把候选 join 进类型名** —— 那会让 detail 输出单节点
 * 就 110 KB。枚举统一记作 `COMBO`，候选另走 options 且截断。
 */
function typeOf(spec: unknown): string {
  if (Array.isArray(spec) && spec.length > 0) {
    const head = spec[0]
    if (typeof head === 'string') return head
    if (Array.isArray(head)) return 'COMBO'
    return 'unknown'
  }
  if (typeof spec === 'string') return spec
  return 'unknown'
}

/** 枚举输入里最多列几个候选（其余只报总数）。 */
const OPTION_PREVIEW = 8

/** 取输入的枚举候选，并截断 —— 全量可能上万条。 */
function optionPreviewOf(spec: unknown): { shown: string[]; total: number } | undefined {
  const all = optionsOf(spec)
  if (all === undefined) return undefined
  return { shown: all.slice(0, OPTION_PREVIEW), total: all.length }
}

/** 取输入的枚举候选（模型文件清单之类）；不是枚举就返回 undefined。 */
function optionsOf(spec: unknown): string[] | undefined {
  if (!Array.isArray(spec) || spec.length === 0) return undefined
  const head = spec[0]
  if (!Array.isArray(head)) return undefined
  return head.filter((item): item is string => typeof item === 'string')
}

/** 把 `python_module` 收敛成人类可读的包名。 */
function packOf(module: unknown): string {
  if (typeof module !== 'string' || module === '') return 'unknown'
  if (module === 'nodes' || module.startsWith('comfy_extras.')) return 'core'
  const parts = module.split('.')
  if (parts[0] === 'custom_nodes') return parts[1] ?? module
  // `comfy_api_nodes.*` 是内置的托管 API 节点（OpenAI / Flux 之类），不是第三方扩展。
  // 不归 core 的话，customOnly 会把 300 多个内置节点一起返回（实测 308/2524）。
  if (parts[0] === 'comfy_api_nodes') return 'core'
  return parts[0] ?? module
}

/**
 * 从 `/object_info` 建索引。
 *
 * @param objectInfo - ComfyUI `/object_info` 的原始响应。
 */
export class NodeIndex {
  private readonly entries: Entry[]

  constructor(objectInfo: Record<string, unknown>) {
    const entries: Entry[] = []
    for (const [classType, value] of Object.entries(objectInfo)) {
      if (value === null || typeof value !== 'object') continue
      const raw = value as RawNode
      const description = typeof raw.description === 'string' ? raw.description : ''
      const displayName = typeof raw.display_name === 'string' && raw.display_name !== ''
        ? raw.display_name
        : classType
      entries.push({
        classType,
        displayName,
        category: typeof raw.category === 'string' ? raw.category : '',
        pack: packOf(raw.python_module),
        summary: description.replace(/\s+/g, ' ').trim().slice(0, 160),
        outputNode: raw.output_node === true,
        classL: classType.toLowerCase(),
        displayL: displayName.toLowerCase(),
        categoryL: (typeof raw.category === 'string' ? raw.category : '').toLowerCase(),
        summaryL: description.toLowerCase(),
        aliasesL: Array.isArray(raw.search_aliases)
          ? raw.search_aliases.filter((a): a is string => typeof a === 'string').map(a => a.toLowerCase())
          : [],
        outputs: Array.isArray(raw.output) ? raw.output.map(item => String(item)) : [],
        raw,
      })
    }
    this.entries = entries
  }

  /** 节点总数。 */
  get size(): number {
    return this.entries.length
  }

  /** 可用的分类（去重、排序），供模型先看一眼有哪些维度可筛。 */
  categories(): string[] {
    const set = new Set<string>()
    for (const entry of this.entries) {
      if (entry.category === '') continue
      // 只取顶级分类，避免列出上百个叶子
      const top = entry.category.split('/')[0]
      if (top !== undefined && top !== '') set.add(top)
    }
    return [...set].sort()
  }

  /**
   * 搜索。
   *
   * 排序四档：类名精确 > 类名前缀 > 显示名/别名命中 > 描述命中。同档按
   * 「终端节点优先、类名字典序」——终端节点通常是用户真正想找的产出环节。
   *
   * @param query - 查询条件。
   */
  search(query: NodeQuery): NodeSearchResult {
    const hasCondition = query.query !== undefined
      || query.category !== undefined
      || query.produces !== undefined
      || query.accepts !== undefined
      || query.pack !== undefined
      || query.hasModel !== undefined
      || query.customOnly === true
    if (!hasCondition) {
      return { total: 0, shown: 0, nodes: [] }
    }

    const needle = (query.query ?? '').trim().toLowerCase()
    // 类名是 CamelCase（`UpscaleModelLoader` 小写后没有分隔符），而用户会写
    // `upscale model` 或 `upscale_model`。所以除了"空格↔下划线"，还要能去掉分隔符比较：
    // 查 `upscale_model` 得能命中 `upscalemodelloader`。
    const loose = needle.replace(/[\s_]+/g, '_')
    const compact = needle.replace(/[\s_]+/g, '')
    const categoryFilter = (query.category ?? '').trim().toLowerCase()
    const produceFilter = (query.produces ?? '').trim().toUpperCase()
    const acceptsFilter = (query.accepts ?? '').trim().toUpperCase()
    const packFilter = (query.pack ?? '').trim().toLowerCase()
    const modelFilter = (query.hasModel ?? '').trim().toLowerCase()

    const rankOf = (entry: Entry, how: NodeSummary['matches']): number => {
      if (how === 'name') {
        if (entry.classL === needle || entry.classL === compact || entry.classL === loose) return 0
        return 1
      }
      if (how === 'display' || how === 'alias') return 2
      return 3
    }

    const hits: Array<{ entry: Entry; rank: number; how: NodeSummary['matches'] }> = []

    for (const entry of this.entries) {
      if (query.customOnly === true && entry.pack === 'core') continue
      if (categoryFilter !== '' && !(entry.categoryL === categoryFilter || entry.categoryL.startsWith(`${categoryFilter}/`))) continue
      if (packFilter !== '' && entry.pack.toLowerCase() !== packFilter) continue
      if (produceFilter !== '' && !entry.outputs.includes(produceFilter)) continue

      if (acceptsFilter !== '') {
        const inputs = {
          ...(entry.raw.input?.required ?? {}),
          ...(entry.raw.input?.optional ?? {}),
        }
        const has = Object.values(inputs).some(spec => typeOf(spec).toUpperCase().split('|').includes(acceptsFilter))
        if (!has) continue
      }

      if (modelFilter !== '') {
        const inputs = {
          ...(entry.raw.input?.required ?? {}),
          ...(entry.raw.input?.optional ?? {}),
        }
        const hit = Object.values(inputs).some(spec =>
          (optionsOf(spec) ?? []).some(option => option.toLowerCase().includes(modelFilter)),
        )
        if (!hit) continue
      }

      if (needle !== '') {
        let how: NodeSummary['matches'] | undefined
        if (entry.classL === needle || entry.classL === compact || entry.classL === loose
          || entry.classL.startsWith(needle) || entry.classL.startsWith(compact)
          || entry.classL.startsWith(loose)) how = 'name'
        else if (entry.displayL.includes(needle) || entry.displayL.includes(loose) || entry.displayL.replace(/[\s_]+/g, '').includes(compact)) how = 'display'
        else if (entry.aliasesL.some(alias => alias.includes(needle) || alias.includes(loose))) how = 'alias'
        else if (entry.categoryL.includes(needle)) how = 'type'
        else if (entry.summaryL.includes(needle)) how = 'description'
        if (how === undefined) continue
        hits.push({ entry, rank: rankOf(entry, how), how })
      } else {
        // 只给了类型/分类/包名条件：这类都算 type 命中
        hits.push({ entry, rank: 4, how: 'type' })
      }
    }

    hits.sort((a, b) =>
      (a.rank - b.rank)
      || (Number(b.entry.outputNode) - Number(a.entry.outputNode))
      || a.entry.classType.localeCompare(b.entry.classType))

    const limit = Math.max(1, Math.min(30, Math.floor(query.limit ?? 8)))
    const page = hits.slice(0, limit)

    const nodes: NodeSummary[] = page.map(({ entry, how }) => ({
      classType: entry.classType,
      displayName: entry.displayName,
      category: entry.category,
      pack: entry.pack,
      summary: entry.summary,
      matches: how,
      outputNode: entry.outputNode,
    }))

    if (query.detail !== true) return { total: hits.length, shown: nodes.length, nodes }

    const details: Record<string, NodeDetail> = {}
    for (const { entry } of page) {
      const describe = ([name, spec]: [string, unknown]) => {
        const options = optionPreviewOf(spec)
        return options === undefined ? { name, type: typeOf(spec) } : { name, type: typeOf(spec), options: options.shown, optionCount: options.total }
      }
      const required = Object.entries(entry.raw.input?.required ?? {}).map(describe)
      const optional = Object.entries(entry.raw.input?.optional ?? {}).map(describe)
      const outputs = entry.outputs.map((type, index) => {
        const named = Array.isArray(entry.raw.output_name) ? entry.raw.output_name[index] : undefined
        return { name: typeof named === 'string' ? named : type, type }
      })
      details[entry.classType] = { inputs: { required, optional }, outputs }
    }
    return { total: hits.length, shown: nodes.length, nodes, details }
  }
}
