/**
 * 服装库面板：搜索 + 分类筛选 + 看图 + 复制关键词 + 落盘给工作流用。
 *
 * 与姿势库同一套交互（搜索、可选收窄、滚到底自动加载），差别在卡片内容：
 * 服装没有角度，但**每条都带英文关键词**，所以卡片上给一行关键词并且能一键复制 ——
 * 那才是这套数据最有用的部分，比图还常用（写提示词时直接粘）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { costumeImageUrl, fetchCostumeFile, fetchCostumeStats, fetchCostumes } from '../../../client/api.js'
import type { CostumeItem, CostumeStats } from '../../../client/api.js'
import { addImageToConversation } from '../../../client/conversation.js'
import type { Translate } from '../../../client/i18n.js'
import { shouldAutoFill, shouldLoadMore } from '../../../client/scroll.js'

const PAGE = 40
const DEBOUNCE_MS = 250

export interface CostumesPanelProps {
  t: Translate
  visible: boolean
  goToConversation: () => void
}

export function CostumesPanel({ t, visible, goToConversation }: CostumesPanelProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  /** 只看常规（排除内衣/泳装/性感）。默认关 —— 内容筛选交给使用者。 */
  const [onlySafe, setOnlySafe] = useState(false)
  const [items, setItems] = useState<CostumeItem[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<CostumeStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 已落盘的图（编号 → 本机路径）。 */
  const [files, setFiles] = useState<Record<string, string>>({})
  /** 正在处理的编号。 */
  const [busy, setBusy] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  const itemsRef = useRef<CostumeItem[]>([])
  const scroller = useRef<HTMLDivElement | null>(null)
  const live = useRef({ loading: false, shown: 0, total: 0, busyAt: 0 })
  live.current.loading = loading
  live.current.shown = items.length
  live.current.total = total
  /** 上一次补页时的 `shown`。相同说明那次没拿到新数据，补页必须停手。 */
  const autoFill = useRef(-1)

  const load = useCallback(async (
    nextQuery: string,
    nextCategory: string,
    nextSafe: boolean,
    append = false,
  ): Promise<void> => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    if (!append) setError('')
    try {
      const result = await fetchCostumes({
        query: nextQuery,
        category: nextCategory,
        safe: nextSafe,
        offset: append ? itemsRef.current.length : 0,
        limit: PAGE,
      })
      if (seq.current !== mine) return
      const next = append ? [...itemsRef.current, ...result.items] : result.items
      itemsRef.current = next
      setItems(next)
      setTotal(result.total)
    } catch (err) {
      if (seq.current !== mine) return
      setError(err instanceof Error ? err.message : String(err))
      if (!append) {
        itemsRef.current = []
        setItems([])
        setTotal(0)
      }
    } finally {
      if (seq.current === mine) setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchCostumeStats()
      .then(value => {
        if (alive) setStats(value)
      })
      .catch(() => { /* 统计失败不影响列表 */ })
    void load('', '', false)
    return () => { alive = false }
  }, [visible, load])

  /** 条件变了：防抖后重查。先关掉在飞窗口并清空快照，否则滚动加载会拿旧 offset。 */
  const schedule = useCallback((next: { query?: string; category?: string; safe?: boolean }) => {
    if (timer.current !== null) clearTimeout(timer.current)
    seq.current += 1
    itemsRef.current = []
    autoFill.current = -1
    timer.current = setTimeout(() => {
      void load(next.query ?? query, next.category ?? category, next.safe ?? onlySafe)
    }, DEBOUNCE_MS)
  }, [load, query, category, onlySafe])

  /** 滚到底部自动加载（与标签库、姿势库同一套判定）。 */
  const onScroll = (): void => {
    const element = scroller.current
    if (element === null) return
    const state = live.current
    const now = Date.now()
    const go = shouldLoadMore({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      shown: state.shown,
      total: state.total,
      loading: state.loading,
      now,
      busyAt: state.busyAt,
    })
    if (!go) return
    state.busyAt = now
    void load(query, category, onlySafe, true)
  }

  /** 内容不足一屏时补一页（停手条件在 `shouldAutoFill` 里）。 */
  useEffect(() => {
    const element = scroller.current
    if (element === null) return
    const go = shouldAutoFill({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      shown: items.length,
      total,
      loading,
      lastFilledShown: autoFill.current,
    })
    if (!go) return
    autoFill.current = items.length
    void load(query, category, onlySafe, true)
  }, [items.length, total, loading])

  const copyKeywords = (item: CostumeItem): void => {
    void navigator.clipboard.writeText(item.keywords)
      .then(() => {
        setNotice(`${t('costumesCopied')} ${item.id}`)
        setError('')
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  const fetchFile = async (item: CostumeItem): Promise<void> => {
    setBusy(item.id)
    setError('')
    try {
      const { file } = await fetchCostumeFile(item.id, 'full')
      setFiles(prev => ({ ...prev, [item.id]: file }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  /** 塞进对话输入框：走代理地址取字节（面板没有本地路径）。 */
  const addToChat = async (item: CostumeItem): Promise<void> => {
    setBusy(item.id)
    setError('')
    try {
      const res = await fetch(costumeImageUrl(item.id, 'full'))
      if (!res.ok) throw new Error(`${t('costumesImageFail')}：HTTP ${res.status}`)
      const blob = await res.blob()
      await addImageToConversation(blob, `${item.id}.webp`, { goToConversation })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  if (!visible) return <div className="cct-root" />

  return (
    <div className="cct-root" ref={scroller} onScroll={onScroll}>
      <div className="cct-head">
        <div>
          <div className="cct-title">{t('costumesTitle')}</div>
          <div className="cct-sub">
            {stats === null
              ? t('costumesLoading')
              : t('costumesSub').replace('{total}', String(stats.total)).replace('{cats}', String(Object.keys(stats.categories).length))}
          </div>
        </div>
      </div>

      <div className="cct-search">
        <input
          className="cct-input"
          value={query}
          placeholder={t('costumesPlaceholder')}
          onChange={event => {
            const value = event.target.value
            setQuery(value)
            schedule({ query: value })
          }}
        />
        <select
          className="cct-select"
          value={category}
          onChange={event => {
            const value = event.target.value
            setCategory(value)
            schedule({ category: value })
          }}
        >
          <option value="">{t('costumesAllCategories')}</option>
          {Object.entries(stats?.categories ?? {}).map(([name, count]) => (
            <option key={name} value={name}>{`${name}（${count}）`}</option>
          ))}
        </select>
        <label className="cct-toggle">
          <input
            type="checkbox"
            checked={onlySafe}
            onChange={event => {
              const value = event.target.checked
              setOnlySafe(value)
              schedule({ safe: value })
            }}
          />
          {t('costumesOnlySafe')}
        </label>
      </div>

      {error !== '' && <div className="cct-note bad">{error}</div>}
      {notice !== '' && <div className="cct-note">{notice}</div>}
      {loading && items.length === 0 && <div className="cct-empty">{t('costumesLoading')}</div>}
      {!loading && items.length === 0 && error === '' && <div className="cct-empty">{t('costumesEmpty')}</div>}

      <div className="cct-grid">
        {items.map(item => {
          const file = files[item.id]
          return (
            <div className="cct-card" key={item.id}>
              <div className="cct-shot">
                <CostumeImage src={costumeImageUrl(item.id, 'thumb')} alt={item.name} fail={t('costumesImageFail')} />
              </div>
              <div className="cct-meta">
                <div className="cct-name" title={item.name}>
                  {item.adult && <span className="cct-badge">{t('costumesAdultBadge')}</span>}
                  {item.name}
                </div>
                <div className="cct-tagline">{`${item.id} · ${item.category}`}</div>
              </div>
              <div className="cct-keywords" title={item.keywords}>{item.keywords}</div>
              <div className="cct-actions">
                <button type="button" className="cct-btn" onClick={() => copyKeywords(item)}>
                  {t('costumesCopyKeywords')}
                </button>
                <button
                  type="button"
                  className="cct-btn"
                  disabled={busy === item.id}
                  onClick={() => { void addToChat(item) }}
                >
                  {t('costumesAddToChat')}
                </button>
                <button
                  type="button"
                  className="cct-btn"
                  disabled={busy === item.id}
                  onClick={() => { void fetchFile(item) }}
                >
                  {busy === item.id ? t('costumesFetching') : t('costumesFetch')}
                </button>
              </div>
              {file !== undefined && <div className="cct-note" title={file}>{`${t('costumesFetched')}：${file}`}</div>}
            </div>
          )
        })}
      </div>

      {items.length > 0 && items.length < total && (
        // 提示行同时是键盘可达的手动兜底（自动加载是主路径）。刻意不是按钮样式。
        <div
          className="cct-more-hint"
          role="button"
          tabIndex={0}
          onClick={() => { if (!loading) void load(query, category, onlySafe, true) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (!loading) void load(query, category, onlySafe, true)
          }}
        >
          {loading ? t('costumesLoadingMore') : t('costumesScrollMore').replace('{left}', String(total - items.length))}
        </div>
      )}

      <div className="cct-attr">
        {stats?.attribution ?? ''}
        {stats?.source !== undefined && stats.source !== '' && (
          <>
            {' '}
            <a href={stats.source} target="_blank" rel="noreferrer">{t('costumesSource')}</a>
          </>
        )}
      </div>
    </div>
  )
}

/** 单张图。加载失败时给一句话，而不是留一块空白。 */
function CostumeImage({ src, alt, fail }: { src: string; alt: string; fail: string }): React.ReactElement {
  const [bad, setBad] = useState(false)
  if (bad) return <div className="cct-shot-fail">{fail}</div>
  return <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />
}
