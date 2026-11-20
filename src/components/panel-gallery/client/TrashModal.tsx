/**
 * 回收站：软删除的东西在这里，可以恢复或彻底清空。
 *
 * 为什么值得一个独立弹层：产物旁的 `.json` sidecar 是"再来一张一模一样的"唯一凭据。
 * 误删一张图丢的不只是一张图，是那一整组参数（seed / prompt / 工作流版本）。
 */
import { useEffect, useState } from 'react'

import { emptyTrash, fetchTrash, restoreTrash } from '../../../client/api.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'

export interface TrashModalProps {
  t: Translate
  onClose: () => void
  /** 恢复/清空之后要刷新图库（删掉的图回来了）。 */
  onChanged: () => void
}

interface TrashRow {
  dir: string
  path: string
  original: string
  name: string
  bytes: number
  trashedAt: string
}

export function TrashModal({ t, onClose, onChanged }: TrashModalProps): React.ReactElement {
  const [rows, setRows] = useState<TrashRow[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const load = (): void => {
    void fetchTrash()
      .then(data => { setRows(data.entries); setError('') })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  useEffect(() => { load() }, [])

  const restore = async (row: TrashRow): Promise<void> => {
    setBusy(row.dir)
    try {
      await restoreTrash(row.dir)
      load()
      onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  const empty = async (): Promise<void> => {
    if (!window.confirm(t('trashEmptyConfirm'))) return
    setBusy('empty')
    try {
      await emptyTrash()
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="csm-root" role="dialog" aria-modal="true" aria-label={t('trashTitle')}>
      <div className="csm-panel">
        <header className="csm-head">
          <div className="csm-title">{t('trashTitle')}</div>
          <button type="button" className="cfa-btn" onClick={onClose} title={t('close')} aria-label={t('close')}>
            <Icon name="close" size={15} />
          </button>
        </header>

        {error !== '' ? <div className="cwa-error">{error}</div> : null}
        {rows === null && error === '' ? <div className="csm-empty">{t('loading')}</div> : null}
        {rows !== null && rows.length === 0 ? <div className="csm-empty">{t('trashEmpty')}</div> : null}

        {rows !== null && rows.length > 0 ? (
          <ul className="csm-list">
            {rows.map(row => (
              <li key={row.dir} className="csm-item">
                <div className="csm-meta">
                  <span className="csm-name" title={row.original}>{row.name}</span>
                  <span className="csm-sub">{row.trashedAt} · {Math.round(row.bytes / 1024)} KB</span>
                </div>
                <button
                  type="button"
                  className="cfa-btn"
                  disabled={busy !== ''}
                  onClick={() => { void restore(row) }}
                >
                  {t('trashRestore')}
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <footer className="csm-foot">
          <span className="csm-hint">{t('trashHint')}</span>
          <div className="csm-actions">
            <button type="button" className="cfa-btn cfa-danger" disabled={busy !== '' || (rows?.length ?? 0) === 0} onClick={() => { void empty() }}>
              {t('trashEmptyAll')}
            </button>
            <button type="button" className="cfa-btn" onClick={onClose}>{t('close')}</button>
          </div>
        </footer>
      </div>
    </div>
  )
}
