import { useEffect, useMemo, useRef, useState } from 'react'

import { fetchConfig, fetchWorkflowDetail, fetchWorkflowList, fileUrl, freeMemory, pollRun, runDirect } from '../../../client/api.js'
import type { HostConfig } from '../../../client/api.js'
import { sendTextToComposer } from '../../../client/conversation.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { DirectRunResult, Notice, SurfaceSlot, WorkflowListItem, WorkflowSurface } from '../../../client/types.js'
import { Field } from './Field.js'
import { ImagePicker } from './ImagePicker.js'

export interface WorkflowPanelProps {
  t: Translate
  visible: boolean
  goToConversation: () => void
}

/** 常见画面比例。点一下把 width/height 按长边 1024 折算。 */
const RATIOS: Array<{ label: string; w: number; h: number }> = [
  { label: '1:1', w: 1, h: 1 },
  { label: '16:9', w: 16, h: 9 },
  { label: '9:16', w: 9, h: 16 },
  { label: '3:2', w: 3, h: 2 },
]

/** 用默认值初始化变量表；图片类不预填（模板里那张图多半在别人机器上）。 */
function initialVars(inputs: readonly SurfaceSlot[]): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  for (const slot of inputs) {
    if (slot.type === 'image' || slot.type === 'mask') continue
    if (slot.default !== undefined) vars[slot.name] = slot.default
  }
  return vars
}

/** 生成走对话时的指令文本。 */
function instructionOf(workflowId: string, vars: Record<string, unknown>): string {
  const cleaned: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined || value === '') continue
    cleaned[key] = value
  }
  return [
    `运行工作流 ${workflowId}，参数如下（请原样传给 comfyui_run，不要自行改动或补充）：`,
    '```json',
    JSON.stringify({ workflow: { id: workflowId }, vars: cleaned }),
    '```',
  ].join('\n')
}

/** 尺寸取 64 的倍数（多数模型要求），长边按 1024 折算。 */
function sizeFor(ratio: { w: number; h: number }, longEdge = 1024): { width: number; height: number } {
  const norm = Math.max(ratio.w, ratio.h)
  const round = (value: number): number => Math.max(64, Math.round(value / 64) * 64)
  return { width: round((ratio.w / norm) * longEdge), height: round((ratio.h / norm) * longEdge) }
}

/**
 * 工作流面板：左预览、右参数。
 *
 * 版式参考常见生图前端 —— 预览占主视区、参数收在右栏、主操作固定在底部；
 * 与它们不同的是表单完全由工作流的 IO 面生成，不是写死的几个旋钮。
 */
export function WorkflowPanel({ t, visible, goToConversation }: WorkflowPanelProps): React.ReactElement {
  const [list, setList] = useState<WorkflowListItem[]>([])
  const [selected, setSelected] = useState('')
  const [surface, setSurface] = useState<WorkflowSurface | null>(null)
  const [vars, setVars] = useState<Record<string, unknown>>({})
  const [mode, setMode] = useState<'conversation' | 'direct'>('direct')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [result, setResult] = useState<DirectRunResult | null>(null)
  const [brokenCount, setBrokenCount] = useState(0)
  const [config, setConfig] = useState<HostConfig | null>(null)
  const [outputDir, setOutputDir] = useState('')
  const [picked, setPicked] = useState('')
  const [online, setOnline] = useState<boolean | null>(null)
  /** 列表还在拉：不能把"加载中"显示成"还没有工作流"。 */
  const [loadingList, setLoadingList] = useState(true)
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchConfig()
      .then(cfg => {
        if (!alive) return
        setConfig(cfg)
        setOnline(true)
      })
      .catch(() => { if (alive) setOnline(false) })
    fetchWorkflowList()
      .then(data => {
        if (!alive) return
        setList(data.workflows)
        setBrokenCount(data.broken?.length ?? 0)
        setSelected(current => (current === '' && data.workflows.length === 1 ? (data.workflows[0]?.workflowId ?? '') : current))
      })
      .catch(error => { if (alive) setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { if (alive) setLoadingList(false) })
    return () => { alive = false }
  }, [visible])

  const stopPolling = (): void => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }
  useEffect(() => stopPolling, [])

  useEffect(() => {
    stopPolling()
    setBusy(false)
    setPicked('')
    if (selected === '') {
      setSurface(null)
      setVars({})
      return undefined
    }
    let alive = true
    fetchWorkflowDetail(selected)
      .then(detail => {
        if (!alive) return
        setSurface(detail)
        setVars(initialVars(detail.inputs))
        setResult(null)
      })
      .catch(error => { if (alive) setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) }) })
    return () => { alive = false }
  }, [selected])

  useEffect(() => {
    if (notice === null) return undefined
    const timer = setTimeout(() => setNotice(null), 3600)
    return () => clearTimeout(timer)
  }, [notice])

  const slots = surface?.inputs ?? []
  const promptSlot = slots.find(slot => slot.type === 'string' && /^(prompt|text|caption)$/i.test(slot.name))
  const imageSlots = slots.filter(slot => slot.type === 'image' || slot.type === 'mask')
  const widthSlot = slots.find(slot => /^width$/i.test(slot.name))
  const heightSlot = slots.find(slot => /^height$/i.test(slot.name))
  const tuned = slots.filter(slot => slot !== promptSlot && !imageSlots.includes(slot) && slot !== widthSlot && slot !== heightSlot)
  const setVar = (name: string, value: unknown): void => setVars(previous => ({ ...previous, [name]: value }))

  /** 当前比例（用于高亮）。 */
  const activeRatio = useMemo(() => {
    const w = Number(vars[widthSlot?.name ?? ''] ?? 0)
    const h = Number(vars[heightSlot?.name ?? ''] ?? 0)
    if (!w || !h) return ''
    const target = w / h
    return RATIOS.find(ratio => Math.abs(ratio.w / ratio.h - target) < 0.02)?.label ?? ''
  }, [vars, widthSlot, heightSlot])

  const applyRatio = (ratio: { label: string; w: number; h: number }): void => {
    if (widthSlot === undefined || heightSlot === undefined) return
    const size = sizeFor(ratio)
    setVars(previous => ({ ...previous, [widthSlot.name]: size.width, [heightSlot.name]: size.height }))
  }

  const missing = slots.filter(slot => slot.required && (vars[slot.name] === undefined || vars[slot.name] === ''))

  const track = (promptId: string, startedAt: number): void => {
    if (Date.now() - startedAt > 20 * 60 * 1000) {
      setBusy(false)
      setNotice({ kind: 'err', text: `${t('runFailed')}：等了 20 分钟还没结果。` })
      return
    }
    pollRef.current = window.setTimeout(() => {
      void pollRun(promptId)
        .then(outcome => {
          if (outcome.pending === true) {
            track(promptId, startedAt)
            return
          }
          setResult(outcome)
          setBusy(false)
          if (outcome.ok !== true) setNotice({ kind: 'err', text: outcome.message ?? t('runFailed') })
          else setNotice({ kind: 'ok', text: t('runDone').replace('{n}', String(outcome.artifacts?.length ?? 0)).replace('{ms}', String(outcome.durationMs ?? 0)) })
        })
        .catch(error => {
          setBusy(false)
          setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        })
    }, 2500)
  }

  const submit = async (): Promise<void> => {
    if (surface === null || busy) return
    if (missing.length > 0) {
      setNotice({ kind: 'err', text: `${t('needRequired')}${missing.map(slot => slot.label || slot.name).join('、')}` })
      return
    }
    stopPolling()
    setBusy(true)
    setPicked('')
    try {
      if (mode === 'conversation') {
        const ok = await sendTextToComposer(instructionOf(surface.workflowId, vars), { goToConversation })
        setNotice(ok ? { kind: 'ok', text: t('instructionFilled') } : { kind: 'err', text: t('instructionFailed') })
        setBusy(false)
        return
      }
      const submitted = await runDirect({
        workflowId: surface.workflowId,
        vars,
        ...(outputDir.trim() === '' ? {} : { outputPath: outputDir.trim() }),
      })
      if (submitted.ok !== true) {
        setResult(submitted)
        setNotice({ kind: 'err', text: `${submitted.message ?? t('runFailed')}${submitted.hint === undefined ? '' : ` — ${submitted.hint}`}` })
        setBusy(false)
        return
      }
      if (submitted.pending === true && submitted.promptId !== undefined) {
        setNotice({ kind: 'ok', text: t('submitted') })
        track(submitted.promptId, Date.now())
        return
      }
      setResult(submitted)
      setNotice({ kind: 'ok', text: t('runDone').replace('{n}', String(submitted.artifacts?.length ?? 0)).replace('{ms}', String(submitted.durationMs ?? 0)) })
      setBusy(false)
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
      setBusy(false)
    }
  }

  const free = async (): Promise<void> => {
    try {
      await freeMemory()
      setNotice({ kind: 'ok', text: t('memoryFreed') })
      setOnline(true)
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
      setOnline(false)
    }
  }

  if (loadingList) {
    return (
      <div className="cwf-empty">
        <Icon name="refresh" size={24} />
        <div className="cwf-empty-title">{t('loadingWorkflows')}</div>
      </div>
    )
  }

  if (list.length === 0) {
    return (
      <div className="cwf-empty">
        <Icon name="album" size={26} />
        <div className="cwf-empty-title">{t('emptyWorkflows')}</div>
        <div>{t('emptyWorkflowsHint')}</div>
      </div>
    )
  }

  const current = list.find(item => item.workflowId === selected)
  const artifacts = result?.ok === true ? (result.artifacts ?? []) : []
  const shown = artifacts.find(item => item.path === picked) ?? artifacts[0]
  const inputImage = imageSlots.find(slot => typeof vars[slot.name] === 'string' && vars[slot.name] !== '')
  const stagePath = shown?.path ?? (inputImage === undefined ? '' : String(vars[inputImage.name]))
  const stageIsInput = shown === undefined && stagePath !== ''

  return (
    <div className="cwf-app">
      <header className="cwf-top">
        <div className="cwf-pick">
          <select value={selected} onChange={event => setSelected(event.target.value)} aria-label={t('selectWorkflow')} title={current?.description ?? ''}>
            <option value="">{t('selectWorkflow')}</option>
            {list.map(item => (
              <option key={item.workflowId} value={item.workflowId}>
                {item.title}{item.model === '' ? '' : ` · ${item.model}`}
              </option>
            ))}
          </select>
          <span className="cwf-chevron" aria-hidden="true" />
        </div>
        <div className="cwf-status">
          <button type="button" className="cwf-ghost" onClick={() => { void free() }}>{t('freeMemory')}</button>
          <span><i className={`cwf-dot${online === false ? ' off' : ''}`} />{online === false ? t('offline') : t('ready')}</span>
        </div>
      </header>

      <div className="cwf-main">
        <section className="cwf-left">
          <div className="cwf-left-head">
            <span>{stageIsInput ? t('previewInput') : t('previewOutput')}</span>
            <div className="cwf-left-actions">
              {busy ? <span>{t('running')}</span> : shown !== undefined ? <span>{t('done')}</span> : null}
              {stagePath !== '' ? (
                <button type="button" className="cwf-ghost" onClick={() => { setPicked(''); setResult(null) }}>{t('clearPreview')}</button>
              ) : null}
            </div>
          </div>

          <div className="cwf-stage">
            {stagePath !== '' ? (
              <>
                <img src={fileUrl(stagePath, stageIsInput)} alt={stagePath} />
                <div className="cwf-stage-badge">
                  {shown !== undefined ? <span className="cwf-tag">{shown.digest}</span> : <span className="cwf-tag">{t('previewInputTag')}</span>}
                  {shown?.width !== undefined && shown.height !== undefined ? <span className="cwf-tag">{shown.width}×{shown.height}</span> : null}
                </div>
              </>
            ) : (
              <div className="cwf-stage-empty">
                <Icon name="image" size={28} />
                <div>{surface === null ? t('previewPickWorkflow') : t('previewEmpty')}</div>
              </div>
            )}
          </div>

          <div className="cwf-stage-foot">
            <button type="button" className="cwf-pill" disabled={shown === undefined} onClick={() => { if (shown !== undefined) window.open(fileUrl(shown.path), '_blank') }}>{t('download')}</button>
            <button
              type="button"
              className="cwf-pill"
              disabled={shown === undefined || imageSlots.length === 0}
              onClick={() => {
                if (shown === undefined || imageSlots[0] === undefined) return
                setVar(imageSlots[0].name, shown.path)
                setNotice({ kind: 'ok', text: t('usedAsReference') })
              }}
            >{t('useAsReference')}</button>
            <button
              type="button"
              className="cwf-pill"
              disabled={mode === 'conversation' && surface === null}
              onClick={() => { setNotice({ kind: 'ok', text: t('reuseHint') }) }}
            >{t('reuseParams')}</button>
            <button type="button" className="cwf-pill" onClick={() => setMode(mode === 'direct' ? 'conversation' : 'direct')} title={mode === 'direct' ? t('modeDirectHint') : t('modeConversationHint')}>
              {mode === 'direct' ? t('modeDirect') : t('modeConversation')}
            </button>
          </div>

          {artifacts.length > 1 ? (
            <div className="cwf-strip">
              {artifacts.map(item => (
                <button key={item.path} type="button" className={item.path === (shown?.path ?? '') ? 'on' : ''} onClick={() => setPicked(item.path)} title={item.path}>
                  <img src={fileUrl(item.path, true)} alt={item.path} loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </section>

        <aside className="cwf-right">
          {current?.missingModels !== undefined && current.missingModels.length > 0 ? (
            <div className="cwf-warn">
              <Icon name="close" size={14} />
              <span>{t('missingModels').replace('{names}', current.missingModels.join('、'))}</span>
              {current.modelHint !== undefined ? <span className="cwf-warn-hint">{current.modelHint}</span> : null}
            </div>
          ) : null}

          {surface !== null ? (
            <>
              {promptSlot !== undefined ? (
                <div className="cwf-group">
                  <div className="cwf-group-label">{promptSlot.label !== '' ? promptSlot.label : t('promptLabel')}</div>
                  <textarea
                    className="cwf-area"
                    value={typeof vars[promptSlot.name] === 'string' ? String(vars[promptSlot.name]) : ''}
                    onChange={event => setVar(promptSlot.name, event.target.value)}
                    placeholder={t('promptPlaceholder')}
                  />
                </div>
              ) : null}

              {imageSlots.length > 0 ? (
                <div className="cwf-group">
                  <div className="cwf-group-label">{t('referenceImage')}</div>
                  {imageSlots.map(slot => (
                    <ImagePicker key={slot.name} slot={slot} value={vars[slot.name]} t={t} onChange={value => setVar(slot.name, value)} />
                  ))}
                </div>
              ) : null}

              {widthSlot !== undefined && heightSlot !== undefined ? (
                <div className="cwf-group">
                  <div className="cwf-group-label">{t('aspectRatio')}</div>
                  <div className="cwf-ratios">
                    {RATIOS.map(ratio => (
                      <button key={ratio.label} type="button" className={`cwf-ratio${activeRatio === ratio.label ? ' on' : ''}`} onClick={() => applyRatio(ratio)}>
                        {ratio.label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {tuned.length > 0 ? (
                <div className="cwf-group">
                  <div className="cwf-group-label"><span>{t('paramsLabel')}</span></div>
                  <div className="cwf-pairs">
                    {tuned.slice(0, 6).map(slot => (
                      <Field key={slot.name} slot={slot} value={vars[slot.name]} t={t} onChange={value => setVar(slot.name, value)} />
                    ))}
                  </div>
                </div>
              ) : null}

              {tuned.length > 6 || widthSlot !== undefined ? (
                <details className="cwf-advanced">
                  <summary>{t('moreParams')}</summary>
                  <div className="cwf-advanced-body">
                    <div className="cwf-pairs">
                      {widthSlot !== undefined ? <Field slot={widthSlot} value={vars[widthSlot.name]} t={t} onChange={value => setVar(widthSlot.name, value)} /> : null}
                      {heightSlot !== undefined ? <Field slot={heightSlot} value={vars[heightSlot.name]} t={t} onChange={value => setVar(heightSlot.name, value)} /> : null}
                      {tuned.slice(6).map(slot => (
                        <Field key={slot.name} slot={slot} value={vars[slot.name]} t={t} onChange={value => setVar(slot.name, value)} />
                      ))}
                    </div>
                    <div className="cwf-group">
                      <div className="cwf-field-label">{t('outputDirLabel')}</div>
                      <input className="cwf-input" value={outputDir} placeholder={config?.outputDir ?? ''} onChange={event => setOutputDir(event.target.value)} spellCheck={false} />
                      <div className="cwf-hint">{t('outputDirHint')}</div>
                    </div>
                  </div>
                </details>
              ) : null}

              <div className="cwf-meta">
                {current?.model !== undefined && current.model !== '' ? `${t('modelLabel')} ${current.model}` : ''}
                {surface.outputs.length > 0 ? ` · ${surface.outputs.length} 个输出` : ''}
                {surface.meta.missingNodes.length > 0 ? ` · 缺节点 ${surface.meta.missingNodes.length}` : ''}
              </div>
            </>
          ) : null}

          {brokenCount > 0 ? <div className="cwf-hint">{t('brokenHint').replace('{n}', String(brokenCount))}</div> : null}
          {notice !== null ? <div className={`cwf-notice${notice.kind === 'err' ? ' err' : ''}`}>{notice.text}</div> : null}

          <div className="cwf-dock">
            <button type="button" className="cwf-generate" disabled={surface === null || busy} onClick={() => { void submit() }}>
              <Icon name="image" size={16} />
              {busy ? t('running') : t('run')}
              <kbd className="cwf-kbd">⌘↵</kbd>
            </button>
          </div>
        </aside>
      </div>
    </div>
  )
}
