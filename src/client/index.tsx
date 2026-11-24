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
import { WorkflowAdmin, WorkflowRow } from '../components/panel-workflow/client/WorkflowAdmin.js'
import { groupWorkflows, groupsToExpandForAudit, isFiltering, matchesFilter, modelGroupOf, resolveExpanded, TAIL_LABEL } from '../components/panel-workflow/client/grouping.js'
import { TagsPanel } from '../components/panel-tags/client/TagsPanel.js'
import TAGS_CSS from '../components/panel-tags/client/styles.css'
import { PosesPanel } from '../components/panel-poses/client/PosesPanel.js'
import POSES_CSS from '../components/panel-poses/client/styles.css'
import { CostumesPanel } from '../components/panel-costumes/client/CostumesPanel.js'
import COSTUMES_CSS from '../components/panel-costumes/client/styles.css'
import { Card } from '../components/panel-gallery/client/Card.js'
import { ConfirmBulkRemove, ConfirmRemove } from '../components/panel-gallery/client/Confirm.js'
import { Gallery } from '../components/panel-gallery/client/Gallery.js'
import { Lightbox } from '../components/panel-gallery/client/Lightbox.js'
import CSS from '../components/panel-gallery/client/styles.css'
import { Workbench } from './components/Workbench.js'
import { terminalActions } from '../components/panel-terminal/client/buttons.js'
import { addImageToConversation, addToConversation, findComposerEditor, isVisibleElement, pasteFile, pickComposerEditor } from './conversation.js'
import { hostLocale, navigateToConversation } from './host/runtime.js'
import { mountComposerSlot, mountInputDock, mountToolView, mountWorkbenchEntries } from './host/slots.js'
import type { ClientHostContext } from './host/types.js'
import { shouldAutoFill, shouldLoadMore } from './scroll.js'
import { metaLine, planPage } from './format.js'
import { Icon } from './icons.js'
import { DICT } from './i18n-data.js'
import { makeTranslate } from './i18n.js'
import WORKBENCH_CSS from './styles.css'

export const name = 'dsh-comfyui-workbench'

/** 只需要槽位注册；betterSidebar 走可选注入，所以不写进必需依赖。 */
export const inject = ['slots']

/**
 * 客户端插件主体。
 *
 * @param ctx - Web Client 根上下文。
 */
export function apply(ctx: ClientHostContext): void {
  const t = makeTranslate(hostLocale(ctx))
  const goToConversation = (): void => navigateToConversation(ctx)

  let openSidebarFn = (): boolean => false
  const openSidebar = (): boolean => openSidebarFn()

  const Tab = (tabProps?: { visible?: boolean }): React.ReactElement => (
    <Workbench
      t={t}
      visible={tabProps === undefined || tabProps.visible !== false}
      embedded
      goToConversation={goToConversation}
      openSidebar={openSidebar}
    />
  )

  const mounted = mountWorkbenchEntries(ctx, {
    title: () => t('title'),
    description: () => t('sidebarDescription'),
    renderTabIcon: (size?: number) => <Icon name="album" size={size ?? 16} />,
    renderPanelIcon: (props?: { size?: number }) => (
      <span style={{ display: 'grid', placeItems: 'center' }}>
        <Icon name="album" size={props?.size ?? 18} />
      </span>
    ),
    renderTab: Tab,
    renderMain: () => (
      <Workbench t={t} visible goToConversation={goToConversation} openSidebar={openSidebar} />
    ),
  })
  openSidebarFn = mounted.openSidebar
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
  WorkflowRow,
  TagsPanel,
  TAGS_CSS,
  terminalActions,
  PosesPanel,
  POSES_CSS,
  CostumesPanel,
  COSTUMES_CSS,
  metaLine,
  planPage,
  shouldLoadMore,
  shouldAutoFill,
  addToConversation,
  addImageToConversation,
  pasteFile,
  findComposerEditor,
  pickComposerEditor,
  isVisibleElement,
  DICT,
  CSS,
  WORKBENCH_CSS,
  // 工作流面板的分组/筛选纯函数：React 之外的逻辑，单独用单测钉住
  groupWorkflows,
  groupsToExpandForAudit,
  isFiltering,
  matchesFilter,
  modelGroupOf,
  resolveExpanded,
  TAIL_LABEL,
  // 客户端 DSH 适配层：供 host-adapter.test.mjs 验证降级与槽位挂载
  mountWorkbenchEntries,
  mountToolView,
  mountComposerSlot,
  mountInputDock,
  navigateToConversation,
  hostLocale,
}
