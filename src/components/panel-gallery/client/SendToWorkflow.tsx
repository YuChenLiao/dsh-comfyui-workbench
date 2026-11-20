/**
 * 「送入其他工作流」：把当前这张图填进某个吃图工作流的 image 槽跑一次。
 *
 * 相册里看图时最常见的下一步是"放大一下""去个背景""提个线稿"—— 这些工作流
 * 早就在模板列表里，缺的只是把图递过去这一步。它走 `/run`（direct 模式）：
 * 不消耗模型往返，产物进资产库。
 *
 * ## 为什么只列**单图槽**的模板
 *
 * `imageSlots` 只给槽名，不给 `required` / `default`。多图槽的模板（controlnet 之类）
 * 如果第二个槽在模板里烤了文件名，`applyVariables` 不会报错 —— 它会沿用模板那张
 * 参考图连同模板的 prompt/seed，于是**静默出一张"条件不对"的图**；如果第二个槽是空的，
 * 点一下又只得到一句看不懂的 `variable_unbound`。两种都不该由面板猜。
 * `comfyui_compose` 对同一件事的选择是"宁可报错也不硬塞"，这里保持一致：
 * 只列单图槽的，多图的留给模型去 compose。
 */
import { useEffect, useState } from 'react'

import { fetchWorkflowList, runDirect } from '../../../client/api.js'
import { Icon } from '../../../client/icons.js'
import type { Translate } from '../../../client/i18n.js'
import type { GalleryItem, WorkflowListItem } from '../../../client/types.js'

export interface SendToWorkflowProps {
  item: GalleryItem
  t: Translate
  onCancel: () => void
  /** 跑起来了：提示交给调用方（它负责 toast），并带上 promptId 让相册盯住结果。 */
  onStarted: (message: string, promptId?: string) => void
}

export function SendToWorkflow({ item, t, onCancel, onStarted }: SendToWorkflowProps): React.ReactElement {
  const [items, setItems] = useState<WorkflowListItem[] | null>(null)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')

  useEffect(() => {
    let alive = true
    void fetchWorkflowList()
      .then(data => {
        if (!alive) return
        setItems(data.workflows.filter(row => {
          if (row.enabled === false) return false
          // 只留**恰好一个**图槽、且没有蒙版槽的：多图槽的模板会静默用错参考图（见文件头）
          if ((row.imageSlots?.length ?? 0) !== 1) return false
          return row.inputKinds.includes('mask') === false
        }))
      })
      .catch(reason => {
        if (!alive) return
        const message = reason instanceof Error ? reason.message : String(reason)
        // 工作流面板被关掉时 `/workflows` 整条路径不存在，路由器回的是
        // "没有这个接口：/workflows" —— 那是开发者话术，翻成人话
        setError(/没有这个接口|unknown-route|404/.test(message)
          ? t('sendNeedWorkflowPanel')
          : message)
      })
    return () => { alive = false }
  }, [t])

  const start = async (row: WorkflowListItem): Promise<void> => {
    const slot = row.imageSlots?.[0]
    if (slot === undefined) return
    setBusyId(row.workflowId)
    setError('')
    try {
      const result = await runDirect({ workflowId: row.workflowId, vars: { [slot]: item.path } })
      if (result.ok !== true) {
        // 失败**不关弹层**：换一个工作流再试比重新打开方便
        setError(result.hint ?? result.message ?? t('sendFailed'))
        return
      }
      onStarted(
        t('sendStarted').replace('{id}', row.title || row.workflowId),
        typeof result.promptId === 'string' && result.promptId !== '' ? result.promptId : undefined,
      )
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyId('')
    }
  }

  const loading = items === null && error === ''

  return (
    <div className="csf-root" role="dialog" aria-modal="true" aria-label={t('sendToWorkflow')}>
      <div className="csf-panel">
        <header className="csf-head">
          <div className="csf-title">{t('sendToWorkflow')}</div>
          <button type="button" className="cfa-btn" onClick={onCancel} title={t('close')} aria-label={t('close')}>
            <Icon name="close" size={15} />
          </button>
        </header>

        <div className="csf-source" title={item.path}>{item.name}</div>

        {loading ? <div className="csf-empty">{t('sendLoading')}</div> : null}
        {error !== '' ? <div className="cwa-error">{error}</div> : null}
        {items !== null && error === '' && items.length === 0
          ? <div className="csf-empty">{t('sendNoWorkflow')}</div>
          : null}

        {items !== null && items.length > 0 ? (
          <ul className="csf-list">
            {items.map(row => {
              const missing = row.missingModels ?? []
              const blocked = missing.length > 0
              return (
                <li key={row.workflowId}>
                  <button
                    type="button"
                    className="csf-item"
                    disabled={busyId !== '' || blocked}
                    title={blocked ? (row.modelHint ?? missing.join('、')) : undefined}
                    onClick={() => { void start(row) }}
                  >
                    <span className="csf-item-name">{row.title || row.workflowId}</span>
                    <span className="csf-item-meta">
                      {row.model !== '' ? row.model : t('noModel')}
                      {busyId === row.workflowId ? ` · ${t('sendStarting')}` : ''}
                      {blocked ? ` · ${t('missingModels').replace('{names}', missing.join('、'))}` : ''}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : null}

        <footer className="csf-foot">{t('sendHint')}</footer>
      </div>
    </div>
  )
}
