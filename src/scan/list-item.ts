import { readMeta } from './sidecar.js'
import { metaSummary } from './summary.js'
import type { ImageRecord, ListItem } from './types.js'

/**
 * 文件信息 + 元数据摘要 → 一条列表项。
 *
 * @param file - 扫描结果。
 * @param rootLabel - 所属根目录显示名。
 */
export function toListItem(file: ImageRecord, rootLabel: string): ListItem {
  return {
    path: file.path,
    name: file.name,
    dir: file.dir,
    root: rootLabel,
    size: file.size,
    mtime: file.mtime,
    ...metaSummary(readMeta(file.path)),
  }
}
