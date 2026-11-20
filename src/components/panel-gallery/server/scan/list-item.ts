import path from 'node:path'

import { readMeta } from './sidecar.js'
import { mediaKindOf } from './constants.js'
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
    // 卡片与灯箱据此决定渲染 img / video / audio
    kind: mediaKindOf(path.extname(file.name)) ?? 'image',
    ...metaSummary(readMeta(file.path)),
  }
}
