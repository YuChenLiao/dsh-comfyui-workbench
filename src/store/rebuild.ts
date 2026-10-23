import fs from 'node:fs'
import path from 'node:path'

import { collectImages, readMeta } from '../scan/index.js'
import type { AssetRecord } from './index-file.js'

/**
 * 从 sidecar 重建索引。
 *
 * sidecar 是真源、索引是派生 —— 索引删了、坏了，都能从产物旁边的
 * `<文件>.json` 重新长出来。这也是"索引可删可重建"这条验收的实现依据。
 *
 * @param roots - 要重扫的根目录。
 * @param options - 扫描上限。
 */
export function rebuildFromSidecars(
  roots: readonly string[],
  options: { maxDepth: number; maxItems: number; includeHidden: boolean },
): AssetRecord[] {
  const out: AssetRecord[] = []
  const seen = new Set<string>()

  for (const root of roots) {
    const scanned = collectImages(root, options)
    for (const file of scanned.files) {
      if (seen.has(file.path)) continue
      seen.add(file.path)

      const meta = readMeta(file.path)
      if (meta === undefined) continue

      const workflowId = typeof meta.workflowId === 'string' ? meta.workflowId : ''
      const workflowHash = typeof meta.workflowHash === 'string' ? meta.workflowHash : ''
      const promptId = meta.comfy !== null && typeof meta.comfy === 'object'
        ? String((meta.comfy as { promptId?: unknown }).promptId ?? '')
        : ''
      const createdAt = typeof meta.createdAt === 'string' ? meta.createdAt : new Date(file.mtime).toISOString()
      const tags = Array.isArray(meta.tags) ? meta.tags.filter((tag): tag is string => typeof tag === 'string') : []

      let bytes = file.size
      try {
        bytes = fs.statSync(file.path).size
      } catch {
        // 文件刚好被删：用扫描时的尺寸
      }

      out.push({
        digest: typeof meta.digest === 'string' ? meta.digest : '',
        path: file.path,
        bytes,
        mime: mimeOfExt(path.extname(file.path)),
        ...(typeof meta.width === 'number' ? { width: meta.width } : {}),
        ...(typeof meta.height === 'number' ? { height: meta.height } : {}),
        workflowId,
        workflowHash,
        promptId,
        createdAt,
        tags,
        status: 'present',
      })
    }
  }
  return out
}

/** 扩展名 → MIME（重建时不必回到宿主层）。 */
function mimeOfExt(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    case '.gif': return 'image/gif'
    case '.avif': return 'image/avif'
    case '.bmp': return 'image/bmp'
    case '.mp4': return 'video/mp4'
    case '.webm': return 'video/webm'
    case '.mp3': return 'audio/mpeg'
    case '.wav': return 'audio/wav'
    default: return 'application/octet-stream'
  }
}
