/**
 * `/queue` 响应体 —— 全仓唯一一份解析与键名表。
 *
 * 抽出来的原因：同一份数据原来有两套解析。`client.queue()` 认
 * `queue_running` / `running` 两种键名并兼容对象元素（ComfyUI 0.3 前后调整过字段），
 * 而空闲回收里的探测一开始只认 `queue_running` —— 上游一改键名，那个探测就会静默
 * 返回"没有活"，于是**正在跑图的实例被当成空闲杀掉**。同一数据两套解析，脆的那套迟早出事。
 */

export interface QueueSnapshot {
  /** 正在跑的 promptId。 */
  running: string[]
  /** 排队中的 promptId。 */
  pending: string[]
}

/** 两种键名都认（上游改过字段名）。 */
const RUNNING_KEYS = ['queue_running', 'running'] as const
const PENDING_KEYS = ['queue_pending', 'pending'] as const

function bagOf(body: unknown): Record<string, unknown> | undefined {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return undefined
  return body as Record<string, unknown>
}

/** 按优先级找第一个是数组的键。 */
function firstArray(bag: Record<string, unknown>, keys: readonly string[]): unknown[] | undefined {
  for (const key of keys) {
    const value = bag[key]
    if (Array.isArray(value)) return value
  }
  return undefined
}

/**
 * 从 `/queue` 的响应体里取队列（要 promptId 的地方用它）。
 *
 * 元素形状有两种：标准是 `[number, prompt_id, ...]`，也有实现给 `{ prompt_id }`。
 * 认不出的元素直接跳过 —— 这个函数的语义是"给出 promptId"，不是"判断有没有活"。
 *
 * @param body - `res.json()` 的结果，任何形状都可能。
 */
export function parseQueue(body: unknown): QueueSnapshot {
  const bag = bagOf(body)
  if (bag === undefined) return { running: [], pending: [] }

  const pick = (keys: readonly string[]): string[] => {
    const value = firstArray(bag, keys)
    if (value === undefined) return []
    const out: string[] = []
    for (const item of value) {
      if (Array.isArray(item) && typeof item[1] === 'string') out.push(item[1])
      else if (item !== null && typeof item === 'object' && typeof (item as { prompt_id?: unknown }).prompt_id === 'string') {
        out.push((item as { prompt_id: string }).prompt_id)
      }
    }
    return out
  }

  return { running: pick(RUNNING_KEYS), pending: pick(PENDING_KEYS) }
}

/**
 * 队列里有没有活（只看有没有排队的条目，不关心 promptId）。
 *
 * 与 `parseQueue` 分开是因为判定标准不同：空闲回收只需要知道"忙不忙"，
 * 而**数组非空本身就算忙** —— 哪怕元素形状认不出来。判错的代价不对称：
 * 误判成忙只是多留一会儿进程，误判成空会杀掉正在干活的实例。
 *
 * @param body - `res.json()` 的结果。
 */
export function isQueueBusy(body: unknown): boolean {
  const bag = bagOf(body)
  if (bag === undefined) return false
  const running = firstArray(bag, RUNNING_KEYS)
  const pending = firstArray(bag, PENDING_KEYS)
  return (running?.length ?? 0) > 0 || (pending?.length ?? 0) > 0
}
