import crypto from 'node:crypto'

import type { ApiWorkflow } from '../workflow/types.js'
import { authFailed, comfyUnreachable, RunError, submitRejected } from './errors.js'
import type { FileRef, HistoryEntry, ObjectInfo } from './types.js'

/** 客户端配置。 */
export interface ComfyClientOptions {
  /** 形如 `http://127.0.0.1:8188`（不带尾斜杠）。 */
  baseUrl: string
  /** 透传请求头：反代鉴权、Cookie 之类。插件不内置任何默认值。 */
  headers?: Record<string, string>
  /** 单次 HTTP 上限（毫秒）。长任务不靠它兜，靠轮询超时。 */
  requestTimeoutMs?: number
  /**
   * 请求前的"确保服务可用"钩子（服务托管用）。
   * 返回 false 表示拉不起来，直接归成 comfy_unreachable。
   */
  ensure?: () => Promise<boolean>
}

/** 默认单请求超时：`/object_info` 可能几 MB，给足但不无限等。 */
const DEFAULT_REQUEST_TIMEOUT = 120_000

/**
 * ComfyUI 的 HTTP 客户端。
 *
 * 只做传输与错误分类，不含业务：什么时候预检、轮询多久、产物怎么命名都不在这里。
 * 端点按 ComfyUI 的既有 API：`/system_stats`、`/object_info`、`/prompt`、
 * `/history/{id}`、`/view`、`/interrupt`。
 */
export class ComfyClient {
  readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly requestTimeoutMs: number
  private readonly ensure: (() => Promise<boolean>) | undefined
  /** `/object_info` 缓存：响应可能好几 MB，同一进程不必反复拉。 */
  private infoCache: ObjectInfo | null = null
  /** 提交时带的 client_id（ComfyUI 用它区分来源）。 */
  private readonly clientId = crypto.randomUUID()

  constructor(options: ComfyClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.headers = options.headers ?? {}
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT
    this.ensure = options.ensure
  }

  /** 发一个请求；网络层失败统一归成 comfy_unreachable。 */
  private async request(
    path: string,
    init: RequestInit = {},
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    if (this.ensure !== undefined) {
      const ready = await this.ensure()
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error('服务未就绪，自动拉起也失败了'))
    }
    const url = `${this.baseUrl}${path}`
    try {
      return await fetch(url, {
        ...init,
        headers: { ...this.headers, ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      throw comfyUnreachable(this.baseUrl, error)
    }
  }

  /** 存活探测：轻量、不缓存。 */
  async systemStats(): Promise<unknown> {
    const res = await this.request('/system_stats', { method: 'GET' }, 10_000)
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status)
    if (!res.ok) throw comfyUnreachable(this.baseUrl, new Error(`/system_stats 返回 ${res.status}`))
    return await res.json()
  }

  /**
   * 节点清单。
   *
   * @param refresh - 强制重新拉（用户显式刷新时用）。
   */
  async objectInfo(refresh = false): Promise<ObjectInfo> {
    if (!refresh && this.infoCache !== null) return this.infoCache
    const res = await this.request('/object_info', { method: 'GET' })
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status)
    if (!res.ok) throw comfyUnreachable(this.baseUrl, new Error(`/object_info 返回 ${res.status}`))
    const parsed: unknown = await res.json()
    const info = parsed !== null && typeof parsed === 'object' ? (parsed as ObjectInfo) : {}
    this.infoCache = info
    return info
  }

  /** 提交一份工作流，返回 prompt_id。 */
  async queuePrompt(workflow: ApiWorkflow): Promise<string> {
    const res = await this.request('/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId }),
    })
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status)
    if (res.status === 400) {
      let body: unknown = null
      try {
        body = await res.json()
      } catch {
        body = null
      }
      throw submitRejected(body)
    }
    if (!res.ok) {
      throw new RunError('submit_rejected', `提交失败：HTTP ${res.status}`, '检查 ComfyUI 日志里的拒绝原因。')
    }
    const parsed: unknown = await res.json()
    const promptId = parsed !== null && typeof parsed === 'object' ? (parsed as { prompt_id?: unknown }).prompt_id : undefined
    if (typeof promptId !== 'string' || promptId === '') {
      throw new RunError('submit_rejected', 'ComfyUI 没有返回 prompt_id。', '确认 ComfyUI 版本支持 POST /prompt。')
    }
    return promptId
  }

  /** 查一次 history：没完成时返回 undefined。 */
  async history(promptId: string): Promise<HistoryEntry | undefined> {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`, { method: 'GET' }, 30_000)
    if (!res.ok) return undefined
    const parsed: unknown = await res.json()
    if (parsed === null || typeof parsed !== 'object') return undefined
    const entry = (parsed as Record<string, unknown>)[promptId]
    if (entry === null || typeof entry !== 'object') return undefined
    return entry as HistoryEntry
  }

  /** 取产物字节。 */
  async view(ref: FileRef): Promise<Buffer> {
    const params = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder ?? '',
      type: ref.type ?? 'output',
    })
    const res = await this.request(`/view?${params.toString()}`, { method: 'GET' }, 120_000)
    if (!res.ok) throw new RunError('output_unreadable', `取产物失败：HTTP ${res.status}（${ref.filename}）`)
    const array = await res.arrayBuffer()
    if (array.byteLength === 0) throw new RunError('output_unreadable', `产物是空的：${ref.filename}`)
    return Buffer.from(array)
  }

  /** 取消执行（超时收尾必发，否则队列被一条已放弃的任务堵住）。 */
  async interrupt(): Promise<void> {
    try {
      await this.request('/interrupt', { method: 'POST' }, 10_000)
    } catch {
      // 取消失败不该掩盖"超时"这个原始结论
    }
  }
}
