import { composerStatusPropsFrom, inputDockPropsFrom, toolViewPropsFrom } from './props.js'
import type { ComposerStatusProps, InputDockProps, ToolViewProps } from './props.js'
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

/** 宿主 props → 组件 props 的归一化函数。 */
export type SlotPropsAdapter = (hostProps: Record<string, unknown>) => unknown

/**
 * 往一个槽位注册组件。
 *
 * `adapter` 是适配层的另一半：给了它，组件收到的是**归一化后**的 props，
 * 而不是宿主原始形状；没给就原样透传（用于不需要映射的位置）。
 *
 * @param ctx - 客户端上下文。
 * @param slotName - 槽位名。
 * @param options - 注册参数（key / id / order / label）。
 * @param component - 组件。
 * @param adapter - 可选的 props 归一化。
 */
function mountSlot(
  ctx: ClientHostContext,
  slotName: string,
  options: SlotMountOptions,
  component: unknown,
  adapter?: SlotPropsAdapter,
): boolean {
  const slots = resolveSlots(ctx)
  if (slots === undefined) return false

  const rendered = adapter === undefined
    ? component
    : (hostProps: Record<string, unknown>) => (component as (props: unknown) => unknown)(adapter(hostProps))

  slots.inject(slotName, () => slots.register({ ...options, name: slotName }, rendered))
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

/**
 * 注册一次工具调用的原生卡片（`tool.call.toolview`）。
 *
 * 槽位是 **keyed by wire name**：`key` 必须与工具名逐字一致，写错就永远不渲染。
 * 注意不要碰它的子槽位 `tool.call.images` —— 那是 `single`，且已被内置
 * `read_image` 的 toolview 占用，第二个占位者会在加载时直接抛错。
 *
 * @param ctx - 客户端上下文。
 * @param toolName - 工具线名（`comfyui_run` 等）。
 * @param component - 卡片组件。
 */
export function mountToolView(
  ctx: ClientHostContext,
  toolName: string,
  component: (props: ToolViewProps) => unknown,
  adapter: SlotPropsAdapter = toolViewPropsFrom,
): boolean {
  return mountSlot(ctx, 'tool.call.toolview', { key: toolName }, component, adapter)
}

/**
 * 注册输入框工具行左侧的紧凑控件（`conversation.input.left`）。
 *
 * 计划里写的 `conversation.composer.tools` 在当前 Slot 契约里**不存在**；
 * 实测对应位置是这一条（list，`id`/`order`/`label`）。
 *
 * @param ctx - 客户端上下文。
 * @param id - 本条目的稳定 id。
 * @param component - 控件组件。
 * @param order - 排序，越小越靠左。
 */
export function mountComposerStatus(
  ctx: ClientHostContext,
  id: string,
  component: (props: ComposerStatusProps) => unknown,
  order = 40,
  adapter: SlotPropsAdapter = composerStatusPropsFrom,
): boolean {
  return mountSlot(ctx, 'conversation.input.left', { id, order }, component, adapter)
}

/**
 * 注册输入框上方的整宽停靠区（`conversation.input.dock`）。
 *
 * 计划里写的 `input.dock` 实际全名是 `conversation.input.dock`；
 * 另有 `conversation.composer.dock` 位于输入框**下方**，这里不用。
 *
 * @param ctx - 客户端上下文。
 * @param id - 本条目的稳定 id。
 * @param component - 组件。
 * @param order - 排序。
 */
export function mountInputDock(
  ctx: ClientHostContext,
  id: string,
  component: (props: InputDockProps) => unknown,
  order = 40,
  adapter: SlotPropsAdapter = inputDockPropsFrom,
): boolean {
  return mountSlot(ctx, 'conversation.input.dock', { id, order }, component, adapter)
}
