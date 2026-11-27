/**
 * 双图对比：并排 / 拉杆两种看法，侧栏列出参数差异。
 *
 * 并排适合看构图与色彩；拉杆适合看"同一张构图里到底改了哪里" ——
 * 用 `clip-path` 切左图，拖动滑块就是在两张之间划一条线。
 *
 * 参数部分只高亮**不同**的行（相同的行折叠起来）：把两份 sidecar 并排贴出来
 * 等于让用户自己找差异，那正是这个弹层要省掉的事。
 */
import { useEffect, useMemo, useState } from 'react'

import { fetchMeta, fileUrl } from '../../../client/api.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { GalleryItem } from '../../../client/types.js'
import { changedRows, diffItems, diffRecords, flattenMeta } from './compare.js'
import type { DiffRow } from './compare.js'

export interface CompareModalProps {
  a: GalleryItem
  b: GalleryItem
  t: Translate
  onClose: () => void
}

export function CompareModal({ a, b, t, onClose }: CompareModalProps): React.ReactElement {
  const [mode, setMode] = useState<'side' | 'slider'>('side')
  const [split, setSplit] = useState(50)
  /**
   * 差异行。**优先用 `/meta` 的完整 sidecar**：列表项只透出十来个摘要字段，
   * 而插件自己写的 sidecar 把参数全放在 `vars` 里 —— 只比列表项的话，
   * 两张只差 steps/cfg/底模的图会显示成"参数完全相同"，那是弹层里最响也最错的一句话。
   */
  const [rows, setRows] = useState<DiffRow[] | null>(null)
  const [fromMeta, setFromMeta] = useState(false)

  useEffect(() => {
    let alive = true
    // 列表值先顶上：`/meta` 要两次往返，慢一点也不能让侧栏空着
    setRows(diffItems(a, b))
    setFromMeta(false)
    void Promise.all([fetchMeta(a.path), fetchMeta(b.path)])
      .then(([left, right]) => {
        if (!alive) return
        const flatLeft = flattenMeta(left)
        const flatRight = flattenMeta(right)
        // 两边都读不到 sidecar（例如非生成图）才退回列表值
        if (Object.keys(flatLeft).length === 0 && Object.keys(flatRight).length === 0) return
        setRows(diffRecords(flatLeft, flatRight))
        setFromMeta(true)
      })
      .catch(() => { /* 读不到就留着列表值那份 */ })
    return () => { alive = false }
  }, [a, b])

  const changed = useMemo(() => changedRows(rows ?? []), [rows])

  return (
    <div className="cpm-root" role="dialog" aria-modal="true" aria-label={t('compareTitle')}>
      <div className="cpm-panel">
        <header className="cpm-head">
          <div className="cpm-title">{t('compareTitle')}</div>
          <div className="cpm-modes">
            <button
              type="button"
              className={`cfa-btn${mode === 'side' ? ' cfa-primary' : ''}`}
              onClick={() => setMode('side')}
            >
              {t('compareSide')}
            </button>
            <button
              type="button"
              className={`cfa-btn${mode === 'slider' ? ' cfa-primary' : ''}`}
              onClick={() => setMode('slider')}
            >
              {t('compareSlider')}
            </button>
          </div>
          <button type="button" className="cfa-btn" onClick={onClose} title={t('close')} aria-label={t('close')}>
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="cpm-body">
          <div className="cpm-stage">
            {mode === 'side' ? (
              <div className="cpm-side">
                <figure className="cpm-figure">
                  <img src={fileUrl(a.path)} alt={a.name} />
                  <figcaption title={a.path}>{a.name}</figcaption>
                </figure>
                <figure className="cpm-figure">
                  <img src={fileUrl(b.path)} alt={b.name} />
                  <figcaption title={b.path}>{b.name}</figcaption>
                </figure>
              </div>
            ) : (
              <div className="cpm-slider">
                <img className="cpm-layer" src={fileUrl(b.path)} alt={b.name} />
                {/* 左图按 split 切开，压在右图上面 */}
                <img
                  className="cpm-layer cpm-clip"
                  src={fileUrl(a.path)}
                  alt={a.name}
                  style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
                />
                <input
                  className="cpm-range"
                  type="range"
                  min={0}
                  max={100}
                  value={split}
                  onChange={event => setSplit(Number(event.target.value))}
                  aria-label={t('compareSlider')}
                />
              </div>
            )}
          </div>

          <aside className="cpm-diff">
            <div className="cpm-diff-head">
              {rows === null
                ? t('loading')
                : changed.length === 0
                  // 用列表值时只说"列表可见字段"——列表里的超长 prompt 可能被截断，
                  // 断言"完全相同"会比真实情况更响
                  ? (fromMeta ? t('compareSame') : t('compareSameSummary'))
                  : t('compareChanged').replace('{n}', String(changed.length))}
            </div>
            <ul className="cpm-list">
              {(rows === null ? [] : changed.length === 0 ? rows : changed).map(row => (
                <li key={row.key} className={`cpm-row${row.same ? ' same' : ''}`}>
                  <div className="cpm-key">{row.key}</div>
                  <div className="cpm-values">
                    <span className="cpm-value" title={row.a}>{row.a}</span>
                    <span className="cpm-value" title={row.b}>{row.b}</span>
                  </div>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      </div>
    </div>
  )
}
