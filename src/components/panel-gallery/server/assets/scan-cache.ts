import { collectImages } from '../scan/index.js'
import type { ScanResult } from '../scan/index.js'

interface CacheEntry {
  at: number
  value: ScanResult
}

/** 扫描缓存：键为 `${root}|${maxDepth}|${maxItems}|${includeHidden}`。 */
const scanCache = new Map<string, CacheEntry>()

/** 缓存条目上限。超了按最旧淘汰，避免长时间运行后无限增长。 */
const MAX_ENTRIES = 64

/**
 * 带缓存的根目录扫描。
 *
 * @param root - 根目录。
 * @param settings - 配置（深度、上限、隐藏目录、缓存时长）。
 * @param force - 跳过缓存（用户点了刷新）。
 */
export function scanRoot(
  root: string,
  settings: { maxDepth: number; maxItems: number; includeHidden: boolean; cacheMs: number },
  force: boolean,
): ScanResult {
  const key = `${root}|${settings.maxDepth}|${settings.maxItems}|${settings.includeHidden}`
  const now = Date.now()

  if (!force && settings.cacheMs > 0) {
    const hit = scanCache.get(key)
    if (hit !== undefined && now - hit.at < settings.cacheMs) return hit.value
  }

  const value = collectImages(root, settings)
  scanCache.set(key, { at: now, value })
  if (scanCache.size > MAX_ENTRIES) {
    const oldest = [...scanCache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (oldest !== undefined) scanCache.delete(oldest[0])
  }
  return value
}

/** 清空扫描缓存（删除、归档、刷新之后调用）。 */
export function clearScanCache(): void {
  scanCache.clear()
}
