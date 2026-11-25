/**
 * 对话流里的出图卡片（`tool.call.toolview`）。
 *
 * 为什么自己画而不复用宿主的 `tool.call.images`：那个子槽位是 `single`，且已被内置
 * `read_image` 的 toolview 占用 —— 第二个占位者会在加载时抛错。所以图片/视频预览
 * 都在本组件里自绘，走 `/api/file` 与 `/api/run-preview`。
 *
 * 三种形态：
 * - preparing / start：只有参数，说明它要干什么；
 * - result + `pending:true`：异步提交成功，轮询 `/run-status` 拿排队位次与采样进度，
 *   同时用 `/run-preview` 拉潜空间预览帧（只显示最新一帧）；
 * - result + `artifacts`：同步出图完成，直接渲染产物缩略图。
 */

import { useEffect, useRef, useState } from 'react'

import { fileUrl } from '../api.js'
import type { ToolViewProps } from '../host/props.js'
import CARD_CSS from './ToolRunCard.css'

/** `/run-status` 的响应（只声明用得到的字段）。 */
interface RunSnapshot {
  found: boolean
  state?: string
  queuePosition?: number
  progress?: { value: number; max: number }
  artifacts?: Array<{ path: string }>
  error?: { code?: string; message?: string }
}

/** 我们工具结果的形状（`jsonOutput` 保证它是 JSON 文本）。 */
interface ToolResult {
  ok?: boolean
  pending?: boolean
  promptId?: string
  artifacts?: Array<string | { path?: string }>
  message?: string
  error?: string
  notes?: string[]
}

/** 轮询间隔。出图要几分钟，2 秒足够跟手又不吵。 */
const POLL_MS = 2_000

/** 把工具结果文本解析成结构化对象；不是 JSON 就返回 undefined。 */
export function parseToolResult(text: string): ToolResult | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed[0] !== '{') return undefined
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return parsed !== null && typeof parsed === 'object' ? (parsed as ToolResult) : undefined
  } catch {
    return undefined
  }
}

/** 从结果里取出产物路径（兼容字符串数组与 `{path}` 对象数组）。 */
export function artifactPathsOf(result: ToolResult | undefined): string[] {
  if (result === undefined || !Array.isArray(result.artifacts)) return []
  const out: string[] = []
  for (const item of result.artifacts) {
    if (typeof item === 'string') out.push(item)
    else if (item !== null && typeof item === 'object' && typeof item.path === 'string') out.push(item.path)
  }
  return out
}

/** 按扩展名判断是不是视频（相册那边同一套判定，这里只用得着这两种）。 */
export function isVideoPath(path: string): boolean {
  return /\.(mp4|webm|mkv|avi|mov)$/i.test(path)
}

/**
 * 出图卡片。
 *
 * @param props - 适配层归一化后的 props。
 */
export function ToolRunCard(props: ToolViewProps): React.ReactElement {
  const { callId, toolName, phase, text, isError, errorCode } = props
  const result = phase === 'result' ? parseToolResult(text) : undefined

  const promptId = typeof result?.promptId === 'string' ? result.promptId : ''
  const pending = result?.pending === true && promptId !== ''
  const done = artifactPathsOf(result)

  const [snapshot, setSnapshot] = useState<RunSnapshot | undefined>(undefined)
  const [previewTick, setPreviewTick] = useState(0)
  const [previewBroken, setPreviewBroken] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (!pending) return undefined
    let alive = true

    const pull = async (): Promise<void> => {
      try {
        const res = await fetch(`/comfyui-workbench/api/run-status?promptId=${encodeURIComponent(promptId)}`)
        if (!res.ok) return
        const data = (await res.json()) as RunSnapshot & { ok?: boolean }
        if (!alive || data.ok !== true) return
        setSnapshot(data)
        // 还在跑：让预览图的 URL 变一下，绕开浏览器缓存
        if (data.state === 'running') setPreviewTick(value => value + 1)
      } catch {
        // 轮询失败不打断界面：下一轮继续
      }
    }

    void pull()
    timerRef.current = setInterval(() => { void pull() }, POLL_MS)
    return () => {
      alive = false
      if (timerRef.current !== null) clearInterval(timerRef.current)
    }
  }, [pending, promptId])

  const progress = snapshot?.progress
  const percent = progress !== undefined && progress.max > 0
    ? Math.min(100, Math.round((progress.value / progress.max) * 100))
    : undefined
  const finished = snapshot?.state === 'done' || snapshot?.state === 'failed'
  const shots = done.length > 0 ? done : artifactPathsOf(snapshot as ToolResult | undefined)

  // 失败：工具自己报错，或状态查询回来是 failed
  const failure = isError || result?.ok === false || snapshot?.state === 'failed'
  const failureText = snapshot?.error?.message
    ?? result?.error
    ?? result?.message
    ?? (isError ? text || '工具执行失败' : '')

  return (
    <div className="ctv-card">
      <style>{CARD_CSS}</style>
      <div className="ctv-head">
        <span className="ctv-tool">{toolName}</span>
        <span className={`ctv-state${failure ? ' err' : ''}`}>
          {failure
            ? (errorCode ?? 'failed')
            : phase !== 'result'
              ? '准备中'
              : pending && !finished
                ? (snapshot?.state === 'queued' ? '排队中' : '出图中')
                : '已完成'}
        </span>
        {snapshot?.queuePosition !== undefined && !finished
          ? <span className="ctv-meta">队列第 {snapshot.queuePosition} 位</span>
          : null}
        {percent !== undefined && !finished ? <span className="ctv-meta">{percent}%</span> : null}
        {callId !== '' ? <span className="ctv-id">{callId.slice(0, 8)}</span> : null}
      </div>

      {percent !== undefined && !finished && !failure ? (
        <div className="ctv-bar"><span style={{ width: `${percent}%` }} /></div>
      ) : null}

      {/* 运行中：潜空间预览帧。加载失败（还没有帧）就静默隐藏，不占位。 */}
      {pending && !finished && !previewBroken ? (
        <img
          className="ctv-preview"
          alt="潜空间预览"
          src={`/comfyui-workbench/api/run-preview?promptId=${encodeURIComponent(promptId)}&t=${previewTick}`}
          onError={() => setPreviewBroken(true)}
        />
      ) : null}

      {shots.length > 0 ? (
        <div className="ctv-shots">
          {shots.map(path => (
            <a key={path} className="ctv-shot" href={fileUrl(path)} target="_blank" rel="noreferrer">
              {isVideoPath(path)
                ? <video className="ctv-media" src={fileUrl(path)} controls preload="metadata" />
                : <img className="ctv-media" src={fileUrl(path, true)} alt={path.split(/[\\/]/).pop() ?? '产物'} loading="lazy" />}
            </a>
          ))}
        </div>
      ) : null}

      {failure ? <div className="ctv-err">{failureText}</div> : null}

      {result?.notes !== undefined && result.notes.length > 0 ? (
        <div className="ctv-note">{result.notes.join(' · ')}</div>
      ) : null}
    </div>
  )
}
