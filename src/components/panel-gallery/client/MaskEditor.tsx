/**
 * 蒙版画笔：在图上涂一块「要重绘的区域」，导出一张遮罩 PNG。
 *
 * ## 为什么两个 canvas
 *
 * 显示层（红色半透明笔迹）与数据层（黑底白笔迹）分开：
 * - 数据层的白/黑就是 ComfyUI 读的遮罩（白=重绘、黑=保留），导出时直接对它合成
 * - 显示层只是给人看的，笔迹用红色半透明叠在底图上
 *
 * 只用一个 canvas 再"反推"遮罩的话，颜色与透明度会来回换算，导出结果和眼睛看到的
 * 永远对不上。两层各管一件事，代价是每次落笔写两次 —— 那比每帧全图合成便宜得多。
 *
 * ## 撤销栈为什么按字节限步
 *
 * `getImageData` 一步就是 `w*h*4` 字节：2K 图 16MB/步、4K 图 64MB/步。
 * 固定存 20 步的话，一次涂蒙版就能把标签页吃爆。这里按单步体积算步数。
 */
import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'

export interface MaskEditorProps {
  /** 底图地址（灯箱里那张图的 `/file` 地址）。 */
  src: string
  t: Translate
  onCancel: () => void
  /** 导出遮罩（白 = 重绘区、黑 = 保留）。 */
  onDone: (mask: Blob, width: number, height: number) => void
}

/** 撤销栈的字节预算：超过就少存几步。 */
const UNDO_BUDGET_BYTES = 96 * 1024 * 1024

export function MaskEditor({ src, t, onCancel, onDone }: MaskEditorProps): React.ReactElement {
  const viewRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  /** 底图：撤销后要整层重绘，直接拿它 `drawImage` 就够，不用再存一份快照。 */
  const imageRef = useRef<HTMLImageElement | null>(null)
  const undoRef = useRef<ImageData[]>([])
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [brush, setBrush] = useState(48)
  const [erasing, setErasing] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [undoDepth, setUndoDepth] = useState(0)

  // 底部依赖里不要放 `t`：中文/英文切换时 `t` 会换引用，这会重新加载图片、
  // 把已经涂好的蒙版清掉。
  useEffect(() => {
    let alive = true
    const image = new Image()
    image.onload = () => {
      if (!alive) return
      const w = image.naturalWidth
      const h = image.naturalHeight
      if (w === 0 || h === 0) {
        setError('底图读不出尺寸。')
        return
      }
      const view = viewRef.current
      const mask = maskRef.current
      if (view === null || mask === null) return
      imageRef.current = image
      for (const canvas of [view, mask]) {
        canvas.width = w
        canvas.height = h
      }
      const mctx = mask.getContext('2d')
      if (mctx === null) return
      mctx.fillStyle = '#000'
      mctx.fillRect(0, 0, w, h)
      undoRef.current = []
      setUndoDepth(0)
      redrawView(image, view)
      setSize({ w, h })
    }
    image.onerror = () => { if (alive) setError('底图加载失败。') }
    image.src = src
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  /** 显示层 = 底图 + 数据层染色（撤销 / 清空时整层重建）。 */
  const redrawView = (image: HTMLImageElement | null, view: HTMLCanvasElement): void => {
    const mask = maskRef.current
    const vctx = view.getContext('2d')
    if (image === null || mask === null || vctx === null) return
    vctx.clearRect(0, 0, view.width, view.height)
    vctx.drawImage(image, 0, 0)
    const tint = document.createElement('canvas')
    tint.width = mask.width
    tint.height = mask.height
    const tctx = tint.getContext('2d')
    if (tctx === null) return
    tctx.drawImage(mask, 0, 0)
    // 数据层是白笔黑底：把"非黑"的部分染红，再半透明叠上去。
    // `source-in` 只保留已有像素的 alpha，正好把白色区域换成红色。
    tctx.globalCompositeOperation = 'multiply'
    tctx.fillStyle = '#ff4545'
    tctx.fillRect(0, 0, tint.width, tint.height)
    tctx.globalCompositeOperation = 'destination-in'
    tctx.drawImage(mask, 0, 0)
    vctx.save()
    vctx.globalAlpha = 0.5
    vctx.drawImage(tint, 0, 0)
    vctx.restore()
  }

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const canvas = event.currentTarget
    const rect = canvas.getBoundingClientRect()
    const scaleX = rect.width === 0 ? 1 : canvas.width / rect.width
    const scaleY = rect.height === 0 ? 1 : canvas.height / rect.height
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    }
  }

  /** 落笔：数据层写白 / 擦除，显示层写红 / 擦除。两层同步，不做全图合成。 */
  const paint = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const mask = maskRef.current
    const view = viewRef.current
    if (mask === null || view === null) return
    const mctx = mask.getContext('2d')
    const vctx = view.getContext('2d')
    if (mctx === null || vctx === null) return
    const layers: Array<[CanvasRenderingContext2D, string]> = [[mctx, '#ffffff'], [vctx, 'rgba(255,69,69,0.50)']]
    for (const [ctx, color] of layers) {
      ctx.save()
      ctx.globalCompositeOperation = erasing ? 'destination-out' : 'source-over'
      ctx.lineWidth = brush
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.strokeStyle = color
      ctx.beginPath()
      ctx.moveTo(from.x, from.y)
      ctx.lineTo(to.x, to.y)
      ctx.stroke()
      ctx.restore()
    }
  }

  const pushUndo = (): void => {
    const mask = maskRef.current
    if (mask === null) return
    const mctx = mask.getContext('2d')
    if (mctx === null) return
    const snapshot = mctx.getImageData(0, 0, mask.width, mask.height)
    const bytes = snapshot.data.byteLength
    if (bytes === 0) return
    const limit = Math.max(1, Math.min(8, Math.floor(UNDO_BUDGET_BYTES / bytes)))
    undoRef.current.push(snapshot)
    while (undoRef.current.length > limit) undoRef.current.shift()
    setUndoDepth(undoRef.current.length)
  }

  const strokeStart = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (size === null) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pushUndo()
    const point = pointOf(event)
    lastRef.current = point
    setDrawing(true)
    paint(point, point)
  }

  const strokeMove = (event: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!drawing || lastRef.current === null) return
    const point = pointOf(event)
    paint(lastRef.current, point)
    lastRef.current = point
  }

  const strokeEnd = (): void => {
    setDrawing(false)
    lastRef.current = null
  }

  const undo = (): void => {
    const mask = maskRef.current
    const view = viewRef.current
    const previous = undoRef.current.pop()
    if (mask === null || view === null || previous === undefined) return
    const mctx = mask.getContext('2d')
    if (mctx === null) return
    mctx.putImageData(previous, 0, 0)
    setUndoDepth(undoRef.current.length)
    redrawView(imageRef.current, view)
  }

  const clearMask = (): void => {
    const mask = maskRef.current
    const view = viewRef.current
    if (mask === null || view === null) return
    const mctx = mask.getContext('2d')
    if (mctx === null) return
    pushUndo()
    mctx.fillStyle = '#000'
    mctx.fillRect(0, 0, mask.width, mask.height)
    redrawView(imageRef.current, view)
  }

  const apply = (): void => {
    const mask = maskRef.current
    if (mask === null) return
    setSaving(true)
    // 合成到黑底再导出：数据层被橡皮擦过的地方是透明的，
    // 直接 toBlob 会得到一张带透明区域的图，ComfyUI 读亮度时行为不确定。
    const out = document.createElement('canvas')
    out.width = mask.width
    out.height = mask.height
    const ctx = out.getContext('2d')
    if (ctx === null) {
      setError('导出失败：拿不到 2D 上下文。')
      setSaving(false)
      return
    }
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(mask, 0, 0)
    out.toBlob(blob => {
      setSaving(false)
      if (blob === null) {
        setError(t('maskSaveFailed'))
        return
      }
      onDone(blob, out.width, out.height)
    }, 'image/png')
  }

  return (
    <div className="cmf-root" role="dialog" aria-modal="true">
      <div className="cmf-panel">
        <header className="cmf-head">
          <div className="cmf-title">{t('maskEditorTitle')}</div>
          <button type="button" className="cfa-btn" onClick={onCancel} title={t('close')} aria-label={t('close')}>
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="cmf-stage">
          <canvas
            ref={viewRef}
            className="cmf-canvas"
            onPointerDown={strokeStart}
            onPointerMove={strokeMove}
            onPointerUp={strokeEnd}
            onPointerCancel={strokeEnd}
          />
          {/* 数据层不显示，只承载白/黑遮罩 */}
          <canvas ref={maskRef} className="cmf-hidden" />
          {size === null && error === '' ? <div className="cmf-loading">{t('loading')}</div> : null}
        </div>

        {error !== '' ? <div className="cwa-error">{error}</div> : null}

        <div className="cmf-tools">
          <label className="cmf-brush">
            <span>{t('maskBrush')}</span>
            <input
              type="range"
              min={8}
              max={200}
              step={2}
              value={brush}
              onChange={event => setBrush(Number(event.target.value))}
            />
            <span className="cmf-brush-value">{brush}</span>
          </label>
          <button
            type="button"
            className={`cfa-btn${erasing ? ' cfa-danger' : ''}`}
            onClick={() => setErasing(current => !current)}
            title={t('maskEraserHint')}
          >
            {t('maskEraser')}
          </button>
          <button type="button" className="cfa-btn" disabled={undoDepth === 0} onClick={undo}>
            {t('maskUndo')}
          </button>
          <button type="button" className="cfa-btn" onClick={clearMask}>
            {t('maskClear')}
          </button>
        </div>

        <footer className="cmf-foot">
          <span className="cmf-hint">{t('maskHint')}</span>
          <div className="cmf-actions">
            <button type="button" className="cfa-btn" onClick={onCancel}>{t('importCancel')}</button>
            <button type="button" className="cfa-btn cfa-primary" disabled={saving || size === null} onClick={apply}>
              {saving ? t('maskSaving') : t('maskApply')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
