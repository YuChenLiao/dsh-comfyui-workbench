import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'

export interface BulkBarProps {
  t: Translate
  selectedCount: number
  busy: string
  onSelectAll: () => void
  onSelectNone: () => void
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
