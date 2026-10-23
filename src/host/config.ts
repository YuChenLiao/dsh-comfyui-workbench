/** 列表缓存默认时长：点一次刷新能看到新图，又不至于每滚一屏就重扫。 */
export const DEFAULT_CACHE_MS = 4000

/** 归一化后的宿主配置。 */
export interface Settings {
  /** 额外纳入资产库的目录（绝对路径）。 */
  roots: string[]
  /** 扫描深度，0 表示只看根目录本身。 */
  maxDepth: number
  /** 单个根目录的收集上限。 */
  maxItems: number
  /** 列表缓存毫秒数。 */
  cacheMs: number
  /** 是否进入 `.` 开头的目录。 */
  includeHidden: boolean
}

/**
 * 归一化 loader 传进来的 config。
 *
 * 所有字段都可省略；越界值夹到区间内而不是抛错 —— 插件装错了配置不该让 DSH 起不来。
 *
 * @param input - loader 传入的原始 config。
 */
export function resolveSettings(input: unknown): Settings {
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const int = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }

  return {
    maxDepth: int(raw.maxDepth, 3, 0, 8),
    maxItems: int(raw.maxItems, 4000, 50, 20000),
    cacheMs: int(raw.cacheMs, DEFAULT_CACHE_MS, 0, 60000),
    includeHidden: raw.includeHidden === true,
    roots: Array.isArray(raw.roots)
      ? raw.roots.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
      : [],
  }
}
