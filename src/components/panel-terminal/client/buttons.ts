/**
 * 终端面板底部按钮的决策表（纯函数，React 之外）。
 *
 * 这块看着只有两个按钮，但状态组合很多，最容易写错的两条是：
 * 1. **外部实例绝不能显示可点的「关机」** —— 那个进程不是我们拉起的，杀了就是越界；
 * 2. **未启动时 `managed` 也是 false**，不能只按它二分，否则会把"根本没在跑"说成外部实例。
 *
 * 抽出来单测，是因为它们只涉及状态判断，不该靠渲染断言反推。
 */

/** 终端按钮需要的状态切片（与后端 ServiceStatus 对齐）。 */
export interface TerminalButtonState {
  /** 有没有拿到过状态（第一轮轮询之前是 undefined）。 */
  hasStatus: boolean
  /** `unknown` / `external` / `starting` / `ready` / `failed`。 */
  state: string
  /** 进程是不是本插件拉起的。 */
  managed: boolean
  /** 受管实例队列里还有没有活（只有 ready + managed 时后端才会探测）。 */
  busy: boolean
}

/** 按钮该显示什么。 */
export interface TerminalActions {
  /** 显示可点的「启动」。 */
  canStart: boolean
  /** 显示可点的「关机」。 */
  canStop: boolean
  /** 显示灰掉、不可点的「关机」（外部实例的提示态）。 */
  stopDisabled: boolean
  /** 点「关机」前要不要二次确认（正在出图时）。 */
  confirmBeforeStop: boolean
}

/**
 * 算按钮状态。
 *
 * @param input - 状态切片。
 */
export function terminalActions(input: TerminalButtonState): TerminalActions {
  const { hasStatus, state, managed, busy } = input

  // 外部实例：显示灰掉的关机，让用户知道"这有个进程，但不是我们管的"。
  if (state === 'external') {
    return { canStart: false, canStop: false, stopDisabled: true, confirmBeforeStop: false }
  }

  // 没在跑（unknown / failed）：只给启动。
  if (state === 'unknown' || state === 'failed') {
    return { canStart: hasStatus, canStop: false, stopDisabled: false, confirmBeforeStop: false }
  }

  // 拉起中：两个按钮都不给，避免连点两下起两个进程、或在半启动时打断。
  if (state === 'starting') {
    return { canStart: false, canStop: false, stopDisabled: false, confirmBeforeStop: false }
  }

  // ready：只有本插件拉起的进程才能停。出图中要二次确认，别把正在跑的图一起关掉。
  if (state === 'ready' && managed) {
    return { canStart: false, canStop: true, stopDisabled: false, confirmBeforeStop: busy }
  }

  return { canStart: false, canStop: false, stopDisabled: false, confirmBeforeStop: false }
}
