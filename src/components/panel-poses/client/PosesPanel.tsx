/**
 * 姿势库面板：搜索 + 体系/分类筛选 + 按角度看线稿 + 落盘给工作流用。
 *
 * ## 它不是什么
 *
 * 不是「姿势工作室」—— 这里不选模型、不调生图 API、不攒配方。工作台已经有
 * `comfyui_run`，出图只能有一条路，否则 seed、运行记录、通知会各分叉一份。
 * 这个面板只解决一件事：**把人体线稿找出来、变成工作流能吃的输入图**。
 *
 * ## 图为什么走服务端
 *
 * 线稿在第三方图床（`ai-pose-gallery.anhao.app`），浏览器直接 `<img src>` 会：
 * 一是把用户的出口 IP 与 Referer 交给别人，二是绕过插件自己的缓存与失败冷却。
 * 所以统一走 `/poses/image`，由后端取一次、落盘缓存、再转发。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchPoseFile, fetchPoseStats, fetchPoses, poseImageUrl } from '../../../client/api.js'
import type { PoseHit, PoseStats } from '../../../client/api.js'
import { addImageToConversation } from '../../../client/conversation.js'
import type { Translate } from '../../../client/i18n.js'
import { shouldAutoFill, shouldLoadMore } from '../../../client/scroll.js'

/** 一页多少组。姿势总共 288 组，40 足够铺满一屏还有余。 */
const PAGE = 40
const DEBOUNCE_MS = 250

export interface PosesPanelProps {
  t: Translate
  visible: boolean
  goToConversation: () => void
}

export function PosesPanel({ t, visible, goToConversation }: PosesPanelProps): React.ReactElement {
  const [query, setQuery] = useState('')
  const [system, setSystem] = useState('')
  const [category, setCategory] = useState('')
  /** 只看常规（排除标了 adult 的组）。默认关 —— 内容筛选交给使用者自己。 */
  const [onlySafe, setOnlySafe] = useState(false)
  const [items, setItems] = useState<PoseHit[]>([])
  const [total, setTotal] = useState(0)
  const [stats, setStats] = useState<PoseStats | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  /** 每张卡片当前看的是哪个角度（视角 id）。 */
  const [angleOf, setAngleOf] = useState<Record<string, string>>({})
  /** 已经落盘的线稿（视角 id → 本机路径）。 */
  const [files, setFiles] = useState<Record<string, string>>({})
  /** 正在落盘的视角 id。 */
  const [busy, setBusy] = useState('')
  /** 输入防抖与竞态：只认最后一次请求。 */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)
  /** 列表的当前值（`load` 是 useCallback，闭包读不到实时 state）。 */
  const itemsRef = useRef<PoseHit[]>([])
  /** 滚动容器。 */
  const scroller = useRef<HTMLDivElement | null>(null)
  const live = useRef({ loading: false, shown: 0, total: 0, busyAt: 0 })
  live.current.loading = loading
  live.current.shown = items.length
  live.current.total = total
  /** 上一次补页时的 `shown`。相同说明那次没拿到新数据，补页必须停手。 */
  const autoFill = useRef(-1)

  /**
   * 拉一页。
   *
   * @param append - true 就接在已有列表后面（滚到底自动加载），false 整份替换（换条件时）。
   */
  const load = useCallback(async (
    nextQuery: string,
    nextSystem: string,
    nextCategory: string,
    nextSafe: boolean,
    append = false,
  ): Promise<void> => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    if (!append) setError('')
    try {
      const result = await fetchPoses({
        query: nextQuery,
        system: nextSystem,
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

  // 首次可见时拉统计与第一页
  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchPoseStats()
      .then(value => {
        if (alive) setStats(value)
      })
      .catch(() => { /* 统计失败不影响列表 */ })
    void load('', '', '', false)
    return () => { alive = false }
  }, [visible, load])

  /** 条件变了：防抖后重查。 */
  const schedule = useCallback((next: { query?: string; system?: string; category?: string; safe?: boolean }) => {
    if (timer.current !== null) clearTimeout(timer.current)
    // 与标签库的 `change()` 同理：先把 seq 推一格关掉"旧请求还在飞"的窗口，
    // 并清空列表快照 —— 否则防抖那 250ms 里滚到底会拿到"新条件 + 旧 offset"的中段结果。
    seq.current += 1
    itemsRef.current = []
    autoFill.current = -1
    timer.current = setTimeout(() => {
      void load(
        next.query ?? query,
        next.system ?? system,
        next.category ?? category,
        next.safe ?? onlySafe,
      )
    }, DEBOUNCE_MS)
  }, [load, query, system, category, onlySafe])

  const viewOf = (pose: PoseHit): string => angleOf[pose.id] ?? pose.cover.viewId

  /** 滚到底部自动加载下一页（与标签库同一套判定）。 */
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
    void load(query, system, category, onlySafe, true)
  }

  /**
   * 内容不足一屏时补一页。
   *
   * 滚动触发有个死胡同：`total` 还有几百组，但当前这页正好不满一屏 —— 容器没有可滚动
   * 的余量，就永远等不到 `onScroll`。
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
    void load(query, system, category, onlySafe, true)
  }, [items.length, total, loading])

  const angleButtons = (pose: PoseHit): React.ReactElement => {
    // 只列这组实际有的角度 —— 硬编码五个会有一组点下去 404（它只有 4 个）
    const current = viewOf(pose).split('_').pop() ?? ''
    return (
      <div className="cps-angles">
        {pose.angleIds.map(angle => (
          <button
            key={angle}
            type="button"
            className={angle === current ? 'cps-angle on' : 'cps-angle'}
            onClick={() => setAngleOf(prev => ({ ...prev, [pose.id]: `${pose.id}_${angle}` }))}
          >
            {angleLabel(t, angle)}
          </button>
        ))}
      </div>
    )
  }

  const fetchFile = async (pose: PoseHit): Promise<void> => {
    const viewId = viewOf(pose)
    setBusy(viewId)
    setError('')
    try {
      const { file } = await fetchPoseFile(viewId, 'full')
      setFiles(prev => ({ ...prev, [viewId]: file }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  /**
   * 把线稿塞进对话输入框。
   *
   * 走**代理地址取字节**而不是先落盘再读本地文件：姿势图在第三方图床上，面板手里没有
   * 本地路径（`/file` 那条路要的是上传目录里的文件）。浏览器取的是我们自己的代理端点，
   * 出口 IP 不会交给图床。
   */
  const addToChat = async (pose: PoseHit): Promise<void> => {
    const viewId = viewOf(pose)
    setBusy(viewId)
    setError('')
    try {
      const res = await fetch(poseImageUrl(viewId, 'full'))
      if (!res.ok) throw new Error(`线稿取不到：HTTP ${res.status}`)
      const blob = await res.blob()
      const angle = viewId.split('_').pop() ?? 'front'
      await addImageToConversation(blob, `${pose.id}_${angle}.png`, { goToConversation })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  // 页签不可见时只保留外壳：better-sidebar 的非活动页签是 display:none 保留挂载，
  // 留着完整列表会让补页判定在隐藏状态下继续工作（clientHeight 为 0 那关也拦得住，
  // 但少渲染一份 DOM 更省）。
  if (!visible) return <div className="cps-root" />

  return (
    <div className="cps-root" ref={scroller} onScroll={onScroll}>
      <div className="cps-head">
        <div>
          <div className="cps-title">{t('posesTitle')}</div>
          <div className="cps-sub">
            {stats === null
              ? t('posesLoading')
              : t('posesSub')
                .replace('{poses}', String(stats.poseCount))
                .replace('{views}', String(stats.viewCount))}
          </div>
        </div>
      </div>

      <div className="cps-search">
        <input
          className="cps-input"
          value={query}
          placeholder={t('posesPlaceholder')}
          onChange={event => {
            const value = event.target.value
            setQuery(value)
            schedule({ query: value })
          }}
        />
        <select
          className="cps-select"
          value={system}
          onChange={event => {
            const value = event.target.value
            setSystem(value)
            schedule({ system: value })
          }}
        >
          <option value="">{t('posesAllSystems')}</option>
          {(stats?.systems ?? []).map(item => (
            <option key={item.id} value={item.id}>{`${item.name}（${item.poseCount}）`}</option>
          ))}
        </select>
        <select
          className="cps-select"
          value={category}
          onChange={event => {
            const value = event.target.value
            setCategory(value)
            schedule({ category: value })
          }}
        >
          <option value="">{t('posesAllCategories')}</option>
          {Object.keys(stats?.categories ?? {}).map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <label className="cps-toggle">
          <input
            type="checkbox"
            checked={onlySafe}
            onChange={event => {
              const value = event.target.checked
              setOnlySafe(value)
              schedule({ safe: value })
            }}
          />
          {t('posesOnlySafe')}
        </label>
      </div>

      {error !== '' && <div className="cps-note bad">{error}</div>}
      {loading && items.length === 0 && <div className="cps-empty">{t('posesLoading')}</div>}
      {!loading && items.length === 0 && error === '' && (
        <div className="cps-empty">{t('posesEmpty')}</div>
      )}

      <div className="cps-grid">
        {items.map(pose => {
          const viewId = viewOf(pose)
          const file = files[viewId]
          return (
            <div className="cps-card" key={pose.id}>
              <div className="cps-shot">
                <PoseImage src={poseImageUrl(viewId, 'thumb')} alt={pose.name} fail={t('posesImageFail')} />
                {angleButtons(pose)}
              </div>
              <div className="cps-meta">
                <div className="cps-name" title={pose.name}>
                  {pose.adult && <span className="cps-badge">{t('posesAdultBadge')}</span>}
                  {pose.name}
                </div>
                <div className="cps-tagline">{`${pose.code} · ${pose.category} · ${pose.viewCount} 角度`}</div>
              </div>
              <div className="cps-actions">
                <button
                  type="button"
                  className="cps-btn"
                  disabled={busy === viewId}
                  onClick={() => { void addToChat(pose) }}
                >
                  {t('posesAddToChat')}
                </button>
                <button
                  type="button"
                  className="cps-btn"
                  disabled={busy === viewId}
                  onClick={() => { void fetchFile(pose) }}
                >
                  {busy === viewId ? t('posesFetching') : t('posesFetch')}
                </button>
              </div>
              {file !== undefined && <div className="cps-note" title={file}>{`${t('posesFetched')}：${file}`}</div>}
            </div>
          )
        })}
      </div>

      {items.length < total && (
        // 提示行同时是键盘可达的手动兜底：自动加载是主路径，但不该让只能按 Tab/回车的人
        // 一直等。刻意不做成按钮样式 —— 用户明确说过不要那个"再看"按钮。
        <div
          className="cps-more-hint"
          role="button"
          tabIndex={0}
          onClick={() => { if (!loading) void load(query, system, category, onlySafe, true) }}
          onKeyDown={event => {
            if (event.key !== 'Enter' && event.key !== ' ') return
            event.preventDefault()
            if (!loading) void load(query, system, category, onlySafe, true)
          }}
        >
          {loading ? t('posesLoadingMore') : t('posesScrollMore').replace('{left}', String(total - items.length))}
        </div>
      )}

      <div className="cps-attr">
        {stats?.attribution ?? ''}
        {stats?.source !== undefined && stats.source !== '' && (
          <>
            {' '}
            <a href={stats.source} target="_blank" rel="noreferrer">{t('posesSource')}</a>
          </>
        )}
      </div>
    </div>
  )
}

/** 单张图。加载失败时给一句话，而不是留一块空白。 */
function PoseImage({ src, alt, fail }: { src: string; alt: string; fail: string }): React.ReactElement {
  const [bad, setBad] = useState(false)
  if (bad) return <div className="cps-shot-fail">{fail}</div>
  return <img src={src} alt={alt} loading="lazy" onError={() => setBad(true)} />
}

/** 角度 id → 中文/英文名。 */
function angleLabel(t: Translate, angle: string): string {
  const key = `posesAngle_${angle}`
  return t(key)
}
