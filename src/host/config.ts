/** 列表缓存默认时长：点一次刷新能看到新图，又不至于每滚一屏就重扫。 */
export const DEFAULT_CACHE_MS = 4000

/** ComfyUI 默认地址（与 dsh-comfyui-image 一致）。 */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'

/** 归一化后的宿主配置。 */
export interface Settings {
  // ── 资产库 ──
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

  // ── ComfyUI ──
  /** 服务地址（设置里的输入框写这里）。 */
  baseUrl: string
  /** 透传请求头：反代鉴权用。不内置任何默认值。 */
  headers: Record<string, string>
  /** 产物落盘目录；null 表示用 workspace 根。 */
  outputDir: string | null
  /** 工作流模板目录；null 表示用默认（~/.dsh-comfyui-workbench/workflows）。 */
  workflowsDir: string | null
  /** 上传的参考图目录；null 表示用默认（~/.dsh-comfyui-workbench/uploads）。 */
  uploadsDir: string | null
  /** 资产索引文件；null 表示用默认（~/.dsh-comfyui-workbench/assets.jsonl）。 */
  indexFile: string | null
  /**
   * 关掉的组件 id。可用的有：
   * `panel.workflow` / `panel.gallery` / `tool.generate` / `tool.workflow-edit`。
   * 空数组表示全开；某个组件出问题时可以单独关掉，不影响其他。
   */
  disabledComponents: string[]
  /** 除 outputDir 外纳入索引的目录。 */
  assetRoots: string[]
  /** 未绑定变量是否报错（默认报错）。 */
  strictVars: boolean
  /** 点生成时走哪条路：conversation（发进对话）| direct（UI 直连）。 */
  runMode: 'conversation' | 'direct'
  /** 已弃用：工具响应只给路径；该字段仅为兼容旧配置而解析。 */
  returnImages: 'first' | 'all' | 'none'
  /** 自动探测 ComfyUI 安装位置。 */
  autoDetect: boolean
  /** 未运行时按需拉起。 */
  autoStart: boolean
  /** 特殊情况下的完整启动命令（覆盖自动拼装）。 */
  startCommand: string[]
  /** 冷启就绪上限。 */
  readyTimeoutMs: number
  /** 空闲回收毫秒数；0 表示不回收。 */
  idleShutdownMs: number
  /** 单次运行等待上限。 */
  timeoutMs: number
  /** 轮询 /history 的间隔。 */
  pollIntervalMs: number
  /** 索引模式：auto（有 sqlite 就建）| off（只扫描）。 */
  indexMode: 'auto' | 'off'
  /** better-sidebar 页签：auto | on | off。 */
  betterSidebarTab: 'auto' | 'on' | 'off'
}

/** 环境变量 → 配置键（与既有插件同名，保证三个插件指向同一台服务）。 */
const ENV_KEYS: Array<[string, keyof Settings]> = [
  ['COMFYUI_URL', 'baseUrl'],
  ['COMFYUI_BASE_URL', 'baseUrl'],
  ['COMFYUI_TIMEOUT_MS', 'timeoutMs'],
]

/** 从环境变量读一层。 */
function fromEnv(env: NodeJS.ProcessEnv): Partial<Settings> {
  const out: Record<string, unknown> = {}
  for (const [envKey, configKey] of ENV_KEYS) {
    const value = env[envKey]
    if (typeof value === 'string' && value.trim() !== '') out[configKey] = value
  }
  return out as Partial<Settings>
}

/**
 * 归一化 loader 传进来的 config。
 *
 * 所有字段都可省略；越界值夹到区间内而不是抛错 —— 插件装错了配置不该让 DSH 起不来。
 * 优先级：profile 配置 > 环境变量 > 内置默认。
 *
 * @param input - loader 传入的原始 config。
 * @param env - 环境变量（测试时可注入）。
 */
export function resolveSettings(input: unknown, env: NodeJS.ProcessEnv = process.env): Settings {
  const envSettings = fromEnv(env)
  const raw = input !== null && typeof input === 'object' ? (input as Record<string, unknown>) : {}

  const pick = (key: keyof Settings): unknown => (raw[key] !== undefined ? raw[key] : envSettings[key])

  const int = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? Math.round(value) : Number.parseInt(String(value ?? ''), 10)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }
  const str = (value: unknown, fallback: string): string =>
    (typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback)
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
    (typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback)
  const listOf = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
  const recordOf = (value: unknown): Record<string, string> => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return {}
    const out: Record<string, string> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (typeof item === 'string') out[key] = item
    }
    return out
  }

  const outputDir = raw.outputDir
  return {
    roots: listOf(raw.roots),
    maxDepth: int(raw.maxDepth, 3, 0, 8),
    maxItems: int(raw.maxItems, 4000, 50, 20000),
    cacheMs: int(raw.cacheMs, DEFAULT_CACHE_MS, 0, 60000),
    includeHidden: raw.includeHidden === true,

    baseUrl: str(pick('baseUrl'), DEFAULT_BASE_URL).replace(/\/+$/, ''),
    headers: recordOf(raw.headers),
    outputDir: typeof outputDir === 'string' && outputDir.trim() !== '' ? outputDir.trim() : null,
    workflowsDir: typeof raw.workflowsDir === 'string' && raw.workflowsDir.trim() !== '' ? raw.workflowsDir.trim() : null,
    uploadsDir: typeof raw.uploadsDir === 'string' && raw.uploadsDir.trim() !== '' ? raw.uploadsDir.trim() : null,
    indexFile: typeof raw.indexFile === 'string' && raw.indexFile.trim() !== '' ? raw.indexFile.trim() : null,
    disabledComponents: Array.isArray(raw.disabledComponents)
      ? raw.disabledComponents.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
      : [],
    assetRoots: listOf(raw.assetRoots),
    strictVars: raw.strictVars !== false,
    runMode: oneOf(raw.runMode, ['conversation', 'direct'] as const, 'conversation'),
    returnImages: oneOf(raw.returnImages, ['first', 'all', 'none'] as const, 'first'),
    autoDetect: raw.autoDetect !== false,
    autoStart: raw.autoStart !== false,
    startCommand: listOf(raw.startCommand),
    readyTimeoutMs: int(raw.readyTimeoutMs, 180_000, 5_000, 900_000),
    idleShutdownMs: int(raw.idleShutdownMs, 300_000, 0, 3_600_000),
    timeoutMs: int(pick('timeoutMs'), 120_000, 1_000, 3_600_000),
    pollIntervalMs: int(raw.pollIntervalMs, 1_000, 100, 10_000),
    indexMode: oneOf(raw.indexMode, ['auto', 'off'] as const, 'auto'),
    betterSidebarTab: oneOf(raw.betterSidebarTab, ['auto', 'on', 'off'] as const, 'auto'),
  }
}
