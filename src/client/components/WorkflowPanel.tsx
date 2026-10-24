import { useEffect, useMemo, useRef, useState } from 'react'

import { fetchConfig, fetchWorkflowDetail, fetchWorkflowList, fileUrl, pollRun, runDirect } from '../api.js'
import type { HostConfig } from '../api.js'
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

/**
 * 用默认值初始化变量表。
 *
 * 图片类**不预填**：模板里那张图是作者机器上的路径或 ComfyUI input 里的文件名，
 * 直接显示成"已选"会让人以为选了张有用图，跑起来才发现不对。
 * 空着让用户自己拖一张；不填时服务端仍会用模板原值（submitWorkflow 会处理路径）。
 */
function initialVars(inputs: readonly SurfaceSlot[]): Record<string, unknown> {
  const vars: Record<string, unknown> = {}
  for (const slot of inputs) {
    if (slot.type === 'image' || slot.type === 'mask') continue
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
  const [config, setConfig] = useState<HostConfig | null>(null)
  /** 用户可改的输出目录；空串表示用宿主默认。 */
  const [outputDir, setOutputDir] = useState('')
  /** 轮询句柄：提交后每 2.5 秒查一次，组件卸载或换工作流时停掉。 */
  const pollRef = useRef<number | null>(null)

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchConfig()
      .then(cfg => { if (alive) setConfig(cfg) })
      .catch(() => { /* 拿不到配置也能用默认值跑 */ })
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
    stopPolling()
    setBusy(false)
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

  const stopPolling = (): void => {
    if (pollRef.current !== null) {
      window.clearTimeout(pollRef.current)
      pollRef.current = null
    }
  }

  useEffect(() => stopPolling, [])

  const track = (promptId: string, startedAt: number): void => {
    // 20 分钟兜底：真卡住了就别一直转。
    if (Date.now() - startedAt > 20 * 60 * 1000) {
      setBusy(false)
      setNotice({ kind: 'err', text: `${t('runFailed')}：等了 20 分钟还没结果，可以去 ComfyUI 界面看队列。` })
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
          if (outcome.ok !== true) {
            setNotice({ kind: 'err', text: outcome.message ?? t('runFailed') })
          } else {
            setNotice({
              kind: 'ok',
              text: t('runDone').replace('{n}', String(outcome.artifacts?.length ?? 0)).replace('{ms}', String(outcome.durationMs ?? 0)),
            })
          }
        })
        .catch(error => {
          setBusy(false)
          setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
        })
    }, 2500)
  }

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
    stopPolling()
    setBusy(true)
    try {
      if (mode === 'conversation') {
        const ok = await sendTextToComposer(instructionOf(surface.workflowId, vars), { goToConversation })
        setNotice(ok ? { kind: 'ok', text: t('instructionFilled') } : { kind: 'err', text: t('instructionFailed') })
        setBusy(false)
      } else {
        // 提交即返回，之后轮询。这样一个请求不会挂几分钟。
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
          return // busy 保持，等轮询结束
        }
        setResult(submitted)
        setNotice({
          kind: 'ok',
          text: t('runDone').replace('{n}', String(submitted.artifacts?.length ?? 0)).replace('{ms}', String(submitted.durationMs ?? 0)),
        })
        setBusy(false)
        return
      }
    } catch (error) {
      setNotice({ kind: 'err', text: error instanceof Error ? error.message : String(error) })
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

        {current?.missingModels !== undefined && current.missingModels.length > 0 ? (
          <div className="cwf-warn">
            <Icon name="close" size={14} />
            <span>{t('missingModels').replace('{names}', current.missingModels.join('、'))}</span>
            {current.modelHint !== undefined ? <span className="cwf-warn-hint">{current.modelHint}</span> : null}
          </div>
        ) : null}
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

        {surface !== null ? (
          <div className="cwf-outdir">
            <div className="cwf-field-label"><span>{t('outputDirLabel')}</span></div>
            <div className="cwf-outdir-row">
              <input
                className="cwf-input"
                value={outputDir}
                placeholder={config?.outputDir ?? ''}
                onChange={event => setOutputDir(event.target.value)}
                spellCheck={false}
              />
              {outputDir !== '' ? (
                <button type="button" className="cwf-icon-btn" title={t('outputDirReset')} onClick={() => setOutputDir('')}>
                  <Icon name="refresh" size={15} />
                </button>
              ) : null}
            </div>
            <div className="cwf-hint">{t('outputDirHint')}</div>
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
