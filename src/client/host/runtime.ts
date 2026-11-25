import { activeLocaleOf } from '../i18n.js'
import { PANEL_ID } from './slots.js'
import type { ClientHostContext, LayoutServiceLike } from './types.js'

/** 跳到会话面板（相册里的"加入当前对话"依赖它；面板服务缺席时由粘贴路径自行兜底）。 */
export function navigateToConversation(ctx: ClientHostContext): void {
  try {
    const layout = ctx.get?.('layout') as LayoutServiceLike | null | undefined
    if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
      layout.selectPanel('conversation')
    }
  } catch {
    // 面板服务缺席时由粘贴路径自行兜底
  }
}

/** 切到工作台主面板；面板服务缺席或调用失败时返回 false。 */
export function navigateToWorkbench(ctx: ClientHostContext): boolean {
  try {
    const layout = ctx.get?.('layout') as LayoutServiceLike | null | undefined
    if (layout !== null && layout !== undefined && typeof layout.selectPanel === 'function') {
      layout.selectPanel(PANEL_ID)
      return true
    }
  } catch {
    // 面板服务缺席时静默降级
  }
  return false
}

/** 从宿主上下文读取当前语言（拿不到时回退为中文）。 */
export function hostLocale(ctx: ClientHostContext): string {
  return activeLocaleOf(ctx.get?.('locale'))
}
