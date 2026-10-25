import { useCallback, useEffect, useRef, useState } from 'react'

import { apiJson } from '../../../../client/api.js'
import { planPage } from '../../../../client/format.js'
import type { GalleryItem, Notice, RootEntry } from '../../../../client/types.js'
import { PAGE } from '../../../../client/types.js'

export interface GalleryData {
  items: GalleryItem[]
  itemsRef: React.MutableRefObject<GalleryItem[]>
  total: number
  truncated: boolean
  loading: boolean
  loadingMore: boolean
  hasMore: boolean
  hasMoreRef: React.MutableRefObject<boolean>
  notice: Notice | null
  roots: RootEntry[]
  scrollRef: React.MutableRefObject<HTMLDivElement | null>
  sentinelRef: (node: HTMLDivElement | null) => void
  setNotice: (notice: Notice | null) => void
  /** 拉第一页（reset）或追加一页。 */
  reload: (reset: boolean) => void
  /** 本地移除若干条目并扣除总数（删除成功后调用，避免整表重拉）。 */
  dropItems: (paths: ReadonlySet<string>, totalDelta: number) => void
}

/**
 * 资产列表的数据层：分页、哨兵、根目录、轻提示。
 *
 * 抽成 hook 之后，Gallery 只剩"编排 UI 与动作"，不再掺着请求与 IntersectionObserver。
 *
 * @param options - 影响请求结果的筛选项；变化即重拉第一页。
 */
export function useGalleryData(options: {
  visible: boolean
  root: string
  query: string
  includeBare: boolean
  mergeDuplicates: boolean
}): GalleryData {
  const { visible, root, query, includeBare, mergeDuplicates } = options

  const [items, setItems] = useState<GalleryItem[]>([])
  const [total, setTotal] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [roots, setRoots] = useState<RootEntry[]>([])

  const itemsRef = useRef<GalleryItem[]>([])
  const hasMoreRef = useRef(false)
  const inFlightRef = useRef(false)
  const requestRef = useRef(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const loadRef = useRef<((reset: boolean) => void) | null>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  const load = useCallback(async (reset: boolean): Promise<void> => {
    // 追加请求同一时刻只允许一个在飞；筛选变化（reset）可以抢占旧的。
    if (!reset && inFlightRef.current) return
    const token = ++requestRef.current
    inFlightRef.current = true
    if (reset) setLoading(true)
    else setLoadingMore(true)

    try {
      // 偏移量取「已加载条数」而不是累加计数：删除一张后它会自然回退，不会跳过一条。
      const offset = reset ? 0 : itemsRef.current.length
      const params: Record<string, string> = {
        offset: String(offset),
        limit: String(PAGE),
        all: includeBare ? '1' : '0',
        dedupe: mergeDuplicates ? '1' : '0',
      }
      if (root !== 'all') params.root = root
      if (query.trim() !== '') params.q = query.trim()

      const data = await apiJson('/items', params)
      if (token !== requestRef.current) return

      const batch = Array.isArray(data.items) ? (data.items as GalleryItem[]) : []
      const totalValue = typeof data.total === 'number' ? data.total : 0
      const base = reset ? [] : itemsRef.current
      const planned = planPage(base, batch, offset, totalValue)

      itemsRef.current = planned.items
      setItems(planned.items)
      setTotal(totalValue)
      setTruncated(data.truncated === true)
      hasMoreRef.current = planned.more
      setHasMore(planned.more)
    } catch (error) {
      if (token === requestRef.current) {
        hasMoreRef.current = false
        setHasMore(false)
        setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
      }
    } finally {
      if (token === requestRef.current) {
        inFlightRef.current = false
        setLoading(false)
        setLoadingMore(false)
      }
    }
  }, [root, query, includeBare, mergeDuplicates])

  loadRef.current = load

  // 哨兵用 callback ref 接管 observer：元素出现/消失时自己挂、自己拆，
  // 不跟着 items.length 反复重建 —— 重建会立刻重新回调一次 isIntersecting，
  // 正是连续触发扫描的来源。
  const sentinelRef = useCallback((node: HTMLDivElement | null) => {
    if (observerRef.current !== null) {
      observerRef.current.disconnect()
      observerRef.current = null
    }
    if (node === null || typeof IntersectionObserver !== 'function') return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      if (inFlightRef.current || !hasMoreRef.current) return
      if (typeof loadRef.current === 'function') loadRef.current(false)
    }, { root: scrollRef.current, rootMargin: '180px' })
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    apiJson('/roots')
      .then(data => { if (alive) setRoots(Array.isArray(data.roots) ? (data.roots as RootEntry[]) : []) })
      .catch(() => { /* 根目录拉不到也能用「全部」继续 */ })
    return () => { alive = false }
  }, [visible])

  useEffect(() => {
    if (!visible) return undefined
    // 输入搜索词时给 240ms 防抖；切筛选立刻拉。
    const delay = query.trim() === '' ? 0 : 240
    const timer = setTimeout(() => { void load(true) }, delay)
    return () => clearTimeout(timer)
  }, [visible, root, includeBare, query, load])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 2800)
    return () => clearTimeout(timer)
  }, [notice])

  const dropItems = useCallback((paths: ReadonlySet<string>, totalDelta: number) => {
    const remaining = itemsRef.current.filter(entry => !paths.has(entry.path))
    itemsRef.current = remaining
    setItems(remaining)
    setTotal(value => Math.max(0, value - totalDelta))
    // 删掉一条后列表短了一格：还有更多就顺手补一条，避免底部出现空档。
    if (hasMoreRef.current && typeof loadRef.current === 'function') loadRef.current(false)
  }, [])

  return {
    items,
    itemsRef,
    total,
    truncated,
    loading,
    loadingMore,
    hasMore,
    hasMoreRef,
    notice,
    roots,
    scrollRef,
    sentinelRef,
    setNotice,
    reload: (reset: boolean) => { void load(reset) },
    dropItems,
  }
}
