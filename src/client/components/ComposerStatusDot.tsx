/**
 * 输入框工具行左侧的迷你状态点（`conversation.input.left`）。
 *
 * 只回答一个问题："现在能不能出图、要不要等我"。四个状态：
 * - 在线：可以直接出图；
 * - 启动中：正在拉起，别重复点；
 * - 离线：没起，点一下拉起来；
 * - 出图中 N：队列里有活。
 *
 * 刻意做成**一行小字**而不是一个面板：这条槽位在输入框旁边，窄、常驻，
 * 任何大块内容都会把工具栏挤换行。
 */

import { useEffect, useRef, useState } from 'react'

import type { ComposerStatusProps } from '../host/props.js'
import DOT_CSS from './ComposerStatusDot.css'

/** `/service/stats` 里我们关心的部分。 */
interface StatsPayload {
  ok: boolean
  service: { state?: string; managed?: boolean; detail?: string }
  active?: Array<{ promptId?: string; state?: string }>
}

/** 轮询间隔：与工作流面板顶部状态条一致。 */
const POLL_MS = 5_000

/** 把服务状态翻成给人看的短词。 */
export function statusLabel(state: string | undefined, running: number): string {
  if (running > 0) return `出图中 ${running}`
  if (state === 'ready') return '在线'
  if (state === 'starting') return '启动中'
  if (state === 'external') return '外部实例'
  if (state === 'failed') return '离线'
  return '未知'
}

/** 状态对应的点颜色类名（`dot` 后缀）。 */
export function dotKind(state: string | undefined, running: number): string {
  if (running > 0) return 'busy'
  if (state === 'ready') return 'ok'
  if (state === 'starting') return 'wait'
  if (state === 'external') return 'ext'
  if (state === 'failed') return 'bad'
  return 'idle'
}

/** 迷你状态点 props：宿主归一化字段 + 打开工作台的回调。 */
export interface ComposerStatusDotProps extends ComposerStatusProps {
  /** 打开工作台（由入口层优先走侧边栏、否则切主面板，避免硬编码无效 URL）。 */
  onOpenWorkbench?: () => void
}

/**
 * 迷你状态点。
 *
 * @param props - 适配层归一化后的 props（这条槽位只有 `sessionId`）与打开工作台回调。
 */
export function ComposerStatusDot(props: ComposerStatusDotProps): React.ReactElement {
  const [state, setState] = useState<string | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [running, setRunning] = useState(0)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node | null
      if (rootRef.current !== null && target !== null && !rootRef.current.contains(target)) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    let alive = true
    const pull = async (): Promise<void> => {
      try {
        const res = await fetch('/comfyui-workbench/api/service/stats')
        if (!res.ok) return
        const data = (await res.json()) as StatsPayload
        if (!alive || data.ok !== true) return
        setState(data.service?.state)
        setFailed(false)
        const active = Array.isArray(data.active) ? data.active : []
        setRunning(active.filter(row => row.state === 'running' || row.state === 'queued').length)
      } catch {
        // 插件没起 / 接口 404：算离线，不要一直显示"未知"
        if (alive) setFailed(true)
      }
    }
    void pull()
    timerRef.current = setInterval(() => { void pull() }, POLL_MS)
    return () => {
      alive = false
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [])

  const effective = failed ? 'failed' : state
  const label = failed ? '未连接' : statusLabel(effective, running)
  const kind = dotKind(effective, running)
  const canStart = (effective === 'unknown' || effective === 'failed' || failed) && !busy

  const start = async (): Promise<void> => {
    setBusy(true)
    try {
      await fetch('/comfyui-workbench/api/terminal?action=start', { method: 'POST' })
    } catch {
      // 拉不起来的原因会从下一轮状态里反映
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={rootRef} className="cst-root">
      <style>{DOT_CSS}</style>
      <button
        type="button"
        className={`cst-dot cst-${kind}`}
        title={failed ? '插件接口不可用' : (props.sessionId === undefined ? label : `${label} · 会话 ${props.sessionId.slice(0, 6)}`)}
        onClick={() => setOpen(value => !value)}
      >
        <span className="cst-point" />
        <span className="cst-label">{label}</span>
      </button>

      {open ? (
        <div className="cst-menu">
          {canStart ? (
            <button type="button" className="cst-item" onClick={() => { setOpen(false); void start() }}>
              启动 ComfyUI
            </button>
          ) : null}
          <button
            type="button"
            className="cst-item"
            onClick={() => { setOpen(false); props.onOpenWorkbench?.() }}
          >
            打开工作台
          </button>
        </div>
      ) : null}
    </div>
  )
}
