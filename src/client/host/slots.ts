import type { BetterSidebarLike, ClientHostContext, SlotRegistryLike } from './types.js'

/** 主面板 id（`sidebar.panellist` 与 `main` 的 key 必须一致，否则点图标切不过去）。 */
export const PANEL_ID = 'comfyui-workbench'

/**
 * better-sidebar 页签 id。
 *
 * better-sidebar 在 localStorage 的 prefs.tabsEnabled 里按这个 id 记"启用/禁用"
 * （`isTabEnabled = prefs.tabsEnabled[id] !== false`）。历史 id（`:assets`）可能
 * 被写成 false 过，那样无论怎么注册都不会出现 —— 换一个干净的 id，默认即启用。
 */
export const TAB_ID = 'comfyui-workbench:workbench'

/** 挂载工作台入口所需的渲染与文案回调。 */
export interface WorkbenchEntryHandlers {
  title: () => string
  description: () => string
  renderTabIcon: (size?: number) => unknown
  renderPanelIcon: (props?: { size?: number }) => unknown
  renderTab: (props?: { visible?: boolean }) => unknown
  renderMain: () => unknown
}

/** 通用槽位注册参数（供 v0.9.0 扩展槽位复用）。 */
export interface SlotMountOptions {
  [key: string]: unknown
}

function resolveSlots(ctx: ClientHostContext): SlotRegistryLike | undefined {
  const slots = ctx.get?.('slots') as Partial<SlotRegistryLike> | undefined
  if (slots === undefined || slots === null || typeof slots.inject !== 'function' || typeof slots.register !== 'function') {
    return undefined
  }
  return slots as SlotRegistryLike
}

function mountSlot(
  ctx: ClientHostContext,
  slotName: string,
  options: SlotMountOptions,
  component: unknown,
): boolean {
  const slots = resolveSlots(ctx)
  if (slots === undefined) return false
  slots.inject(slotName, () => slots.register({ ...options, name: slotName }, component))
  return true
}

/**
 * 挂载工作台的宿主入口：
 *   1. `betterSidebar.registerTab`（可选注入 + `scope.effect` 降级）
 *   2. `sidebar.panellist` 图标
 *   3. `main` 主面板
 */
export function mountWorkbenchEntries(
  ctx: ClientHostContext,
  handlers: WorkbenchEntryHandlers,
): { openSidebar: () => boolean } {
  // better-sidebar 是可选依赖：未安装时 inject 永远不 resolve，这里也就不会注册任何东西。
  let sidebar: BetterSidebarLike | null = null

  const openSidebar = (): boolean => {
    if (sidebar === null) return false
    try {
      sidebar.openTab({ type: TAB_ID })
      return true
    } catch {
      return false
    }
  }

  ctx.inject?.(['betterSidebar'], scope => {
    const service = scope?.betterSidebar
    if (service === undefined || typeof service.registerTab !== 'function') return

    const register = (): (() => void) => {
      const dispose = service.registerTab({
        id: TAB_ID,
        title: handlers.title,
        description: handlers.description,
        icon: handlers.renderTabIcon,
        order: 40,
        single: true,
        component: handlers.renderTab,
      })
      sidebar = service
      return () => {
        sidebar = null
        dispose()
      }
    }

    if (typeof scope.effect === 'function') {
      scope.effect(register, 'comfyui-workbench: better-sidebar tab')
    } else {
      register()
    }
  })

  const slots = resolveSlots(ctx)
  if (slots === undefined) {
    console.warn('[comfyui-workbench] 拿不到 slots 服务，工作流管理界面未注册。')
    return { openSidebar }
  }

  mountSlot(ctx, 'sidebar.panellist', {
    id: PANEL_ID,
    order: 40,
    label: handlers.title,
  }, handlers.renderPanelIcon)

  mountSlot(ctx, 'main', {
    key: PANEL_ID,
  }, handlers.renderMain)

  console.info('[comfyui-workbench] 工作流管理界面已注册（侧边栏入口 + 主面板）')
  return { openSidebar }
}

/** 预留 v0.9.0：注册工具结果视图槽位（业务卡片不直接写 DSH 槽位字符串）。 */
export function mountToolView(
  ctx: ClientHostContext,
  options: SlotMountOptions,
  component: unknown,
): boolean {
  return mountSlot(ctx, 'tool.view', options, component)
}

/** 预留 v0.9.0：注册输入栏扩展槽位（业务卡片不直接写 DSH 槽位字符串）。 */
export function mountComposerSlot(
  ctx: ClientHostContext,
  options: SlotMountOptions,
  component: unknown,
): boolean {
  return mountSlot(ctx, 'composer.slot', options, component)
}

/** 预留 v0.9.0：注册输入框停靠区槽位（业务卡片不直接写 DSH 槽位字符串）。 */
export function mountInputDock(
  ctx: ClientHostContext,
  options: SlotMountOptions,
  component: unknown,
): boolean {
  return mountSlot(ctx, 'input.dock', options, component)
}
