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
import type { Translate } from '../../../client/i18n.js'

/** 一页多少组。姿势总共 288 组，40 足够铺满一屏还有余。 */
const PAGE = 40
const DEBOUNCE_MS = 250

export interface PosesPanelProps {
  t: Translate
  visible: boolean
}

export function PosesPanel({ t, visible }: PosesPanelProps): React.ReactElement {
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

  const load = useCallback(async (
    nextQuery: string,
    nextSystem: string,
    nextCategory: string,
    nextSafe: boolean,
  ): Promise<void> => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    setError('')
    try {
      const result = await fetchPoses({
        query: nextQuery,
        system: nextSystem,
        category: nextCategory,
        safe: nextSafe,
        limit: PAGE,
      })
      if (seq.current !== mine) return
      setItems(result.items)
      setTotal(result.total)
    } catch (err) {
      if (seq.current !== mine) return
      setError(err instanceof Error ? err.message : String(err))
      setItems([])
      setTotal(0)
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

  return (
    <div className="cps-root">
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

      {total > items.length && (
        <div className="cps-note">
          {t('posesMore').replace('{left}', String(total - items.length))}
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
