/**
 * 输入框上方的快捷生图停靠区（`conversation.input.dock`）。
 *
 * 目标很窄：**不离开对话页就能起一次高频出图**。所以它只做三件事 ——
 * 选工作流、选预设、写核心变量 —— 然后把一段可以直接照做的指令塞进草稿框。
 *
 * 不在这里直接调 `comfyui_run`：那等于绕过对话把结果丢给用户，既没有工具卡片
 * 也没有交付物登记；走草稿则是"用户看一眼、回车执行"，用的仍是同一条成熟链路。
 */

import { useEffect, useState } from 'react'

import { sendTextToComposer } from '../conversation.js'
import type { InputDockProps } from '../host/props.js'
import DOCK_CSS from './QuickRunDock.css'

/** `/workflows` 里的单条（只取用得到的字段）。 */
interface WorkflowRow {
  id?: string
  title?: string
  enabled?: boolean
  presets?: string[]
}

/** 生成一段"照着做就行"的指令文本。 */
export function buildQuickRunPrompt(workflowId: string, preset: string, vars: Record<string, string>): string {
  const parts = [`请用 comfyui_run 出图：workflow=${workflowId}`]
  if (preset !== '') parts.push(`preset=${preset}`)
  const pairs = Object.entries(vars).filter(([, value]) => value !== '')
  if (pairs.length > 0) {
    const json = JSON.stringify(Object.fromEntries(pairs))
    parts.push(`vars=${json}`)
  }
  return `${parts.join('，')}。`
}

/**
 * 快捷生图停靠区。
 *
 * @param props - 适配层归一化后的 props（`sessionId` + `draft`）。
 */
export function QuickRunDock(props: InputDockProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<WorkflowRow[]>([])
  const [workflowId, setWorkflowId] = useState('')
  const [preset, setPreset] = useState('')
  const [prompt, setPrompt] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    void (async () => {
      try {
        const res = await fetch('/comfyui-workbench/api/workflows?enabled=1')
        if (!res.ok) return
        const data = (await res.json()) as { ok?: boolean; workflows?: WorkflowRow[] }
        if (!alive || data.ok !== true) return
        const list = Array.isArray(data.workflows) ? data.workflows : []
        setRows(list.filter(row => row.enabled !== false))
      } catch {
        // 拉不到列表就保持空：选不了工作流时这里不该报错
      }
    })()
    return () => { alive = false }
  }, [open])

  const current = rows.find(row => (row.id ?? row.title ?? '') === workflowId)
  const presets = Array.isArray(current?.presets) ? current.presets : []

  const submit = async (): Promise<void> => {
    if (workflowId === '') {
      setNote('先选一个工作流')
      return
    }
    const text = buildQuickRunPrompt(workflowId, preset, prompt === '' ? {} : { prompt })
    const ok = await sendTextToComposer(text, { goToConversation: () => {} })
    setNote(ok ? '已填入输入框，回车即执行' : '找不到输入框，请手动粘贴')
  }

  return (
    <div className="cqd-root">
      <style>{DOCK_CSS}</style>
      <button type="button" className="cqd-head" onClick={() => setOpen(value => !value)}>
        <span className="cqd-caret">{open ? '▾' : '▸'}</span>
        <span>快速生图</span>
        {props.draft.trim() !== '' ? <span className="cqd-hint">草稿 {props.draft.length} 字</span> : null}
      </button>

      {open ? (
        <div className="cqd-body">
          <select
            className="cqd-select"
            value={workflowId}
            onChange={event => { setWorkflowId(event.target.value); setPreset('') }}
          >
            <option value="">选择工作流…</option>
            {rows.map(row => {
              const id = row.id ?? row.title ?? ''
              return <option key={id} value={id}>{row.title ?? id}</option>
            })}
          </select>

          {presets.length > 0 ? (
            <select className="cqd-select" value={preset} onChange={event => setPreset(event.target.value)}>
              <option value="">默认参数</option>
              {presets.map(name => <option key={name} value={name}>{name}</option>)}
            </select>
          ) : null}

          <textarea
            className="cqd-prompt"
            rows={2}
            placeholder="提示词（可选，会作为 vars.prompt）"
            value={prompt}
            onChange={event => setPrompt(event.target.value)}
          />

          <div className="cqd-actions">
            <button type="button" className="cqd-btn" onClick={() => { void submit() }}>填入对话</button>
            {note !== '' ? <span className="cqd-note">{note}</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}
