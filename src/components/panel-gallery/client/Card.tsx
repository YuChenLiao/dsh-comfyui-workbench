import { useState } from 'react'

import { fileUrl } from '../../../client/api.js'
import { metaLine } from '../../../client/format.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { ActionKind, GalleryItem } from '../../../client/types.js'

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
  /** 老列表项没有 `kind`，按图片处理（那时相册里也只有图片）。 */
  const isImage = (item.kind ?? 'image') === 'image'
  // 浏览器解不了的容器（.mkv / .avi）会触发 onError：没有降级的话，用户看到的是
  // 一块黑卡 —— 正是这次要消灭的"看不见"，只是换了个形态。
  const [mediaBroken, setMediaBroken] = useState(false)

  return (
    <figure
      className={`cfa-card${selecting ? ' cfa-selectable' : ''}${selecting && selected ? ' selected' : ''}`}
      onClick={() => (selecting ? onToggle(item) : onOpen(item))}
      title={item.prompt !== undefined && item.prompt !== '' ? item.prompt : item.name}
    >
      {/* 视频/音频不走缩略图：把 mp4 塞进 <img> 只会得到破图图标，而它本来能直接播 */}
      {item.kind === 'video' && mediaBroken === false ? (
        <video
          className="cfa-thumb"
          src={fileUrl(item.path)}
          muted
          preload="metadata"
          playsInline
          onError={() => setMediaBroken(true)}
        />
      ) : item.kind === 'video' || item.kind === 'audio' ? (
        <div className="cfa-thumb cfa-thumb-audio" title={item.name} aria-label={item.name}>
          {item.kind === 'video' ? <span className="cfa-thumb-broken">{t('mediaUnsupported')}</span> : '♪'}
        </div>
      ) : (
        <img
          className="cfa-thumb"
          src={fileUrl(item.path, true)}
          alt={item.name}
          loading="lazy"
          decoding="async"
          draggable={false}
        />
      )}
      {selecting ? <span className={`cfa-pick${selected ? ' on' : ''}`} aria-hidden="true">{selected ? '✓' : ''}</span> : null}
      {!selecting && dupCount > 1
        ? <span className="cfa-dup" title={t('duplicateBadge').replace('{n}', String(dupCount))}>{`×${dupCount}`}</span>
        : null}
      {selecting ? null : (
        <div className="cfa-actions">
          {/* 复制图片 / 送进对话都是**图片语义**：`createImageBitmap` 与图片附件都不接受 mp4。
              对视频/音频留一个点了会报错的按钮，比不给按钮更糟。 */}
          {isImage ? <button type="button" className="cfa-btn" title={t('copyImage')} aria-label={t('copyImage')} onClick={act('copyImage')}><Icon name="copy" size={15} /></button> : null}
          <button type="button" className="cfa-btn" title={t('copyPrompt')} aria-label={t('copyPrompt')} onClick={act('copyPrompt')}><Icon name="text" size={15} /></button>
          <button type="button" className="cfa-btn" title={t('exportWorkflow')} aria-label={t('exportWorkflow')} onClick={act('exportWorkflow')}><Icon name="download" size={15} /></button>
          {isImage ? <button type="button" className="cfa-btn" title={t('addToChat')} aria-label={t('addToChat')} onClick={act('addToChat')}><Icon name="chat" size={15} /></button> : null}
          {/* 拿这张图的参数再跑一遍（换图 + 换新 seed，其余参数从 sidecar 带过去） */}
          <button type="button" className="cfa-btn" title={t('useAsInput')} aria-label={t('useAsInput')} onClick={act('useAsInput')}><Icon name="image" size={15} /></button>
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
