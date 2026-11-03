/**
 * 「参考」子面板：从真实用户写的 prompt 里翻灵感。
 *
 * 两个模式：
 * - **随机**：走 HF 任意 offset 抽样，不依赖本地池 —— 第一次打开就能用，这是主路径。
 * - **搜索**：在本地池（默认 2 万条）里按关键词过滤。池子要建，约一分钟。
 *
 * 只读 + 复制。不做编辑、不做"应用到我这份工作流"（那需要和草稿状态耦合，
 * 与本面板"翻素材"的定位不相称）。
 */
import { useEffect, useRef, useState } from 'react'

import { fetchPoolSync, fetchPromptRefs, startPoolSync } from '../../../client/api.js'
import type { PromptHit, PoolSyncState, PromptPoolInfo } from '../../../client/api.js'
import type { Translate } from '../../../client/i18n.js'

const DEBOUNCE_MS = 250
const LIMIT = 10

export interface PromptRefsProps {
  t: Translate
  visible: boolean
}

export function PromptRefs({ t, visible }: PromptRefsProps): React.ReactElement {
  const [mode, setMode] = useState<'random' | 'search'>('random')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PromptHit[]>([])
  const [pool, setPool] = useState<PromptPoolInfo>({ size: 0, builtAt: 0 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [job, setJob] = useState<PoolSyncState | null>(null)
  const seq = useRef(0)

  /** 拉一批。随机模式每次都是新的一批，搜索模式跟着输入走。 */
  const load = (nextMode: 'random' | 'search', nextQuery: string): void => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    void fetchPromptRefs({ mode: nextMode, query: nextQuery, limit: LIMIT })
      .then(result => {
        if (seq.current !== mine) return
        setItems(result.items)
        setPool(result.pool)
        setError('')
      })
      .catch(reason => {
        if (seq.current !== mine) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { if (seq.current === mine) setLoading(false) })
  }

  // 进面板先给一批随机的；切到搜索后跟着输入防抖
  useEffect(() => {
    if (!visible) return undefined
    if (mode === 'random') { load('random', ''); return undefined }
    const timer = setTimeout(() => { load('search', query) }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // 只在模式与输入变化时重拉
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, query])

  // 建池任务在跑 → 每秒问一次
  useEffect(() => {
    if (!visible || job?.state !== 'running') return undefined
    const timer = setInterval(() => {
      void fetchPoolSync()
        .then(next => {
          setJob(next)
          if (next.state !== 'running') load('search', query)
        })
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    }, 1000)
    return () => clearInterval(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, job?.state, query])

  const copy = (text: string): void => {
    try {
      void navigator.clipboard.writeText(text)
        .then(() => { setNotice(t('refsCopied')); setError('') })
        .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
    } catch {
      // 非安全上下文下 clipboard 是 undefined，同步抛 TypeError —— catch 接不到 Promise
      setError(t('refsCopyFailed'))
    }
  }

  const build = (): void => {
    setError('')
    setNotice('')
    void startPoolSync()
      .then(setJob)
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  if (!visible) return <div className="ctg-refs" />

  return (
    <div className="ctg-refs">
      <div className="ctg-refs-bar">
        <div className="ctg-seg">
          <button type="button" className={`ctg-seg-item${mode === 'random' ? ' on' : ''}`} onClick={() => setMode('random')}>
            {t('refsRandom')}
          </button>
          <button type="button" className={`ctg-seg-item${mode === 'search' ? ' on' : ''}`} onClick={() => setMode('search')}>
            {t('refsSearch')}
          </button>
        </div>
        {mode === 'random' ? (
          <button type="button" className="ctg-sync" disabled={loading} onClick={() => load('random', '')}>
            {t('refsAnother')}
          </button>
        ) : null}
      </div>

      {mode === 'search' ? (
        <div className="ctg-search">
          <input
            className="ctg-input"
            type="search"
            value={query}
            aria-label={t('refsSearch')}
            placeholder={t('refsPlaceholder')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
      ) : null}

      <div className="ctg-refs-pool">
        {pool.size === 0
          ? t('refsPoolEmpty')
          : t('refsPoolSize').replace('{n}', String(pool.size))}
        <button type="button" className="ctg-sync" disabled={job?.state === 'running'} onClick={build}>
          {job?.state === 'running' ? t('refsBuilding') : pool.size === 0 ? t('refsBuild') : t('refsRebuild')}
        </button>
      </div>

      {job !== null && job.state !== 'idle' ? (
        <div className={`ctg-syncbar${job.state === 'failed' ? ' bad' : ''}`}>
          {job.state === 'running'
            ? job.stage
            : job.state === 'done'
              ? t('refsPoolDone').replace('{n}', String(job.size))
              : t('refsPoolFailed').replace('{message}', job.message)}
        </div>
      ) : null}

      {error !== '' ? <div className="ctg-error">{error}</div> : null}
      {notice !== '' ? <div className="ctg-notice">{notice}</div> : null}

      <div className="ctg-list">
        {items.map(item => (
          <article key={`${item.source}:${item.text.slice(0, 24)}`} className="ctg-ref">
            <p className="ctg-ref-text">{item.text}</p>
            <div className="ctg-ref-actions">
              <span className="ctg-hot">#{item.source}</span>
              <button type="button" className="ctg-copy" title={t('refsCopy')} onClick={() => copy(item.text)}>
                {t('refsCopy')}
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 && !loading ? (
          <div className="ctg-empty">
            {mode === 'search' && pool.size === 0 ? t('refsNeedPool') : t('refsEmpty')}
          </div>
        ) : null}
      </div>
    </div>
  )
}
