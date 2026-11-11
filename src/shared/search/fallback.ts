/**
 * 零命中时"逐字砍尾再试"。
 *
 * 起因：素材库的匹配是**小写子串 + 空格 AND**，所以中文动词短语必然失败 ——
 * `坐着` 不是任何字段的子串，而 `坐` 能命中 58 条（含「坐姿」29 组与名字里带「坐」的）。
 * 实测能救回的：`坐着`→`坐`、`站着`→`站`、`跪着`→`跪`、`白裙子`→`白`。
 * 救不回的：`水手服`（数据里没有这个品类词）、`好看的连衣裙`（长修饰语，砍尾也切不掉）。
 *
 * **回退必须让调用方知道**：模型查「坐着」却拿到 58 条坐姿，如果不告诉它"我用的是坐"，
 * 它会以为这些结果对应的是"坐着"，反而更难判断。所以返回里带 `usedQuery` 与 `fellBack`。
 */

/** 回退结果。 */
export interface PrefixFallbackResult<T> {
  /** 最终命中的条目（未分页）。 */
  list: T[]
  /** 实际用来查的词：没回退时等于原查询。 */
  usedQuery: string
  /** 是否发生了回退。 */
  fellBack: boolean
  /** 被砍掉的尾部（如 `裙子`）；没回退时为空串。 */
  droppedTail: string
}

/**
 * 被砍掉的尾部是不是**虚词/方位词**。
 *
 * 这决定"回退后的结果还能不能信"：
 * - `坐着` 砍掉 `着` → 语义没丢，58 条坐姿就是用户要的 ✓
 * - `白裙子` 砍掉 `裙子` → 核心名词没了，剩下的 507 条里可能一件裙子都不是 ✗
 * - `牛仔外套` 砍掉 `外套` → 那 175 条里`外套`在数据里根本是 0 条 ✗
 *
 * 所以判据不是"命中占比多大"（小库容易误伤），而是**砍掉的东西是不是实词**。
 */
const FILLER_TAIL = /^[着过了的在地得里中下上之吗呢吧啊呀哦嘛]+$/

/**
 * @param droppedTail - 被砍掉的尾部。
 * @returns 全是虚词/方位词时为 true —— 这样的回退结果可以照常给。
 */
export function isFillerTail(droppedTail: string): boolean {
  return droppedTail !== '' && FILLER_TAIL.test(droppedTail)
}

/**
 * 先按原词查，零命中再逐字砍掉最后一个词的尾字重试。
 *
 * 只砍最后一个词、最多砍 `maxCuts` 字：中文里多出来的通常是尾字（着 / 上 / 了），
 * 砍太多会退化成单字，命中一堆不相关的东西。
 *
 * @param query - 原始查询词。
 * @param run - 用某个词执行一次检索，返回全部命中条目（不分页）。
 * @param maxCuts - 最多砍几个字，默认 4。实测 3 救不了 `坐在椅子上`（砍 3 字是「坐在椅」），
 *   砍 4 字才落回「坐」；再放宽会让 `好看的连衣裙` 这种长修饰语退化成单字，命中一堆不相干的。
 */
export function searchWithPrefixFallback<T>(
  query: string,
  run: (query: string) => T[],
  maxCuts = 4,
): PrefixFallbackResult<T> {
  const direct = run(query)
  const trimmed = query.trim()
  if (direct.length > 0 || trimmed === '') {
    return { list: direct, usedQuery: query, fellBack: false, droppedTail: '' }
  }

  // **只对中文查询回退**。英文砍字没有语言学意义：`prone` 会依次变成 `pron` / `pro` / `pr`，
  // 都是碎片，撞上别的词的别名反而误命中（实测 `prone` 砍成 `pr` 命中 4 组立位，全是假的）。
  if (!/[\u4e00-\u9fff]/.test(trimmed)) {
    return { list: direct, usedQuery: query, fellBack: false, droppedTail: '' }
  }

  const parts = trimmed.split(/\s+/).filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  for (let cut = 1; cut <= Math.min(last.length - 1, maxCuts); cut += 1) {
    const shortened = last.slice(0, last.length - cut)
    if (shortened === '') break
    const attempt = [...parts.slice(0, -1), shortened].join(' ')
    const result = run(attempt)
    if (result.length > 0) {
      return { list: result, usedQuery: attempt, fellBack: true, droppedTail: last.slice(last.length - cut) }
    }
  }
  return { list: direct, usedQuery: query, fellBack: false, droppedTail: '' }
}
