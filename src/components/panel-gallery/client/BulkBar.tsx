import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'

export interface BulkBarProps {
  t: Translate
  selectedCount: number
  busy: string
  onSelectAll: () => void
  onSelectNone: () => void
  onCompare: () => void
  onExport: () => void
  onRemove: () => void
  onExit: () => void
}

/** 选择模式下贴在底部的批量操作条。 */
export function BulkBar(props: BulkBarProps): React.ReactElement {
  const { t, selectedCount, busy } = props
  const idle = selectedCount === 0 || busy.startsWith('bulk:')

  return (
    <div className="cfa-bulk">
      <span className="cfa-bulk-count">{t('selectedCount').replace('{n}', String(selectedCount))}</span>
      <button type="button" className="cfa-chip" onClick={props.onSelectAll}>{t('selectAll')}</button>
      <button type="button" className="cfa-chip" onClick={props.onSelectNone}>{t('selectNone')}</button>
      <span className="cfa-bulk-gap" />
      {/* 只有恰好选中两张时才有意义 —— 三张以上"对比"说不出是在比哪两张 */}
      <button
        type="button"
        className="cfa-chip"
        disabled={selectedCount !== 2}
        title={selectedCount === 2 ? undefined : t('compareNeedsTwo')}
        onClick={props.onCompare}
      >
        <Icon name="image" size={14} /> {t('compareTitle')}
      </button>
      <button type="button" className="cfa-chip" disabled={idle} onClick={props.onExport}>
        <Icon name="download" size={14} /> {t('bulkExport')}
      </button>
      <button type="button" className="cfa-chip cfa-bulk-danger" disabled={idle} onClick={props.onRemove}>
        <Icon name="trash" size={14} /> {t('bulkDelete')}
      </button>
      <button type="button" className="cfa-chip" onClick={props.onExit}>{t('exitSelect')}</button>
    </div>
  )
}
