import { useEffect, useRef, useState } from 'react'

import { API, fileUrl } from '../api.js'
import { Icon } from '../icons.js'
import type { Translate } from '../i18n.js'
import type { SurfaceSlot } from '../types.js'

/** 上传结果。 */
interface UploadResult {
  ok: boolean
  path?: string
  bytes?: number
  mime?: string
  width?: number
  height?: number
  message?: string
}

/**
 * 图片输入：拖拽 / 点击 / 粘贴，选完立刻看到预览。
 *
 * 值仍然是**绝对路径**（工作流要的就是路径），但用户不需要知道这件事 ——
 * 他只需要把图拖进来。上传走二进制直传，不经 base64。
 */
export function ImagePicker(props: {
  slot: SurfaceSlot
  value: unknown
  t: Translate
  onChange: (value: unknown) => void
}): React.ReactElement {
  const { slot, value, t, onChange } = props
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  /** 手动填路径模式：图已经在某个目录里，不想再传一份。 */
  const [manual, setManual] = useState(false)
  const [draft, setDraft] = useState('')

  const target = typeof value === 'string' ? value : ''
  const filled = target !== ''

  useEffect(() => {
    setSize(null)
  }, [target])

  const upload = async (file: File): Promise<void> => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`${API}/upload?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'content-type': file.type !== '' ? file.type : 'application/octet-stream' },
        body: file,
      })
      const body = (await res.json()) as UploadResult
      if (!res.ok || body.ok !== true || typeof body.path !== 'string') {
        throw new Error(body.message ?? `上传失败：HTTP ${res.status}`)
      }
      onChange(body.path)
      if (body.width !== undefined && body.height !== undefined) setSize({ w: body.width, h: body.height })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const take = (files: FileList | null): void => {
    const file = files?.[0]
    if (file !== undefined) void upload(file)
  }

  return (
    <div className="cwf-field">
      <div className="cwf-field-label">
        <span>{slot.label !== '' ? slot.label : slot.name}</span>
        {slot.required ? <span className="cwf-req" title={t('requiredField')}>*</span> : null}
      </div>

      {filled ? (
        <div className="cwf-picked">
          <div className="cwf-picked-thumb">
            <img
              src={fileUrl(target, true)}
              alt={target}
              onLoad={event => {
                const img = event.currentTarget
                if (size === null && img.naturalWidth > 0) setSize({ w: img.naturalWidth, h: img.naturalHeight })
              }}
            />
          </div>
          <div className="cwf-picked-meta">
            <div className="cwf-picked-name" title={target}>{target.split(/[\\/]/).pop()}</div>
            <div className="cwf-picked-sub">
              {size !== null ? `${size.w}×${size.h}` : '\u00a0'}
            </div>
          </div>
          <div className="cwf-picked-actions">
            <button type="button" className="cwf-icon-btn" title={t('replaceImage')} onClick={() => inputRef.current?.click()}>
              <Icon name="refresh" size={15} />
            </button>
            <button type="button" className="cwf-icon-btn cwf-icon-danger" title={t('clearImage')} onClick={() => onChange('')}>
              <Icon name="close" size={15} />
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`cwf-drop${dragOver ? ' over' : ''}${busy ? ' busy' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              inputRef.current?.click()
            }
          }}
          onDragOver={event => {
            event.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={event => {
            event.preventDefault()
            setDragOver(false)
            take(event.dataTransfer.files)
          }}
          onPaste={event => {
            const item = Array.from(event.clipboardData.items).find(entry => entry.type.startsWith('image/'))
            const file = item?.getAsFile()
            if (file !== null && file !== undefined) {
              event.preventDefault()
              void upload(file)
            }
          }}
        >
          <span className="cwf-drop-icon"><Icon name="image" size={20} /></span>
          <span className="cwf-drop-title">{busy ? t('uploading') : t('dropImage')}</span>
          <span className="cwf-drop-hint">{t('dropImageHint')}</span>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp"
        className="cwf-sr-only"
        onChange={event => {
          take(event.target.files)
          event.target.value = ''
        }}
      />
      {!filled && manual ? (
        <input
          className="cwf-input"
          placeholder={t('manualPathHint')}
          value={draft}
          spellCheck={false}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => { if (draft.trim() !== '') onChange(draft.trim()) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && draft.trim() !== '') onChange(draft.trim())
          }}
        />
      ) : null}
      {!filled ? (
        <button type="button" className="cwf-link" onClick={() => setManual(value => !value)}>
          {manual ? t('manualPathCancel') : t('manualPath')}
        </button>
      ) : null}
      {error !== '' ? <div className="cwf-hint cwf-hint-err">{error}</div> : null}
    </div>
  )
}
