import type { ListItem } from '../scan/index.js'

/** 合并后仍在列表项上的附加信息。 */
export interface DedupedItem extends ListItem {
  duplicateCount?: number
  duplicates?: string[]
}

/**
 * 宽松签名：**同一次运行的副本一定同这个 key**，但不同运行也可能撞上。
 *
 * 典型场景：跑一次 ComfyUI，ComfyUI 自己存了一份（`moss_8step_00017_.png`），
 * 插件又把结果另存一份（`comfyui-….png`）—— 两张图 seed、像素尺寸、提示词完全一致，
 * 只有路径与文件名不同。
 *
 * 两条历史教训：
 *
 * 1. **提示词不能截断**。之前取前 160 字符，长提示词（模板 + 服装 + 场景，动辄上千字）
 *    前半段都一样，于是不同图撞成同一个 key。实测一条 160 字符的上限造出 124 个假簇，
 *    比"缺运行标识"这一条还狠。
 * 2. **这个 key 不足以判定重复** —— 同一个固定 seed 跑多次时，key 必然相同而图完全不同。
 *    所以它只用来**聚类**，簇内还要看 `promptId`（见 `dedupeItems`）。
 *
 * 刻意**不用内容哈希**：同图经不同编码/后处理后字节不同，哈希不同，反而漏合并。
 *
 * @param item - 列表项。
 */
export function looseKey(item: ListItem): string | undefined {
  if (typeof item.seed !== 'number') return undefined
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim() : ''
  if (prompt === '') return undefined
  return `${item.seed}|${item.width ?? 0}x${item.height ?? 0}|${prompt}`
}

function promptIdOf(item: ListItem): string | undefined {
  return typeof item.promptId === 'string' && item.promptId !== '' ? item.promptId : undefined
}

/**
 * 合并一组"确认是同一张图"的副本。
 *
 * 谁当主项：sidecar 优先（元数据更完整）→ 路径更短（更靠近输出根）→ 修改时间更新。
 */
function mergeGroup(members: ListItem[]): DedupedItem {
  const sorted = members.slice().sort((a, b) => {
    const bySource = (a.metaSource === 'sidecar' ? 0 : 1) - (b.metaSource === 'sidecar' ? 0 : 1)
    if (bySource !== 0) return bySource
    const byDepth = a.path.length - b.path.length
    if (byDepth !== 0) return byDepth
    return b.mtime - a.mtime
  })
  const first = sorted[0] as ListItem
  const primary: DedupedItem = { ...first }
  if (sorted.length > 1) {
    primary.duplicateCount = sorted.length
    primary.duplicates = sorted.slice(1, 21).map(other => other.path)
  }
  return primary
}

/**
 * 合并重复项：**同一次运行**的多份副本只输出一张，其余记进 `duplicates`。
 *
 * 判据是两段式，缺一不可：
 *
 * 1. 先按 `looseKey`（seed / 尺寸 / 完整提示词）聚类 —— 同一次运行的副本必然落进同一簇
 * 2. 簇内看 `promptId`：出现 **≥2 个不同 promptId** 就说明这是"同一个固定 seed 的多次运行"，
 *    必须按 promptId 再拆开；只有一个 promptId（或一个都没有）才整簇合并
 *
 * 为什么不能直接拿 `promptId` 当唯一判据：ComfyUI 自己存的那份是 PNG 内嵌块，
 * **没有** `comfy.promptId`，而插件另存的那份有。直接要求 promptId 会让这种跨来源副本
 * 永远合不上 —— 实测那占真实数据的 142 组，是主体而不是边缘情况。
 *
 * 为什么簇要拆时"无 promptId 的条目各自独立"：没法确认它属于哪一次运行，
 * 宁可在列表里多显示一张，也不要把它塞进别人的副本组里跟着一起消失。
 *
 * @param items - 已过滤的列表项（保持原有顺序）。
 */
export function dedupeItems(items: ListItem[]): DedupedItem[] {
  interface Bucket { key: string; members: ListItem[] }
  const buckets = new Map<string, Bucket>()
  const order: Array<{ kind: 'single'; item: ListItem } | { kind: 'bucket'; bucket: Bucket }> = []

  for (const item of items) {
    const key = looseKey(item)
    if (key === undefined) {
      order.push({ kind: 'single', item })
      continue
    }
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = { key, members: [] }
      buckets.set(key, bucket)
      order.push({ kind: 'bucket', bucket })
    }
    bucket.members.push(item)
  }

  const result: DedupedItem[] = []
  const emitted = new Set<string>()

  for (const entry of order) {
    if (entry.kind === 'single') {
      result.push(entry.item)
      continue
    }
    const { bucket } = entry
    const pids = new Set<string>()
    for (const member of bucket.members) {
      const pid = promptIdOf(member)
      if (pid !== undefined) pids.add(pid)
    }

    if (pids.size <= 1) {
      // 同一次运行（或全都缺 promptId）：整簇合并
      if (emitted.has(bucket.key)) continue
      emitted.add(bucket.key)
      result.push(mergeGroup(bucket.members))
      continue
    }

    // ≥2 个不同运行：按 promptId 拆开，无 promptId 的各自独立
    const byPid = new Map<string, ListItem[]>()
    for (const member of bucket.members) {
      const pid = promptIdOf(member)
      if (pid === undefined) continue
      const list = byPid.get(pid) ?? []
      list.push(member)
      byPid.set(pid, list)
    }
    for (const member of bucket.members) {
      const pid = promptIdOf(member)
      if (pid === undefined) {
        result.push(member)
        continue
      }
      if (emitted.has(pid)) continue
      emitted.add(pid)
      result.push(mergeGroup(byPid.get(pid) ?? [member]))
    }
  }
  return result
}
