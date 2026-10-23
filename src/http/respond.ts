import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * 写一个 JSON 响应。
 *
 * 统一 `no-store`：资产列表与元数据都随磁盘变化，缓存由前端自己控制。
 *
 * @param res - 响应。
 * @param status - HTTP 状态码。
 * @param value - 响应体（会被 JSON 序列化）。
 */
export function sendJson(res: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/**
 * 读取 JSON 请求体（上限 512KB：只用于批量路径列表）。
 *
 * @param req - 请求。
 */
export async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += buffer.length
    if (size > 512 * 1024) throw new Error('请求体超过 512KB')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

/**
 * 从请求体里取一批路径，并做类型与数量校验。
 *
 * @param body - 请求体。
 * @param limit - 上限。
 * @returns 路径列表；不合法时 undefined。
 */
export function pathsFromBody(body: Record<string, unknown>, limit: number): string[] | undefined {
  const raw = body.paths
  if (!Array.isArray(raw)) return undefined
  const paths = raw.filter((item): item is string => typeof item === 'string' && item !== '')
  if (paths.length === 0 || paths.length > limit) return undefined
  return paths
}
