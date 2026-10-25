import path from 'node:path'

import { foldPathCase } from '../host/paths.js'

import { canonical } from './legacy-paths.js'
import type { RootEntry } from './roots.js'

/**
 * 请求路径是否落在某个授权根目录内。
 *
 * 这是插件的安全边界：浏览、删除、归档、写输出都要过它。早期的相册只校验
 * "源路径"，本插件新增了 archive / rerun 这类**目标路径**写入，所以调用方必须
 * 对源和目标分别调用一次 —— 只校验源等于给路径穿越开后门。
 *
 * @param target - 待校验的绝对路径。
 * @param roots - 授权根目录。
 */
export function isAuthorized(target: string, roots: readonly RootEntry[]): boolean {
  if (typeof target !== 'string' || target.trim() === '') return false
  if (target.includes('\0')) return false
  const abs = foldPathCase(canonical(target))
  return roots.some(root => {
    const base = foldPathCase(root.path)
    return abs === base || abs.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
  })
}
