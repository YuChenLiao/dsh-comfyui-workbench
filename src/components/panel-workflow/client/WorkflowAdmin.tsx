import { useEffect, useState } from 'react'

import { fetchConfig, fetchWorkflowList, importWorkflow, setProgressStream, updateWorkflow, WorkflowExistsError } from '../../../client/api.js'
import type { TogglesView } from '../../../client/api.js'
import type { WorkflowListItem } from '../../../client/types.js'
import type { Translate } from '../../../client/i18n.js'
import { Icon } from '../../../client/icons.js'
import { WORKBENCH_CSS } from '../../../client/styles-workbench.js'

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
  const [toggleSaving, setToggleSaving] = useState(false)
  /** 导入区：展开状态、文件名提示、粘贴的 JSON、提交中。 */
  const [importOpen, setImportOpen] = useState(false)
  const [importName, setImportName] = useState('')
  const [importText, setImportText] = useState('')
  const [importing, setImporting] = useState(false)

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
    setToggleSaving(true)
    try {
      const updated = await setProgressStream(next)
      setToggles(updated)
      setNotice(t('adminSaved'))
      setError('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setToggleSaving(false)
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

  /** 选文件只做一件事：把内容填进粘贴框，让用户还能先看一眼再提交。 */
  const pickFile = (file: File | undefined): void => {
    if (file === undefined) return
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

      {error !== '' ? <div className="cwa-error">{error}</div> : null}
      {notice !== '' ? <div className="cwa-notice">{notice}</div> : null}

      {importOpen ? (
        <article className="cwa-row">
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
                accept=".json,application/json"
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
                  disabled={toggleSaving}
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
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
