/**
 * 标签面板：搜索 + 大类筛选 + 一键复制 tag。
 *
 * 数据来自 `/tags`（搜索）与 `/tags/stats`（计数）。分类只覆盖 `general` 的
 * 27% 左右，所以**不把大类当成唯一入口** —— 搜索框是主路径，大类只是快捷筛，
 * 每个按钮旁边都标着实到条数，用户查不到时能看出是"分类没覆盖"而不是"功能坏了"。
 *
 * 只读 + 复制。不做草稿状态（那会长成一个编辑器，与本面板的定位打架）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchTags, fetchTagStats, fetchTagSync, startTagSync } from '../../../client/api.js'
import type { TagHit, TagStats, TagSyncState } from '../../../client/api.js'
import type { Translate } from '../../../client/i18n.js'
import { shouldAutoFill, shouldLoadMore } from '../../../client/scroll.js'

/** 一页多少条。 */
const PAGE = 50
/** 输入停顿多久才发请求。 */
const DEBOUNCE_MS = 250
/** 大类按钮的显示顺序（`other` 最后）。 */
const CATEGORY_ORDER = ['action', 'clothing', 'appearance', 'composition', 'object', 'theme', 'explicit', 'other']
/** 四类的显示顺序与中文名。 */
const KIND_LABEL: Record<string, string> = {
  character: '角色',
  artist: '画师',
  copyright: '作品',
  general: '通用',
}

export interface TagsPanelProps {
  t: Translate
  visible: boolean
}

export function TagsPanel({ t, visible }: TagsPanelProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState('')
  const [category, setCategory] = useState('')
  const [items, setItems] = useState<TagHit[]>([])
  /**
   * 列表的当前值（给 `load` 读）。
   *
   * `load` 是 `useCallback(..., [])`，闭包捕获的是**首次渲染**的 `items`——直接读它
   * 会永远是空数组：`offset` 恒为 0，追加时 `[...items]` 也是空的，于是点「再看 N 条」
   * 等于又取第一页再覆盖第一页，表现为"点了没反应"。用 ref 拿实时值。
   */
  const itemsRef = useRef<TagHit[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<TagStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 「更新标签」的后台任务状态（`null` 表示还没问过）。 */
  const [sync, setSync] = useState<TagSyncState | null>(null)
  /** 防抖与竞态：只认最后一次请求的结果。 */
  const seq = useRef(0)

  /**
   * 拉一次。
   *
   * **按 offset 增量取，不是把 limit 越加越大**：服务端有 `MAX_LIMIT = 100` 的硬顶，
   * 用 `limit = PAGE * 页数` 的话第三页就被夹回去，"再看 N 条"从此点了没反应、
   * 而"还有 99272 条"永远挂着。
   *
   * @param append - 真就接在已有列表后面；假就整份替换（换条件时用）。
   * @param take - 这次要取多少条。
   */
  const load = useCallback(async (
    nextQuery: string,
    nextKind: string,
    nextCategory: string,
    append: boolean,
    take: number,
  ): Promise<void> => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    try {
      const result = await fetchTags({
        query: nextQuery,
        kind: nextKind,
        category: nextCategory,
        // 读 ref 而不是闭包里的 `items`：前者是实时的，后者永远是首次渲染那个空数组
        offset: append ? itemsRef.current.length : 0,
        limit: take,
      })
      // 期间又改了条件：这份结果已经过期，丢掉
      if (seq.current !== mine) return
      // 用函数式更新：即使中途有别的写入，也不会把已加载的那几页冲掉
      setItems(prev => {
        const next = append ? [...prev, ...result.items] : result.items
        itemsRef.current = next
        return next
      })
      setTotal(result.total)
      setError('')
    } catch (reason) {
      if (seq.current !== mine) return
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (seq.current === mine) setLoading(false)
    }
  }, [])

  // 首屏拿统计（四类与大类的计数）
  useEffect(() => {
    if (!visible) return
    let alive = true
    fetchTagStats()
      .then(value => { if (alive) setStats(value) })
      .catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : String(reason)) })
    return () => { alive = false }
  }, [visible])

  // 条件变化 → 防抖后整份重查
  useEffect(() => {
    if (!visible) return undefined
    const timer = setTimeout(() => { void load(query, kind, category, false, PAGE) }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [visible, query, kind, category, load])

  // 更新任务在跑 → 每秒问一次进度；跑完刷新统计与列表
  useEffect(() => {
    if (!visible || sync?.state !== 'running') return undefined
    const timer = setInterval(() => {
      void fetchTagSync()
        .then(next => {
          setSync(next)
          if (next.state !== 'running') {
            // 数据换了：统计要重取，列表要重查
            void fetchTagStats().then(setStats).catch(() => { /* 下次进面板再试 */ })
            seq.current += 1
            void load(query, kind, category, false, PAGE)
          }
        })
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    }, 1000)
    return () => clearInterval(timer)
  }, [visible, sync?.state, query, kind, category, load])

  /** 点「更新标签」：开跑，然后交给上面的轮询。 */
  const beginSync = (): void => {
    setError('')
    setNotice('')
    void startTagSync()
      .then(setSync)
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  /**
   * 换条件。
   *
   * 先把 `seq` 推一格关掉"旧请求还在飞"的窗口 —— 否则防抖触发前的 250ms 里，
   * 上一个条件的响应回来时序号仍匹配，旧结果会先上屏再被替换（闪一下）。
   */
  const change = (apply: () => void): void => {
    seq.current += 1
    // 列表也一并清掉：防抖那 250ms 里旧列表还在屏上、滚动还能触发 `more()`，
    // 那时的 offset 会拿旧列表长度去算，把新条件的中段拼到旧结果后面。
    // 只清 `itemsRef` 不清 state 时，屏上仍会短暂出现"旧行 + 新条件第 1 页"。
    itemsRef.current = []
    setItems([])
    setNotice('')
    // 补页的"有没有进展"判断跟着新条件重来
    autoFill.current = -1
    apply()
  }

  /** 再看一页：接在已有列表后面（offset 由 `itemsRef` 提供）。 */
  const more = (): void => {
    void load(query, kind, category, true, PAGE)
  }

  /** 滚动容器（`.ctg-root` 自己是 overflow:auto）。 */
  const scroller = useRef<HTMLDivElement | null>(null)
  /**
   * 触底自动加载要读的三个实时值。
   *
   * `onScroll` 是原生事件，闭包捕获的是**绑定时**的 state —— 直接读 `loading` / `total`
   * 会永远是初始值，表现为"滚到底一直在重复请求第一页"。用 ref 存实时值。
   */
  const live = useRef({ loading: false, shown: 0, total: 0, busyAt: 0 })
  live.current.loading = loading
  live.current.shown = items.length
  live.current.total = total
  /** 上一次补页时的 `shown`。相同说明那次没拿到新数据，补页必须停手。 */
  const autoFill = useRef(-1)

  /**
   * 触到底部就加载下一页。
   *
   * 判定交给 `shouldLoadMore`（纯函数，有表驱动测试）：这里只负责把 DOM 尺寸与实时状态喂进去。
   */
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
    more()
  }

  /**
   * 内容不足一屏时补一页。
   *
   * 滚动触发有个死胡同：`total` 还有几万条，但当前这页正好不满一屏 —— 容器没有可滚动
   * 的余量，就永远等不到 `onScroll`，用户看着「还有 N 条」却怎么滚都不动。
   *
   * **停手条件必须写在判定里**：这个 effect 没有用户动作做节流，而 `load` 每轮都会翻转
   * `loading`（依赖之一），失败的 append 又不动 `shown`。少了"没进展就不补"这条，
   * 一个失败请求就能让它无间隔空转。
   */
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
    more()
  }, [items.length, total, loading])

  const copy = (tag: string): void => {
    void navigator.clipboard.writeText(tag)
      .then(() => {
        setNotice(`已复制 ${tag}`)
        setError('')
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  if (!visible) return <div className="ctg-root" />

  const categoryCount = stats?.categories ?? {}
  const labels = stats?.labels ?? {}

  return (
    <div className="ctg-root" ref={scroller} onScroll={onScroll}>
      <header className="ctg-head">
        <div>
          <div className="ctg-title">{t('tagsTitle')}</div>
          <div className="ctg-sub">
            {stats === null
              ? t('tagsLoading')
              : t('tagsSub').replace('{total}', String(stats.total)).replace('{shown}', String(total))}
          </div>
        </div>
        <div className="ctg-head-actions">
          <button
            type="button"
            className="ctg-sync"
            disabled={sync?.state === 'running'}
            title={t('tagsSyncHint')}
            onClick={beginSync}
          >
            {sync?.state === 'running' ? t('tagsSyncRunning') : t('tagsSync')}
          </button>
        </div>
      </header>

      {<>

      {sync !== null && sync.state !== 'idle' ? (
        <div className={`ctg-syncbar${sync.state === 'failed' ? ' bad' : ''}`}>
          {sync.state === 'running'
            ? `${sync.stage}${sync.total > 0 ? `（${sync.done}/${sync.total}）` : ''}`
            : sync.state === 'done'
              ? t('tagsSyncDone')
                .replace('{kinds}', sync.results.map(item => `${item.kind} ${item.records}`).join(' / '))
                .replace('{groups}', String(sync.groups?.groups ?? 0))
                .replace('{tags}', String(sync.groups?.tags ?? 0))
              : t('tagsSyncFailed').replace('{message}', sync.message)
                + (sync.results.length === 0 ? '' : `（已完成：${sync.results.map(item => item.kind).join(' / ')}）`)}
        </div>
      ) : null}

      <div className="ctg-search">
        <input
          className="ctg-input"
          type="search"
          value={query}
          placeholder={t('tagsPlaceholder')}
          onChange={event => change(() => setQuery(event.target.value))}
        />
        <select className="ctg-select" value={kind} onChange={event => change(() => setKind(event.target.value))}>
          <option value="">{t('tagsAllKinds')}</option>
          {Object.entries(KIND_LABEL).map(([value, label]) => (
            <option key={value} value={value}>
              {label}{stats === null ? '' : `（${stats.kinds[value] ?? 0}）`}
            </option>
          ))}
        </select>
      </div>

      <div className="ctg-chips">
        <button
          type="button"
          className={`ctg-chip${category === '' ? ' on' : ''}`}
          onClick={() => change(() => setCategory(''))}
        >
          {t('tagsAllCategories')}
        </button>
        {CATEGORY_ORDER.map(key => (
          <button
            key={key}
            type="button"
            className={`ctg-chip${category === key ? ' on' : ''}`}
            title={t('tagsCategoryHint')}
            onClick={() => change(() => setCategory(key))}
          >
            {labels[key] ?? key}
            <span className="ctg-count">{categoryCount[key] ?? 0}</span>
          </button>
        ))}
      </div>

      {error !== '' ? <div className="ctg-error">{error}</div> : null}
      {notice !== '' ? <div className="ctg-notice">{notice}</div> : null}

      <div className="ctg-list">
        {items.map(item => (
          <article key={`${item.kind}:${item.tag}`} className="ctg-row">
            <div className="ctg-row-main">
              <code className="ctg-tag">{item.tag}</code>
              {item.zh === '' ? null : <span className="ctg-zh">{item.zh}</span>}
            </div>
            <div className="ctg-row-meta">
              <span className="ctg-badge">{KIND_LABEL[item.kind] ?? item.kind}</span>
              {item.category === 'other' ? null : <span className="ctg-badge">{labels[item.category] ?? item.category}</span>}
              <span className="ctg-hot">{item.postCount.toLocaleString()}</span>
              {item.aliases.length === 0 ? null : <span className="ctg-alias">{item.aliases.join(' / ')}</span>}
            </div>
            <button type="button" className="ctg-copy" title={t('tagsCopy')} onClick={() => copy(item.tag)}>
              {t('tagsCopy')}
            </button>
          </article>
        ))}
        {/*
          空态与"还有 N 条"都要带 `total === 0` / `items.length > 0` 这两个前提。
          仅凭 `items.length === 0` 判断会在换条件那一刻闪出"没有匹配的标签"——
          那时 `change()` 刚把列表清空，而 `loading` 还没被置起来（防抖 250ms 里），
          `total` 仍是上一个条件的几万条，于是空态与"继续往下滚还有 99372 条"会同屏。
        */}
        {items.length === 0 && !loading && total === 0 ? (
          <div className="ctg-empty">{t('tagsEmpty')}</div>
        ) : null}
      </div>

      {items.length > 0 && items.length < total ? (
        // 提示行同时是键盘可达的手动兜底：自动加载是主路径，但不该让只能按 Tab/回车的人
        // 一直等。刻意不做成按钮样式 —— 用户明确说过不要那个"再看"按钮。
        <div
          className="ctg-more-hint"
          role="button"
          tabIndex={0}
          onClick={() => { if (!loading) more() }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (!loading) more()
          }}
        >
          {loading
            ? t('tagsLoadingMore')
            : t('tagsScrollMore').replace('{left}', String(total - items.length))}
        </div>
      ) : null}
      </>}
    </div>
  )
}
