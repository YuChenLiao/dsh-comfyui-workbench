import type { ListItem } from '../scan/index.js'

/** 合并后仍在列表项上的附加信息。 */
export interface DedupedItem extends ListItem {
  duplicateCount?: number
  duplicates?: string[]
}

/**
 * 同一张图的副本签名。
 *
 * 典型场景：跑一次 ComfyUI，ComfyUI 自己存了一份（`moss_8step_00017_.png`），
 * 插件又把结果另存一份（`comfyui-….png`）。两张图 seed、像素尺寸、提示词完全一致，
 * 只有路径与文件名不同。没有 seed 的图不参与合并 —— 宁多勿错。
 *
 * 刻意**不用内容哈希**：同图经不同编码/后处理后字节不同，哈希不同，反而漏合并。
 * 内容哈希只用于"物理同一文件"的判重（见索引层的 digest）。
 *
 * @param item - 列表项。
 */
export function duplicateKey(item: ListItem): string | undefined {
  if (typeof item.seed !== 'number') return undefined
  const prompt = typeof item.prompt === 'string' ? item.prompt.trim().slice(0, 160) : ''
  if (prompt === '') return undefined
  return `${item.seed}|${item.width ?? 0}x${item.height ?? 0}|${prompt}`
}

/**
 * 合并重复项：每组只输出一张，其余记进 `duplicates`。
 *
 * 谁当主项：sidecar 优先（元数据更完整）→ 路径更短（更靠近输出根）→ 修改时间更新。
 *
 * @param items - 已过滤的列表项（保持原有顺序）。
 */
export function dedupeItems(items: ListItem[]): DedupedItem[] {
  interface Group {
    items: ListItem[]
  }
  const groups = new Map<string, Group>()
  const order: Array<{ item: ListItem; group: Group | undefined }> = []

  for (const item of items) {
    const key = duplicateKey(item)
    if (key === undefined) {
      order.push({ item, group: undefined })
      continue
    }
    let group = groups.get(key)
    if (group === undefined) {
      group = { items: [] }
      groups.set(key, group)
      order.push({ item, group })
    }
    group.items.push(item)
  }

  const emitted = new Set<Group>()
  const result: DedupedItem[] = []
  for (const entry of order) {
    if (entry.group === undefined) {
      result.push(entry.item)
      continue
    }
    if (emitted.has(entry.group)) continue
    emitted.add(entry.group)

    const sorted = entry.group.items.slice().sort((a, b) => {
      const bySource = (a.metaSource === 'sidecar' ? 0 : 1) - (b.metaSource === 'sidecar' ? 0 : 1)
      if (bySource !== 0) return bySource
      const byDepth = a.path.length - b.path.length
      if (byDepth !== 0) return byDepth
      return b.mtime - a.mtime
    })
    const first = sorted[0]
    if (first === undefined) continue
    const primary: DedupedItem = { ...first }
    if (sorted.length > 1) {
      primary.duplicateCount = sorted.length
      primary.duplicates = sorted.slice(1, 21).map(other => other.path)
    }
    result.push(primary)
  }
  return result
}
