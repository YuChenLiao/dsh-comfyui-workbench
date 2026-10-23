import { useEffect, useMemo, useState } from 'react'

import { fetchWorkflowDetail, fetchWorkflowList, fileUrl, runDirect } from '../api.js'
import { sendTextToComposer } from '../conversation.js'
import { Icon } from '../icons.js'
import type { Translate } from '../i18n.js'
import type { DirectRunResult, Notice, SurfaceSlot, WorkflowListItem, WorkflowSurface } from '../types.js'
import { Field } from './Field.js'

export interface WorkflowPanelProps {
  t: Translate
  visible: boolean
  goToConversation: () => void
}

/** 用默认值初始化变量表。 */
function initialVars(inputs: readonly SurfaceSlot[]): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  for (const slot of inputs) {
    if (slot.default !== undefined) vars[slot.name] = slot.default
  }
  return vars
}

/** 生成走对话时的指令文本：结构化 JSON，压缩模型改写的空间。 */
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

/**
 * 工作流面板：左边填参数，右边常驻预览。
 *
 * 第一屏只有提示词与图像输入；`seed`/`steps`/`cfg` 都收在"更多参数"里。
 * 节点配置不在这里出现 —— 那是 `comfyui_workflow_inspect` 的事。
 */
export function WorkflowPanel({ t, visible, goToConversation }: WorkflowPanelProps): React.ReactElement {
  const [list, setList] = useState<WorkflowListItem[]>([])
  const [selected, setSelected] = useState('')
  const [surface, setSurface] = useState<WorkflowSurface | null>(null)
  const [vars, setVars] = useState<Record<string, unknown>>({})
  const [mode, setMode] = useState<'conversation' | 'direct'>('conversation')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [result, setResult] = useState<DirectRunResult | null>(null)
  const [brokenCount, setBrokenCount] = useState(0)

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchWorkflowList()
      .then(data => {
        if (!alive) return
        setList(data.workflows)
        setBrokenCount(data.broken?.length ?? 0)
        setSelected(current => (current === '' && data.workflows.length === 1 ? (data.workflows[0]?.workflowId ?? '') : current))
      })
      .catch(error => { if (alive) setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) }) })
    return () => { alive = false }
  }, [visible])

  useEffect(() => {
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

  const basic = useMemo(() => surface?.inputs.filter(slot => slot.group === 'basic') ?? [], [surface])
  const advanced = useMemo(() => surface?.inputs.filter(slot => slot.group === 'advanced') ?? [], [surface])
  const missing = useMemo(
    () => (surface?.inputs ?? []).filter(slot => slot.required && (vars[slot.name] === undefined || vars[slot.name] === '')),
    [surface, vars],
  )

  const setVar = (name: string, value: unknown): void => setVars(previous => ({ ...previous, [name]: value }))

  const submit = async (): Promise<void> => {
    if (surface === null || busy) return
    if (missing.length > 0) {
      setNotice({
        kind: 'err',
        text: `${t('needRequired')}${missing.map(slot => (slot.label !== '' ? slot.label : slot.name)).join('、')}`,
      })
      return
    }
    setBusy(true)
    try {
      if (mode === 'conversation') {
        const ok = await sendTextToComposer(instructionOf(surface.workflowId, vars), { goToConversation })
        setNotice(ok ? { kind: 'ok', text: t('instructionFilled') } : { kind: 'err', text: t('instructionFailed') })
      } else {
        const outcome = await runDirect({ workflowId: surface.workflowId, vars })
        setResult(outcome)
        if (outcome.ok !== true) {
          setNotice({ kind: 'err', text: `${outcome.message ?? t('runFailed')}${outcome.hint === undefined ? '' : ` — ${outcome.hint}`}` })
        } else {
          setNotice({
            kind: 'ok',
            text: t('runDone').replace('{n}', String(outcome.artifacts?.length ?? 0)).replace('{ms}', String(outcome.durationMs ?? 0)),
          })
        }
      }
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  if (list.length === 0) {
    return (
      <div className="cwf-root">
        <div className="cwf-empty">
          <Icon name="album" size={26} />
          <div className="cwf-empty-title">{t('emptyWorkflows')}</div>
          <div>{t('emptyWorkflowsHint')}</div>
        </div>
      </div>
    )
  }

  const current = list.find(item => item.workflowId === selected)
  const artifacts = result?.ok === true ? (result.artifacts ?? []) : []
  const previewArtifact = artifacts[0]
  // 没有产物时回退到表单里已选的输入图 —— 用户选完图立刻就能确认选对了。
  const inputImageSlot = surface?.inputs.find(
    slot => slot.type === 'image' && typeof vars[slot.name] === 'string' && vars[slot.name] !== '',
  )
  const previewPath = previewArtifact?.path ?? (inputImageSlot !== undefined ? String(vars[inputImageSlot.name]) : '')
  const previewIsInput = previewArtifact === undefined && previewPath !== ''

  return (
    <div className="cwf-root">
      <div className="cwf-editor">
        <div className="cwf-bar">
          <select
            className="cwf-select"
            value={selected}
            onChange={event => setSelected(event.target.value)}
            title={current?.description ?? ''}
            aria-label={t('selectWorkflow')}
          >
            <option value="">{t('selectWorkflow')}</option>
            {list.map(item => (
              <option key={item.workflowId} value={item.workflowId} title={item.description}>
                {item.title}{item.model === '' ? '' : ` · ${item.model}`}
              </option>
            ))}
          </select>
          <div className="cwf-modes" role="group" aria-label={t('runModeLabel')}>
            <button type="button" className={`cwf-mode${mode === 'conversation' ? ' on' : ''}`} title={t('modeConversationHint')} onClick={() => setMode('conversation')}>
              {t('modeConversation')}
            </button>
            <button type="button" className={`cwf-mode${mode === 'direct' ? ' on' : ''}`} title={t('modeDirectHint')} onClick={() => setMode('direct')}>
              {t('modeDirect')}
            </button>
          </div>
          <button type="button" className="cwf-run" disabled={surface === null || busy} onClick={() => { void submit() }}>
            {busy ? t('running') : t('run')}
          </button>
        </div>

        {current !== undefined && current.description !== '' ? <p className="cwf-desc">{current.description}</p> : null}
        {current !== undefined && current.description === '' ? <p className="cwf-desc cwf-desc-weak">{t('undescribedHint')}</p> : null}

        {surface !== null ? (
          <div className="cwf-form">
            {basic.map(slot => (
              <Field key={slot.name} slot={slot} value={vars[slot.name]} t={t} onChange={value => setVar(slot.name, value)} />
            ))}
            {advanced.length > 0 ? (
              <details className="cwf-advanced">
                <summary>{t('moreParams')} · {advanced.length}</summary>
                <div className="cwf-advanced-body">
                  <div className="cwf-grid2">
                    {advanced.map(slot => (
                      <Field key={slot.name} slot={slot} value={vars[slot.name]} t={t} onChange={value => setVar(slot.name, value)} />
                    ))}
                  </div>
                </div>
              </details>
            ) : null}
          </div>
        ) : null}

        {brokenCount > 0 ? <p className="cwf-desc cwf-desc-weak">{t('brokenHint').replace('{n}', String(brokenCount))}</p> : null}
        {notice !== null ? <div className={`cwf-notice${notice.kind === 'err' ? ' err' : ''}`}>{notice.text}</div> : null}
      </div>

      <div className="cwf-side">
        <div className="cwf-preview">
          <div className="cwf-preview-head">
            <span>{previewIsInput ? t('previewInput') : t('previewOutput')}</span>
            {previewArtifact?.width !== undefined && previewArtifact.height !== undefined
              ? <span>{previewArtifact.width}×{previewArtifact.height}</span>
              : null}
          </div>
          <div className="cwf-stage">
            {previewPath !== '' ? (
              <>
                <img src={fileUrl(previewPath, !previewIsInput)} alt={previewPath} />
                <div className="cwf-stage-meta">
                  {previewArtifact !== undefined
                    ? <span className="cwf-tag">{previewArtifact.digest}</span>
                    : <span className="cwf-tag">{t('previewInputTag')}</span>}
                </div>
              </>
            ) : (
              <div className="cwf-stage-empty">
                <Icon name="image" size={26} />
                <div>{surface === null ? t('previewPickWorkflow') : t('previewEmpty')}</div>
              </div>
            )}
          </div>
          {artifacts.length > 1 ? (
            <div className="cwf-results">
              {artifacts.map(artifact => (
                <figure key={artifact.path} className="cwf-result">
                  <img src={fileUrl(artifact.path, true)} alt={artifact.path} loading="lazy" />
                  <figcaption>{artifact.digest}</figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
