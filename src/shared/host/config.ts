/** 列表缓存默认时长：点一次刷新能看到新图，又不至于每滚一屏就重扫。 */
export const DEFAULT_CACHE_MS = 30_000

/** ComfyUI 默认地址（与 dsh-comfyui-image 一致）。 */
export const DEFAULT_BASE_URL = 'http://127.0.0.1:8188'

/** 姿势线稿的默认图床。上游是 Cloudflare 上的静态站，实测 thumbs/img 两条路径都在。 */
export const DEFAULT_POSES_ORIGIN = 'https://ai-pose-gallery.anhao.app'

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
  /** 扫描时额外跳过的目录名（与内置 SKIP_DIRS 合并）。 */
  excludeDirs: string[]
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
   * 关掉的组件 id。可用的有（与 `runtime.ts` 的 `componentStateOf` 一一对应）：
   * `panel.gallery` / `panel.workflow` / `panel.tags` / `panel.poses` / `panel.costumes`
   * / `panel.terminal` / `tool.generate` / `tool.workflow-edit` / `tool.danbooru`
   * / `tool.sync-wait`（关掉后出图工具不再接受 `wait`，一律异步）。
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
  /** 单次 HTTP 请求超时（同步等待上限见 `runWaitMaxMs`，两者不是一回事）。 */
  timeoutMs: number
  /** 轮询 /history 的间隔。 */
  pollIntervalMs: number
  /** 索引模式：auto（有 sqlite 就建）| off（只扫描）。 */
  indexMode: 'auto' | 'off'
  /** better-sidebar 页签：auto | on | off。 */
  betterSidebarTab: 'auto' | 'on' | 'off'
  /**
   * 是否用 ComfyUI 的 `/ws` 读精确进度（默认关，`COMFYUI_PROGRESS_WS=1` 可开）。
   *
   * 开了之后 `sweepRun` 会复用提交时的 `client_id` 订阅 `progress` 事件，把
   * `{value, max}` 写进运行记录。连不上只是没有百分比，出图不受影响。
   */
  progressStream: boolean

  /** 出图工具默认等不等：`async` 提交完就还控制权（默认），`sync` 等到产物落盘。 */
  runWait: 'async' | 'sync'
  /**
   * 同步等待的上限（毫秒），默认 30 分钟。
   *
   * 不能借 `timeoutMs`：那个是单次 HTTP 请求超时（默认 2 分钟），而出图普遍比它久。
   * 当初共用一个数，「同步」就变成「最多等 2 分钟然后返回 pending」，与用户开这个开关的
   * 意图相反。`parseWait` 会把它夹到 `[1s, 30min]`，所以超过 30 分钟的值没有意义。
   */
  runWaitMaxMs: number

  // ── 姿势库 ──
  /**
   * 姿势线稿的图床根地址。**必须 https**，非 https 一律回退默认。
   *
   * 收到配置里而不是硬编码：上游换域名时不必发版；但也不能让一条配置把
   * 「服务端代理」变成任意地址的出口，所以只接受 https。
   */
  posesOrigin: string
}

/** 环境变量 → 配置键（与既有插件同名，保证三个插件指向同一台服务）。 */
const ENV_KEYS: Array<[string, keyof Settings]> = [
  ['COMFYUI_URL', 'baseUrl'],
  ['COMFYUI_BASE_URL', 'baseUrl'],
  ['COMFYUI_TIMEOUT_MS', 'timeoutMs'],
  ['COMFYUI_RUN_WAIT', 'runWait'],
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
  /** `COMFYUI_PROGRESS_WS=1|true|yes|on` 打开 WebSocket 进度。 */
  const envProgress = ['1', 'true', 'yes', 'on'].includes(String(env.COMFYUI_PROGRESS_WS ?? '').trim().toLowerCase())

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
    excludeDirs: listOf(raw.excludeDirs),
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
    // 默认**不回收**：`/queue` 只能看到 prompt 队列，看不到模型下载/安装。用户拉一个大模型
    // 超过 5 分钟、期间没有工具调用，实例就会被判成"空闲"杀掉 —— 那正是"下到一半被打断、
    // 卡在下载状态"的经典事故。想省显存自己设成 300000；开着时回收前会先问 `/queue`。
    idleShutdownMs: int(raw.idleShutdownMs, 0, 0, 3_600_000),
    timeoutMs: int(pick('timeoutMs'), 120_000, 1_000, 3_600_000),
    // 默认异步：出图要几分钟，让工具调用一直挂着会让用户以为连接断了。
    // 想每次都同步拿产物（顺带登记资产索引）就设成 sync。
    runWait: oneOf(pick('runWait'), ['async', 'sync'] as const, 'async'),
    runWaitMaxMs: int(raw.runWaitMaxMs, 1_800_000, 1_000, 1_800_000),
    pollIntervalMs: int(raw.pollIntervalMs, 1_000, 100, 10_000),
    indexMode: oneOf(raw.indexMode, ['auto', 'off'] as const, 'auto'),
    betterSidebarTab: oneOf(raw.betterSidebarTab, ['auto', 'on', 'off'] as const, 'auto'),
    progressStream: raw.progressStream === true || envProgress === true,
    posesOrigin: (() => {
      const value = str(raw.posesOrigin, DEFAULT_POSES_ORIGIN).replace(/\/+$/, '')
      // 代理只该指向一个 https 图床；配错了回退默认，而不是让配置把出口放开
      return /^https:\/\//.test(value) ? value : DEFAULT_POSES_ORIGIN
    })(),
  }
}
