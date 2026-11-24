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
