import fs from 'node:fs'
import path from 'node:path'

import { foldPathCase } from './paths.js'

/** 只要求能按名字取服务。 */
interface ServiceBag {
  get?: (name: string) => unknown
}

/** 产物目录候选：目录 + 它是怎么来的。 */
export interface WorkspaceGuess {
  dir: string
  source: 'env' | 'workingDirectory' | 'service' | 'cwd'
}

/** 一次探测的取证记录：只用于诊断，不参与决策。 */
export interface WorkspaceProbe {
  /** 环境变量是否给出。 */
  env: string | null
  /** process.cwd() 的原值。 */
  cwd: string
  /** cwd 是否被判为宿主内部目录。 */
  cwdInternal: boolean
  /** workingDirectory 服务给出的当前目录（没有则为 null）。 */
  workingDirectory: string | null
  /** workspaceRegistry 服务取到几个路径。 */
  serviceCount: number
  /** 服务对外暴露的可疑名字（只记录存在的）。 */
  serviceKeys: string[]
}

/** 这些路径是宿主的内部目录，不是用户的工作区。 */
function looksInternal(dir: string): boolean {
  const norm = dir.replace(/\\/g, '/').toLowerCase()
  return (
    !fs.existsSync(dir) ||
    norm.includes('/.dsh/profiles/') ||
    norm.includes('/.dsh/plugins/') ||
    norm.includes('/node_modules/') ||
    norm.endsWith('/.dsh')
  )
}

/** 进程 cwd，但排除宿主的内部目录。 */
function cwdCandidate(): string | undefined {
  const cwd = process.cwd()
  if (cwd === '' || looksInternal(cwd)) return undefined
  return cwd
}

/**
 * 猜当前工作区目录。
 *
 * 顺序：环境变量 → workingDirectory 的部署级 fallback → workspaceRegistry（与 cwd
 * 同前缀中最深的）→ 进程 cwd。
 *
 * 注意这里**不含会话级**：这个函数拿不到 agent。会话级由 `sessionWorkspaceDir` 单独解析，
 * 在 runtime 的 `resolveOutputDirFor` 里优先使用（但配置项 `outputDir` 仍然最优先）。多工作区下 probeWorkspace 的结果只是
 * 「没有会话信息时」的兜底。
 *
 * 注意 registry 的返回顺序不可靠：cwd 匹配不上时取首项，那个顺序与用户当前在哪个
 * 工作区无关 —— 多工作区场景下产物会落到不相关的工作区。所以能用会话级就别用 registry。
 * 都没有就返回 undefined，由调用方决定兜底位置。
 *
 * 之前只用一个猜出来的字段名，字段不存在时静默退回插件数据目录，
 * 表现是"图还是写到 C 盘"且查不出原因 —— 所以每一级都保留来源标记。
 */
export function workspaceDirOf(ctx: ServiceBag): WorkspaceGuess | undefined {
  return probeWorkspace(ctx).guess
}

/**
 * 探测工作区，并留下取证记录。
 *
 * @param ctx - 宿主上下文。
 */
export function probeWorkspace(ctx: ServiceBag): { guess: WorkspaceGuess | undefined; probe: WorkspaceProbe } {
  const cwd = process.cwd()
  const probe: WorkspaceProbe = {
    env: typeof process.env.DSH_WORKSPACE === 'string' && process.env.DSH_WORKSPACE.trim() !== '' ? process.env.DSH_WORKSPACE : null,
    cwd,
    cwdInternal: looksInternal(cwd),
    workingDirectory: null,
    serviceCount: 0,
    serviceKeys: [],
  }

  // 只用于诊断记录。注意 `workspace` 是 storages 里的域名，不是 ctx 上的服务；
  // 真正可用的是 workspaceRegistry（其余几个历史上试过，留着方便排查）。
  for (const name of ['workspaceRegistry', 'workspace', 'workspaces', 'workspaceStore']) {
    try {
      if (typeof (ctx.get?.(name) as unknown) !== 'undefined') probe.serviceKeys.push(name)
    } catch {
      // 取不到就算了
    }
  }

  const explicit = process.env.DSH_WORKSPACE
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    // env 优先时也要把服务给出的值记进诊断，否则这个字段在 env 场景下恒为 null，
    // 读 probe 的人分不清「没挂服务」和「被 env 压过」。
    try {
      const wd = ctx.get?.('workingDirectory') as { defaultDirectory?: unknown } | undefined
      if (typeof wd?.defaultDirectory === 'string') probe.workingDirectory = wd.defaultDirectory
    } catch {
      // 取不到就不记
    }
    return { guess: { dir: path.resolve(explicit.trim()), source: 'env' as const }, probe }
  }

  // workingDirectory 是"当前工作目录"的正规来源（宿主自己的 cwd 服务）。
  // 之前只靠 workspaceRegistry.list() 的返回顺序猜，cwd 匹配不上时取第一个 ——
  // 那个顺序跟用户当前在哪个工作区无关，产物会落到不相关的工作区里。
  try {
    const wd = ctx.get?.('workingDirectory') as { defaultDirectory?: unknown } | undefined
    const dir = wd?.defaultDirectory
    // 先记原值：被排除时也要能从诊断里看出【它本来是哪个路径】，否则分不清
    // 「服务没挂载」和「路径被判成内部目录」。
    if (typeof dir === 'string' && dir !== '') probe.workingDirectory = dir
    if (typeof dir === 'string' && dir !== '' && !looksInternal(dir)) {
      return { guess: { dir: path.resolve(dir), source: 'workingDirectory' as const }, probe }
    }
  } catch {
    // 服务未挂载：继续往下探
  }

  let paths: string[] = []
  try {
    // 服务名是 workspaceRegistry —— `workspace` 只是它在 storages 里的**域名**
    // （workspace.json 的 unit.name），不是 ctx 上的服务名。仓内 authz/roots.ts 用的就是前者。
    const service = ctx.get?.('workspaceRegistry') as { list?: () => unknown } | undefined
    const raw = typeof service?.list === 'function' ? service.list() : []
    if (Array.isArray(raw)) {
      paths = raw
        .map(item => (item !== null && typeof item === 'object' ? (item as { path?: unknown }).path : undefined))
        .filter((item): item is string => typeof item === 'string' && item !== '')
    }
  } catch {
    paths = []
  }

  probe.serviceCount = paths.length
  if (paths.length > 0) {
    // 进程 cwd 常常就在工作区里，但工作区之间可能是父子关系（`D:\dsh` 与 `D:\dsh\notes`）。
    // 比较前要做三件事：① 归一化分隔符（宿主给的正斜杠在 Windows 下永远比不中）；
    // ② 折叠大小写（Windows 路径大小写不敏感）；③ 取**最深**的那个 —— 只按顺序找第一个
    // 会把产物丢到父工作区根下。
    // 折叠规则与授权 / 根去重共用一处（foldPathCase），别再各写一份。
    const norm = (value: string): string => foldPathCase(value.replace(/\\/g, '/').replace(/\/+$/, ''))
    const cwdNorm = norm(cwd)
    const related = paths
      .map(item => ({ item, target: norm(item) }))
      .filter(({ target }) => cwdNorm === target || cwdNorm.startsWith(`${target}/`))
      .sort((a, b) => b.target.length - a.target.length)[0]?.item
    return { guess: { dir: related ?? (paths[0] as string), source: 'service' as const }, probe }
  }

  const candidate = cwdCandidate()
  const guess = candidate === undefined ? undefined : { dir: candidate, source: 'cwd' as const }
  return { guess, probe }
}

/**
 * 从 Agent 上取会话级的工作区目录。
 *
 * 这是唯一能区分"同一个进程里多个工作区"的来源：workspaceRegistry 只知道有哪些，
 * 不知道当前会话属于哪个。不同 DSH 版本把会话挂在 agent 的不同字段上，所以这里
 * 防御式地挨个试 —— 拿不到就返回 undefined，由调用方回退。
 *
 * @param ctx - 宿主上下文。
 * @param agent - 发起本次调用的 Agent（ToolExec.agent）。
 */
export function sessionWorkspaceDir(ctx: ServiceBag, agent: unknown): string | undefined {
  if (agent === null || typeof agent !== 'object') return undefined
  const holder = agent as { session?: unknown; sessionId?: unknown; id?: unknown }
  const session = holder.session ?? holder.sessionId ?? holder.id
  if (session === undefined || session === null) return undefined

  let service: unknown
  try {
    service = ctx.get?.('workingDirectory')
  } catch {
    return undefined
  }
  if (service === null || typeof service !== 'object') return undefined

  const getter = (service as { get?: unknown }).get
  if (typeof getter !== 'function') return undefined

  let result: unknown
  try {
    result = (getter as (session: unknown) => unknown).call(service, session)
  } catch {
    return undefined
  }
  if (typeof result === 'string') {
    return result !== '' && !looksInternal(result) ? path.resolve(result) : undefined
  }
  if (result !== null && typeof result === 'object') {
    const candidate = (result as { path?: unknown; directory?: unknown }).path
      ?? (result as { path?: unknown; directory?: unknown }).directory
    if (typeof candidate === 'string' && candidate !== '' && !looksInternal(candidate)) return path.resolve(candidate)
  }
  return undefined
}

/**
 * 决定产物目录（并建出来）。
 *
 * 宁可在用户的工作区里新建一个 `comfyui-output`，也不要退回插件私有数据目录 ——
 * 后者在 C 盘深处，用户在自己的项目里根本找不到。
 *
 * @param configured - 配置里显式给的目录，优先级最高。
 * @param guess - 工作区探测结果。
 * @param dataDir - 插件数据目录，仅在探测彻底失败时兜底。
 */
export function resolveOutputDir(
  configured: string | null,
  guess: WorkspaceGuess | undefined,
  dataDir: string,
): { dir: string; source: 'config' | 'env' | 'workingDirectory' | 'service' | 'cwd' | 'data' } {
  if (configured !== null) return { dir: configured, source: 'config' }
  if (guess !== undefined) {
    return { dir: path.join(guess.dir, 'comfyui-output'), source: guess.source }
  }
  return { dir: path.join(dataDir, 'outputs'), source: 'data' }
}
