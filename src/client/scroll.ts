/**
 * 「滚到底部自动加载下一页」的判定。
 *
 * 抽成纯函数是因为这段逻辑在两个面板里各有一份（标签库、姿势库），而它出错的方式
 * 全在边界上：正在加载时重复触发、已经到底了还继续请求、滚动事件太密把服务端打爆。
 * 这些用肉眼和 SSR 都验不出来，只能对函数打表。
 */

export interface ScrollLoadInput {
  /** 整块内容高度。 */
  scrollHeight: number
  /** 当前滚动位置。 */
  scrollTop: number
  /** 可视高度。 */
  clientHeight: number
  /** 已经在列表里的条数。 */
  shown: number
  /** 命中总数。 */
  total: number
  /** 是否正在加载（加载中不该再触发）。 */
  loading: boolean
  /** 当前时间戳（毫秒）。 */
  now: number
  /** 上一次触发的时间戳，用于节流。 */
  busyAt: number
}

/** 距底多少像素开始预取。等用户真看见底时，下一页通常已经在路上。 */
export const LOAD_MORE_MARGIN = 320

/** 两次触发的最小间隔（毫秒）。scroll 一次滚动能来几十个事件。 */
export const LOAD_MORE_GAP = 100

/**
 * 该不该加载下一页。
 *
 * @param input - 滚动位置与列表状态。
 * @param margin - 预取余量。
 * @param gap - 节流间隔。
 */
export function shouldLoadMore(input: ScrollLoadInput, margin = LOAD_MORE_MARGIN, gap = LOAD_MORE_GAP): boolean {
  // 一条都没有时不预取：那是首屏还在加载、或者筛选结果为空，两种情况都不该再要一页
  if (input.loading || input.shown === 0 || input.shown >= input.total) return false
  if (input.now - input.busyAt < gap) return false
  const remain = input.scrollHeight - input.scrollTop - input.clientHeight
  return remain <= margin
}

export interface AutoFillInput {
  /** 整块内容高度。 */
  scrollHeight: number
  /** 可视高度。**0 表示容器没被布局**（页签隐藏、`display:none`）。 */
  clientHeight: number
  shown: number
  total: number
  loading: boolean
  /**
   * 上一次"补一屏"动作发生时的 `shown`。
   *
   * 用来判断有没有进展：补过一页之后 `shown` 没变，说明这次没拿到新数据
   * （请求失败、或者服务端返回空），继续补就是无间隔重试。换条件时调用方把它复位成 -1。
   */
  lastFilledShown: number
}

/** 内容不足一屏时的补页判定：`scrollHeight` 比可视高度还小才需要补。 */
export const AUTO_FILL_SLACK = 4

/**
 * 该不该为"填满一屏"再要一页。
 *
 * 与 `shouldLoadMore` 分开是因为触发源不同：那个由用户滚动驱动，这个由"加载完成后自检"
 * 驱动 —— 后者没有用户动作做节流，**必须自己保证一定会停手**。否则一个失败请求就能让
 * effect 空转：`load` 每次都翻转 `loading`，effect 每轮都会重跑，而失败的 append 又不动
 * `shown` / `total`，条件永远成立。
 *
 * 三道闸：隐藏不补（`clientHeight` 为 0）、没进展不补（`lastFilledShown` 相同）、
 * 已经够一屏不补。
 */
export function shouldAutoFill(input: AutoFillInput, slack = AUTO_FILL_SLACK): boolean {
  if (input.loading) return false
  if (input.clientHeight <= 0) return false
  if (input.shown === 0 || input.shown >= input.total) return false
  if (input.lastFilledShown === input.shown) return false
  return input.scrollHeight <= input.clientHeight + slack
}
