import type { GalleryItem } from './types.js'

/** 卡片下方那行小字：尺寸 · seed · 底模，都没有就退回文件名。 */
export function metaLine(item: GalleryItem): string {
  const parts: string[] = []
  if (item.width !== undefined && item.height !== undefined && item.width > 0 && item.height > 0) {
    parts.push(`${item.width}×${item.height}`)
  }
  if (typeof item.seed === 'number') parts.push(`seed ${item.seed}`)
  if (typeof item.checkpoint === 'string' && item.checkpoint !== '') parts.push(item.checkpoint)
  if (parts.length === 0) parts.push(item.name)
  return parts.join(' · ')
}

/**
 * 计算「追加一页」之后列表长什么样、还要不要继续拉。
 *
 * 抽成纯函数是为了把两个停手条件钉死：
 *   - 本批没有新条目（offset 分页在列表变动后会重复拉到同一段）→ 停；
 *   - 已经够到 total → 停。
 * 只要有一条没守住，哨兵可见时就会无限重发请求，底部视图就会抖。
 *
 * @param baseItems - 当前已加载的条目。
 * @param batch - 这一批返回的条目。
 * @param offset - 本次请求的偏移量。
 * @param total - 服务端报告的总数。
 */
export function planPage<T extends { path: string }>(
  baseItems: readonly T[],
  batch: readonly T[],
  offset: number,
  total: number,
): { items: T[]; more: boolean } {
  const seen = new Set(baseItems.map(entry => entry.path))
  const appended: T[] = []
  for (const entry of batch) {
    if (seen.has(entry.path)) continue
    seen.add(entry.path)
    appended.push(entry)
  }
  return {
    items: [...baseItems, ...appended],
    more: appended.length > 0 && offset + batch.length < total,
  }
}
