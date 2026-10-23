/** 宿主 API 前缀。与 src/http/router.ts 的 PREFIX 必须一致。 */
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
