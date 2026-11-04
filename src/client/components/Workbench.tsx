import { useEffect, useState } from 'react'

import { fetchConfig } from '../api.js'
import type { Translate } from '../i18n.js'
import WORKBENCH_CSS from '../styles.css'
import { Gallery } from '../../components/panel-gallery/client/Gallery.js'
import { WorkflowAdmin } from '../../components/panel-workflow/client/WorkflowAdmin.js'
import { Terminal } from '../../components/panel-terminal/client/Terminal.js'
import TAGS_CSS from '../../components/panel-tags/client/styles.css'
import { TagsPanel } from '../../components/panel-tags/client/TagsPanel.js'
import POSES_CSS from '../../components/panel-poses/client/styles.css'
import { PosesPanel } from '../../components/panel-poses/client/PosesPanel.js'
import COSTUMES_CSS from '../../components/panel-costumes/client/styles.css'
import { CostumesPanel } from '../../components/panel-costumes/client/CostumesPanel.js'

export interface WorkbenchProps {
  t: Translate
  visible: boolean
  embedded?: boolean
  goToConversation: () => void
  openSidebar: () => boolean
}

type TabId = 'assets' | 'workflow' | 'tags' | 'poses' | 'costumes' | 'terminal'

/** 页签与组件的对应关系：关掉哪个组件，对应页签就不会出现。 */
const TABS: Array<{ id: TabId; component: string; label: 'tabAssets' | 'tabWorkflowAdmin' | 'tabTags' | 'tabPoses' | 'tabCostumes' | 'tabTerminal' }> = [
  { id: 'assets', component: 'panel.gallery', label: 'tabAssets' },
  { id: 'workflow', component: 'panel.workflow', label: 'tabWorkflowAdmin' },
  { id: 'tags', component: 'panel.tags', label: 'tabTags' },
  { id: 'poses', component: 'panel.poses', label: 'tabPoses' },
  { id: 'costumes', component: 'panel.costumes', label: 'tabCostumes' },
  { id: 'terminal', component: 'panel.terminal', label: 'tabTerminal' },
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
    'panel.tags': true,
    'panel.poses': true,
    'panel.costumes': true,
    'panel.terminal': true,
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
      {/*
        四份样式必须先拼成**一个**字符串再交给 `<style>`。
        React 19 的 SSR 对 `<style>` 的 children 只接受单个字符串：**长度 ≥2 的数组被整段
        静默丢弃**（实测 19.2.8；`<style>{A}{B}{C}{D}</style>` 渲染成空的 `<style></style>`，
        用 Fragment 包起来更糟，是 `[object Object]`）。React 18 没有这个行为。
        这与"`<style>` 被当成可提升资源"**无关**：不带 href/precedence 的写法照样中招，
        带 href + precedence 的可提升路径也一样丢 —— 是 children 序列化那里的数组长度判断。
        浏览器端不受影响（DOM 追加多个 text node 是合法的），所以只在 SSR 里现形；
        顺带一提，拼成一个之后 SSR 与客户端的 text node 数也一致了（改前是 0 vs 2）。
      */}
      <style>{[WORKBENCH_CSS, TAGS_CSS, POSES_CSS, COSTUMES_CSS].join('\n')}</style>
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
            {current === 'assets' ? (
              <Gallery t={t} visible={visible} {...(embedded === true ? { embedded } : {})} goToConversation={goToConversation} openSidebar={openSidebar} />
            ) : current === 'workflow' ? (
              <WorkflowAdmin t={t} visible={visible} />
            ) : current === 'tags' ? (
              <TagsPanel t={t} visible={visible} />
            ) : current === 'poses' ? (
              <PosesPanel t={t} visible={visible} goToConversation={goToConversation} />
            ) : current === 'costumes' ? (
              <CostumesPanel t={t} visible={visible} goToConversation={goToConversation} />
            ) : current === 'terminal' ? (
              <Terminal t={t} visible={visible} />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}
