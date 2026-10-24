/** workspace 服务的最小形状（只用到 list）。 */
interface WorkspaceLike {
  path?: unknown
}

/**
 * 猜当前工作区目录，用来决定产物落在哪儿。
 *
 * 三个来源依次尝试，全都拿不到就返回 undefined（调用方退回数据目录）：
 * 1. 环境变量 `DSH_WORKSPACE` —— 显式指定，最可靠；
 * 2. workspace 服务的列表里与进程 cwd 相关的那一个（同前缀优先）；
 * 3. 列表第一个。
 *
 * 之前只用了一个猜出来的字段名，字段不存在时静默退回数据目录，
 * 表现就是"图又写到 C 盘去了"，还查不出原因 —— 所以这里每个来源都留着痕迹。
 */
/** 只要求能按名字取服务。 */
interface ServiceBag {
  get?: (name: string) => unknown
}

export function workspaceDirOf(ctx: ServiceBag): string | undefined {
  const explicit = process.env.DSH_WORKSPACE
  if (typeof explicit === 'string' && explicit.trim() !== '') return explicit.trim()

  let list: WorkspaceLike[] = []
  try {
    const service = ctx.get?.('workspace') as { list?: () => unknown } | undefined
    const raw = typeof service?.list === 'function' ? service.list() : []
    if (Array.isArray(raw)) list = raw as WorkspaceLike[]
  } catch {
    list = []
  }

  const paths = list
    .map(item => (typeof item?.path === 'string' ? item.path : ''))
    .filter(item => item !== '')
  if (paths.length === 0) return undefined

  const cwd = process.cwd()
  // 进程 cwd 常常就是工作区；同前缀时优先它，避免多工作区时选错。
  const related = paths.find(item => cwd === item || cwd.startsWith(`${item}\\`) || cwd.startsWith(`${item}/`))
  return related ?? paths[0]
}

/** 产物目录的最终解析，供 /config 展示与诊断。 */
export function describeOutputDir(configured: string | null, workspace: string | undefined, dataDir: string): {
  dir: string
  source: 'config' | 'workspace' | 'data'
} {
  if (configured !== null) return { dir: configured, source: 'config' }
  if (workspace !== undefined) return { dir: `${workspace}/comfyui-output`.replace(/\\/g, '/'), source: 'workspace' }
  return { dir: `${dataDir}/outputs`.replace(/\\/g, '/'), source: 'data' }
}
