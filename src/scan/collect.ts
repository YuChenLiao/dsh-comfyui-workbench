import fs from 'node:fs'
import path from 'node:path'

import { IMAGE_EXTS, SKIP_DIRS } from './constants.js'
import { hasEmbeddedPromptHint } from './embedded.js'
import type { ImageRecord, ScanOptions, ScanResult } from './types.js'

/**
 * 递归收集一个根目录下的图片。
 *
 * 深度与数量都有上限：资产库是浏览入口，不能变成一次全盘 IO。
 * 带 sidecar 的（生成物）与普通图片分开计数，保证上限先吃掉普通图片 ——
 * 一个塞满截图的目录不该把真正的生成图挤出列表。
 *
 * @param root - 根目录绝对路径。
 * @param options - 扫描上限。
 */
export function collectImages(root: string, options: ScanOptions): ScanResult {
  const generated: ImageRecord[] = []
  const bare: ImageRecord[] = []
  let truncatedGenerated = false
  let truncatedBare = false

  const walk = (dir: string, depth: number): void => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const name = entry.name
      if (!options.includeHidden && name.startsWith('.')) continue
      const full = path.join(dir, name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        if (depth + 1 > options.maxDepth) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      if (!IMAGE_EXTS.has(path.extname(name).toLowerCase())) continue

      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

      const generatedFlag = fs.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full)
      const record: ImageRecord = {
        path: full,
        name,
        dir,
        size: stat.size,
        mtime: stat.mtimeMs,
        generated: generatedFlag,
      }

      if (generatedFlag) {
        if (generated.length < options.maxItems) generated.push(record)
        else truncatedGenerated = true
      } else if (bare.length < options.maxItems) {
        bare.push(record)
      } else {
        truncatedBare = true
      }
    }
  }

  walk(root, 0)
  const files = generated.concat(bare)
  files.sort((a, b) => b.mtime - a.mtime)
  return { files, truncated: truncatedGenerated || truncatedBare, truncatedGenerated, truncatedBare }
}
