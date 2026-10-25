/**
 * Danbooru API 的访问层：主站失败时自动换镜像。
 *
 * 实测 `safebooru.donmai.us` 是 Danbooru 官方的 SFW 镜像 —— 同一套接口、
 * 同一份数据（`post_count`、wiki 的 `other_names`、`other_names_match` 反查结果
 * 与主站逐字段一致），所以可以当等价备选，不会改变查询语义。
 *
 * 不能用的是 `aibooru.online` 这类"同一套软件、不同数据库"的站：它的
 * `hatsune_miku` 是 1821 帖而主站是 148311，拿它当镜像会给出错误的热度与结果。
 */

/** 已知的等价镜像，按优先级排列。 */
export const MIRRORS = ['https://danbooru.donmai.us', 'https://safebooru.donmai.us']

const UA = 'dsh-comfyui-workbench (+https://github.com/YuChenLiao/dsh-comfyui-workbench)'

/** 单次请求的超时。没有它，"连上了但不响应"会让降级形同虚设。 */
let timeoutMs = 8000

/**
 * 调整请求超时（测试用；生产保持默认）。
 *
 * @param ms - 毫秒；传 0 恢复默认。
 */
export function useTimeout(ms: number): void {
  timeoutMs = ms > 0 ? ms : 8000
}

/** 上一次成功的镜像下标：避免每次请求都先撞一次已经坏掉的站。 */
let preferred = 0

/** 允许调用方（或测试）指定镜像列表。 */
let mirrors: string[] = [...MIRRORS]

/**
 * 临时替换镜像列表（测试与配置用）。
 *
 * @param hosts - 新的镜像列表，空数组表示恢复默认。
 */
export function useMirrors(hosts: readonly string[]): void {
  mirrors = hosts.length === 0 ? [...MIRRORS] : [...hosts]
  preferred = 0
}

/** 当前镜像列表（诊断用）。 */
export function currentMirrors(): readonly string[] {
  return mirrors
}

/** 带状态码与 Retry-After 的错误，供上层决定"退避多久"或"是否限流"。 */
export interface ApiError extends Error {
  status?: number
  retryAfterMs?: number
}

/**
 * 带降级的 GET。
 *
 * 判定"这个站能不能算数"的依据是状态码：
 * - `2xx` 成功。
 * - `404` 表示**端点不存在**（Danbooru 的"查无此项"是 `200 + []`，不是 404），
 *   说明这个镜像不可用，换下一个。
 * - `429` / `5xx` / 网络错误 / 超时 → 换下一个。
 * - 其它 4xx 是请求本身有问题，直接抛，换站只会重复同一个错误。
 *
 * @param path - 以 `/` 开头的接口路径（含 query）。
 * @param init - 额外的 fetch 选项（signal 等）。
 */
export async function fetchJson(path: string, init?: RequestInit): Promise<Response> {
  let lastError: ApiError | undefined
  const total = mirrors.length
  for (let step = 0; step < total; step += 1) {
    const index = (preferred + step) % total
    const host = mirrors[index] as string
    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = init?.signal === undefined || init.signal === null
      ? timeout
      : AbortSignal.any([init.signal, timeout])
    try {
      const res = await fetch(host + path, {
        ...init,
        signal,
        headers: { 'User-Agent': UA, ...(init?.headers ?? {}) },
      })
      if (res.ok) {
        preferred = index
        return res
      }
      const retryAfter = Number(res.headers.get('retry-after')) || 0
      const error = new Error(`Danbooru 返回 ${res.status}：${path}`) as ApiError
      error.status = res.status
      if (retryAfter > 0) error.retryAfterMs = retryAfter * 1000
      lastError = error
      // 404 说明这个镜像没有这个端点；429/5xx 是临时故障 —— 都换站
      if (res.status === 404 || res.status === 429 || res.status >= 500) continue
      throw error
    } catch (caught) {
      const failure = caught as ApiError
      // 请求本身的问题（4xx 非 404/429）不该换站重复
      if (typeof failure.status === 'number' && failure.status !== 404 && failure.status !== 429 && failure.status < 500) {
        throw failure
      }
      lastError = failure instanceof Error ? failure : new Error(String(caught))
    }
  }
  throw lastError ?? new Error(`Danbooru 请求失败：${path}`)
}

/** 取 JSON（大多数接口用这个）。 */
export async function getJson(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetchJson(path, init)
  return res.json()
}
