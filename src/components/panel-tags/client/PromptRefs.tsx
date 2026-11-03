/**
 * ⚠️ **已停用（代码保留，等后续方案）**
 *
 * 「提示词参考」子面板（Danbooru posts 版，带图）。
 *
 * 停用原因：用户判断「工具太重了」—— 参考面板要维护第二个数据源（外部站点的可用性、
 * UA/防盗链、图片代理、限流与重试），而它只是「看别人怎么写 tag」的辅助功能。
 * UI 上的「提示词参考」子页签已摘掉（见 TagsPanel.tsx），这套代码完整保留、不要删：
 * 等后续调查或想到更轻的方案时可以直接接回来。
 *
 * 要恢复：在 TagsPanel 里把子页签加回来（看本文件与 PromptRefs.tsx 的 git 历史），
 * 路由 /tags/refs 与 /tags/prompts 都还在。
 */
/**
 * 「提示词参考」子面板：看真实作品怎么用 tag。
 *
 * 数据是 **Danbooru 的 posts**，实时取、**不落盘**：一次请求同时给缩略图与完整 tag 串
 * （还按 general/character/copyright/artist 分好类），搜索由服务端做。
 *
 * 之前那版用的是纯文本数据集 + 本地池：没有图（用户要的就是带图）、要建池（2 万条
 * 200 次请求，HF 一路 429）、而且建池失败会把原池写坏。换成 posts 之后这三个问题
 * 一起消失了 —— 没有池子，就没有"建池"这件事。
 */
import { useEffect, useRef, useState } from 'react'

import { API, fetchPostRefs } from '../../../client/api.js'
import type { PostRef } from '../../../client/api.js'
import type { Translate } from '../../../client/i18n.js'

const DEBOUNCE_MS = 300
const LIMIT = 12

export interface PromptRefsProps {
  t: Translate
  visible: boolean
}

export function PromptRefs({ t, visible }: PromptRefsProps): React.ReactElement {
  const [mode, setMode] = useState<'random' | 'search'>('random')
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<PostRef[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /** 是否放开分级过滤（默认只看 general）。 */
  const [anyRating, setAnyRating] = useState(false)
  const seq = useRef(0)

  /** 拉一批。随机模式每次换一批，搜索模式跟着输入走。 */
  const load = (nextMode: 'random' | 'search', nextQuery: string): void => {
    const mine = seq.current + 1
    seq.current = mine
    setLoading(true)
    void fetchPostRefs({
      query: nextMode === 'search' ? nextQuery : '',
      limit: LIMIT,
      rating: anyRating ? 'all' : 'general',
    })
      .then(result => {
        if (seq.current !== mine) return
        setItems(result)
        setError('')
      })
      .catch(reason => {
        if (seq.current !== mine) return
        setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => { if (seq.current === mine) setLoading(false) })
  }

  useEffect(() => {
    if (!visible) return undefined
    if (mode === 'random') { load('random', ''); return undefined }
    const timer = setTimeout(() => { load('search', query) }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
    // 只在这两个变化时重拉；`load` 每次渲染都是新函数，放进依赖会无限重挂
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, mode, query, anyRating])

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

  if (!visible) return <div className="ctg-refs" />

  return (
    <div className="ctg-refs">
      <div className="ctg-refs-bar">
        <div className="ctg-seg" role="tablist" aria-label={t('refsTabRefs')}>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'random'}
            className={`ctg-seg-item${mode === 'random' ? ' on' : ''}`}
            onClick={() => setMode('random')}
          >
            {t('refsRandom')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'search'}
            className={`ctg-seg-item${mode === 'search' ? ' on' : ''}`}
            onClick={() => setMode('search')}
          >
            {t('refsSearch')}
          </button>
        </div>
        <label className="ctg-anyrating" title={t('refsAnyRatingHint')}>
          <input type="checkbox" checked={anyRating} onChange={event => setAnyRating(event.target.checked)} />
          <span>{t('refsAnyRating')}</span>
        </label>
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

      {error !== '' ? <div className="ctg-error">{error}</div> : null}
      {notice !== '' ? <div className="ctg-notice">{notice}</div> : null}

      <div className="ctg-refs-grid">
        {items.map(item => (
          <article key={item.id} className="ctg-ref">
            <a href={item.largeUrl} target="_blank" rel="noreferrer noopener" className="ctg-ref-thumb">
              <img src={`${API}/tags/refs/image?u=${encodeURIComponent(item.previewUrl)}`} alt="" loading="lazy" />
            </a>
            <p className="ctg-ref-prompt" title={item.prompt}>{item.prompt}</p>
            <div className="ctg-ref-actions">
              <span className="ctg-hot">#{item.id}</span>
              <button type="button" className="ctg-copy" title={t('refsCopy')} onClick={() => copy(item.prompt)}>
                {t('refsCopy')}
              </button>
            </div>
          </article>
        ))}
        {items.length === 0 && !loading ? (
          <div className="ctg-empty">{t('refsEmpty')}</div>
        ) : null}
      </div>
    </div>
  )
}
