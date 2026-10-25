import { useEffect, useState } from 'react'

import { fetchConfig } from '../api.js'
import type { Translate } from '../i18n.js'
import { WORKBENCH_CSS } from '../styles-workbench.js'
import { Gallery } from '../../components/panel-gallery/client/Gallery.js'
import { WorkflowAdmin } from '../../components/panel-workflow/client/WorkflowAdmin.js'

export interface WorkbenchProps {
  t: Translate
  visible: boolean
  embedded?: boolean
  goToConversation: () => void
  openSidebar: () => boolean
}

type TabId = 'assets' | 'workflow'

/** 页签与组件的对应关系：关掉哪个组件，对应页签就不会出现。 */
const TABS: Array<{ id: TabId; component: string; label: 'tabAssets' | 'tabWorkflowAdmin' }> = [
  { id: 'assets', component: 'panel.gallery', label: 'tabAssets' },
  { id: 'workflow', component: 'panel.workflow', label: 'tabWorkflowAdmin' },
]

/**
 * 工作台外壳：把两个组件装进同一个入口。
 *
 * 外壳本身不属于任何一个组件 —— 它只负责"有哪些页签可显示"。
 * 某个组件被配置关掉时，页签少一个；两个都关掉时这里只说明情况，不假装还能用。
 */
export function Workbench({ t, visible, embedded, goToConversation, openSidebar }: WorkbenchProps): React.ReactElement {
  const [tab, setTab] = useState<TabId>('assets')
  /** 未取到配置前先按全开渲染，避免首帧什么都不显示。 */
  const [enabled, setEnabled] = useState<Record<string, boolean>>({
    'panel.gallery': true,
    'panel.workflow': true,
  })

  useEffect(() => {
    if (!visible) return undefined
    let alive = true
    fetchConfig()
      .then(config => {
        if (alive && config.components !== undefined) setEnabled(config.components)
      })
      .catch(() => { /* 拿不到配置就按全开，至少能用 */ })
    return () => { alive = false }
  }, [visible])

  const available = TABS.filter(item => enabled[item.component] !== false)
  const current = available.some(item => item.id === tab) ? tab : available[0]?.id

  return (
    <div className="cwb-root">
      <style>{WORKBENCH_CSS}</style>
      {available.length === 0 ? (
        <div className="cwf-empty">
          <div className="cwf-empty-title">{t('allPanelsOff')}</div>
          <div>{t('allPanelsOffHint')}</div>
        </div>
      ) : (
        <>
          {available.length > 1 ? (
            <nav className="cwb-tabs" role="tablist" aria-label="工作台">
              {available.map(item => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={current === item.id}
                  className={`cwb-tab${current === item.id ? ' on' : ''}`}
                  onClick={() => setTab(item.id)}
                >{t(item.label)}</button>
              ))}
            </nav>
          ) : null}
          <div className="cwb-body">
            {current === 'assets'
              ? <Gallery t={t} visible={visible} {...(embedded === true ? { embedded } : {})} goToConversation={goToConversation} openSidebar={openSidebar} />
              : <WorkflowAdmin t={t} visible={visible} />}
          </div>
        </>
      )}
    </div>
  )
}
