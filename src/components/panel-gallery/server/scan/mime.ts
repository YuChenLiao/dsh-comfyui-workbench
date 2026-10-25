import path from 'node:path'

import { MIME_BY_EXT } from './constants.js'

/**
 * 扩展名 → MIME。未知扩展名给 octet-stream，由浏览器决定怎么处理。
 *
 * @param filePath - 文件路径。
 */
export function mimeOf(filePath: string): string {
  return MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream'
}
