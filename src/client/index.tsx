/**
 * 客户端入口：把**工作流管理**面板接到宿主的三个位置上。
 *
 *   1. sidebar.panellist 图标 → 主面板（DSH 原生左侧栏）
 *   2. main key = 'comfyui-workbench'（与上面 id 对齐，点了就切过去）
 *   3. betterSidebar.registerTab（装了 dsh-better-sidebar 才有，未装则安静缺席）
 *
 * 面板只做工作流管理（列表 / 是否可用 / 用途备注）—— 生图能力是给模型的，
 * 用户想自己出图直接开 ComfyUI 即可，这里不再复制一套前端。
 *
 * 打包后整体被 `window.__ModuleLoader__.load` 包住（见 scripts/build.mjs 的 banner），
 * React 由宿主通过 factory 的 require 注入。
 */
import { WorkflowAdmin } from '../components/panel-workflow/client/WorkflowAdmin.js'
import { Card } from '../components/panel-gallery/client/Card.js'
import { ConfirmBulkRemove, ConfirmRemove } from '../components/panel-gallery/client/Confirm.js'
import { Gallery } from '../components/panel-gallery/client/Gallery.js'
import { Lightbox } from '../components/panel-gallery/client/Lightbox.js'
import { CSS } from '../components/panel-gallery/client/styles.js'
import { Workbench } from './components/Workbench.js'
import { addToConversation, findComposerEditor, pasteFile } from './conversation.js'
import { metaLine, planPage } from './format.js'
import { Icon } from './icons.js'
import { DICT } from './i18n-data.js'
import { activeLocaleOf, makeTranslate } from './i18n.js'
import { WORKBENCH_CSS } from './styles-workbench.js'

export const name = 'dsh-comfyui-workbench'

/** 只需要槽位注册；betterSidebar 走可选注入，所以不写进必需依赖。 */
export const inject = ['slots']

/** 主面板 id（`sidebar.panellist` 与 `main` 的 key 必须一致，否则点图标切不过去）。 */
const PANEL_ID = 'comfyui-workbench'

/** better-sidebar 页签 id。加上插件前缀，避免与内置类型撞名。 */
const TAB_ID = 'comfyui-workbench:workflows'

/** 客户端上下文的最小面。 */
interface ClientContext {
  get: (name: string) => any
  inject: (names: string[], run: (scope: any) => void) => void
}

interface SlotRegistry {
  inject: (name: string, register: () => () => void) => void
  register: (options: Record<string, unknown>, component: unknown) => () => void
}

/**
 * 客户端插件主体。
 *
 * @param ctx - Web Client 根上下文。
 */
export function apply(ctx: ClientContext): void {
  const t = makeTranslate(activeLocaleOf(ctx.get('locale')))

  /** 跳到会话面板（相册里的"加入当前对话"依赖它）。 */
  const goToConversation = (): void => {
    try {
      const layout = ctx.get('layout')
      if (layout !== null && typeof layout?.selectPanel === 'function') layout.selectPanel('conversation')
    } catch {
      // 面板服务缺席时由粘贴路径自行兜底
    }
  }

  // better-sidebar 是可选依赖：未安装时 inject 永远不 resolve，这里也就不会注册任何东西。
  let sidebar: { openTab: (seed: { type: string }) => void } | null = null

  const openSidebar = (): boolean => {
    if (sidebar === null) return false
    try {
      sidebar.openTab({ type: TAB_ID })
      return true
    } catch {
      return false
    }
  }

  const Tab = (tabProps?: { visible?: boolean }): React.ReactElement => (
    <Workbench
      t={t}
      visible={tabProps === undefined || tabProps.visible !== false}
      embedded
      goToConversation={goToConversation}
      openSidebar={openSidebar}
    />
  )

  ctx.inject(['betterSidebar'], (scope: any) => {
    scope.effect(() => {
      const service = scope.betterSidebar
      const dispose: () => void = service.registerTab({
        id: TAB_ID,
        title: () => t('title'),
        description: () => t('sidebarDescription'),
        icon: (size?: number) => <Icon name="workflow" size={size ?? 16} />,
        order: 40,
        single: true,
        component: Tab,
      })
      sidebar = service
      return () => {
        sidebar = null
        dispose()
      }
    }, 'comfyui-workbench: better-sidebar tab')
  })

  const slots = ctx.get('slots') as SlotRegistry | undefined
  if (slots === undefined) {
    console.warn('[comfyui-workbench] 拿不到 slots 服务，工作流管理界面未注册。')
    return
  }

  slots.inject('sidebar.panellist', () => slots.register({
    name: 'sidebar.panellist',
    id: PANEL_ID,
    order: 40,
    label: () => t('title'),
  }, (props: { size?: number }) => (
    <span style={{ display: 'grid', placeItems: 'center' }}>
      <Icon name="workflow" size={props?.size ?? 18} />
    </span>
  )))

  slots.inject('main', () => slots.register({
    name: 'main',
    key: PANEL_ID,
  }, () => (
    <Workbench t={t} visible goToConversation={goToConversation} openSidebar={openSidebar} />
  )))

  console.info('[comfyui-workbench] 工作流管理界面已注册（侧边栏入口 + 主面板）')
}

/** 自检导出：`tests/render.mjs` 靠它把组件挂起来渲染。 */
export const __test = {
  Gallery,
  Card,
  Lightbox,
  ConfirmRemove,
  ConfirmBulkRemove,
  Workbench,
  WorkflowAdmin,
  metaLine,
  planPage,
  addToConversation,
  pasteFile,
  findComposerEditor,
  DICT,
  CSS,
  WORKBENCH_CSS,
}
