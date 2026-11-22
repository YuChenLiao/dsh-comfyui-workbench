import { useEffect, useRef, useState } from 'react'

import { fetchConfig, fetchServiceStats, fetchWorkflowAudit, fetchWorkflowDetail, fetchWorkflowList, freeMemory, importWorkflow, importWorkflowPng, interruptRun, removeWorkflow, setProgressStream, setRunWait, stopService, updateWorkflow, WorkflowExistsError } from '../../../client/api.js'
import type { ServiceStats, TogglesView, WorkflowAudit } from '../../../client/api.js'
import { sendTextToComposer } from '../../../client/conversation.js'
import type { WorkflowListItem, WorkflowSurface } from '../../../client/types.js'
import type { Translate } from '../../../client/i18n.js'
import { Icon } from '../../../client/icons.js'
import WORKBENCH_CSS from '../../../client/styles.css'
import { readPref, writePref } from '../../../shared/host/prefs.js'

import { groupWorkflows, groupsToExpandForAudit, isFiltering, resolveExpanded } from './grouping.js'
import type { WorkflowFilter, WorkflowGroup } from './grouping.js'

export interface WorkflowAdminProps {
  t: Translate
  visible: boolean
  /** 跳回对话面板（「送进对话」要用）。宿主没给时按钮点了只会复制到剪贴板之外无路可走，所以可选。 */
  goToConversation?: () => void
}

/** 正在保存的条目（用于禁用输入与显示状态）。 */
type Saving = Record<string, boolean>

/** 筛选胶囊的顺序与文案键。 */
const FILTERS: Array<{ value: WorkflowFilter; label: string }> = [
  { value: 'all', label: 'filterAll' },
  { value: 'enabled', label: 'filterEnabled' },
  { value: 'image', label: 'filterImage' },
  { value: 'warning', label: 'filterWarning' },
  { value: 'disabled', label: 'filterDisabled' },
]

/**
 * 分组的持久化键。
 *
 * 兜底组的 key 里有 `\u0000`（保证不与真实底模撞名），直接当 localStorage 键太怪，
 * 所以给它一个固定名字。
 */
function prefKeyOf(group: WorkflowGroup): string {
  return group.tail ? 'workflow.group.tail' : `workflow.group.${group.key}`
}

/** 服务状态 → 一句人话。`unknown` 表示连探测都没做过。 */
function serviceLabel(t: Translate, state: string | undefined): string {
  if (state === 'ready' || state === 'external') return t('serviceOnline')
  if (state === 'starting') return t('serviceStarting')
  if (state === 'failed') return t('serviceFailed')
  return t('serviceUnknown')
}

/**
 * 工作流管理面板。
 *
 * 职责没变：列出工作流、设置是否对模型可用、写一句用途备注、看模板能不能跑。
 * 出图是给模型的工具，用户要手工出图直接开 ComfyUI —— 这里不再复制一套生图前端。
 *
 * 布局上按底模分组折叠：真实使用里工作流本来就是按底模生态组织的（同一套底模挂着
 * 文生图 / 图生图 / 重绘 / 放大），平铺一列卡片在侧栏里根本扫不过来。
 */
export function WorkflowAdmin({ t, visible, goToConversation }: WorkflowAdminProps): React.ReactElement {
  const [items, setItems] = useState<WorkflowListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Saving>({})
  const [notice, setNotice] = useState<string>('')
  const [error, setError] = useState<string>('')
  /** 面板开关：`null` 表示还没拿到（或这个部署不给改）。 */
  const [toggles, setToggles] = useState<TogglesView | null>(null)
  /** 组件开关状态；组件 `tool.sync-wait` 关掉时不显示「同步等结果」这个开关。 */
  const [components, setComponents] = useState<Record<string, boolean> | null>(null)
  const [toggleSaving, setToggleSaving] = useState<'progress' | 'runWait' | null>(null)
  /** 导入区：展开状态、文件名提示、粘贴的 JSON、提交中。 */
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)
  /** 控制条：显存与活跃任务。`null` = 首帧还没取到。 */
  const [strip, setStrip] = useState<ServiceStats | null>(null)
  const [stripBusy, setStripBusy] = useState<'' | 'interrupt' | 'free' | 'stop' | 'audit'>('')
  /** 体检结果：`null` = 还没点过。点过之后卡片上会标出缺节点/缺模型。 */
  const [audit, setAudit] = useState<WorkflowAudit | null>(null)

  /** 搜索词与筛选胶囊。 */
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<WorkflowFilter>('all')
  /** 各组是否展开（分组键 → 是否展开）。 */
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  /** 当前展开详情的那张卡。 */
  const [openCard, setOpenCard] = useState<string>('')
  /** 详情缓存：点开某张卡时按需拉 `GET /workflows/{id}`。 */
  const [details, setDetails] = useState<Record<string, WorkflowSurface>>({})
  /** 「运行设置」控制条是否展开（progressStream / runWait 两个开关收在这里）。 */
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** 「活跃任务」抽屉是否展开。 */
  const [queueOpen, setQueueOpen] = useState(false)
  /** 正在拖文件：给整面拖放加高亮。 */
  const [dropActive, setDropActive] = useState(false)
  /** 多文件导入的逐条结果（`load()` 会清 error，所以单独放一个不会被清的地方）。 */
  const [batchReport, setBatchReport] = useState<string[]>([])

  /** 分组结果：搜索/筛选/排序都在这一个纯函数里。 */
  const groups = groupWorkflows(items, { query, filter })
  const filtering = isFiltering(query, filter)
  /** 搜索或筛选时强制全展 —— 否则"搜到了却因为组是折叠的而看不见"。 */
  const shown = resolveExpanded(groups, expanded, filtering)

  // 首次拿到列表（或组集合变化）时，用持久化的展开状态铺一遍；搜索态不读持久化。
  useEffect(() => {
    if (items.length === 0) return
    setExpanded(previous => {
      const next: Record<string, boolean> = { ...previous }
      for (const group of groupWorkflows(items)) {
        if (next[group.key] === undefined) next[group.key] = readPref(prefKeyOf(group), false)
      }
      return next
    })
  }, [items])

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    let timer: ReturnType<typeof setTimeout> | null = null
    /**
     * 控制条轮询：**上一次回来之后才排下一次**。
     *
     * 用 `setInterval` 的话，一次慢请求（服务在冷启动、`/service/stats` 卡几秒）
     * 会让请求叠起来：每个 tick 都发一个新请求，而按钮一整个时段都是 disabled。
     * 服务端已经 skipEnsure（不触发拉起），这里再保证不叠。
     */
    const pull = (): void => {
      void fetchServiceStats()
        .then(value => { if (alive) setStrip(value) })
        .catch(() => { if (alive) setStrip(previous => previous) })
        .finally(() => {
          if (alive) timer = setTimeout(pull, 5_000)
        })
    }
    pull()
    return () => {
      alive = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [visible])

  const load = (): void => {
    setLoading(true)
    Promise.all([
      fetchWorkflowList(),
      // 拿不到开关不影响列表：老宿主 / 关掉面板时这里会失败
      fetchConfig().catch(() => null),
    ])
      .then(([data, config]) => {
        setItems(data.workflows)
        setToggles(config?.toggles ?? null)
        setComponents(config?.components ?? null)
        setError('')
      })
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (!visible) return undefined
    load()
    return undefined
  }, [visible])

  useEffect(() => {
    if (notice === '') return undefined
    const timer = setTimeout(() => setNotice(''), 2200)
    return () => clearTimeout(timer)
  }, [notice])

  const patch = async (
    id: string,
    body: { enabled?: boolean; description?: string; title?: string },
  ): Promise<void> => {
    setSaving(previous => ({ ...previous, [id]: true }))
    try {
      const next = await updateWorkflow(id, body)
      setItems(previous => previous.map(item => (item.workflowId === id ? { ...item, ...next } : item)))
      setNotice(t('adminSaved'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(previous => ({ ...previous, [id]: false }))
    }
  }

  /**
   * 切「精确进度」。
   *
   * 写的是插件数据目录的 `settings.json`，不是 profile 配置 —— 所以不用重启，
   * 下一次从面板提交的运行就带 `progress`。
   */
  const toggleProgress = async (next: boolean): Promise<void> => {
    setToggleSaving('progress')
    try {
      const updated = await setProgressStream(next)
      setToggles(updated)
      setNotice(t('adminSaved'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setToggleSaving(null)
    }
  }

  /**
   * 切「出图等不等」。
   *
   * 同步等到产物落盘才返回（顺带登记资产索引），异步提交完就把控制权交回对话、
   * 出图完成后插件再往会话里推一条。写的是 `settings.json`，下一次提交就生效。
   * 组件 `tool.sync-wait` 被关掉时这个开关不显示（工具那边也没有 wait 参数）。
   */
  const toggleRunWait = async (next: 'async' | 'sync'): Promise<void> => {
    setToggleSaving('runWait')
    try {
      const updated = await setRunWait(next)
      setToggles(updated)
      setNotice(t('adminSaved'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setToggleSaving(null)
    }
  }

  /**
   * 导入粘贴的 JSON。
   *
   * `JSON.parse` 在**前端**做：语法错误要当场说清是哪一行，不该把一坨文本传给服务端
   * 再换回一句"读不了"。格式校验（API / UI）在服务端，那里有 `formatHint` 的现成文案。
   */
  const submitImport = async (): Promise<void> => {
    const text = importText.trim()
    if (text === '') {
      setError(t('importEmpty'))
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (reason) {
      setError(`JSON 解析失败：${reason instanceof Error ? reason.message : String(reason)}`)
      return
    }
    const name = importName.trim() === '' ? undefined : importName.trim()
    setImporting(true)
    try {
      let result: { workflowId: string; replaced: boolean }
      try {
        result = await importWorkflow({ ...(name === undefined ? {} : { name }), workflow: parsed })
      } catch (reason) {
        // 同名 → 问一句再覆盖。面板上导入是一次点击，不确认就等于静默丢数据。
        if (!(reason instanceof WorkflowExistsError)) throw reason
        const confirmed = window.confirm(t('importConfirmOverwrite').replace('{id}', reason.workflowId))
        if (!confirmed) {
          setImporting(false)
          return
        }
        result = await importWorkflow({ ...(name === undefined ? {} : { name }), workflow: parsed, overwrite: true })
      }
      setNotice((result.replaced ? t('importReplaced') : t('importDone')).replace('{id}', result.workflowId))
      setError('')
      setImportOpen(false)
      setImportText('')
      setImportName('')
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImporting(false)
    }
  }

  /**
   * 动作之后立刻取一次状态：不然要等最多 5 秒才看到变化
   * （刚点完"停止服务"，控制条还显示在跑；刚中断完，活跃数没变）。
   */
  const refreshStrip = (): void => {
    void fetchServiceStats().then(value => setStrip(value)).catch(() => { /* 拿不到就维持旧值 */ })
  }

  /** 控制条的动作。都不该打断列表，所以错误只落到 `error` 行。 */
  const stripAction = async (kind: 'interrupt' | 'free' | 'stop'): Promise<void> => {
    setStripBusy(kind)
    try {
      if (kind === 'interrupt') {
        await interruptRun()
        setNotice(t('interrupted'))
      } else if (kind === 'free') {
        await freeMemory()
        setNotice(t('freed'))
      } else {
        const result = await stopService()
        setNotice(result.stopped ? t('stopped') : (result.message ?? t('stoppedNothing')))
      }
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setStripBusy('')
      refreshStrip()
    }
  }

  /** 体检：把缺节点/缺模型的模板标出来，并自动展开命中的组。 */
  const runAudit = async (): Promise<void> => {
    setStripBusy('audit')
    try {
      const result = await fetchWorkflowAudit()
      setAudit(result)
      setNotice(result.ok ? (result.verdict ?? '') : (result.error ?? t('auditFailed')))
      setError('')
      // 体检命中告警的组自动展开：否则用户点了体检，看到的还是"一切正常"的折叠列表
      const flagged = new Set([...result.dead, ...result.degraded].map(row => row.workflowId))
      const keys = groupsToExpandForAudit(groupWorkflows(items), flagged)
      if (keys.length > 0) {
        setExpanded(previous => {
          const next = { ...previous }
          for (const key of keys) next[key] = true
          return next
        })
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setStripBusy('')
    }
  }

  /** 删模板：删的是模板本身（连 schema / 备注），所以卡片里先二次确认。 */
  const removeTemplate = async (id: string): Promise<void> => {
    setSaving(previous => ({ ...previous, [id]: true }))
    try {
      await removeWorkflow(id)
      setNotice(t('workflowDeleted').replace('{id}', id))
      setError('')
      setOpenCard('')
      setDetails(previous => {
        const next = { ...previous }
        delete next[id]
        return next
      })
      load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(previous => ({ ...previous, [id]: false }))
    }
  }

  /**
   * 导入一张 ComfyUI 保存的 PNG。
   *
   * 图里的 `prompt`（API 格式）或 `workflow`（UI 格式）块就是完整模板 ——
   * 这是"从成品图恢复工作流"最短的一条路，不用回 ComfyUI 里再导一次。
   * 二进制没法贴进 textarea，所以直接提交。
   */
  const importPngFile = async (file: Blob, fallbackName?: string): Promise<void> => {
    setImporting(true)
    try {
      const typed = importName.trim() !== '' ? importName.trim() : fallbackName
      const result = await importWorkflowPng(file, typed)
      const notes = result.conversionNotes ?? []
      const base = (result.replaced ? t('importReplaced') : t('importDone')).replace('{id}', result.workflowId)
      setNotice(notes.length === 0 ? base : `${base} (${notes.join(' ')})`)
      setError('')
      setImportOpen(false)
      setImportText('')
      setImportName('')
      load()
    } catch (reason) {
      if (reason instanceof WorkflowExistsError) {
        // 从图恢复模板时撞名，改名比覆盖更合理（覆盖会换掉正在用的模板）
        setError(t('importNameTaken').replace('{id}', reason.workflowId))
        return
      }
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setImporting(false)
    }
  }

  /**
   * 选文件：JSON 填进粘贴框让人还能先看一眼；PNG 直接导入（二进制贴不进去）。
   */
  const pickFile = (file: File | undefined): void => {
    if (file === undefined) return
    const isPng = file.type === 'image/png' || /\.png$/i.test(file.name)
    if (isPng) {
      void importPngFile(file, file.name.replace(/\.png$/i, ''))
      return
    }
    void file.text().then(content => {
      setImportText(content)
      if (importName.trim() === '') setImportName(file.name.replace(/\.json$/i, ''))
    }).catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  /**
   * 整面拖放：不点开导入框也能直接拖进来。
   *
   * 多文件时**逐条处理并汇总**：一个坏 JSON 不能把后面几个一起带走（`JSON.parse`
   * 在循环里抛错会中断整批，而且外面是 `void (...)`，连提示都没有）。多文件也用
   * 各自的文件名，不套输入框里那个名字 —— 否则第二个起必然撞名。
   */
  const dropFiles = async (list: FileList | undefined): Promise<void> => {
    const files = list === undefined ? [] : Array.from(list)
    if (files.length === 0) return
    if (files.length === 1) {
      pickFile(files[0])
      return
    }
    setImporting(true)
    setBatchReport([])
    const done: string[] = []
    const failed: string[] = []
    for (const file of files) {
      try {
        if (file.type === 'image/png' || /\.png$/i.test(file.name)) {
          const result = await importWorkflowPng(file, file.name.replace(/\.png$/i, ''))
          done.push(result.workflowId)
        } else {
          const parsed: unknown = JSON.parse(await file.text())
          const result = await importWorkflow({ workflow: parsed })
          done.push(result.workflowId)
        }
      } catch (reason) {
        failed.push(`${file.name}：${reason instanceof Error ? reason.message : String(reason)}`)
      }
    }
    setImporting(false)
    setBatchReport([
      ...(done.length === 0 ? [] : [t('importBatchDone').replace('{n}', String(done.length)).replace('{names}', done.join('、'))]),
      ...(failed.length === 0 ? [] : [t('importBatchFailed').replace('{n}', String(failed.length)), ...failed]),
    ])
    load()
  }

  /** 展开/收起一组，并把选择记住。 */
  const toggleGroup = (group: WorkflowGroup): void => {
    const next = shown[group.key] !== true
    setExpanded(previous => ({ ...previous, [group.key]: next }))
    writePref(prefKeyOf(group), next)
  }

  /** 全部展开 / 全部收起（同样写进持久化）。 */
  const setAllGroups = (open: boolean): void => {
    const next: Record<string, boolean> = {}
    for (const group of groups) {
      next[group.key] = open
      writePref(prefKeyOf(group), open)
    }
    setExpanded(previous => ({ ...previous, ...next }))
  }

  /** 点开某张卡时按需拉详情（IO 面里的输入槽位只有这个接口给）。 */
  const loadDetail = (id: string): void => {
    if (details[id] !== undefined) return
    void fetchWorkflowDetail(id)
      .then(surface => setDetails(previous => ({ ...previous, [id]: surface })))
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))
  }

  /**
   * 删一个预设（`.meta.json` 里的 `presets[name]`）。
   *
   * 面板只做删除、不做新增：新增需要"一组完整参数值"，面板上没有那种表单，
   * 硬做只会逼用户手填 JSON。要加预设，模型用 `comfyui_workflow_edit` 或手改文件更直接。
   */
  const removePreset = async (id: string, name: string): Promise<void> => {
    setSaving(previous => ({ ...previous, [id]: true }))
    try {
      const next = await updateWorkflow(id, { removePreset: name })
      setItems(previous => previous.map(item => (item.workflowId === id ? { ...item, ...next } : item)))
      setNotice(t('presetDeleted').replace('{name}', name))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSaving(previous => ({ ...previous, [id]: false }))
    }
  }

  /** 「送进对话」：把一条能直接用的提示词填进输入框草稿，生图仍然走模型侧工具。 */
  const sendToChat = async (item: WorkflowListItem): Promise<void> => {
    const text = t('sendToChatPrompt').replace('{id}', item.workflowId)
    const ok = await sendTextToComposer(text, { goToConversation: goToConversation ?? (() => {}) })
    if (ok) setNotice(t('sendToChatDone'))
    else setError(t('sendToChatFailed'))
  }

  if (loading) {
    return (
      <div className="cwb-root">
        <style>{WORKBENCH_CSS}</style>
        <div className="cwf-empty">
          <Icon name="workflow" size={24} />
          <div className="cwf-empty-title">{t('loadingWorkflows')}</div>
        </div>
      </div>
    )
  }

  const enabledCount = items.filter(item => item.enabled !== false).length
  const active = strip?.active ?? []
  const serviceState = strip === null
    ? undefined
    : (strip.service !== null && typeof strip.service === 'object'
      ? String((strip.service as { state?: unknown }).state ?? '')
      : '')
  const serviceManaged = strip !== null && strip.service !== null && typeof strip.service === 'object'
    && (strip.service as { managed?: unknown }).managed === true

  return (
    <div
      className={`cwb-root${dropActive ? ' cwa-dropping' : ''}`}
      onDragOver={event => { event.preventDefault(); setDropActive(true) }}
      onDragLeave={() => setDropActive(false)}
      onDrop={event => {
        event.preventDefault()
        setDropActive(false)
        void dropFiles(event.dataTransfer.files)
      }}
    >
      <style>{WORKBENCH_CSS}</style>
      <header className="cwa-head">
        <div>
          <div className="cwa-title">{t('adminTitle')}</div>
          <div className="cwa-sub">{t('adminSub').replace('{on}', String(enabledCount)).replace('{all}', String(items.length))}</div>
        </div>
        <div className="cwa-head-actions">
          <button
            type="button"
            className="cwf-ghost cwa-import-btn"
            onClick={() => setImportOpen(open => !open)}
            title={t('importWorkflow')}
          >
            <Icon name="download" size={15} />
            <span>{t('importWorkflow')}</span>
          </button>
          <button type="button" className="cwf-ghost" onClick={load} title={t('refresh')}>
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      {/* 控制条：一行回答"现在到底能不能跑"。队列与运行设置收在它下面，默认不占位置。 */}
      <article className="cwa-strip cwa-strip-line">
        <button
          type="button"
          className="cwa-service"
          title={serviceManaged ? t('serviceManagedHint') : t('serviceHint')}
          onClick={() => setQueueOpen(open => !open)}
        >
          <span className={`cwa-dot state-${serviceState ?? 'unknown'}`} aria-hidden="true" />
          <span className="cwa-service-text">{serviceLabel(t, serviceState)}</span>
        </button>
        <div className="cwa-strip-facts">
          {strip === null || strip.gpu.length === 0
            ? <span>{t('gpuUnknown')}</span>
            : strip.gpu.map((gpu, index) => (
              <span key={`${gpu.name}-${index}`}>{gpu.name} · {t('vramUsed').replace('{pct}', String(gpu.vramUsedPct))}</span>
            ))}
          <button
            type="button"
            className={`cwa-badge cwa-queue-btn${active.length > 0 ? ' on' : ''}`}
            onClick={() => setQueueOpen(open => !open)}
            title={t('activeQueueHint')}
          >
            {t('activeRuns').replace('{n}', String(active.length))}
          </button>
        </div>
        <div className="cwa-actions">
          <button
            type="button"
            className={`cwf-ghost${settingsOpen ? ' on' : ''}`}
            onClick={() => setSettingsOpen(open => !open)}
            title={t('runSettings')}
          >
            <Icon name="dock" size={14} />
            <span>{t('runSettings')}</span>
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void stripAction('interrupt') }}>
            {t('interrupt')}
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void stripAction('free') }}>
            {t('freeMemory')}
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void runAudit() }}>
            {t('auditTemplates')}
          </button>
          {/* 停止服务是唯一不可逆的一个，放到最后并和别的隔开 */}
          <button type="button" className="cwf-ghost cfa-danger" disabled={stripBusy !== ''} onClick={() => { void stripAction('stop') }}>
            {t('stopService')}
          </button>
        </div>
      </article>

      {queueOpen ? (
        <article className="cwa-panel cwa-queue">
          {active.length === 0
            ? <div className="cwa-list-empty">{t('queueEmpty')}</div>
            : (
              <ul className="cwa-queue-list">
                {active.map((row, index) => (
                  <li key={row.promptId ?? `run-${index}`} className="cwa-queue-row">
                    <span className="cwa-queue-wf">{row.workflowId ?? t('queueUnknownWorkflow')}</span>
                    <span className="cwa-badge">{row.state === 'running' ? t('queueRunning') : t('queueQueued')}</span>
                    {row.state === 'queued' && typeof row.queuePosition === 'number' ? <span className="cwa-fact">#{row.queuePosition}</span> : null}
                    {row.progress !== undefined && row.progress.max > 0
                      ? <span className="cwa-fact">{Math.round((row.progress.value / row.progress.max) * 100)}%</span>
                      : null}
                  </li>
                ))}
              </ul>
            )}
        </article>
      ) : null}

      {settingsOpen ? (
        <article className="cwa-panel cwa-settings">
          {toggles === null ? <div className="cwa-list-empty">{t('togglesUnavailable')}</div> : (
            <>
              <div className="cwa-setting-row">
                <label className="cwa-switch" title={t('progressToggleHint').replace('{value}', 'n').replace('{max}', 'N')}>
                  <input
                    type="checkbox"
                    checked={toggles.progressStream}
                    disabled={toggleSaving !== null}
                    onChange={event => { void toggleProgress(event.target.checked) }}
                  />
                  <span className="cwa-track" aria-hidden="true"><span className="cwa-knob" /></span>
                </label>
                <div className="cwa-meta">
                  <div className="cwa-name">{t('progressToggle')}</div>
                  <div className="cwa-facts">
                    <span>{t('progressToggleHint').replace('{value}', 'n').replace('{max}', 'N')}</span>
                    {toggles.progressStreamSource === 'config' ? <span className="cwa-badge">{t('progressToggleFromConfig')}</span> : null}
                  </div>
                </div>
              </div>
              {/* 组件 tool.sync-wait 关掉时，工具那边连 wait 参数都没有，这个开关也不该出现。 */}
              {components?.['tool.sync-wait'] === false ? null : (
                <div className="cwa-setting-row">
                  <label className="cwa-switch" title={t('runWaitHint')}>
                    <input
                      type="checkbox"
                      checked={toggles.runWait === 'sync'}
                      disabled={toggleSaving !== null}
                      onChange={event => { void toggleRunWait(event.target.checked ? 'sync' : 'async') }}
                    />
                    <span className="cwa-track" aria-hidden="true"><span className="cwa-knob" /></span>
                  </label>
                  <div className="cwa-meta">
                    <div className="cwa-name">{t('runWaitToggle')}</div>
                    <div className="cwa-facts">
                      <span>{t('runWaitHint')}</span>
                      {toggles.runWaitSource === 'config' ? <span className="cwa-badge">{t('progressToggleFromConfig')}</span> : null}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </article>
      ) : null}

      {error !== '' ? <div className="cwa-error">{error}</div> : null}
      {notice !== '' ? <div className="cwa-notice">{notice}</div> : null}
      {batchReport.length > 0 ? (
        <div className="cwa-notice cwa-batch-report">
          {batchReport.map((line, index) => <div key={index}>{line}</div>)}
          <button type="button" className="cwa-link" onClick={() => setBatchReport([])}>{t('close')}</button>
        </div>
      ) : null}

      {importOpen ? (
        <article
          className="cwa-row cwa-import"
          // 拖放：ComfyUI 默认「保存」出来的是 UI 格式 JSON，或一张带工作流块的 PNG，
          // 两者都直接拖到这里。
          onDragOver={event => { event.preventDefault() }}
          onDrop={event => {
            // 内层必须 stopPropagation：根容器上也挂了 onDrop，不拦的话同一个文件会被
            // 提交两次 —— 第二发命中 already-exists，用户看到"导入成功"紧跟着"名字被占用"。
            event.preventDefault()
            event.stopPropagation()
            void dropFiles(event.dataTransfer.files)
          }}
        >
          <div className="cwa-row-head">
            <div className="cwa-meta">
              <div className="cwa-name">{t('importWorkflow')}</div>
              <div className="cwa-facts"><span>{t('importHint')}</span></div>
            </div>
          </div>
          <input
            className="cwa-note"
            type="text"
            value={importName}
            placeholder={t('importName')}
            disabled={importing}
            onChange={event => setImportName(event.target.value)}
          />
          <textarea
            className="cwa-note"
            value={importText}
            placeholder={t('importPlaceholder')}
            disabled={importing}
            rows={6}
            onChange={event => setImportText(event.target.value)}
          />
          <div className="cwa-actions">
            <label className="cwf-ghost" title={t('importPickFile')}>
              <input
                type="file"
                accept=".json,.png,application/json,image/png"
                multiple
                className="cwf-sr-only"
                disabled={importing}
                onChange={event => {
                  void dropFiles(event.target.files ?? undefined)
                  event.target.value = ''
                }}
              />
              <Icon name="image" size={15} />
              <span>{t('importPickFile')}</span>
            </label>
            <button type="button" className="cwf-ghost" disabled={importing} onClick={() => { setImportOpen(false); setImportText(''); setImportName('') }}>
              {t('importCancel')}
            </button>
            <button type="button" className="cwf-ghost" disabled={importing} onClick={() => { void submitImport() }}>
              {t('importSubmit')}
            </button>
          </div>
        </article>
      ) : null}

      {/* 搜索 + 筛选 + 全部展开/收起：列表一长，这三样比任何排版都管用 */}
      <div className="cwa-toolbar">
        <input
          className="cwa-search"
          type="search"
          value={query}
          placeholder={t('searchWorkflows')}
          aria-label={t('searchWorkflows')}
          onChange={event => setQuery(event.target.value)}
        />
        <div className="cwa-filters">
          {FILTERS.map(entry => (
            <button
              key={entry.value}
              type="button"
              className={`cwa-chip${filter === entry.value ? ' on' : ''}`}
              onClick={() => setFilter(entry.value)}
            >
              {t(entry.label)}
            </button>
          ))}
        </div>
        <div className="cwa-toolbar-actions">
          <button type="button" className="cwf-ghost" onClick={() => setAllGroups(true)}>{t('expandAll')}</button>
          <button type="button" className="cwf-ghost" onClick={() => setAllGroups(false)}>{t('collapseAll')}</button>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="cwf-empty">
          <Icon name="workflow" size={26} />
          <div className="cwf-empty-title">{t('emptyWorkflows')}</div>
          <div>{t('emptyWorkflowsHint')}</div>
        </div>
      ) : groups.length === 0 ? (
        <div className="cwf-empty">
          <Icon name="workflow" size={26} />
          <div className="cwf-empty-title">{t('emptyWorkflowFiltered')}</div>
          <div>{t('emptyWorkflowFilteredHint')}</div>
        </div>
      ) : (
        <div className="cwa-list">
          {groups.map(group => (
            <section key={group.key} className={`cwa-group${shown[group.key] === true ? ' open' : ''}`}>
              <button type="button" className="cwa-group-head" disabled={filtering} onClick={() => toggleGroup(group)}>
                <span className="cwa-group-arrow" aria-hidden="true">{shown[group.key] === true ? '▾' : '▸'}</span>
                <span className="cwa-group-name" title={group.items[0]?.model ?? group.label}>{group.label}</span>
                {group.kind !== '' ? <span className="cwa-badge">{group.kind}</span> : null}
                <span className="cwa-fact">{group.enabledCount}/{group.items.length}</span>
                {group.warning ? <span className="cwa-group-warn" title={t('groupWarningHint')}>!</span> : null}
              </button>
              {shown[group.key] === true ? (
                <div className="cwa-group-body">
                  {group.items.map(item => (
                    <WorkflowRow
                      key={item.workflowId}
                      item={item}
                      t={t}
                      saving={saving[item.workflowId] === true}
                      audit={audit}
                      open={openCard === item.workflowId}
                      detail={details[item.workflowId]}
                      onToggleOpen={() => {
                        const next = openCard === item.workflowId ? '' : item.workflowId
                        setOpenCard(next)
                        if (next !== '') loadDetail(next)
                      }}
                      onEnabled={next => patch(item.workflowId, { enabled: next })}
                      onSave={(body) => patch(item.workflowId, body)}
                      onRemovePreset={name => removePreset(item.workflowId, name)}
                      onSendToChat={() => sendToChat(item)}
                      onRemove={() => removeTemplate(item.workflowId)}
                    />
                  ))}
                </div>
              ) : null}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

interface WorkflowRowProps {
  item: WorkflowListItem
  t: Translate
  saving: boolean
  audit: WorkflowAudit | null
  open: boolean
  detail: WorkflowSurface | undefined
  onToggleOpen: () => void
  onEnabled: (next: boolean) => Promise<void>
  onSave: (body: { title?: string; description?: string }) => Promise<void>
  onRemovePreset: (name: string) => Promise<void>
  onSendToChat: () => Promise<void>
  onRemove: () => Promise<void>
}

/**
 * 一张工作流卡。
 *
 * 收起态只占两行（开关 + 标题 + 能力标 + 一行备注预览），点开才露出编辑区与 IO 面 ——
 * 之前在每张卡上常驻大 textarea 和红按钮，工作流一多整屏都是输入框。
 */
export function WorkflowRow({ item, t, saving, audit, open, detail, onToggleOpen, onEnabled, onSave, onRemovePreset, onSendToChat, onRemove }: WorkflowRowProps): React.ReactElement {
  const [titleDraft, setTitleDraft] = useState(item.title)
  const [noteDraft, setNoteDraft] = useState(item.description)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const dirty = titleDraft !== item.title || noteDraft !== item.description

  // 外部更新（模型用 comfyui_workflow_edit 改过、或列表刷新）要把草稿同步过来，
  // 否则输入框里永远停着旧值 —— 受控输入不做这一步就是之前的 defaultValue 老毛病。
  const syncedRef = useRef({ title: item.title, description: item.description })
  useEffect(() => {
    if (syncedRef.current.title === item.title && syncedRef.current.description === item.description) return
    syncedRef.current = { title: item.title, description: item.description }
    setTitleDraft(item.title)
    setNoteDraft(item.description)
  }, [item.title, item.description])

  const dead = audit !== null && audit.dead.some(row => row.workflowId === item.workflowId)
  const degraded = audit !== null && audit.degraded.some(row => row.workflowId === item.workflowId)
  const missing = item.missingModels ?? []
  const deadNodes = dead ? (audit?.dead.find(row => row.workflowId === item.workflowId)?.missingNodes ?? []) : []
  const degradedModels = degraded ? (audit?.degraded.find(row => row.workflowId === item.workflowId)?.missingModels ?? []) : []

  /** 能力标签：吃图 / 出视频 / 出音频 —— 由 IO 面推出来，用户扫一眼就知道这模板能干什么。 */
  const chips: string[] = []
  if ((item.imageSlots?.length ?? 0) > 0) chips.push(t('chipImage'))
  if (item.outputs.some(output => output.kind === 'video')) chips.push(t('chipVideo'))
  if (item.outputs.some(output => output.kind === 'audio')) chips.push(t('chipAudio'))

  const basics = detail?.inputs.filter(slot => slot.group === 'basic') ?? []
  const advanced = detail?.inputs.filter(slot => slot.group === 'advanced') ?? []

  return (
    <article className={`cwa-row cwa-card${item.enabled === false ? ' off' : ''}${open ? ' open' : ''}`}>
      <div className="cwa-row-head">
        <label className="cwa-switch" title={item.enabled === false ? t('enableHint') : t('disableHint')}>
          <input
            type="checkbox"
            checked={item.enabled !== false}
            disabled={saving}
            onChange={event => { void onEnabled(event.target.checked) }}
          />
          <span className="cwa-track" aria-hidden="true"><span className="cwa-knob" /></span>
        </label>

        <div className="cwa-meta">
          <div className="cwa-card-title">
            <span className="cwa-name" title={item.workflowId}>{item.title}</span>
            {item.enabled === false ? <span className="cwa-badge">{t('disabledBadge')}</span> : null}
            {chips.map(chip => <span key={chip} className="cwa-badge cwa-chip-badge">{chip}</span>)}
          </div>
          <div className="cwa-facts">
            <span className="cwa-mono">{item.workflowId}</span>
            <span>·</span>
            <span>{item.inputCount} {t('inputsCount')}</span>
            <span>·</span>
            <span>{item.nodes} {t('nodesCount')}</span>
            {item.description !== '' ? <span className="cwa-note-preview">· {item.description}</span> : null}
          </div>
          {missing.length > 0 ? <div className="cwa-warn">{t('missingModels').replace('{names}', missing.join('、'))}</div> : null}
          {dead ? <div className="cwa-warn">{t('auditDead').replace('{names}', deadNodes.join('、'))}</div> : null}
          {degraded ? <div className="cwa-warn">{t('auditDegraded').replace('{names}', degradedModels.join('、'))}</div> : null}
        </div>

        <button type="button" className="cwa-expand" onClick={onToggleOpen} title={open ? t('collapseCard') : t('expandCard')}>
          <Icon name="chevronRight" size={14} />
        </button>
      </div>

      {open ? (
        <div className="cwa-card-body">
          <label className="cwa-field">
            <span className="cwa-field-label">{t('titleField')}</span>
            <input
              className="cwa-note"
              type="text"
              value={titleDraft}
              disabled={saving}
              onChange={event => setTitleDraft(event.target.value)}
            />
          </label>
          <label className="cwa-field">
            <span className="cwa-field-label">{t('noteField')}</span>
            <textarea
              className="cwa-note"
              value={noteDraft}
              placeholder={t('notePlaceholder')}
              disabled={saving}
              rows={2}
              onChange={event => setNoteDraft(event.target.value)}
            />
          </label>

          {/* 槽位预览：导入新模板后用户最想知道的就是"插件认出了哪些参数" */}
          {detail === undefined ? null : (
            <div className="cwa-slots">
              <div className="cwa-field-label">{t('slotsTitle')}</div>
              {basics.length === 0 && advanced.length === 0
                ? <div className="cwa-fact">{t('slotsEmpty')}</div>
                : (
                  <ul className="cwa-slot-list">
                    {basics.map(slot => (
                      <li key={slot.name} className="cwa-slot">
                        <span className="cwa-mono">{slot.name}</span>
                        <span className="cwa-badge">{slot.type}</span>
                        {slot.required ? <span className="cwa-badge cwa-req">{t('slotRequired')}</span> : null}
                        {slot.default !== undefined ? <span className="cwa-fact">{t('slotDefault').replace('{value}', String(slot.default))}</span> : null}
                      </li>
                    ))}
                  </ul>
                )}
              {advanced.length > 0 ? (
                <>
                  <button type="button" className="cwa-link" onClick={() => setAdvancedOpen(value => !value)}>
                    {advancedOpen ? t('hideAdvanced') : t('showAdvanced').replace('{n}', String(advanced.length))}
                  </button>
                  {advancedOpen ? (
                    <ul className="cwa-slot-list">
                      {advanced.map(slot => (
                        <li key={slot.name} className="cwa-slot">
                          <span className="cwa-mono">{slot.name}</span>
                          <span className="cwa-badge">{slot.type}</span>
                          {slot.required ? <span className="cwa-badge cwa-req">{t('slotRequired')}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              ) : null}
            </div>
          )}

          {/* 缺模型时后端已经算好了本机替代，直接摊开比只报一句"缺模型"有用 */}
          {item.modelHint !== undefined ? <div className="cwa-hint">{item.modelHint}</div> : null}

          {/* 预设：`<id>.meta.json` 里配好的参数组合，模型用 `comfyui_run { preset }` 套用 */}
          {item.presets !== undefined && item.presets.length > 0 ? (
            <div className="cwa-presets">
              <div className="cwa-field-label">{t('presetsTitle')}</div>
              <ul className="cwa-slot-list">
                {item.presets.map(name => (
                  <li key={name} className="cwa-slot">
                    <span className="cwa-mono">{name}</span>
                    <button
                      type="button"
                      className="cwa-link cwa-preset-del"
                      disabled={saving}
                      onClick={() => { void onRemovePreset(name) }}
                    >
                      {t('presetDelete')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="cwa-actions">
            {confirmDelete ? (
              <>
                <span className="cwa-warn cwa-confirm-text">{t('deleteWorkflowConfirm').replace('{id}', item.workflowId)}</span>
                <button type="button" className="cwf-ghost" onClick={() => setConfirmDelete(false)}>{t('importCancel')}</button>
                <button
                  type="button"
                  className="cwf-ghost cfa-danger"
                  disabled={saving}
                  onClick={() => { void onRemove() }}
                >
                  {t('deleteWorkflow')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="cwf-ghost"
                  disabled={saving}
                  onClick={() => { void onSendToChat() }}
                  title={t('sendToChatHint')}
                >
                  <Icon name="chat" size={14} />
                  {t('sendToChat')}
                </button>
                <button
                  type="button"
                  className="cwf-ghost cfa-danger"
                  disabled={saving}
                  onClick={() => setConfirmDelete(true)}
                >
                  <Icon name="trash" size={14} />
                  {t('deleteWorkflow')}
                </button>
                <button
                  type="button"
                  className="cwf-ghost cwa-save"
                  disabled={saving || dirty === false}
                  onClick={() => { void onSave({ title: titleDraft.trim(), description: noteDraft.trim() }) }}
                >
                  {saving ? t('adminSaving') : t('adminSave')}
                </button>
              </>
            )}
          </div>
        </div>
      ) : null}
    </article>
  )
}
