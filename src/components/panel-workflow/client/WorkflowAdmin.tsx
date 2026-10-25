import { useEffect, useState } from 'react'

import { fetchWorkflowList, updateWorkflow } from '../../../client/api.js'
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

  const load = (): void => {
    setLoading(true)
    fetchWorkflowList()
      .then(data => {
        setItems(data.workflows)
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
        <button type="button" className="cwf-ghost" onClick={load} title={t('refresh')}>
          <Icon name="refresh" size={15} />
        </button>
      </header>

      {error !== '' ? <div className="cwa-error">{error}</div> : null}
      {notice !== '' ? <div className="cwa-notice">{notice}</div> : null}

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
