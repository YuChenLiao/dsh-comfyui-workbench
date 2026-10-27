import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { RootEntry } from '../../../client/types.js'

export interface ToolbarProps {
  t: Translate
  total: number
  roots: RootEntry[]
  root: string
  query: string
  includeBare: boolean
  mergeDuplicates: boolean
  selecting: boolean
  embedded: boolean
  onQuery: (value: string) => void
  onRoot: (value: string) => void
  onToggleBare: () => void
  onToggleDuplicates: () => void
  onToggleSelecting: () => void
  onRefresh: () => void
  /** 是否隐藏 NSFW 内容。 */
  hideNsfw: boolean
  /** 当前已加载的可见条数。 */
  visibleCount: number
  /** 已加载的总条数（分页只加载了一部分时小于 total）。 */
  loadedCount: number
  /** 被隐藏的条数（按钮上显示，让用户知道藏了多少）。 */
  hiddenNsfwCount: number
  onToggleNsfw: () => void
  onOpenSidebar: () => void
}

/** 顶部工具条：搜索、根目录、两个开关、选择模式、刷新、侧栏入口。 */
export function Toolbar(props: ToolbarProps): React.ReactElement {
  const { t, total, roots, root, query, includeBare, mergeDuplicates, selecting, embedded, hideNsfw, hiddenNsfwCount, onToggleNsfw, visibleCount, loadedCount } = props

  return (
    <header className="cfa-bar">
      <div className="cfa-head">
        <Icon name="album" size={18} />
        <span className="cfa-title">{t('tabAssets')}</span>
        {total > 0 ? (
          <span className="cfa-count">
            {/* 隐藏时显示「可见 / 总数」：只显示总数会让人以为列表坏了 */}
            {hideNsfw && visibleCount < loadedCount ? `${visibleCount} / ${loadedCount}` : String(loadedCount)}
          </span>
        ) : null}
      </div>
      <div className="cfa-tools">
        <label className="cfa-search">
          <Icon name="search" size={14} />
          <input value={query} placeholder={t('search')} onChange={event => props.onQuery(event.target.value)} />
        </label>
        <select className="cfa-select" value={root} title={t('allRoots')} onChange={event => props.onRoot(event.target.value)}>
          <option value="all">{t('allRoots')}</option>
          {roots.map(entry => (
            <option key={entry.path} value={entry.path} title={entry.path}>
              {entry.label !== '' ? entry.label : entry.path}
            </option>
          ))}
        </select>
        <button
          type="button"
          className={`cfa-chip${includeBare ? ' on' : ''}`}
          title={includeBare ? t('onlyGenerated') : t('onlyGeneratedOn')}
          onClick={props.onToggleBare}
        >
          {includeBare ? t('onlyGeneratedOn') : t('onlyGenerated')}
        </button>
        <button
          type="button"
          className={`cfa-chip${mergeDuplicates ? ' on' : ''}`}
          title={t('mergeDuplicates')}
          onClick={props.onToggleDuplicates}
        >
          {t('mergeDuplicates')}
        </button>
        <button
          type="button"
          className={`cfa-chip${selecting ? ' on' : ''}`}
          title={selecting ? t('exitSelect') : t('select')}
          onClick={props.onToggleSelecting}
        >
          {selecting ? t('exitSelect') : t('select')}
        </button>
        <button type="button" className="cfa-btn" title={t('refresh')} aria-label={t('refresh')} onClick={props.onRefresh}>
          <Icon name="refresh" size={15} />
        </button>
        {/* 省略号只是入口：真正常用的开关收在悬浮里，工具条不至于被一堆按钮撑满 */}
        <div className="cfa-extra">
          <button type="button" className="cfa-btn cfa-extra-trigger" title={t('moreActions')} aria-label={t('moreActions')}>
            <span aria-hidden="true">⋯</span>
          </button>
          <div className="cfa-extra-panel">
            <button
              type="button"
              className={`cfa-extra-item${hideNsfw ? ' on' : ''}`}
              title={t('hideNsfwHint')}
              onClick={props.onToggleNsfw}
            >
              {hideNsfw ? t('showNsfw') : t('hideNsfw')}
              {hiddenNsfwCount > 0 ? <span className="cfa-extra-count">{hiddenNsfwCount}</span> : null}
            </button>
          </div>
        </div>
        {embedded ? null : (
          <button type="button" className="cfa-btn" title={t('openSidebar')} aria-label={t('openSidebar')} onClick={props.onOpenSidebar}>
            <Icon name="dock" size={15} />
          </button>
        )}
      </div>
    </header>
  )
}
