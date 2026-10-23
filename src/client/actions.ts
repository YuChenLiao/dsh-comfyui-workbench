import { API, apiJson, download } from './api.js'
import { copyImageToClipboard, copyTextToClipboard } from './clipboard.js'
import { addToConversation } from './conversation.js'
import type { Translate } from './i18n.js'
import type { ActionKind, GalleryItem } from './types.js'

/** 资产卡片上的动作集合（宿主返回后由调用方决定怎么提示）。 */
export interface ActionHandlers {
  goToConversation: () => void
}

/**
 * 复制提示词：列表项里没有就回源读 /meta。
 *
 * @returns 给用户的成功文案。
 */
export async function copyPrompt(item: GalleryItem, t: Translate): Promise<string> {
  let prompt = item.prompt
  if (prompt === undefined || prompt === '') {
    try {
      const data = await apiJson('/meta', { path: item.path })
      const meta = data.meta !== null && typeof data.meta === 'object' ? (data.meta as { prompt?: unknown }) : null
      prompt = typeof meta?.prompt === 'string' ? meta.prompt : ''
    } catch {
      // 没元数据就走下面的报错
    }
  }
  if (prompt === undefined || prompt === '') throw new Error(t('noPrompt'))
  await copyTextToClipboard(prompt)
  return t('copiedPrompt')
}

/**
 * 导出单张图的工作流为 JSON 文件。
 *
 * @returns 给用户的成功文案。
 */
export async function exportWorkflow(item: GalleryItem, t: Translate): Promise<string> {
  const res = await fetch(`${API}/workflow?path=${encodeURIComponent(item.path)}`)
  if (!res.ok) {
    let message = `导出失败：HTTP ${res.status}`
    try {
      const data: unknown = await res.json()
      const bag = data !== null && typeof data === 'object' ? (data as { message?: unknown }) : null
      if (typeof bag?.message === 'string') message = bag.message
    } catch {
      // 非 JSON 错误体：用状态码
    }
    throw new Error(message)
  }
  const blob = await res.blob()
  const base = item.name.replace(/\.[^.]+$/, '')
  const filename = `${base}.workflow.json`
  download(blob, filename)
  return `${t('exported')} ${filename}`
}

/**
 * 执行一个卡片动作。
 *
 * 所有分支返回"给用户看的一句话"，由调用方统一进轻提示 —— 动作自己不碰 UI。
 *
 * @param kind - 动作类型。
 * @param item - 目标资产。
 * @param t - 翻译函数。
 * @param handlers - 宿主回调（跳回会话面板）。
 */
export async function runAction(
  kind: Exclude<ActionKind, 'remove'>,
  item: GalleryItem,
  t: Translate,
  handlers: ActionHandlers,
): Promise<string> {
  if (kind === 'copyImage') {
    await copyImageToClipboard(item.path)
    return t('copiedImage')
  }
  if (kind === 'copyPrompt') return await copyPrompt(item, t)
  if (kind === 'exportWorkflow') return await exportWorkflow(item, t)
  await addToConversation(item, handlers)
  return t('added')
}
