import { fetchBlob } from './api.js'
import { copyImageToClipboard } from './clipboard.js'
import type { GalleryItem } from './types.js'

/**
 * 找会话输入框。
 *
 * 宿主给编辑器的滚动容器打了 `data-input-scroll`，比类名稳；再退到 lexical 标记，
 * 最后才用裸的 contenteditable。这是目前唯一可用的"把资产送进对话"的通道，
 * 相册已在生产环境验证。
 */
export function findComposerEditor(): HTMLElement | null {
  const scoped = document.querySelector<HTMLElement>('[data-input-scroll] [contenteditable="true"]')
  if (scoped !== null) return scoped
  const lexical = document.querySelector<HTMLElement>('[contenteditable="true"][data-lexical-editor]')
  if (lexical !== null) return lexical
  return document.querySelector<HTMLElement>('[contenteditable="true"]')
}

/** 等输入框出现（切回会话面板后可能要几帧）。 */
async function waitForEditor(timeoutMs: number): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const found = findComposerEditor()
    if (found !== null) return found
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }
  return null
}

/**
 * 与用户手动 Ctrl+V 完全同一条路径：宿主的 paste 处理会把 File 变成草稿附件。
 *
 * 不用 input 事件拼 DOM：那条路会绕过宿主的附件管线，粘进去的只是一张 <img>。
 */
export function pasteFile(editor: HTMLElement, file: File): void {
  const transfer = new DataTransfer()
  transfer.items.add(file)
  let event: Event | null = null
  try {
    event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer })
  } catch {
    event = null
  }
  if (event === null || (event as ClipboardEvent).clipboardData !== transfer) {
    event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: transfer })
  }
  editor.dispatchEvent(event)
}

/**
 * 把一张资产图加入当前对话的输入框草稿。
 *
 * 输入框找不到时先把图片复制到剪贴板，再报错 —— 用户至少还能手动粘一次。
 *
 * @param item - 资产项。
 * @param actions - 宿主提供的导航回调。
 */
export async function addToConversation(item: GalleryItem, actions: { goToConversation: () => void }): Promise<void> {
  const blob = await fetchBlob(item.path)
  const type = blob.type !== '' && blob.type.startsWith('image/') ? blob.type : 'image/png'
  const file = new File([blob], item.name !== '' ? item.name : 'image.png', { type })

  let editor = findComposerEditor()
  if (editor === null) {
    actions.goToConversation()
    editor = await waitForEditor(1400)
  }
  if (editor === null) {
    await copyImageToClipboard(item.path)
    throw new Error('没找到输入框，图片已复制到剪贴板。')
  }
  try {
    editor.focus()
  } catch {
    // 焦点拿不到不影响粘贴
  }
  pasteFile(editor, file)
}
