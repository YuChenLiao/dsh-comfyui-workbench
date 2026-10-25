import { useEffect, useRef, useState } from 'react'

import { fileUrl } from '../../../client/api.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { ActionKind, GalleryItem } from '../../../client/types.js'

/** 缩放范围：0.2×–8×，避免缩到看不见或放大到丢失精度。 */
function clampZoom(value: number): number {
  return Math.min(8, Math.max(0.2, value))
}

function Kv({ k, v }: { k: string; v: string | number }): React.ReactElement {
  return (
    <>
      <dt>{k}</dt>
      <dd title={String(v)}>{String(v)}</dd>
    </>
  )
}

export interface LightboxProps {
  item: GalleryItem
  index: number
  count: number
  t: Translate
  onClose: () => void
  onAction: (kind: ActionKind, item: GalleryItem) => void
  onPrev: () => void
  onNext: () => void
}

/** 图片详情：缩放、拖拽、左右翻页、元数据与动作。 */
export function Lightbox(props: LightboxProps): React.ReactElement {
  const { item, index, count, t, onClose, onAction, onPrev, onNext } = props
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null)

  // 换图即复位：否则上一张的缩放和位移会带到下一张。
  useEffect(() => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
    dragRef.current = null
    setDragging(false)
  }, [item.path])

  // React 的 onWheel 是 passive 的，preventDefault 无效，这里直接挂原生监听。
  useEffect(() => {
    const node = stageRef.current
    if (node === null) return undefined
    const onWheel = (event: WheelEvent): void => {
      event.preventDefault()
      setZoom(previous => clampZoom(previous * (event.deltaY < 0 ? 1.12 : 1 / 1.12)))
    }
    node.addEventListener('wheel', onWheel, { passive: false })
    return () => node.removeEventListener('wheel', onWheel)
  }, [item.path])

  // 缩放快捷键只在灯箱打开时生效。
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === '+' || event.key === '=') {
        event.preventDefault()
        setZoom(previous => clampZoom(previous * 1.2))
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault()
        setZoom(previous => clampZoom(previous / 1.2))
      } else if (event.key === '0') {
        event.preventDefault()
        setZoom(1)
        setPan({ x: 0, y: 0 })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const resetZoom = (): void => {
    setZoom(1)
    setPan({ x: 0, y: 0 })
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (zoom <= 1) return
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y }
    setDragging(true)
    if (typeof event.currentTarget.setPointerCapture === 'function') {
      event.currentTarget.setPointerCapture(event.pointerId)
    }
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (drag === null) return
    setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) })
  }

  const endDrag = (): void => {
    dragRef.current = null
    setDragging(false)
  }

  const act = (kind: ActionKind) => (event: React.MouseEvent): void => {
    event.stopPropagation()
    onAction(kind, item)
  }

  const rows: React.ReactNode[] = []
  if (item.width !== undefined && item.height !== undefined && item.width > 0 && item.height > 0) {
    rows.push(<Kv key="size" k={t('size')} v={`${item.width}×${item.height}`} />)
  }
  if (typeof item.seed === 'number') rows.push(<Kv key="seed" k={t('seed')} v={item.seed} />)
  if (typeof item.checkpoint === 'string' && item.checkpoint !== '') rows.push(<Kv key="model" k={t('model')} v={item.checkpoint} />)
  if (typeof item.samplerName === 'string' && item.samplerName !== '') {
    rows.push(<Kv key="sampler" k={t('sampler')} v={item.samplerName + (item.scheduler !== undefined && item.scheduler !== '' ? ` / ${item.scheduler}` : '')} />)
  }
  if (typeof item.steps === 'number' && item.steps > 0) rows.push(<Kv key="steps" k={t('steps')} v={item.steps} />)
  if (typeof item.cfgScale === 'number' && item.cfgScale > 0) rows.push(<Kv key="cfg" k={t('cfg')} v={item.cfgScale} />)
  if (typeof item.mode === 'string' && item.mode !== '') rows.push(<Kv key="mode" k={t('mode')} v={item.mode} />)
  if (typeof item.createdAt === 'string' && item.createdAt !== '') {
    rows.push(<Kv key="created" k={t('createdAt')} v={String(item.createdAt).replace('T', ' ').slice(0, 19)} />)
  }
  rows.push(<Kv key="path" k={t('filePath')} v={item.path} />)

  const dupCount = typeof item.duplicateCount === 'number' ? item.duplicateCount : 0

  return (
    <div className="cfa-lb" onClick={onClose}>
      <div
        className="cfa-lb-stage"
        ref={stageRef}
        onClick={event => event.stopPropagation()}
        onDoubleClick={() => (zoom > 1 ? resetZoom() : setZoom(2))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
      >
        <img
          key={item.path}
          className={`cfa-lb-img${dragging ? ' dragging' : ''}`}
          src={fileUrl(item.path)}
          alt={item.name}
          draggable={false}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
            cursor: zoom > 1 ? (dragging ? 'grabbing' : 'grab') : 'zoom-in',
            transition: dragging ? 'none' : 'transform .1s ease',
          }}
        />
        {count > 1 ? (
          <button type="button" className="cfa-lb-nav prev" title={t('prevImage')} aria-label={t('prevImage')} onClick={event => { event.stopPropagation(); onPrev() }}>
            <Icon name="chevronLeft" size={18} />
          </button>
        ) : null}
        {count > 1 ? (
          <button type="button" className="cfa-lb-nav next" title={t('nextImage')} aria-label={t('nextImage')} onClick={event => { event.stopPropagation(); onNext() }}>
            <Icon name="chevronRight" size={18} />
          </button>
        ) : null}
        {typeof index === 'number' && count > 0 ? <span className="cfa-lb-count">{`${index + 1} / ${count}`}</span> : null}
        <div className="cfa-lb-zoom" onClick={event => event.stopPropagation()}>
          <button type="button" className="cfa-lb-zbtn" title={t('zoomOut')} aria-label={t('zoomOut')} onClick={() => setZoom(previous => clampZoom(previous / 1.2))}>
            <Icon name="minus" size={14} />
          </button>
          <button type="button" className="cfa-lb-zvalue" title={t('zoomReset')} onClick={resetZoom}>{`${Math.round(zoom * 100)}%`}</button>
          <button type="button" className="cfa-lb-zbtn" title={t('zoomIn')} aria-label={t('zoomIn')} onClick={() => setZoom(previous => clampZoom(previous * 1.2))}>
            <Icon name="plus" size={14} />
          </button>
        </div>
      </div>
      <aside className="cfa-lb-side" onClick={event => event.stopPropagation()}>
        <div className="cfa-lb-head">
          <strong title={item.name}>{item.name}</strong>
          <button type="button" className="cfa-btn" title={t('close')} aria-label={t('close')} onClick={onClose}><Icon name="close" size={15} /></button>
        </div>
        <div className="cfa-lb-actions">
          <button type="button" className="cfa-btn" onClick={act('copyImage')}><Icon name="copy" size={14} />{t('copyImage')}</button>
          <button type="button" className="cfa-btn" onClick={act('copyPrompt')}><Icon name="text" size={14} />{t('copyPrompt')}</button>
          <button type="button" className="cfa-btn" onClick={act('exportWorkflow')}><Icon name="download" size={14} />{t('exportWorkflow')}</button>
          <button type="button" className="cfa-btn" onClick={act('addToChat')}><Icon name="chat" size={14} />{t('addToChat')}</button>
          <button type="button" className="cfa-btn" onClick={act('describe')}><Icon name="text" size={14} />{t('describe')}</button>
          <button type="button" className="cfa-btn cfa-danger" onClick={act('remove')}><Icon name="trash" size={14} />{t('remove')}</button>
        </div>
        <dl className="cfa-kv">{rows}</dl>
        {dupCount > 1 ? (
          <div>
            <div className="cfa-kv-k">{`${t('duplicates')} · ${dupCount}`}</div>
            <div className="cfa-prompt-box cfa-dup-list">
              {(item.duplicates ?? []).map(other => <div key={other}>{other}</div>)}
            </div>
          </div>
        ) : null}
        <div className="cfa-kv-k">{t('prompt')}</div>
        <p className="cfa-prompt-box">{item.prompt !== undefined && item.prompt !== '' ? item.prompt : t('noPrompt')}</p>
        {item.negativePrompt !== undefined && item.negativePrompt !== '' ? <div className="cfa-kv-k">{t('negativePrompt')}</div> : null}
        {item.negativePrompt !== undefined && item.negativePrompt !== '' ? <p className="cfa-prompt-box">{item.negativePrompt}</p> : null}
      </aside>
    </div>
  )
}
