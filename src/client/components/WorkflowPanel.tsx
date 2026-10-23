import { useEffect, useMemo, useState } from 'react'

import { fetchWorkflowDetail, fetchWorkflowList, fileUrl, runDirect } from '../api.js'
import { sendTextToComposer } from '../conversation.js'
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
 * 工作流面板：用户只看输入与输出。
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
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [brokenCount, setBrokenCount] = useState(0)

  // 列表：只在可见时拉，避免后台标签页反复请求。
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

  // 选中即拉 IO 面，并把默认值灌进表单。
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
    const timer = setTimeout(() => setNotice(null), 3200)
    return () => clearTimeout(timer)
  }, [notice])

  const basic = useMemo(() => surface?.inputs.filter(slot => slot.group === 'basic') ?? [], [surface])
  const advanced = useMemo(() => surface?.inputs.filter(slot => slot.group === 'advanced') ?? [], [surface])
  const missing = useMemo(
    () => (surface?.inputs ?? []).filter(slot => slot.required && (vars[slot.name] === undefined || vars[slot.name] === '')),
    [surface, vars],
  )

  const submit = async (): Promise<void> => {
    if (surface === null || busy) return
    if (missing.length > 0) {
      setNotice({ kind: 'err', text: `${t('needRequired')}${missing.map(slot => slot.name).join('、')}` })
      return
    }

    setBusy(true)
    try {
      if (mode === 'conversation') {
        const ok = await sendTextToComposer(instructionOf(surface.workflowId, vars), { goToConversation })
        setNotice(ok
          ? { kind: 'ok', text: t('instructionFilled') }
          : { kind: 'err', text: t('instructionFailed') })
      } else {
        const outcome = await runDirect({ workflowId: surface.workflowId, vars })
        if (outcome.ok !== true) {
          setNotice({ kind: 'err', text: `${outcome.message ?? '运行失败'}${outcome.hint === undefined ? '' : ` — ${outcome.hint}`}` })
          setResult(outcome)
        } else {
          setResult(outcome)
          setNotice({ kind: 'ok', text: `完成：${outcome.artifacts?.length ?? 0} 个产物，用时 ${outcome.durationMs ?? 0} ms。` })
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
          <p>{t('emptyWorkflows')}</p>
          <p className="cwf-hint">{t('emptyWorkflowsHint')}</p>
        </div>
      </div>
    )
  }

  const current = list.find(item => item.workflowId === selected)

  return (
    <div className="cwf-root">
      <header className="cwf-bar">
        <select
          className="cwf-select"
          value={selected}
          onChange={event => setSelected(event.target.value)}
          title={current?.description ?? ''}
        >
          <option value="">{t('selectWorkflow')}</option>
          {list.map(item => (
            <option key={item.workflowId} value={item.workflowId} title={item.description}>
              {item.title}
              {item.model === '' ? '' : ` · ${item.model}`}
            </option>
          ))}
        </select>
        <div className="cwf-modes" role="group" aria-label={t('run')}>
          <button
            type="button"
            className={`cwf-chip${mode === 'conversation' ? ' on' : ''}`}
            title={t('modeConversationHint')}
            onClick={() => setMode('conversation')}
          >{t('modeConversation')}</button>
          <button
            type="button"
            className={`cwf-chip${mode === 'direct' ? ' on' : ''}`}
            title={t('modeDirectHint')}
            onClick={() => setMode('direct')}
          >{t('modeDirect')}</button>
        </div>
        <button type="button" className="cwf-run" disabled={surface === null || busy} onClick={() => { void submit() }}>
          {busy ? t('running') : t('run')}
        </button>
      </header>

      {current !== undefined && current.description !== '' ? <p className="cwf-desc">{current.description}</p> : null}
      {current !== undefined && current.description === '' ? (
        <p className="cwf-desc cwf-desc-missing">{t('undescribedHint')}</p>
      ) : null}

      {surface !== null ? (
        <div className="cwf-form">
          {basic.map(slot => (
            <Field
              key={slot.name}
              slot={slot}
              value={vars[slot.name]}
              t={t}
              onChange={value => setVars(previous => ({ ...previous, [slot.name]: value }))}
            />
          ))}
          {advanced.length > 0 ? (
            <details className="cwf-advanced" open={showAdvanced} onToggle={event => setShowAdvanced((event.target as HTMLDetailsElement).open)}>
              <summary>{t('moreParams')}（{advanced.length}）</summary>
              <div className="cwf-grid2">
                {advanced.map(slot => (
                  <Field
                    key={slot.name}
                    slot={slot}
                    value={vars[slot.name]}
                    t={t}
                    onChange={value => setVars(previous => ({ ...previous, [slot.name]: value }))}
                  />
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}

      {result !== null && result.ok === true && (result.artifacts?.length ?? 0) > 0 ? (
        <div className="cwf-output">
          <div className="cwf-output-title">{t('outputTitle')}</div>
          <div className="cwf-output-grid">
            {(result.artifacts ?? []).map(artifact => (
              <figure key={artifact.path} className="cwf-out-card">
                <img src={fileUrl(artifact.path, true)} alt={artifact.path} loading="lazy" />
                <figcaption>{artifact.digest}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      ) : null}

      {brokenCount > 0 ? <p className="cwf-desc cwf-desc-missing">{t('brokenHint')}（{brokenCount}）</p> : null}
      {notice !== null ? <div className={`cwf-notice${notice.kind === 'err' ? ' err' : ''}`}>{notice.text}</div> : null}
    </div>
  )
}
