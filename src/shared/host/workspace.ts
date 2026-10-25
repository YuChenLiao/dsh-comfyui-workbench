import fs from 'node:fs'
import path from 'node:path'

/** 只要求能按名字取服务。 */
interface ServiceBag {
  get?: (name: string) => unknown
}

/** 产物目录候选：目录 + 它是怎么来的。 */
export interface WorkspaceGuess {
  dir: string
  source: 'env' | 'service' | 'cwd'
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
 * 顺序：环境变量 → workspace 服务（优先与 cwd 同前缀的）→ 进程 cwd。
 * 都没有就返回 undefined，由调用方决定兜底位置。
 *
 * 之前只用一个猜出来的字段名，字段不存在时静默退回插件数据目录，
 * 表现是"图还是写到 C 盘"且查不出原因 —— 所以每一级都保留来源标记。
 */
export function workspaceDirOf(ctx: ServiceBag): WorkspaceGuess | undefined {
  const explicit = process.env.DSH_WORKSPACE
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    return { dir: path.resolve(explicit.trim()), source: 'env' }
  }

  let paths: string[] = []
  try {
    const service = ctx.get?.('workspace') as { list?: () => unknown } | undefined
    const raw = typeof service?.list === 'function' ? service.list() : []
    if (Array.isArray(raw)) {
      paths = raw
        .map(item => (item !== null && typeof item === 'object' ? (item as { path?: unknown }).path : undefined))
        .filter((item): item is string => typeof item === 'string' && item !== '')
    }
  } catch {
    paths = []
  }

  if (paths.length > 0) {
    const cwd = process.cwd()
    // 进程 cwd 常常就在工作区里；同前缀优先，避免多工作区时选错。
    const related = paths.find(item => cwd === item || cwd.startsWith(`${item}\\`) || cwd.startsWith(`${item}/`))
    return { dir: related ?? (paths[0] as string), source: 'service' }
  }

  const cwd = cwdCandidate()
  return cwd === undefined ? undefined : { dir: cwd, source: 'cwd' }
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
): { dir: string; source: 'config' | 'env' | 'service' | 'cwd' | 'data' } {
  if (configured !== null) return { dir: configured, source: 'config' }
  if (guess !== undefined) {
    return { dir: path.join(guess.dir, 'comfyui-output'), source: guess.source }
  }
  return { dir: path.join(dataDir, 'outputs'), source: 'data' }
}
