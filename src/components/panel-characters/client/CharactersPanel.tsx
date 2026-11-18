/**
 * 角色库面板：列表 + 品牌筛选 + 详情（五个槽位逐个取图/落盘）。
 *
 * 与衣装面板的区别：一个角色挂五张图，所以「取图」必须带槽位。列表只显示缩略图，
 * 点开卡片才拉详情里的五张 —— 20 个角色 × 5 张全预加载会把上游打满。
 */
import { useCallback, useEffect, useRef, useState } from 'react'

import { fetchCharacterStats, fetchCharacters, fetchCharacterFile, characterImageUrl } from '../../../client/api.js'
import type { CharacterHit } from '../../../client/api.js'
import type { Translate } from '../../../client/i18n.js'
import { Icon } from '../../../client/icons.js'

/** 详情里五个槽位的顺序与文案。 */
const SLOT_ORDER = ['turnaround', 'expression', 'outfit', 'props', 'sheet'] as const

export interface CharactersPanelProps {
  t: Translate
  visible: boolean
  goToConversation?: () => void
}

export function CharactersPanel({ t, visible }: CharactersPanelProps): React.ReactElement {
  const [items, setItems] = useState<CharacterHit[]>([])
  const [total, setTotal] = useState(0)
  const [brands, setBrands] = useState<Record<string, number>>({})
  const [stats, setStats] = useState<{ characterCount: number; license: string; attribution: string } | null>(null)
  const [query, setQuery] = useState('')
  const [brand, setBrand] = useState('')
  const [openId, setOpenId] = useState('')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (nextQuery: string, nextBrand: string): Promise<void> => {
    setLoading(true)
    try {
      const result = await fetchCharacters({ query: nextQuery, brand: nextBrand, limit: 60 })
      setItems(result.items)
      setTotal(result.total)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchCharacterStats()
      .then(value => {
        if (!alive) return
        setBrands(value.brands)
        setStats({ characterCount: value.characterCount, license: value.license, attribution: value.attribution })
      })
      .catch(() => { /* 统计失败不影响列表 */ })
    void load('', '')
    return () => { alive = false }
  }, [visible, load])

  /** 输入防抖：与另两个库同一套（250ms）。 */
  const schedule = useCallback((next: { query?: string; brand?: string }) => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      void load(next.query ?? query, next.brand ?? brand)
    }, 250)
  }, [load, query, brand])

  const pickBrand = (value: string): void => {
    setBrand(value)
    schedule({ brand: value })
  }

  const toggleOpen = (id: string): void => {
    setOpenId(current => (current === id ? '' : id))
  }

  /** 落盘某个槽位到 uploads，拿到绝对路径（给工作流当参考图）。 */
  const saveSlot = async (id: string, slot: string): Promise<void> => {
    setBusy(`${id}:${slot}`)
    try {
      const result = await fetchCharacterFile(id, slot)
      setNotice(`${t('charactersSaved')} ${result.file}`)
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  if (!visible) return <div className="cch-root" />

  const open = items.find(item => item.id === openId)

  return (
    <div className="cch-root">
      <div className="cch-head">
        <div>
          <div className="cch-title">{t('charactersTitle')}</div>
          <div className="cch-sub">
            {stats === null
              ? t('charactersLoading')
              : t('charactersSub').replace('{total}', String(stats.characterCount)).replace('{brands}', String(Object.keys(brands).length))}
          </div>
        </div>
      </div>

      <div className="cch-search">
        <input
          className="cch-input"
          value={query}
          placeholder={t('charactersPlaceholder')}
          onChange={event => {
            const value = event.target.value
            setQuery(value)
            schedule({ query: value })
          }}
        />
        <div className="cch-tabs" role="group" aria-label={t('charactersBrandsLabel')} title={t('charactersCountHint')}>
          <button type="button" aria-pressed={brand === ''} className={`cch-tab${brand === '' ? ' is-on' : ''}`} onClick={() => { pickBrand('') }}>
            {t('charactersAllBrands')}
            <span className="cch-tab-n">{total}</span>
          </button>
          {Object.entries(brands).map(([name, count]) => (
            <button
              key={name}
              type="button"
              aria-pressed={brand === name}
              className={`cch-tab${brand === name ? ' is-on' : ''}`}
              onClick={() => { pickBrand(name) }}
            >
              {name}
              <span className="cch-tab-n">{count}</span>
            </button>
          ))}
        </div>
      </div>

      {error !== '' && <div className="cch-note bad">{error}</div>}
      {notice !== '' && <div className="cch-note">{notice}</div>}
      {loading && items.length === 0 && <div className="cch-empty">{t('charactersLoading')}</div>}
      {!loading && items.length === 0 && error === '' && <div className="cch-empty">{t('charactersEmpty')}</div>}

      {open === undefined ? null : (
        <div className="cch-detail">
          <div className="cch-detail-head">
            <span className="cch-detail-name">{open.name}</span>
            <span className="cch-detail-sub">{open.subtitle}</span>
            <button type="button" className="cch-btn" onClick={() => { setOpenId('') }}>{t('charactersClose')}</button>
          </div>
          <div className="cch-slots">
            {SLOT_ORDER.filter(slot => open.slots.includes(slot)).map(slot => (
              <div key={slot} className="cch-slot">
                <div className="cch-slot-shot">
                  <img src={characterImageUrl(open.id, slot)} alt={`${open.name} ${slot}`} loading="lazy" />
                </div>
                <div className="cch-slot-bar">
                  <span className="cch-slot-label">{slotLabel(t, slot)}</span>
                  <button
                    type="button"
                    className="cch-btn"
                    disabled={busy === `${open.id}:${slot}`}
                    onClick={() => { void saveSlot(open.id, slot) }}
                  >{t('charactersSave')}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="cch-attr">{stats === null ? '' : `${stats.license} · ${stats.attribution}`}</div>
        </div>
      )}

      <div className="cch-grid">
        {items.map(item => (
          <button
            type="button"
            key={item.id}
            className={`cch-card${item.id === openId ? ' is-open' : ''}`}
            onClick={() => { toggleOpen(item.id) }}
          >
            <div className="cch-shot">
              <img src={characterImageUrl(item.id, 'preview')} alt={item.alt} loading="lazy" />
            </div>
            <div className="cch-meta">
              <div className="cch-name" title={item.name}>
                <span className="cch-badge">{item.brand}</span>
                {item.name}
              </div>
              <div className="cch-tagline">{item.subtitle}</div>
            </div>
          </button>
        ))}
      </div>

      <div className="cch-attr">
        <Icon name="image" size={13} /> {t('charactersFooter')}
      </div>
    </div>
  )
}

/** 槽位的中文名。`t()` 的 key 是固定的五个，不做动态拼接。 */
function slotLabel(t: Translate, slot: string): string {
  if (slot === 'turnaround') return t('charactersSlotTurnaround')
  if (slot === 'expression') return t('charactersSlotExpression')
  if (slot === 'outfit') return t('charactersSlotOutfit')
  if (slot === 'props') return t('charactersSlotProps')
  return t('charactersSlotSheet')
}
