/** Web 客户端 `betterSidebar` 服务的最小面。 */
export interface BetterSidebarLike {
  registerTab: (options: Record<string, unknown>) => () => void
  openTab: (seed: { type: string }) => void
}

/** Web 客户端 `slots` 服务的最小面。 */
export interface SlotRegistryLike {
  inject: (name: string, register: () => () => void) => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

/** Web 客户端 `layout` 服务的最小面。 */
export interface LayoutServiceLike {
  selectPanel?: (panelId: string) => void
}

/** `ctx.inject(['betterSidebar'], scope => ...)` 回调收到的作用域最小面。 */
export interface ClientHostScope {
  betterSidebar?: BetterSidebarLike
  effect?: (run: () => void | (() => void), label?: string) => void
}

/** Web 客户端上下文的最小面。 */
export interface ClientHostContext {
  get?: (name: string) => unknown
  inject?: (names: string[], run: (scope: ClientHostScope) => void) => void
}
