import { fileUrl } from '../api.js'
import { metaLine } from '../format.js'
import { Icon } from '../icons.js'
import type { Translate } from '../i18n.js'
import type { ActionKind, GalleryItem } from '../types.js'

export interface CardProps {
  item: GalleryItem
  t: Translate
  selecting: boolean
  selected: boolean
  onToggle: (item: GalleryItem) => void
  onOpen: (item: GalleryItem) => void
  onAction: (kind: ActionKind, item: GalleryItem) => void
}

/**
 * 网格里的一张卡片。
 *
 * 选择模式下整卡是勾选目标，普通模式下点开灯箱；悬浮菜单只在普通模式出现 ——
 * 选择模式里再给一排按钮会让"点哪里"变得含混。
 */
export function Card({ item, t, selecting, selected, onToggle, onOpen, onAction }: CardProps): React.ReactElement {
  const act = (kind: ActionKind) => (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
    onAction(kind, item)
  }
  const dupCount = typeof item.duplicateCount === 'number' ? item.duplicateCount : 0

  return (
    <figure
      className={`cfa-card${selecting ? ' cfa-selectable' : ''}${selecting && selected ? ' selected' : ''}`}
      onClick={() => (selecting ? onToggle(item) : onOpen(item))}
      title={item.prompt !== undefined && item.prompt !== '' ? item.prompt : item.name}
    >
      <img
        className="cfa-thumb"
        src={fileUrl(item.path, true)}
        alt={item.name}
        loading="lazy"
        decoding="async"
        draggable={false}
      />
      {selecting ? <span className={`cfa-pick${selected ? ' on' : ''}`} aria-hidden="true">{selected ? '✓' : ''}</span> : null}
      {!selecting && dupCount > 1
        ? <span className="cfa-dup" title={t('duplicateBadge').replace('{n}', String(dupCount))}>{`×${dupCount}`}</span>
        : null}
      {selecting ? null : (
        <div className="cfa-actions">
          <button type="button" className="cfa-btn" title={t('copyImage')} aria-label={t('copyImage')} onClick={act('copyImage')}><Icon name="copy" size={15} /></button>
          <button type="button" className="cfa-btn" title={t('copyPrompt')} aria-label={t('copyPrompt')} onClick={act('copyPrompt')}><Icon name="text" size={15} /></button>
          <button type="button" className="cfa-btn" title={t('exportWorkflow')} aria-label={t('exportWorkflow')} onClick={act('exportWorkflow')}><Icon name="download" size={15} /></button>
          <button type="button" className="cfa-btn" title={t('addToChat')} aria-label={t('addToChat')} onClick={act('addToChat')}><Icon name="chat" size={15} /></button>
          <button type="button" className="cfa-btn cfa-danger" title={t('remove')} aria-label={t('remove')} onClick={act('remove')}><Icon name="trash" size={15} /></button>
        </div>
      )}
      <figcaption className="cfa-cap">
        <span className="cfa-prompt">{item.prompt !== undefined && item.prompt !== '' ? item.prompt : item.name}</span>
        <span className="cfa-meta">{metaLine(item)}</span>
      </figcaption>
    </figure>
  )
}
