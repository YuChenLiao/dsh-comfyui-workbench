/**
 * 终端面板「关机」按钮的判定：什么时候出现、能不能点、点了要不要确认。
 *
 * 抽成纯函数是为了能测。`Terminal` 里现算这段也能跑，但它的三种错法都验不出来：
 * - 在 `starting` 给了按钮 → 点下去和 `start()` 抢同一个 child，界面显示"就绪但没进程"
 * - 外部实例给了可点按钮 → 点了没反应也不报错，用户以为插件坏了
 * - 无条件弹确认 → 空闲时也要多点一次，而忙时**不**弹会直接丢任务
 *
 * 而 SSR 测不到：按钮由 `status` 派生，首帧 `status` 是 `undefined`，五个状态一个都渲染不出来。
 * 所以跟 `scroll.ts` / `format.ts` 同一路数，判定留在这里，由 `tests/render.mjs` 打表。
 */

/**
 * 判定需要的**最小**状态形状。
 *
 * 不直接收 `ServiceStatus`：面板侧的 `Status` 是它的手写子集（`state` 是宽松的 `string`，
 * 因为要兜住后端将来新增的状态值而不至于在类型上先崩）。两边都按结构满足这个接口，
 * 面板与后端就不必为了共用这个纯函数而互相耦合类型。
 */
export interface StopButtonInput {
  /** 服务状态；后端是联合类型，面板侧是 `string`，这里只关心几个字面量。 */
  state: string
  /** 进程是否由本插件拉起。 */
  managed: boolean
  /** 队列里还有没有活；缺失按不忙处理。 */
  busy?: boolean
}

/**
 * 关机按钮该渲染成什么。
 *
 * 用特判类型而不是带 `disabled` 布尔的结构：`external` 这个分支的全部意义就是
 * "点不动 + 说明原因"，把它拆成一个 kind 加一个独立布尔，两者就会有可能对不上的组合。
 */
export type StopButtonPlan =
  /** 不渲染。 */
  | { kind: 'none' }
  /** 正常可点的关机。 */
  | { kind: 'stop' }
  /**
   * 外部实例的关机：灰着但占位。
   *
   * 直接不渲染会让人以为"这个面板就是没有关机功能"；灰着并说明原因，
   * 用户才知道该去关哪个进程。
   */
  | { kind: 'external'; tip: string }

/**
 * 决定渲染哪个关机按钮。
 *
 * 五种状态的去处：
 * - `unknown` → 不渲染（该给的是「启动」）
 * - `starting` → 不渲染：拉起是异步的，这期间停会和 `start()` 抢同一个 child
 * - `ready && managed` → 可点的关机
 * - `ready && !managed` → 灰着的关机
 * - `failed && managed` → 可点的关机（**见下**）
 *
 * `failed && managed` 也必须给停止：`start()` 超时（或进程起得慢）时会先把 state 写成
 * `failed` 而 **child 仍然活着**（supervisor.ts 的 `start()` 在循环结束后直接置 failed，
 * 没有 kill 子进程）。此时 `canStart` 因 `!managed` 为假、而这里若再不给停止，
 * 面板就**一个按钮都没有**，进程却还占着端口 —— 正是这个面板要消灭的那种"没有关闭入口"。
 * 规格的矩阵没覆盖这一格（它假定 failed 时进程已经没了），按规格自己的目的补齐。
 *
 * @param status - 当前托管状态；首帧还没有时传 `undefined`。
 */
export function planStopButton(status: StopButtonInput | undefined): StopButtonPlan {
  // 首帧不猜：managed/state 都还没读到，猜哪个都是闪一个错按钮。
  if (status === undefined) return { kind: 'none' }
  // 外部实例优先判：`ready` 与 `managed` 是两次读取拼起来的，
  // 万一拼出 `ready && !managed`，也得当外部实例处理 —— 那本来就不是我们能停的东西。
  if (status.managed !== true) {
    return status.state === 'external' || status.state === 'ready'
      ? { kind: 'external', tip: 'termStopExternal' }
      : { kind: 'none' }
  }
  // managed 侧：ready 能停；failed 也放行（进程可能还活着，见上）。
  // starting 仍然不给 —— 那是唯一会与 start() 抢同一 child 的状态。
  return status.state === 'ready' || status.state === 'failed'
    ? { kind: 'stop' }
    : { kind: 'none' }
}

/**
 * 点「关机」前要不要二次确认。
 *
 * 只有队列忙才问：`stop()` 是 `child.kill()` 硬杀，不等队列 ——
 * 忙的时候点下去会直接丢掉正在跑的任务；空闲时弹窗只是让人多点一次。
 *
 * `busy` 缺失按**不忙**处理，与 `queueBusy()` 的语义一致：拿不到就当作没活，
 * 连不上时停止才是正确动作。
 *
 * @param status - 当前托管状态；`busy` 由后端的 `/terminal` 一并给出。
 */
export function needsStopConfirm(status: StopButtonInput | undefined): boolean {
  return status?.busy === true
}

/** `runStop` 的依赖，全部注入 —— 这样「先确认、再停、最后立刻刷新」能被打表。 */
export interface StopFlow {
  /** 当前托管状态（决定要不要确认）。 */
  status: StopButtonInput | undefined
  /** 问一句；返回 false 就中止。真机上接 `window.confirm`。 */
  confirm: (message: string) => boolean
  /** 真正停止；真机上接 `stopService()`。抛错会被吞掉并照常刷新。 */
  stop: () => Promise<unknown>
  /** 停完立刻拉一次状态。 */
  pull: () => void
  /** 确认框的文案。 */
  message: string
}

/**
 * 点「关机」之后的完整动作：**要确认就确认、用户拒绝就什么都不做、停完立刻刷新**。
 *
 * 抽出来是因为这三步里有两处只靠读代码发现不了的错法：
 * - 确认写在 `await stop()` 之后（或忘了 return），于是"取消"其实已经停了
 * - 停完不 pull，点完这一秒里按钮还是「关机」，看起来像没反应
 *
 * 而 `Terminal` 是 React 组件、仓库又没有 DOM 测试库，所以这两条只能靠把动作本身
 * 拿出来打表（同 `shouldReclaim` 的思路：主路径要真进程，判定必须能单独验）。
 */
export async function runStop(flow: StopFlow): Promise<void> {
  if (needsStopConfirm(flow.status) && !flow.confirm(flow.message)) return
  try {
    await flow.stop()
  } catch {
    // 停不掉的原因会从下一轮 status.detail 里反映出来
  }
  flow.pull()
}
