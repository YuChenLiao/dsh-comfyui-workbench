import fs from 'node:fs'
import path from 'node:path'

import { foldPathCase } from '../../../../shared/host/paths.js'
import { MEDIA_EXTS, SKIP_DIRS } from './constants.js'
import { hasEmbeddedPromptHint } from './embedded.js'
import type { ImageRecord, ScanOptions, ScanResult } from './types.js'

/**
 * 递归收集一个根目录下的图片。
 *
 * 深度与数量都有上限：资产库是浏览入口，不能变成一次全盘 IO。
 * 带 sidecar 的（生成物）与普通图片分开计数，保证上限先吃掉普通图片 ——
 * 一个塞满截图的目录不该把真正的生成图挤出列表。
 *
 * 性能上有一条硬规则：**任何能靠内存判断的，就不要碰磁盘**。
 * 曾经在一个塞满语音素材的目录上把整次扫描拖到 27 秒，原因就是
 * 每个媒体文件都先 `statSync` 再 `existsSync`，而其中绝大多数最后都被上限丢掉。
 *
 * @param root - 根目录绝对路径。
 * @param options - 扫描上限。
 */
export function collectImages(root: string, options: ScanOptions): ScanResult {
  const generated: ImageRecord[] = []
  const bare: ImageRecord[] = []
  let truncatedGenerated = false
  let truncatedBare = false

  const generatedFull = (): boolean => generated.length >= options.maxItems
  const bareFull = (): boolean => bare.length >= options.maxItems
  const skipDirs = new Set((options.excludeDirs ?? []).map(item => foldPathCase(item)))

  const walk = (dir: string, depth: number): void => {
    // 两类都满了就没有任何还能收进来的东西，整棵子树直接跳过。
    if (generatedFull() && bareFull()) {
      truncatedGenerated = true
      truncatedBare = true
      return
    }

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }

    // 同目录的文件名集合：sidecar 判定从 existsSync 降成 O(1) 内存查询。
    // 一次 readdirSync 已经把这些名字全拿到了，再问文件系统一遍纯属浪费。
    // 键按平台折叠大小写：旧的 existsSync 在 Windows 上本就不区分，
    // 不折叠会让改名过大小写的 sidecar 突然认不出来。
    const names = new Set<string>()
    for (const entry of entries) {
      if (entry.isFile()) names.add(foldPathCase(entry.name))
    }

    for (const entry of entries) {
      const name = entry.name
      if (!options.includeHidden && name.startsWith('.')) continue
      const full = path.join(dir, name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue
        if (skipDirs.has(foldPathCase(name))) continue
        if (depth + 1 > options.maxDepth) continue
        walk(full, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      // 视频/音频也算资产：工作流会顺带产出它们，排掉就是"生成了却看不见"
      const ext = path.extname(name).toLowerCase()
      if (!MEDIA_EXTS.has(ext)) continue

      // 先判"收不收得下"，再决定要不要碰磁盘（statSync / 读 PNG 头）—— 顺序反过来就是那 27 秒。
      const hasSidecar = names.has(foldPathCase(`${name}.json`))
      let generatedFlag: boolean
      if (hasSidecar) {
        if (generatedFull()) {
          truncatedGenerated = true
          if (bareFull()) {
            truncatedBare = true
            break
          }
          continue
        }
        generatedFlag = true
      } else if (bareFull()) {
        // 没有 sidecar 且 bare 已满：
        // - 若 generated 也满了，连 PNG 文件头都不必读，整层直接结束；
        // - 若不是 PNG，必定进 bare，直接跳过；
        // - 若是 PNG 且 generated 未满，先探测 256 字节头再决定是否 statSync，避免给普通 PNG 白做 stat。
        if (generatedFull()) {
          truncatedGenerated = true
          truncatedBare = true
          break
        }
        if (ext !== '.png' || !hasEmbeddedPromptHint(full)) {
          truncatedBare = true
          continue
        }
        generatedFlag = true
      } else {
        // bare 未满：只有 PNG 才可能靠内嵌 prompt 翻成生成图；
        // 若确实是生成图但 generated 已满，直接跳过，不白做 statSync。
        generatedFlag = ext === '.png' && hasEmbeddedPromptHint(full)
        if (generatedFlag && generatedFull()) {
          truncatedGenerated = true
          continue
        }
      }

      let stat: fs.Stats
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }

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
