import { useCallback, useEffect, useRef, useState } from 'react'

import { stopService } from '../../../client/api.js'
import type { Translate } from '../../../client/i18n.js'
import { planStopButton, runStop } from './terminal-stop.js'
import TERMINAL_CSS from './styles.css'

/** 一条终端输出（与后端 TerminalLine 对应）。 */
interface Line {
  seq: number
  stream: 'out' | 'err'
  text: string
  at: number
}

/** 托管状态（后端 ServiceStatus 的子集）。 */
interface Status {
  state: string
  managed: boolean
  detail?: string
  baseUrl: string
  pid?: number
  /** 队列里还有没有活（面板据此决定「关机」要不要二次确认）。 */
  busy?: boolean
}

interface Payload {
  ok: boolean
  lines: Line[]
  cursor: number
  dropped: number
  truncated: boolean
  /** 缓冲实例代号：变了就说明被重建，旧 cursor 不再可信。 */
  epoch: string
  status: Status
}

/** 轮询间隔。日志不是秒级敏感的，1 秒够用且不吵。 */
const POLL_MS = 1000

/** 屏幕上最多留多少行（再多就用 CSS 滚动，不删 DOM 会更卡）。 */
const MAX_RENDER = 2000

export interface TerminalProps {
  t: Translate
  visible: boolean
}

/**
 * ComfyUI 终端面板。
 *
 * 只读地跟着进程输出走。三件必须做对的事：
 * 一是**自动滚底**，但用户往上翻时不能把他拽回来；二是**增量拉取**（带 cursor），
 * 不重复下载整屏；三是**说清为什么没输出** —— 外部启动的实例，stdout 在别人的终端里。
 */
export function Terminal({ t, visible }: TerminalProps): React.ReactElement {
  const [lines, setLines] = useState<Line[]>([])
  const [status, setStatus] = useState<Status | undefined>(undefined)
  const [dropped, setDropped] = useState(0)
  const [following, setFollowing] = useState(true)
  const [filter, setFilter] = useState('')
  const [paused, setPaused] = useState(false)

  const cursor = useRef(0)
  /** 记住当前缓冲的代号；变了说明插件热重载过。 */
  const epochRef = useRef('')
  /** 有没有请求还在路上。 */
  const inflight = useRef(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  const pull = useCallback(async (): Promise<void> => {
    // 上一轮还没回来就再发一次，会拿到同一段增量并重复 append（React key 也会重复）。
    if (inflight.current) return
    inflight.current = true
    try {
      const res = await fetch(`/comfyui-workbench/api/terminal?since=${cursor.current}`, {
        headers: { Accept: 'application/json' },
      })
      if (!res.ok) return
      const data = (await res.json()) as Payload
      if (!data.ok) return
      // busy 也要参与比较：漏了它，队列从空到忙时对象被判成"没变"、状态不更新，
      // 于是忙时点关机不弹确认 —— 而那条确认正是唯一挡住丢任务的东西。
      setStatus(prev => (prev !== undefined && prev.state === data.status.state
        && prev.managed === data.status.managed
        && prev.pid === data.status.pid
        && prev.detail === data.status.detail
        && prev.busy === data.status.busy
        ? prev
        : data.status))
      setDropped(data.dropped)
      // 缓冲被重建（插件热重载）：序号与屏上内容都不再可信，丢掉旧屏全量重拉。
      // 靠"序号是否连续"判不出来 —— 新缓冲可能已经输出到旧 cursor 之后，看起来完全连续。
      if (data.epoch !== epochRef.current) {
        epochRef.current = data.epoch
        cursor.current = 0
        setLines([])
        void pull()
        return
      }
      if (data.lines.length > 0) {
        cursor.current = data.cursor
        setLines(prev => {
          const merged = [...prev, ...data.lines]
          return merged.length > MAX_RENDER ? merged.slice(-MAX_RENDER) : merged
        })
      } else {
        cursor.current = data.cursor
      }
    } catch {
      // 拉取失败不打断界面：下一轮继续试
    } finally {
      inflight.current = false
    }
  }, [])

  useEffect(() => {
    if (!visible || paused) return undefined
    void pull()
    const timer = setInterval(() => { void pull() }, POLL_MS)
    return () => { clearInterval(timer) }
  }, [visible, paused, pull])

  // 跟着底部走：只在用户没有往上翻时才自动滚
  useEffect(() => {
    if (!following) return
    const box = boxRef.current
    if (box !== null) box.scrollTop = box.scrollHeight
  }, [lines, following])

  const onScroll = (): void => {
    const box = boxRef.current
    if (box === null) return
    // 距底部 24px 内算"在看最新"
    setFollowing(box.scrollHeight - box.scrollTop - box.clientHeight < 24)
  }

  const clear = async (): Promise<void> => {
    try {
      const res = await fetch('/comfyui-workbench/api/terminal', { method: 'POST' })
      // 必须看状态码：接口被拦（405/404）时不改本地状态，否则界面清空了、
      // 下一轮 since=0 又把整屏拉回来，看起来像灵异现象。
      if (!res.ok) return
    } catch {
      return
    }
    setLines([])
    cursor.current = 0
    setDropped(0)
  }

  const start = async (): Promise<void> => {
    try {
      await fetch('/comfyui-workbench/api/terminal?action=start', { method: 'POST' })
    } catch {
      // 拉不起来的原因会从下一轮 status.detail 里反映出来
    }
    void pull()
  }

  /**
   * 停掉插件拉起的进程。
   *
   * 先确认、再停、停完立刻刷新的三步在 `runStop` 里（那里能打表验 —— 组件本体的
   * 这两条错法用 React 测不出来），这里只把真实依赖接进去。
   */
  const stop = async (): Promise<void> => {
    await runStop({
      status,
      message: t('termStopConfirm'),
      confirm: question => window.confirm(question),
      // 走 api.ts 而不是裸 fetch：`stopService()` 会看 `ok`/`stopped`，
      // 后端回 "没有本插件拉起的进程" 时能拿到 message，不至于静默成功。
      stop: () => stopService(),
      // 立刻拉一次：supervisor.stop() 会把 state 落回 unknown，按钮随即变回「启动」。
      // 不主动拉的话要等下一轮 1 秒轮询，点完这一秒里按钮还是「关机」，像没反应。
      pull: () => { void pull() },
    })
  }

  const shown = filter.trim() === ''
    ? lines
    : lines.filter(line => line.text.toLowerCase().includes(filter.trim().toLowerCase()))

  const managed = status?.managed === true
  const state = status?.state ?? 'unknown'
  // 不能只按 managed 二分：未启动时 managed 也是 false，会被说成「外部实例」——
  // 而根本没人在跑，用户会去找一个不存在的实例。
  const hint = status === undefined
    ? t('termConnecting')
    : state === 'external'
      // 有内容才说"这里显示的是日志文件"；空面板还这么说就是在空口承诺。
      ? (lines.length > 0 ? t('termNotManaged') : t('termNoLog'))
      : state === 'failed'
        ? (status.detail ?? t('termFailed'))
        : state === 'starting'
          ? t('termStarting')
          : state === 'unknown'
            ? (lines.length > 0 ? t('termLogOnly') : t('termNotStarted'))
          : lines.length === 0
            ? t('termEmpty')
            : ''
  /** 能拉起的情况：没在跑，且不是外部实例（外部实例不该被我们插手）。 */
  const canStart = status !== undefined && !managed && state !== 'external' && state !== 'starting'
  const stopPlan = planStopButton(status)

  return (
    <div className="cwt-root">
      <style>{TERMINAL_CSS}</style>
      <div className="cwt-bar">
        <span className={`cwt-state cwt-state-${state === 'external' ? 'external' : state}`}>
          {state === 'external' ? t('termExternal') : state}
        </span>
        {status?.pid !== undefined ? <span className="cwt-meta">pid {status.pid}</span> : null}
        <input
          className="cwt-filter"
          value={filter}
          placeholder={t('termFilter')}
          onChange={event => setFilter(event.target.value)}
        />
        <button type="button" className={`cwt-btn${paused ? ' on' : ''}`} onClick={() => setPaused(value => !value)}>
          {paused ? t('termResume') : t('termPause')}
        </button>
        <button type="button" className={`cwt-btn${following ? ' on' : ''}`} onClick={() => setFollowing(true)}>
          {t('termFollow')}
        </button>
        {canStart ? (
          <button
            type="button"
            className="cwt-btn cwt-btn-primary"
            onClick={() => { void start() }}
          >{t('termStart')}</button>
        ) : null}
        {stopPlan.kind === 'stop' ? (
          <button
            type="button"
            className="cwt-btn cwt-btn-danger"
            onClick={() => { void stop() }}
          >{t('termStop')}</button>
        ) : null}
        {/* 外部实例：按钮在但点不动 —— 直接不渲染会让人以为这面板没有关机功能。
            title 必须挂在外层 span 上：**禁用的按钮不收指针事件**，Chrome/Firefox 都不会
            在 disabled 的 <button> 上弹原生提示，挂里面等于没有。 */}
        {stopPlan.kind === 'external' ? (
          <span className="cwt-tip" title={t(stopPlan.tip)}>
            <button type="button" className="cwt-btn" disabled>{t('termStop')}</button>
          </span>
        ) : null}
        <button type="button" className="cwt-btn" onClick={() => { void clear() }}>{t('termClear')}</button>
      </div>

      {dropped > 0 ? <div className="cwt-note">{t('termDropped').replace('{n}', String(dropped))}</div> : null}
      {hint !== '' ? <div className="cwt-hint">{hint}</div> : null}

      <div className="cwt-box" ref={boxRef} onScroll={onScroll}>
        {shown.map(line => (
          <div key={line.seq} className={`cwt-line${line.stream === 'err' ? ' err' : ''}`}>
            <span className="cwt-text">{line.text}</span>
          </div>
        ))}
        {shown.length === 0 && lines.length > 0 ? <div className="cwt-hint">{t('termNoMatch')}</div> : null}
      </div>
    </div>
  )
}
