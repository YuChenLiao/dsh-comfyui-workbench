/** 宿主 API 前缀。与 src/http/router.ts 的 PREFIX 必须一致。 */
import type { DirectRunResult, WorkflowListItem, WorkflowSurface } from './types.js'

export const API = '/comfyui-workbench/api'

/**
 * 调一个 JSON 接口。
 *
 * 非 2xx 或 `ok !== true` 一律抛错，并把宿主给的 message 带出来 ——
 * 宿主的中文错误信息比 "HTTP 500" 有用得多。
 *
 * @param route - 以 `/` 开头的子路径。
 * @param params - 查询参数。
 */
export async function apiJson(route: string, params?: Record<string, string>): Promise<Record<string, unknown>> {
  const qs = params !== undefined ? `?${new URLSearchParams(params).toString()}` : ''
  const res = await fetch(API + route + qs)
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (!res.ok || bag === null || bag.ok !== true) {
    const message = typeof bag?.message === 'string' ? bag.message : `请求失败：HTTP ${res.status}`
    throw new Error(message)
  }
  return bag ?? {}
}

/** 面板开关的当前状态。`source` 说明这个值是面板改的还是配置来的。 */
export interface TogglesView {
  progressStream: boolean
  progressStreamSource: 'toggle' | 'config'
}

/** 宿主配置（界面上要显示的默认路径等）。 */
export interface HostConfig {
  baseUrl: string
  outputDir: string
  uploadsDir: string
  workflowsDir: string
  runMode: string
  returnImages: string
  timeoutMs: number
  /** 各组件是否启用。 */
  components?: Record<string, boolean>
  tools?: { registered: string[]; failed: Array<{ name: string; message: string }>; skipped: string[] }
  /** 面板开关（`progressStream` 等）。 */
  toggles?: TogglesView
}

/**
 * 切一个面板开关。
 *
 * 写的是插件数据目录的 `settings.json`（不是 profile 的 `cordis.patch.yml`），
 * 所以改完**下一次提交就生效**、不用重启。传 `null` 表示清掉覆盖、回退到配置默认值。
 *
 * @param progressStream - 目标状态，或 `null` 清掉覆盖。
 */
export async function setProgressStream(progressStream: boolean | null): Promise<TogglesView> {
  const res = await fetch(`${API}/config`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progressStream }),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object' ? (data as { ok?: unknown; message?: unknown; toggles?: unknown }) : null
  if (bag?.ok !== true) throw new Error(typeof bag?.message === 'string' ? bag.message : `保存失败：HTTP ${res.status}`)
  const toggles = bag.toggles !== null && typeof bag.toggles === 'object' ? (bag.toggles as TogglesView) : null
  if (toggles === null) throw new Error('宿主没有返回开关状态。')
  return toggles
}

/** 改工作流设置（是否可用 / 备注 / 标题），返回服务端确认后的值。 */
export async function updateWorkflow(
  id: string,
  body: { enabled?: boolean; description?: string; title?: string },
): Promise<{ enabled: boolean; description: string; title: string }> {
  const res = await fetch(`${API}/workflows/${encodeURIComponent(id)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object' ? (data as { ok?: unknown; message?: unknown }) : null
  if (bag?.ok !== true) throw new Error(typeof bag?.message === 'string' ? bag.message : `保存失败：HTTP ${res.status}`)
  return data as { enabled: boolean; description: string; title: string }
}

/** 标签面板的一行。 */
export interface TagHit {
  tag: string
  kind: string
  postCount: number
  zh: string
  aliases: string[]
  category: string
  groups: string[]
}

/** 标签面板首屏要的统计。 */
export interface TagStats {
  kinds: Record<string, number>
  categories: Record<string, number>
  labels: Record<string, string>
  total: number
}

/** 查标签（面板用）。 */
export async function fetchTags(
  options: { query?: string; kind?: string; category?: string; offset?: number; limit?: number },
): Promise<{ items: TagHit[]; total: number }> {
  const params = new URLSearchParams()
  if (options.query !== undefined && options.query !== '') params.set('q', options.query)
  if (options.kind !== undefined && options.kind !== '') params.set('kind', options.kind)
  if (options.category !== undefined && options.category !== '') params.set('category', options.category)
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const res = await fetch(`${API}/tags?${params.toString()}`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; items?: unknown; total?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取标签失败：HTTP ${res.status}`)
  }
  return {
    items: Array.isArray(bag.items) ? (bag.items as TagHit[]) : [],
    total: typeof bag.total === 'number' ? bag.total : 0,
  }
}

/** 取标签库的统计（四类与大类的计数）。 */
export async function fetchTagStats(): Promise<TagStats> {
  const res = await fetch(`${API}/tags/stats`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; kinds?: unknown; categories?: unknown; labels?: unknown; total?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取标签统计失败：HTTP ${res.status}`)
  }
  return {
    kinds: (bag.kinds !== null && typeof bag.kinds === 'object' ? bag.kinds : {}) as Record<string, number>,
    categories: (bag.categories !== null && typeof bag.categories === 'object' ? bag.categories : {}) as Record<string, number>,
    labels: (bag.labels !== null && typeof bag.labels === 'object' ? bag.labels : {}) as Record<string, string>,
    total: typeof bag.total === 'number' ? bag.total : 0,
  }
}

/** 「更新标签」任务的状态。 */
export interface TagSyncState {
  state: 'idle' | 'running' | 'done' | 'failed'
  stage: string
  done: number
  total: number
  message: string
  lastSuccessAt: number
  results: Array<{ kind: string; records: number; withNames: number }>
  groups: { groups: number; tags: number; failed: string[]; fromCache: boolean } | null
}

/** 开始一次标签更新（后台跑，立刻返回当前状态）。 */
export async function startTagSync(): Promise<TagSyncState> {
  const res = await fetch(`${API}/tags/sync`, { method: 'POST' })
  return readSyncState(res)
}

/** 查更新进度。 */
export async function fetchTagSync(): Promise<TagSyncState> {
  const res = await fetch(`${API}/tags/sync`)
  return readSyncState(res)
}

async function readSyncState(res: Response): Promise<TagSyncState> {
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as Partial<TagSyncState> & { ok?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `更新失败：HTTP ${res.status}`)
  }
  return {
    state: (bag.state ?? 'idle') as TagSyncState['state'],
    stage: typeof bag.stage === 'string' ? bag.stage : '',
    done: typeof bag.done === 'number' ? bag.done : 0,
    total: typeof bag.total === 'number' ? bag.total : 0,
    message: typeof bag.message === 'string' ? bag.message : '',
    lastSuccessAt: typeof bag.lastSuccessAt === 'number' ? bag.lastSuccessAt : 0,
    results: Array.isArray(bag.results) ? bag.results : [],
    groups: bag.groups ?? null,
  }
}

/** 单条运行的状态（面板提交后轮询用）。 */
export interface RunStatus {
  found: boolean
  state: string
  queuePosition?: number
  progress?: { value: number; max: number }
  error?: { code: string; message: string }
  artifacts?: Array<{ path: string; bytes: number }>
}

/** 查一条运行的状态。 */
export async function fetchRunStatus(promptId: string): Promise<RunStatus> {
  const res = await fetch(`${API}/run-status?promptId=${encodeURIComponent(promptId)}`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; found?: unknown; state?: unknown; message?: unknown } & Partial<RunStatus>)
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `查运行状态失败：HTTP ${res.status}`)
  }
  return {
    found: bag.found === true,
    state: typeof bag.state === 'string' ? bag.state : 'unknown',
    ...(typeof bag.queuePosition === 'number' ? { queuePosition: bag.queuePosition } : {}),
    ...(bag.progress === undefined ? {} : { progress: bag.progress }),
    ...(bag.error === undefined ? {} : { error: bag.error }),
    ...(bag.artifacts === undefined ? {} : { artifacts: bag.artifacts }),
  }
}

/**
 * 同名工作流已存在，需要显式确认覆盖。
 *
 * 带上 `workflowId` 让调用方能直接问"要覆盖 X 吗"，不必再解析文案。
 */
export class WorkflowExistsError extends Error {
  readonly workflowId: string

  constructor(workflowId: string, message: string) {
    super(message)
    this.name = 'WorkflowExistsError'
    this.workflowId = workflowId
  }
}

/**
 * 导入一份工作流（粘贴的 JSON 对象）。
 *
 * 与 `POST /workflows` 不同：那是批量导出 ZIP，这条是导入。同名会**覆盖模板**，
 * 但保留面板里写过的备注与 schema —— 所以返回值里带 `replaced` 让界面能说清。
 *
 * @param body - `name`（只用来生成 id，可省）与已解析的 `workflow` 对象。
 */
export async function importWorkflow(body: { name?: string; workflow: unknown; overwrite?: boolean }): Promise<{ workflowId: string; replaced: boolean }> {
  const res = await fetch(`${API}/workflows/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; message?: unknown; error?: unknown; workflowId?: unknown; replaced?: unknown })
    : null
  // 同名且没带 overwrite：抛一个带 id 的错误，让调用方确认后再重发
  if (bag?.error === 'already-exists') {
    throw new WorkflowExistsError(String(bag.workflowId ?? ''), typeof bag.message === 'string' ? bag.message : '')
  }
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `导入失败：HTTP ${res.status}`)
  }
  return { workflowId: String(bag.workflowId ?? ''), replaced: bag.replaced === true }
}

/** 取宿主配置。 */
export async function fetchConfig(): Promise<HostConfig> {
  const data = await apiJson('/config')
  const bag = data.config !== null && typeof data.config === 'object' ? (data.config as HostConfig) : null
  if (bag === null) throw new Error('宿主没有返回配置。')
  return bag
}

/** 工作流列表（IO 面摘要）。 */
export async function fetchWorkflowList(): Promise<{ workflows: WorkflowListItem[]; broken?: string[] }> {
  const data = await apiJson('/workflows')
  return {
    workflows: Array.isArray(data.workflows) ? (data.workflows as WorkflowListItem[]) : [],
    ...(Array.isArray(data.broken) ? { broken: data.broken as string[] } : {}),
  }
}

/** 单份工作流的完整 IO 面。 */
export async function fetchWorkflowDetail(workflowId: string): Promise<WorkflowSurface> {
  const data = await apiJson(`/workflows/${encodeURIComponent(workflowId)}`)
  const surface = data.surface
  if (surface === null || typeof surface !== 'object') throw new Error('宿主没有返回 IO 面。')
  return surface as WorkflowSurface
}

/**
 * 直接运行（direct 模式）。
 *
 * 走 HTTP 而不是工具：这条路不消耗模型往返，代价是图片不会进对话。
 */
export async function runDirect(input: {
  workflowId: string
  vars: Record<string, unknown>
  outputPath?: string
}): Promise<DirectRunResult> {
  const res = await fetch(`${API}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object' ? (data as DirectRunResult) : null
  if (bag === null) throw new Error(`运行失败：HTTP ${res.status}`)
  return bag
}

/** 查一次已提交的运行。 */
export async function pollRun(promptId: string): Promise<DirectRunResult> {
  const res = await fetch(`${API}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ promptId }),
  })
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  const bag = data !== null && typeof data === 'object' ? (data as DirectRunResult) : null
  if (bag === null) throw new Error(`查询失败：HTTP ${res.status}`)
  return bag
}

/** 让 ComfyUI 释放显存。 */
export async function freeMemory(): Promise<void> {
  const res = await fetch(`${API}/free`, { method: 'POST' })
  const body = await res.json().catch(() => null)
  if (body?.ok !== true) throw new Error(body?.message ?? `释放失败：HTTP ${res.status}`)
}

/** 文件字节地址。`thumb` 为真时走缩略图。 */
export function fileUrl(path: string, thumb?: boolean): string {
  return `${API}/file?path=${encodeURIComponent(path)}${thumb === true ? '&thumb=1' : ''}`
}

/** 取一张图的字节。 */
export async function fetchBlob(path: string): Promise<Blob> {
  const res = await fetch(fileUrl(path))
  if (!res.ok) throw new Error(`读取图片失败：HTTP ${res.status}`)
  return await res.blob()
}

/** 触发浏览器下载。 */
export function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

// ── 姿势库 ──

/** 面板上的一组姿势。字段与 `panel-poses/server/catalog.ts` 的 `PoseHit` 对齐。 */
export interface PoseHit {
  id: string
  name: string
  system: string
  systemId: string
  code: string
  category: string
  adult: boolean
  viewCount: number
  /** 实际存在哪些角度。有一组只有 4 个，前端不能写死五个。 */
  angleIds: string[]
  cover: { viewId: string; thumb: string; full: string; angle: string }
}

export interface PoseStats {
  systems: Array<{ id: string; name: string; adult: boolean; poseCount: number; viewCount: number }>
  categories: Record<string, number>
  poseCount: number
  viewCount: number
  adultPoseCount: number
  safePoseCount: number
  attribution: string
  source: string
  origin: string
}

/** 查姿势（面板用）。默认全给，`safe` 才收窄。 */
export async function fetchPoses(
  options: { query?: string; system?: string; category?: string; safe?: boolean; offset?: number; limit?: number },
): Promise<{ items: PoseHit[]; total: number }> {
  const params = new URLSearchParams()
  if (options.query !== undefined && options.query !== '') params.set('q', options.query)
  if (options.system !== undefined && options.system !== '') params.set('system', options.system)
  if (options.category !== undefined && options.category !== '') params.set('category', options.category)
  if (options.safe === true) params.set('safe', '1')
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const res = await fetch(`${API}/poses?${params.toString()}`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; items?: unknown; total?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取姿势失败：HTTP ${res.status}`)
  }
  return {
    items: Array.isArray(bag.items) ? (bag.items as PoseHit[]) : [],
    total: typeof bag.total === 'number' ? bag.total : 0,
  }
}

/** 取姿势库统计（体系、分类、成人向计数）。 */
export async function fetchPoseStats(): Promise<PoseStats> {
  const res = await fetch(`${API}/poses/stats`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (bag?.ok !== true) {
    const message = typeof bag?.message === 'string' ? bag.message : `取姿势统计失败：HTTP ${res.status}`
    throw new Error(message)
  }
  return {
    systems: Array.isArray(bag.systems) ? (bag.systems as PoseStats['systems']) : [],
    categories: (bag.categories !== null && typeof bag.categories === 'object' ? bag.categories : {}) as Record<string, number>,
    poseCount: typeof bag.poseCount === 'number' ? bag.poseCount : 0,
    viewCount: typeof bag.viewCount === 'number' ? bag.viewCount : 0,
    adultPoseCount: typeof bag.adultPoseCount === 'number' ? bag.adultPoseCount : 0,
    safePoseCount: typeof bag.safePoseCount === 'number' ? bag.safePoseCount : 0,
    attribution: typeof bag.attribution === 'string' ? bag.attribution : '',
    source: typeof bag.source === 'string' ? bag.source : '',
    origin: typeof bag.origin === 'string' ? bag.origin : '',
  }
}

/** 线稿的字节地址（服务端代理，浏览器不直连第三方图床）。 */
export function poseImageUrl(viewId: string, size: 'thumb' | 'full' = 'thumb'): string {
  return `${API}/poses/image?id=${encodeURIComponent(viewId)}&size=${size}`
}

/** 把某张线稿落盘到 uploads，返回本机路径（给工作流当输入图）。 */
export async function fetchPoseFile(viewId: string, size: 'thumb' | 'full' = 'full'): Promise<{ file: string }> {
  const res = await fetch(`${API}/poses/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: viewId, size }),
  })
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; file?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true || typeof bag.file !== 'string') {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取线稿失败：HTTP ${res.status}`)
  }
  return { file: bag.file }
}

// ── 服装库 ──

/** 一套服装。字段与 `panel-costumes/server/catalog.ts` 的 `CostumeItem` 对齐。 */
export interface CostumeItem {
  id: string
  category: string
  name: string
  tags: string[]
  /** 英文关键词，可直接拼进提示词。 */
  keywords: string
  adult: boolean
  thumb: string
  preview: string
  full: string
}

export interface CostumeStats {
  total: number
  adultCount: number
  safeCount: number
  categories: Record<string, number>
  attribution: string
  source: string
  origin: string
}

/** 衣装库的两个画风版本。 */
export type CostumeSource = 'real' | 'anime'

/** 查服装（面板用）。默认全给，`safe` 才收窄。 */
export async function fetchCostumes(
  options: { source?: CostumeSource; query?: string; category?: string; safe?: boolean; offset?: number; limit?: number },
): Promise<{ items: CostumeItem[]; total: number }> {
  const params = new URLSearchParams()
  if (options.source === 'anime') params.set('source', 'anime')
  if (options.query !== undefined && options.query !== '') params.set('q', options.query)
  if (options.category !== undefined && options.category !== '') params.set('category', options.category)
  if (options.safe === true) params.set('safe', '1')
  if (options.offset !== undefined) params.set('offset', String(options.offset))
  if (options.limit !== undefined) params.set('limit', String(options.limit))
  const res = await fetch(`${API}/costumes?${params.toString()}`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; items?: unknown; total?: unknown; message?: unknown })
    : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取服装失败：HTTP ${res.status}`)
  }
  return {
    items: Array.isArray(bag.items) ? (bag.items as CostumeItem[]) : [],
    total: typeof bag.total === 'number' ? bag.total : 0,
  }
}

/** 取服装库统计。 */
export async function fetchCostumeStats(source?: CostumeSource): Promise<CostumeStats> {
  const suffix = source === 'anime' ? '?source=anime' : ''
  const res = await fetch(`${API}/costumes/stats${suffix}`)
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取服装统计失败：HTTP ${res.status}`)
  }
  return {
    total: typeof bag.total === 'number' ? bag.total : 0,
    adultCount: typeof bag.adultCount === 'number' ? bag.adultCount : 0,
    safeCount: typeof bag.safeCount === 'number' ? bag.safeCount : 0,
    categories: (bag.categories !== null && typeof bag.categories === 'object' ? bag.categories : {}) as Record<string, number>,
    attribution: typeof bag.attribution === 'string' ? bag.attribution : '',
    source: typeof bag.source === 'string' ? bag.source : '',
    origin: typeof bag.origin === 'string' ? bag.origin : '',
  }
}

/** 服装图的字节地址（服务端代理，浏览器不直连第三方图床）。 */
/**
 * 一张服装图的地址。
 *
 * `source` 必须带上：两库的 id 同格式（`SPR-xxxx`），不带的话服务端按写实版取，
 * 面板切到二次元后列表换了、图却没换 —— 这正是第一版漏掉的。
 */
export function costumeImageUrl(id: string, size: 'thumb' | 'preview' | 'full' = 'thumb', source?: CostumeSource): string {
  const suffix = source === 'anime' ? '&source=anime' : ''
  return `${API}/costumes/image?id=${encodeURIComponent(id)}&size=${size}${suffix}`
}

/** 把某套服装的图落盘到 uploads，返回本机路径。 */
export async function fetchCostumeFile(id: string, size: 'thumb' | 'preview' | 'full' = 'full', source?: CostumeSource): Promise<{ file: string; keywords: string }> {
  const res = await fetch(`${API}/costumes/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(source === 'anime' ? { id, size, source: 'anime' } : { id, size }),
  })
  const data: unknown = await res.json().catch(() => null)
  const bag = data !== null && typeof data === 'object'
    ? (data as { ok?: unknown; file?: unknown; message?: unknown; costume?: { keywords?: unknown } })
    : null
  if (bag?.ok !== true || typeof bag.file !== 'string') {
    throw new Error(typeof bag?.message === 'string' ? bag.message : `取服装图失败：HTTP ${res.status}`)
  }
  const keywords = bag.costume !== undefined && typeof bag.costume.keywords === 'string' ? bag.costume.keywords : ''
  return { file: bag.file, keywords }
}
