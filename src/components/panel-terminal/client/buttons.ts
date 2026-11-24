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
  /** 显示可点的「关机」（或启动中的「取消启动」）。 */
  canStop: boolean
  /** 当 `canStop` 为真时，表示处于启动中，文案应显示「取消启动」。 */
  canceling: boolean
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

  // 第一轮轮询回来之前不展示任何按钮，避免状态未定就误操作。
  if (!hasStatus) {
    return { canStart: false, canStop: false, canceling: false, stopDisabled: false, confirmBeforeStop: false }
  }

  // 外部实例：显示灰掉的关机，让用户知道"这有个进程，但不是我们管的"。
  if (state === 'external') {
    return { canStart: false, canStop: false, canceling: false, stopDisabled: true, confirmBeforeStop: false }
  }

  // 拉起中：子进程已拉起时给「取消启动」（冷启卡死时不用干等 180 秒）；尚未拉起前不给动作。
  if (state === 'starting') {
    return { canStart: false, canStop: managed, canceling: managed, stopDisabled: false, confirmBeforeStop: false }
  }

  // 失败：若超时但受管子进程还活着，先给「关机」清掉旧进程，避免再起第二个撞端口；否则给「启动」。
  if (state === 'failed') {
    return managed
      ? { canStart: false, canStop: true, canceling: false, stopDisabled: false, confirmBeforeStop: false }
      : { canStart: true, canStop: false, canceling: false, stopDisabled: false, confirmBeforeStop: false }
  }

  // 没在跑（unknown）：只给启动。
  if (state === 'unknown') {
    return { canStart: !managed, canStop: false, canceling: false, stopDisabled: false, confirmBeforeStop: false }
  }

  // ready：只有本插件拉起的进程才能停。出图中要二次确认，别把正在跑的图一起关掉。
  if (state === 'ready' && managed) {
    return { canStart: false, canStop: true, canceling: false, stopDisabled: false, confirmBeforeStop: busy }
  }

  return { canStart: false, canStop: false, canceling: false, stopDisabled: false, confirmBeforeStop: false }
}
