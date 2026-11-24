import { activeLocaleOf } from '../i18n.js'
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

/** 从宿主上下文读取当前语言（拿不到时回退为中文）。 */
export function hostLocale(ctx: ClientHostContext): string {
  return activeLocaleOf(ctx.get?.('locale'))
}
