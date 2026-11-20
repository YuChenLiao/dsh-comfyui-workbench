import { useEffect, useState } from 'react'

import { fetchConfig, fetchServiceStats, fetchWorkflowAudit, fetchWorkflowList, freeMemory, importWorkflow, importWorkflowPng, interruptRun, removeWorkflow, setProgressStream, setRunWait, stopService, updateWorkflow, WorkflowExistsError } from '../../../client/api.js'
import type { ServiceStats, WorkflowAudit } from '../../../client/api.js'
import type { TogglesView } from '../../../client/api.js'
import type { WorkflowListItem } from '../../../client/types.js'
import type { Translate } from '../../../client/i18n.js'
import { Icon } from '../../../client/icons.js'
import WORKBENCH_CSS from '../../../client/styles.css'

export interface WorkflowAdminProps {
  t: Translate
  visible: boolean
}

/** 正在保存的条目（用于禁用输入与显示状态）。 */
type Saving = Record<string, boolean>

/**
 * 工作流管理面板。
 *
 * 只做三件事：列出工作流、设置是否对模型可用、写一句用途备注。
 * 出图是给模型的工具，用户要手工出图直接开 ComfyUI —— 这里不再复制一套生图前端。
 */
export function WorkflowAdmin({ t, visible }: WorkflowAdminProps): React.ReactElement {
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

  const patch = async (id: string, body: { enabled?: boolean; description?: string }): Promise<void> => {
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

  /** 控制条的动作。三个都不该打断列表，所以错误只落到 `error` 行。 */
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

  /** 体检：把缺节点/缺模型的模板在卡片上标出来。 */
  const runAudit = async (): Promise<void> => {
    setStripBusy('audit')
    try {
      const result = await fetchWorkflowAudit()
      setAudit(result)
      setNotice(result.ok ? (result.verdict ?? '') : (result.error ?? t('auditFailed')))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setStripBusy('')
    }
  }

  /** 删模板：删的是模板本身（连 schema / 备注），所以必须先确认。 */  const removeTemplate = async (id: string): Promise<void> => {
    if (!window.confirm(t('deleteWorkflowConfirm').replace('{id}', id))) return
    setSaving(previous => ({ ...previous, [id]: true }))
    try {
      await removeWorkflow(id)
      setNotice(t('workflowDeleted').replace('{id}', id))
      setError('')
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

  return (
    <div className="cwb-root">
      <style>{WORKBENCH_CSS}</style>
      <header className="cwa-head">
        <div>
          <div className="cwa-title">{t('adminTitle')}</div>
          <div className="cwa-sub">{t('adminSub').replace('{on}', String(enabledCount)).replace('{all}', String(items.length))}</div>
        </div>
        {/* 两个按钮要贴在一起：`.cwa-head` 是 space-between，直接放三子元素会把它们甩开 */}
        <div className="cwa-head-actions">
          <button type="button" className="cwf-ghost" onClick={() => setImportOpen(open => !open)} title={t('importWorkflow')}>
            <Icon name="download" size={15} />
          </button>
          <button type="button" className="cwf-ghost" onClick={load} title={t('refresh')}>
            <Icon name="refresh" size={15} />
          </button>
        </div>
      </header>

      {/* 控制条：显存 + 活跃任务 + 四个动作。它回答的是"现在到底能不能跑"，
          所以放在最上面 —— 卡住时用户第一眼要看到的是这里。 */}
      <article className="cwa-row cwa-strip">
        <div className="cwa-strip-facts">
          {strip === null
            ? <span>{t('gpuUnknown')}</span>
            : strip.gpu.length === 0
              ? <span>{t('gpuUnknown')}</span>
              : strip.gpu.map((gpu, index) => (
                <span key={`${gpu.name}-${index}`}>{gpu.name} · {t('vramUsed').replace('{pct}', String(gpu.vramUsedPct))}</span>
              ))}
          {strip !== null && strip.active.length > 0
            ? <span className="cwa-badge">{t('activeRuns').replace('{n}', String(strip.active.length))}</span>
            : null}
        </div>
        <div className="cwa-actions">
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void stripAction('interrupt') }}>
            {t('interrupt')}
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void stripAction('free') }}>
            {t('freeMemory')}
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void stripAction('stop') }}>
            {t('stopService')}
          </button>
          <button type="button" className="cwf-ghost" disabled={stripBusy !== ''} onClick={() => { void runAudit() }}>
            {t('auditTemplates')}
          </button>
        </div>
      </article>

      {error !== '' ? <div className="cwa-error">{error}</div> : null}
      {notice !== '' ? <div className="cwa-notice">{notice}</div> : null}

      {importOpen ? (
        <article
          className="cwa-row"
          // 拖放：ComfyUI 默认「保存」出来的是 UI 格式 JSON，或一张带工作流块的 PNG，
          // 两者都直接拖到这里。
          onDragOver={event => { event.preventDefault() }}
          onDrop={event => {
            event.preventDefault()
            pickFile(event.dataTransfer.files?.[0])
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
                className="cwf-sr-only"
                disabled={importing}
                onChange={event => { pickFile(event.target.files?.[0]); event.target.value = '' }}
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

      {toggles === null ? null : (() => {
        // `t()` 不做插值，所以占位符在这里一次性替换掉（两处复用同一个结果，
        // 否则 title 里会漏出原始的 `{value}/{max}`）
        const hint = t('progressToggleHint').replace('{value}', 'n').replace('{max}', 'N')
        return (
          <article className={`cwa-row${toggles.progressStream ? '' : ' off'}`}>
            <div className="cwa-row-head">
              <label className="cwa-switch" title={hint}>
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
                  <span>{hint}</span>
                  {toggles.progressStreamSource === 'config' ? <span className="cwa-badge">{t('progressToggleFromConfig')}</span> : null}
                </div>
              </div>
            </div>
          </article>
        )
      })()}

      {/* 组件 tool.sync-wait 关掉时，工具那边连 wait 参数都没有，这个开关也不该出现。 */}
      {toggles === null || components?.['tool.sync-wait'] === false ? null : (
        <article className={`cwa-row${toggles.runWait === 'sync' ? '' : ' off'}`}>
          <div className="cwa-row-head">
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
        </article>
      )}

      {items.length === 0 ? (
        <div className="cwf-empty">
          <Icon name="workflow" size={26} />
          <div className="cwf-empty-title">{t('emptyWorkflows')}</div>
          <div>{t('emptyWorkflowsHint')}</div>
        </div>
      ) : (
        <div className="cwa-list">
          {items.map(item => (
            <article key={item.workflowId} className={`cwa-row${item.enabled === false ? ' off' : ''}`}>
              <div className="cwa-row-head">
                <label className="cwa-switch" title={item.enabled === false ? t('enableHint') : t('disableHint')}>
                  <input
                    type="checkbox"
                    checked={item.enabled !== false}
                    disabled={saving[item.workflowId] === true}
                    onChange={event => { void patch(item.workflowId, { enabled: event.target.checked }) }}
                  />
                  <span className="cwa-track" aria-hidden="true"><span className="cwa-knob" /></span>
                </label>

                <div className="cwa-meta">
                  <div className="cwa-name" title={item.workflowId}>{item.title}</div>
                  <div className="cwa-facts">
                    {item.model !== '' ? <span>{item.model}</span> : <span>{t('noModel')}</span>}
                    <span>·</span>
                    <span>{item.inputCount} 输入</span>
                    <span>·</span>
                    <span>{item.nodes} 节点</span>
                    {item.enabled === false ? <span className="cwa-badge">{t('disabledBadge')}</span> : null}
                  </div>
                  {item.missingModels !== undefined && item.missingModels.length > 0 ? (
                    <div className="cwa-warn">{t('missingModels').replace('{names}', item.missingModels.join('、'))}</div>
                  ) : null}
                  {/* 体检结果：缺节点必然跑不起来（红），缺模型能提交但会跑偏 */}
                  {audit !== null && audit.dead.some(row => row.workflowId === item.workflowId) ? (
                    <div className="cwa-warn">
                      {t('auditDead').replace('{names}', (audit.dead.find(row => row.workflowId === item.workflowId)?.missingNodes ?? []).join('、'))}
                    </div>
                  ) : null}
                  {audit !== null && audit.degraded.some(row => row.workflowId === item.workflowId) ? (
                    <div className="cwa-warn">
                      {t('auditDegraded').replace('{names}', (audit.degraded.find(row => row.workflowId === item.workflowId)?.missingModels ?? []).join('、'))}
                    </div>
                  ) : null}
                </div>
              </div>

              <textarea
                className="cwa-note"
                defaultValue={item.description}
                placeholder={t('notePlaceholder')}
                disabled={saving[item.workflowId] === true}
                onBlur={event => {
                  const value = event.target.value.trim()
                  if (value === item.description) return
                  void patch(item.workflowId, { description: value })
                }}
                rows={2}
              />
              <div className="cwa-actions">
                <button
                  type="button"
                  className="cwf-ghost cfa-danger"
                  disabled={saving[item.workflowId] === true}
                  onClick={() => { void removeTemplate(item.workflowId) }}
                >
                  <Icon name="trash" size={14} />
                  {t('deleteWorkflow')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
