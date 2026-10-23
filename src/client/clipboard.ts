import { fetchBlob } from './api.js'

/** 非 PNG 的图先转成 PNG：剪贴板只认少数几种格式，webp/avif 直接写会失败。 */
async function toPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob)
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('无法创建画布上下文。')
  context.drawImage(bitmap, 0, 0)
  const png = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(out => (out !== null ? resolve(out) : reject(new Error('图片转码失败'))), 'image/png')
  })
  if (typeof bitmap.close === 'function') bitmap.close()
  return png
}

/**
 * 把一张图写进剪贴板。
 *
 * @param path - 图片绝对路径（走宿主 /file）。
 */
export async function copyImageToClipboard(path: string): Promise<void> {
  if (typeof ClipboardItem === 'undefined' || navigator.clipboard === undefined || typeof navigator.clipboard.write !== 'function') {
    throw new Error('这个环境不支持写入图片剪贴板（需要安全上下文）。')
  }
  const blob = await fetchBlob(path)
  const png = blob.type === 'image/png' ? blob : await toPngBlob(blob)
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
}

/** 写文本到剪贴板。 */
export async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard === undefined || typeof navigator.clipboard.writeText !== 'function') {
    throw new Error('这个环境不支持写入剪贴板。')
  }
  await navigator.clipboard.writeText(text)
}
