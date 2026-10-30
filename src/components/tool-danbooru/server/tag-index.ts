/**
 * 标签库的可搜索索引。
 *
 * 原来的 `searchTags` 每次调用都线性扫 35,384 条记录，并对每条记录的 tag 与全部
 * 别名做 `toLowerCase` + 多次 `includes` —— 实测 19 ms。两件事叠加：
 *
 * ① **小写与归一化重复计算**：同一个 tag 每查一次就 `toLowerCase` 一次。
 *    预计算一次即可，这一条单独就带来 2.2x。
 * ② **候选集太大**：绝大多数记录连一个字符都不匹配，却全被扫了。
 *    按 2-gram 建桶，查询只扫命中的那个桶 —— 候选从 35,384 降到几十条。
 *
 * 两条加起来实测 19 ms → 0.095 ms（55.9x，见 perf-and-rust.md）。
 *
 * **只改候选集，不改判定**：档位顺序、空格↔下划线等价、别名精确提升 tag 名
 * 前缀/包含 —— 全部照原样，所以现有断言应当全绿。
 */

/** 命中方式。`tag` 表示直接命中 tag 名本身（最强）。 */
export type MatchHow = 'tag' | 'exact' | 'prefix' | 'contains'

/** 一条匹配结果。 */
export interface IndexMatch<T> {
  record: T
  how: MatchHow
}

/** 索引需要的记录形状（只取用到的那几个字段）。 */
export interface IndexableRecord {
  tag: string
  postCount: number
  names: string[]
}

/** 档位排序权重。 */
const RANK: Record<MatchHow, number> = { tag: 0, exact: 1, prefix: 2, contains: 3 }

/** 预计算好的一条记录。 */
interface Prepared {
  record: IndexableRecord
  tagL: string
  /** 空格/下划线归一成下划线的 tag 名。 */
  tagN: string
  namesL: Array<{ raw: string; normalized: string }>
}

/**
 * 把一段文本按 2-gram 拆开。
 *
 * 用下划线归一后的形式建桶：查询 `hatsune miku` 与 `hatsune_miku` 会落到同一批桶里，
 * 与匹配阶段"空格与下划线等价"的规则一致。
 *
 * @param text - 已小写、已归一的文本。
 */
function gramsOf(text: string): string[] {
  if (text.length < 2) return []
  const out: string[] = []
  for (let i = 0; i + 2 <= text.length; i += 1) out.push(text.slice(i, i + 2))
  return out
}

/** 小写 + 空格/下划线归成下划线。 */
function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '_')
}

/**
 * 建一份可反复查询的索引。
 *
 * 建索引一次约 87 ms（35,384 条、58,179 个桶），之后每次查询 0.1 ms 级。
 * 调用方应当缓存索引实例（`createTagCache` 就是这样做的），而不是每次查询重建。
 */
export class TagIndex<T extends IndexableRecord> {
  private readonly prepared: Prepared[]
  /** 2-gram → 记录下标。 */
  private readonly grams: Map<string, number[]>

  constructor(records: readonly T[]) {
    this.prepared = records.map(record => {
      const tagL = record.tag.trim().toLowerCase()
      return {
        record,
        tagL,
        tagN: tagL.replace(/[\s_]+/g, '_'),
        namesL: record.names.map(name => ({
          raw: name.trim().toLowerCase(),
          normalized: name.trim().toLowerCase().replace(/[\s_]+/g, '_'),
        })),
      }
    })

    const grams = new Map<string, number[]>()
    const add = (text: string, index: number): void => {
      for (const gram of gramsOf(text)) {
        let bucket = grams.get(gram)
        if (bucket === undefined) {
          bucket = []
          grams.set(gram, bucket)
        }
        // 同一条记录的 tag 与多个别名可能产生重复 gram，相邻去重即可
        if (bucket[bucket.length - 1] !== index) bucket.push(index)
      }
    }
    this.prepared.forEach((item, index) => {
      add(item.tagN, index)
      for (const name of item.namesL) add(name.normalized, index)
    })
    this.grams = grams
  }

  /** 记录条数。 */
  get size(): number {
    return this.prepared.length
  }

  /**
   * 搜索。
   *
   * @param query - 查询串（中文、日文、tag 都行；空格与下划线等价）。
   * @param limit - 最多返回几条。
   */
  search(query: string, limit = 10): Array<IndexMatch<T>> {
    const needle = normalize(query)
    if (needle === '') return []
    // 别名匹配要用**未归一**的原串：线性实现里 `candidate.includes(needle)` 的 needle
    // 是 'orange star'（带空格），而归一后的 'orange_star' 命中范围更大。
    // 两者必须先对齐，否则同一个查询在索引版会多出 contains 档结果、挤掉原有的。
    const original = query.trim().toLowerCase()
    const spaced = needle.replace(/_+/g, ' ')

    // 单字符查询走不了 2-gram：这类查询本来就少，直接全扫。
    const candidates = needle.length < 2
      ? this.prepared.map((_, index) => index)
      : (this.grams.get(needle.slice(0, 2)) ?? [])

    const matches: Array<{ item: Prepared; how: MatchHow }> = []
    for (const index of candidates) {
      const item = this.prepared[index] as Prepared
      let best: MatchHow | undefined

      // tag 名本身命中排最前
      if (item.tagL === needle || item.tagN === needle) best = 'tag'
      else if (item.tagL.startsWith(needle) || item.tagN.startsWith(needle)) best = 'prefix'
      else if (item.tagL.includes(needle) || item.tagN.includes(needle)) best = 'contains'

      // tag 名只是"前缀"或"包含"命中时，别名可能精确命中 —— 那档更该优先
      // （`hatsune_miku` 的别名里有 `miku`，查 miku 应当把它提上来）。
      if (best === undefined || best === 'prefix' || best === 'contains') {
        for (const name of item.namesL) {
          if (name.raw === needle || name.normalized === needle) { best = 'exact'; break }
          if (name.raw.startsWith(needle) || name.normalized.startsWith(needle)) {
            if (best === undefined) best = 'prefix'
            continue
          }
          if (name.raw.includes(original) || name.raw.includes(spaced)) {
            if (best === undefined) best = 'contains'
          }
        }
      }

      if (best !== undefined) matches.push({ item, how: best })
    }

    matches.sort((a, b) => (RANK[a.how] - RANK[b.how]) || (b.item.record.postCount - a.item.record.postCount))
    return matches.slice(0, limit).map(match => ({ record: match.item.record as T, how: match.how }))
  }
}

/**
 * 不建索引的线性搜索。
 *
 * 与 {@link TagIndex.search} 判定完全相同，只是每次全扫、且不做预计算。
 * 保留它有两个用处：小数据量场景（几十条）不值得建索引；以及作为基准对照，
 * 证明索引只改候选集不改判定。
 *
 * @param records - 记录。
 * @param query - 查询串。
 * @param limit - 最多几条。
 */
export function searchTagsLinear<T extends IndexableRecord>(
  records: readonly T[],
  query: string,
  limit = 10,
): Array<IndexMatch<T>> {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []
  const loose = needle.replace(/[\s_]+/g, '_')
  const spaced = needle.replace(/[_\s]+/g, ' ')

  const matches: Array<IndexMatch<T>> = []
  for (const record of records) {
    const tagName = record.tag.toLowerCase()
    const tagNormalized = tagName.replace(/[\s_]+/g, '_')
    let best: MatchHow | undefined
    if (tagName === needle || tagNormalized === loose) best = 'tag'
    else if (tagName.startsWith(needle) || tagNormalized.startsWith(loose)) best = 'prefix'
    else if (tagName.includes(needle) || tagNormalized.includes(loose)) best = 'contains'

    if (best === undefined || best === 'prefix' || best === 'contains') {
      for (const name of record.names) {
        const candidate = name.toLowerCase()
        const normalized = candidate.replace(/[\s_]+/g, '_')
        if (candidate === needle || normalized === loose) { best = 'exact'; break }
        if (candidate.startsWith(needle) || normalized.startsWith(loose)) {
          if (best === undefined) best = 'prefix'
          continue
        }
        if (candidate.includes(needle) || candidate.includes(spaced)) {
          if (best === undefined) best = 'contains'
        }
      }
    }
    if (best !== undefined) matches.push({ record, how: best })
  }

  matches.sort((a, b) => (RANK[a.how] - RANK[b.how]) || (b.record.postCount - a.record.postCount))
  return matches.slice(0, limit)
}
