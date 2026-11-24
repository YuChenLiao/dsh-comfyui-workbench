import type { Disposer, HostContext } from './types.js'

/** 宿主工具规格的最小面（只要求有工具名）。 */
export interface HostToolSpec {
  name: string
}

/** 宿主 `tools` 服务的最小面。 */
export interface HostToolsService {
  register: (spec: unknown) => Disposer | void
}

/** 注册宿主工具时的可选参数。 */
export interface RegisterHostToolOptions {
  /** 生命周期标签前缀（用于 `ctx.effect`）。 */
  label?: string
  /** 自定义 disposer 追踪器（例如共享 runtime 的 `rt.track`）。 */
  track?: (dispose: Disposer | void) => void
  /** 降级或失败时的日志回调（默认 `console.warn`）。 */
  warn?: (message: string) => void
  /** 拿不到 `tools` 服务时的提示文案。 */
  missingMessage?: string
  /** 注册失败时是否向上抛出（供 `registerTools` 自行收集 `report.failed`）。 */
  throwOnError?: boolean
  /** 预留给 v0.9.0 deliverables/presented（局部探测 `sessionProjections`）的挂钩点。 */
  onRegistered?: (spec: HostToolSpec, ctx: HostContext) => void
}

/**
 * 统一封装 `ctx.effect` 存在性检查与生命周期注册。
 *
 * 宿主或测试传入的 `ctx` 可能不带 `effect`（例如无容器的单测环境），
 * 此时静默跳过注册，不抛异常。
 */
export function onHostDispose(ctx: HostContext, label: string, cleanup: () => void): void {
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup, label)
  }
}

/**
 * 统一封装路由生命周期注册。
 *
 * `ctx.effect` 存在时把 `mountFn` 挂进作用域，卸载时自动执行返回的清理函数；
 * 缺省时直接执行 `mountFn` 并返回清理函数。
 */
export function mountHostRoutes(ctx: HostContext, label: string, mountFn: () => Disposer): Disposer {
  if (typeof ctx.effect === 'function') {
    let mounted = false
    ctx.effect(() => {
      mounted = true
      return mountFn()
    }, label)
    if (mounted) return () => {}
  }
  return mountFn()
}

/** 从宿主上下文安全读取 `tools` 服务。 */
export function resolveHostTools(ctx: HostContext): HostToolsService | undefined {
  const tools = ctx.get?.('tools') as Partial<HostToolsService> | undefined
  if (tools === undefined || tools === null || typeof tools.register !== 'function') {
    return undefined
  }
  return tools as HostToolsService
}

/**
 * 向宿主注册单个工具，并统一处理判空、disposer 追踪与降级警告。
 */
export function registerHostTool(
  ctx: HostContext,
  spec: HostToolSpec,
  options?: RegisterHostToolOptions,
): boolean {
  const warn = options?.warn ?? ((message: string) => console.warn(message))
  const tools = resolveHostTools(ctx)
  if (tools === undefined) {
    if (options?.missingMessage !== undefined) warn(options.missingMessage)
    return false
  }

  try {
    const dispose = tools.register(spec)
    if (options?.track !== undefined) {
      options.track(dispose)
    } else if (typeof dispose === 'function') {
      onHostDispose(ctx, `${options?.label ?? 'host'}: tool ${spec.name}`, dispose)
    }
    options?.onRegistered?.(spec, ctx)
    return true
  } catch (error) {
    if (options?.throwOnError === true) throw error
    const message = error instanceof Error ? error.message : String(error)
    warn(`[comfyui-workbench] 工具 ${spec.name} 未注册：${message}`)
    return false
  }
}

/**
 * 批量向宿主注册工具；`tools` 服务不可用时只告警一次。
 */
export function registerHostTools(
  ctx: HostContext,
  specs: HostToolSpec[],
  options?: RegisterHostToolOptions,
): number {
  const warn = options?.warn ?? ((message: string) => console.warn(message))
  if (resolveHostTools(ctx) === undefined) {
    if (options?.missingMessage !== undefined) warn(options.missingMessage)
    return 0
  }

  let registered = 0
  for (const spec of specs) {
    if (registerHostTool(ctx, spec, { ...options, warn })) {
      registered += 1
    }
  }
  return registered
}

/**
 * 为 `registerTools(TOOL_GROUPS, deps, ...)` 生成适配器回调。
 *
 * 拿不到 `tools` 服务时返回 `undefined`，由调用方决定降级提示；
 * 拿到后返回的回调在注册抛错时会向上抛出，让 `registerTools` 正常收集 `report.failed`。
 */
export function createHostToolRegistrar(
  ctx: HostContext,
  options?: Omit<RegisterHostToolOptions, 'missingMessage' | 'throwOnError'>,
): ((spec: unknown) => void) | undefined {
  if (resolveHostTools(ctx) === undefined) return undefined
  return (spec: unknown) => {
    registerHostTool(ctx, spec as HostToolSpec, { ...options, throwOnError: true })
  }
}

/**
 * cordis 根上下文的候选 symbol 键（`Symbol.for('cordis.root')`）。
 *
 * 用 `Symbol.for` 而不是 `import { Context }`：本包没有 cordis 的运行时依赖，
 * 硬 import 会把宿主提供的类型变成真实依赖。
 *
 * **这不是唯一取法，也不该当成事实断言**：本地打包进 DSH 的 cordis（实测 4.0.2 /
 * DSH 0.2.2-rc.5）里根本没有这个 symbol，根上下文是普通属性 `this.root = self`；
 * 只有 issue #3 报告的 0.2.3-alpha.2（cordis 4.2.0-alpha.1）才换成 symbol。
 * 所以这里只把它当"先试一下"，真正的兜底是下面的 `ctx.root`。
 */
export const HOST_ROOT_SYMBOL: symbol = Symbol.for('cordis.root')

/**
 * 取所有 entry 共同的原点上下文。
 *
 * cordis 里每条 entry 的 ctx 是 `parent.extend({ fiber })` 出来的独立对象，
 * 兄弟之间不共享自有属性；把共享状态挂在 entry 自己的 ctx 上等于各建一份。
 * 只有根上下文是所有 entry 共同的原点，因此取法必须跟着宿主版本走：
 *
 *   1. cordis >= 4.0.0-rc.12（DSH >= 0.2.2-rc.2）：根上下文是 `ctx[Context.root]`。
 *      直接读 `ctx.root` 会抛 `cannot get property "root" without inject`。
 *   2. 更早的 cordis：根上下文是普通属性 `ctx.root`，且**没有** root symbol。
 *   3. 单测或非 cordis 环境：两者都不存在，退回 `ctx` 自身。
 *
 * 两条路都必须保留 —— 只认 symbol 会在旧宿主上取到 undefined 并静默退回自身，
 * 表现为每个 entry 各建一份 Runtime，比启动失败更难排查。
 *
 * @param ctx - 任意 entry 的上下文。
 */
/** 兜底警告只打一次：它挂在每条 entry 的 apply 路径上，重复刷屏没有额外信息。 */
let rootFallbackWarned = false

export function resolveHostRoot(ctx: HostContext, warn?: (message: string) => void): unknown {
  const candidate = ctx as unknown as Record<symbol, unknown> & { root?: unknown }

  try {
    const viaSymbol = candidate[HOST_ROOT_SYMBOL]
    if (viaSymbol !== undefined && viaSymbol !== null) return viaSymbol
  } catch {
    // 个别宿主会对 symbol 读取也走校验分支：忽略，走下面的兼容路径。
  }

  try {
    const viaProperty = candidate.root
    if (viaProperty !== undefined && viaProperty !== null) return viaProperty
  } catch {
    // 新版本 cordis（issue #3 报告的那支）：读 ctx.root 直接抛错。这就是要兜住的那条。
  }

  // 两条路都没取到：退回 entry 自己的 ctx。这会让每个 entry 各建一份共享运行时
  // （路由表、refs 计数都不再共享），症状是"某些接口 404 但没报错"——
  // 必须留下痕迹，否则排查成本远高于一条警告。
  if (!rootFallbackWarned) {
    rootFallbackWarned = true
    const message = '[comfyui-workbench] 取不到 cordis 根上下文（symbol 与 ctx.root 都不可用），'
      + '共享运行时将退回各 entry 自身：跨组件路由与工具可能互相看不见。'
    if (warn !== undefined) warn(message)
    else console.warn(message)
  }
  return ctx
}

/** 仅测试用：重置兜底警告的一次性标记。 */
export function resetRootFallbackWarning(): void {
  rootFallbackWarned = false
}
