import { useState } from 'react'

import type { Translate } from '../i18n.js'
import { WORKBENCH_CSS } from '../styles-workbench.js'
import { Gallery } from './Gallery.js'
import { WorkflowPanel } from './WorkflowPanel.js'

export interface WorkbenchProps {
  t: Translate
  visible: boolean
  embedded?: boolean
  goToConversation: () => void
  openSidebar: () => boolean
}

type TabId = 'assets' | 'workflow'

/**
 * 工作台外壳：两个页签共用一套入口。
 *
 * 拆出来而不是塞进 Gallery：资产库与工作流是两个独立视图，页签条属于"容器"，
 * 让其中一个视图去管另一个的生命周期会把两边的状态搅在一起。
 */
export function Workbench({ t, visible, embedded, goToConversation, openSidebar }: WorkbenchProps): React.ReactElement {
  const [tab, setTab] = useState<TabId>('assets')

  return (
    <div className="cwb-root">
      <style>{WORKBENCH_CSS}</style>
      <nav className="cwb-tabs" role="tablist" aria-label="工作台">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'assets'}
          className={`cwb-tab${tab === 'assets' ? ' on' : ''}`}
          onClick={() => setTab('assets')}
        >{t('tabAssets')}</button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'workflow'}
          className={`cwb-tab${tab === 'workflow' ? ' on' : ''}`}
          onClick={() => setTab('workflow')}
        >{t('tabWorkflow')}</button>
      </nav>
      <div className="cwb-body">
        {tab === 'assets'
          ? <Gallery t={t} visible={visible} {...(embedded === true ? { embedded } : {})} goToConversation={goToConversation} openSidebar={openSidebar} />
          : <WorkflowPanel t={t} visible={visible} goToConversation={goToConversation} />}
      </div>
    </div>
  )
}
