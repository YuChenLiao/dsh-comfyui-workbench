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
  onOpenSidebar: () => void
}

/** 顶部工具条：搜索、根目录、两个开关、选择模式、刷新、侧栏入口。 */
export function Toolbar(props: ToolbarProps): React.ReactElement {
  const { t, total, roots, root, query, includeBare, mergeDuplicates, selecting, embedded } = props

  return (
    <header className="cfa-bar">
      <div className="cfa-head">
        <Icon name="album" size={18} />
        <span className="cfa-title">{t('tabAssets')}</span>
        {total > 0 ? <span className="cfa-count">{String(total)}</span> : null}
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
        {embedded ? null : (
          <button type="button" className="cfa-btn" title={t('openSidebar')} aria-label={t('openSidebar')} onClick={props.onOpenSidebar}>
            <Icon name="dock" size={15} />
          </button>
        )}
      </div>
    </header>
  )
}
