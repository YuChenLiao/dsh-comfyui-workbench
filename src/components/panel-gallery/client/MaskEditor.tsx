/**
 * 蒙版画笔：在图上涂一块「要重绘的区域」，导出一张遮罩 PNG。
 *
 * ## 三层，各管一件事
 *
 * - `<img>`：底图。**不烘焙进 canvas** —— 烘焙进去的话，橡皮用 `destination-out`
 *   会把底图也擦掉（露出画布底色），撤销时还得整层重绘底图。
 * - 显示层 canvas：透明底 + 红色半透明笔迹，只用来给人看。
 * - 数据层 canvas（不显示）：透明底 + 白色笔迹 = ComfyUI 读的遮罩（白 = 重绘）。
 *   导出时合成到黑底上（透明 → 黑 = 保留）。
 *
 * 之前显示层烘焙底图再用 `multiply`/`destination-in` 染色，数据层又是**不透明黑底**：
 * 黑色乘红仍是黑，涂完再半透明叠上去，整张图会被压暗 50%，而擦过的地方反而全亮 ——
 * 明暗关系整个是反的。
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
  /**
   * 导出遮罩（白 = 重绘区、黑 = 保留）。
   *
   * **返回 Promise 是有意的**：上传失败时父组件不该先关弹层 —— 那会把用户
   * 画了几十笔的东西丢掉。父组件只在成功后关闭；这里按结果决定要不要保留画面。
   */
  onDone: (mask: Blob, width: number, height: number) => Promise<void>
}

/** 撤销栈的字节预算：超过就少存几步。 */
const UNDO_BUDGET_BYTES = 96 * 1024 * 1024

export function MaskEditor({ src, t, onCancel, onDone }: MaskEditorProps): React.ReactElement {
  const viewRef = useRef<HTMLCanvasElement | null>(null)
  const maskRef = useRef<HTMLCanvasElement | null>(null)
  const undoRef = useRef<ImageData[]>([])
  const lastRef = useRef<{ x: number; y: number } | null>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [brush, setBrush] = useState(48)
  const [erasing, setErasing] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [undoDepth, setUndoDepth] = useState(0)
  /** 有没有涂过东西：全黑遮罩导出去没有意义，只会占一份 uploads。 */
  const [painted, setPainted] = useState(false)

  // 依赖里不要放 `t`：切语言时 `t` 会换引用，重跑这个 effect 会把已涂的蒙版清掉。
  useEffect(() => {
    let alive = true
    const image = new Image()
    image.onload = () => {
      if (!alive) return
      const w = image.naturalWidth
      const h = image.naturalHeight
      if (w === 0 || h === 0) {
        setError(t('maskLoadFailed'))
        return
      }
      const view = viewRef.current
      const mask = maskRef.current
      if (view === null || mask === null) return
      for (const canvas of [view, mask]) {
        canvas.width = w
        canvas.height = h
      }
      // 两块 canvas 都从**透明**开始：数据层的白笔才是遮罩，透明处导出时补黑
      mask.getContext('2d')?.clearRect(0, 0, w, h)
      view.getContext('2d')?.clearRect(0, 0, w, h)
      undoRef.current = []
      setUndoDepth(0)
      setPainted(false)
      setSize({ w, h })
    }
    image.onerror = () => { if (alive) setError(t('maskLoadFailed')) }
    image.src = src
    return () => { alive = false }
    // 仅在 src 变化时重新加载并重置画布，不因 t 引用变化触发重绘
  }, [src])

  /** 指针坐标 → 原图像素坐标（canvas 被 CSS 缩放过，必须换算）。 */
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

  /** 落笔：数据层写白 / 擦除，显示层写红 / 擦除。两层都是透明底，不做全图合成。 */
  const paint = (from: { x: number; y: number }, to: { x: number; y: number }): void => {
    const mask = maskRef.current
    const view = viewRef.current
    if (mask === null || view === null) return
    const mctx = mask.getContext('2d')
    const vctx = view.getContext('2d')
    if (mctx === null || vctx === null) return
    const layers: Array<[CanvasRenderingContext2D, string]> = [[mctx, '#ffffff'], [vctx, 'rgba(255,69,69,0.55)']]
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
    if (!erasing) setPainted(true)
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
    if (!drawing) return
    // 指针捕获丢了（切窗口、触摸被系统收走）时 buttons 会归零 —— 不判的话
    // 不按着鼠标也会继续画
    if (event.buttons === 0) {
      strokeEnd()
      return
    }
    if (lastRef.current === null) return
    const point = pointOf(event)
    paint(lastRef.current, point)
    lastRef.current = point
  }

  const strokeEnd = (): void => {
    setDrawing(false)
    lastRef.current = null
  }

  /** 撤销 / 清空：恢复数据层后，把显示层按数据层重新染一遍。 */
  const repaintView = (): void => {
    const view = viewRef.current
    const mask = maskRef.current
    if (view === null || mask === null) return
    const vctx = view.getContext('2d')
    if (vctx === null) return
    vctx.clearRect(0, 0, view.width, view.height)
    // 数据层是"透明底 + 白笔"：先原样画上来，再用 source-in 把白色换成红色
    vctx.drawImage(mask, 0, 0)
    vctx.save()
    vctx.globalCompositeOperation = 'source-in'
    vctx.fillStyle = 'rgba(255,69,69,0.55)'
    vctx.fillRect(0, 0, view.width, view.height)
    vctx.restore()
  }

  const undo = (): void => {
    const mask = maskRef.current
    const previous = undoRef.current.pop()
    if (mask === null || previous === undefined) return
    const mctx = mask.getContext('2d')
    if (mctx === null) return
    mctx.putImageData(previous, 0, 0)
    setUndoDepth(undoRef.current.length)
    repaintView()
    setPainted(true)
  }

  const clearMask = (): void => {
    const mask = maskRef.current
    const view = viewRef.current
    if (mask === null || view === null) return
    pushUndo()
    mask.getContext('2d')?.clearRect(0, 0, mask.width, mask.height)
    view.getContext('2d')?.clearRect(0, 0, view.width, view.height)
    setPainted(false)
  }

  const apply = async (): Promise<void> => {
    const mask = maskRef.current
    if (mask === null) return
    setSaving(true)
    setError('')
    const out = document.createElement('canvas')
    out.width = mask.width
    out.height = mask.height
    const ctx = out.getContext('2d')
    if (ctx === null) {
      setError(t('maskSaveFailed'))
      setSaving(false)
      return
    }
    // 透明处补黑 = "保留"。不补的话 PNG 带透明区域，ComfyUI 读亮度时行为不确定。
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(mask, 0, 0)

    const blob = await new Promise<Blob | null>(resolve => { out.toBlob(resolve, 'image/png') })
    if (blob === null) {
      setError(t('maskSaveFailed'))
      setSaving(false)
      return
    }
    try {
      // 失败时父组件会抛 —— 这里**不关弹层**，保留画面让用户重试
      await onDone(blob, out.width, out.height)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="cmf-root" role="dialog" aria-modal="true" aria-label={t('maskEditorTitle')}>
      <div className="cmf-panel">
        <header className="cmf-head">
          <div className="cmf-title">{t('maskEditorTitle')}</div>
          <button type="button" className="cfa-btn" onClick={onCancel} title={t('close')} aria-label={t('close')}>
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="cmf-stage">
          <div className="cmf-wrap">
            <img className="cmf-base" src={src} alt="" draggable={false} />
            <canvas
              ref={viewRef}
              className="cmf-canvas"
              onPointerDown={strokeStart}
              onPointerMove={strokeMove}
              onPointerUp={strokeEnd}
              onPointerCancel={strokeEnd}
              onLostPointerCapture={strokeEnd}
            />
          </div>
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
            <button
              type="button"
              className="cfa-btn cfa-primary"
              disabled={saving || size === null || !painted}
              onClick={() => { void apply() }}
            >
              {saving ? t('maskSaving') : t('maskApply')}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
