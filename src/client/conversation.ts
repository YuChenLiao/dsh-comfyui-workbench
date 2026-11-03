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
 * 把一段文本粘进输入框。
 *
 * 与 `pasteFile` 同一条路：宿主的 paste 处理器接管后，文本成为草稿内容。
 * 不用 `editor.textContent = …`：那样绕开宿主的编辑器状态，草稿不会被识别。
 *
 * @param editor - 输入框元素。
 * @param text - 要插入的文本。
 */
export function pasteText(editor: HTMLElement, text: string): void {
  const transfer = new DataTransfer()
  transfer.setData('text/plain', text)
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

/** 参考图转提示词时发进对话的指令（固定格式，便于模型稳定跟随）。 */
const DESCRIBE_INSTRUCTION = [
  '请参考这张图，写一条可以直接用于生图的正向提示词。',
  '只输出一个 <prompt>…</prompt> 块，块内是提示词本身，不要解释、不要罗列参数。',
].join('')

/**
 * 参考图转提示词：先把图放进草稿，再把指令贴在后面。
 *
 * 图与指令走同一条粘贴通道（宿主的 paste 处理器），与用户手打完全同构。
 * 自动回填需要"订阅本会话新消息"，那个能力尚未验证 —— 所以这里只负责把
 * 半成品递到输入框，最后一击由用户按回车完成。
 *
 * @param item - 资产项。
 * @param actions - 宿主导航回调。
 */
export async function describeImage(item: GalleryItem, actions: { goToConversation: () => void }): Promise<void> {
  await addToConversation(item, actions)
  const editor = findComposerEditor()
  if (editor === null) throw new Error('没找到输入框，无法填入转写指令。')
  try {
    editor.focus()
  } catch {
    // 焦点拿不到不影响粘贴
  }
  pasteText(editor, `
${DESCRIBE_INSTRUCTION}`)
}

/** 把一段文本送进当前会话的输入框；找不到输入框时返回 false。 */
export async function sendTextToComposer(text: string, actions: { goToConversation: () => void }): Promise<boolean> {
  let editor = findComposerEditor()
  if (editor === null) {
    actions.goToConversation()
    editor = await waitForEditor(1400)
  }
  if (editor === null) return false
  try {
    editor.focus()
  } catch {
    // 焦点拿不到不影响粘贴
  }
  pasteText(editor, text)
  return true
}

/**
 * 把一张图塞进当前对话的输入框草稿。
 *
 * 抽出来的原因：资产库的图有本地路径（走 `/file` 取字节），姿势库的图只有服务端代理
 * 地址（第三方图床，浏览器不直连），但「找到输入框 → 粘贴」这段逻辑完全一样。
 * 复制两份必然漂移。
 *
 * 输入框找不到时，**有本地路径**就先复制到剪贴板再报错 —— 用户至少还能手动粘一次；
 * 只有 blob 的情况给一句明确的失败原因。
 *
 * @param blob - 图片字节。
 * @param filename - 粘贴时用的文件名。
 * @param actions - 宿主提供的导航回调。
 * @param fallbackPath - 可选：本地路径，找不到输入框时用它做剪贴板兜底。
 */
export async function addImageToConversation(
  blob: Blob,
  filename: string,
  actions: { goToConversation: () => void },
  fallbackPath?: string,
): Promise<void> {
  const type = blob.type !== '' && blob.type.startsWith('image/') ? blob.type : 'image/png'
  const file = new File([blob], filename !== '' ? filename : 'image.png', { type })

  let editor = findComposerEditor()
  if (editor === null) {
    actions.goToConversation()
    editor = await waitForEditor(1400)
  }
  if (editor === null) {
    if (fallbackPath !== undefined) {
      await copyImageToClipboard(fallbackPath)
      throw new Error('没找到输入框，图片已复制到剪贴板。')
    }
    throw new Error('没找到输入框，图片没能加入对话。')
  }
  try {
    editor.focus()
  } catch {
    // 焦点拿不到不影响粘贴
  }
  pasteFile(editor, file)
}

/**
 * 把一张资产图加入当前对话的输入框草稿。
 *
 * @param item - 资产项。
 * @param actions - 宿主提供的导航回调。
 */
export async function addToConversation(item: GalleryItem, actions: { goToConversation: () => void }): Promise<void> {
  const blob = await fetchBlob(item.path)
  await addImageToConversation(blob, item.name, actions, item.path)
}
