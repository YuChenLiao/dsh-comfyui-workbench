import type { Translate } from '../../../client/i18n.js'
import type { GalleryItem } from '../../../client/types.js'

/** 删除是不可逆操作：先过一次确认层，别让误点直接抹掉文件。 */
export function ConfirmRemove(props: {
  item: GalleryItem
  t: Translate
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement {
  const { item, t, busy, onCancel, onConfirm } = props
  const dupCount = typeof item.duplicateCount === 'number' ? item.duplicateCount : 0
  const copyCount = dupCount > 1 ? Math.min((item.duplicates ?? []).length, dupCount - 1) : 0

  return (
    <div className="cfa-modal" onClick={busy ? undefined : onCancel}>
      <div className="cfa-modal-card" onClick={event => event.stopPropagation()}>
        <div className="cfa-modal-title">{t('removeTitle')}</div>
        <p className="cfa-modal-body">{t('removeBody')}</p>
        {copyCount > 0 ? <p className="cfa-modal-body">{t('duplicateHint').replace('{n}', String(copyCount))}</p> : null}
        <div className="cfa-modal-name">{item.name}</div>
        <div className="cfa-modal-actions">
          <button type="button" className="cfa-chip" onClick={onCancel} disabled={busy}>{t('cancel')}</button>
          <button type="button" className="cfa-btn-solid-danger" onClick={() => onConfirm()} disabled={busy}>{t('removeConfirm')}</button>
        </div>
      </div>
    </div>
  )
}

/** 批量删除的确认层：只报数量，逐条列出没有意义。 */
export function ConfirmBulkRemove(props: {
  count: number
  t: Translate
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.ReactElement {
  const { count, t, busy, onCancel, onConfirm } = props
  return (
    <div className="cfa-modal" onClick={busy ? undefined : onCancel}>
      <div className="cfa-modal-card" onClick={event => event.stopPropagation()}>
        <div className="cfa-modal-title">{t('bulkRemoveTitle').replace('{n}', String(count))}</div>
        <p className="cfa-modal-body">{t('bulkRemoveBody')}</p>
        <div className="cfa-modal-actions">
          <button type="button" className="cfa-chip" onClick={onCancel} disabled={busy}>{t('cancel')}</button>
          <button type="button" className="cfa-btn-solid-danger" onClick={() => onConfirm()} disabled={busy}>{t('removeConfirm')}</button>
        </div>
      </div>
    </div>
  )
}
