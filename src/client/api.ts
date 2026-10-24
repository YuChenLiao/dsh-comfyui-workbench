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

/** 宿主配置（界面上要显示的默认路径等）。 */
export interface HostConfig {
  baseUrl: string
  outputDir: string
  uploadsDir: string
  workflowsDir: string
  runMode: string
  returnImages: string
  timeoutMs: number
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
