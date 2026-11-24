import { collectImages } from '../scan/index.js'
import type { ScanResult } from '../scan/index.js'

interface CacheEntry {
  at: number
  value: ScanResult
}

/** 扫描缓存：键为 `${root}|${maxDepth}|${maxItems}|${includeHidden}|${excludeDirs}`。 */
const scanCache = new Map<string, CacheEntry>()

/** 缓存条目上限。超了按最旧淘汰，避免长时间运行后无限增长。 */
const MAX_ENTRIES = 64

/** 扫描设置：与 `Settings` 里资产库那几项一致，避免这里再引一份配置类型。 */
export interface ScanSettings {
  maxDepth: number
  maxItems: number
  includeHidden: boolean
  cacheMs: number
  excludeDirs: readonly string[]
}

/**
 * 带缓存的根目录扫描。
 *
 * 时间戳必须取 **扫描结束后** 的时刻：一次大目录扫描本身可能要几十秒，
 * 若按开始时刻记，`cacheMs` 再大也是刚存进去就已过期，表现为"每次都重新扫"。
 *
 * @param root - 根目录。
 * @param settings - 配置（深度、上限、隐藏目录、排除目录、缓存时长）。
 * @param force - 跳过缓存（用户点了刷新）。
 */
export function scanRoot(root: string, settings: ScanSettings, force: boolean): ScanResult {
  // 不能用逗号拼：目录名本身可以带逗号，['a,b'] 与 ['a','b'] 会撞成同一个键。
  const excludeKey = JSON.stringify([...(settings.excludeDirs ?? [])].sort())
  const key = `${root}|${settings.maxDepth}|${settings.maxItems}|${settings.includeHidden}|${excludeKey}`

  if (!force && settings.cacheMs > 0) {
    const hit = scanCache.get(key)
    if (hit !== undefined && Date.now() - hit.at < settings.cacheMs) return hit.value
  }

  const value = collectImages(root, settings)
  scanCache.set(key, { at: Date.now(), value })
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
