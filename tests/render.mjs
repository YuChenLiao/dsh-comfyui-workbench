/**
 * 客户端静态渲染自检：在没有浏览器的前提下，用 react-dom/server 把
 * Gallery / Card / Lightbox 渲一遍，确认组件树能构建、props 契约对得上、
 * 关键结构（工具栏、网格、悬浮按钮、灯箱）确实出现在输出里。
 *
 * 不覆盖：真实交互（剪贴板、粘贴注入）、网络加载、样式在浏览器里的最终观感。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import os from 'node:os'

const profilePkg = path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json')
const profileRequire = createRequire(profilePkg)

// react 与 react-dom 必须同源：dsh 的安装树里存在多份 React 副本，
// 混用会让 react-dom 认不出另一个副本产出的 element（$$typeof 不同）。
let reactDomDir = path.dirname(profileRequire.resolve('react-dom/server'))
while (!fs.existsSync(path.join(reactDomDir, 'package.json'))) {
  const parent = path.dirname(reactDomDir)
  if (parent === reactDomDir) throw new Error('找不到 react-dom 的 package.json')
  reactDomDir = parent
}
const sameRequire = createRequire(path.join(reactDomDir, 'package.json'))
const React = sameRequire('react')
const { renderToStaticMarkup } = sameRequire('react-dom/server')

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) {
      captured = spec
    },
  },
}

await import('../lib/client.js?cache-bust=' + Date.now())
assert.ok(captured, 'client.js 应当向 ModuleLoader 注册 factory')
assert.equal(captured.id, 'dsh-comfyui-workbench')

const mod = captured.factory(sameRequire)
assert.equal(mod.name, 'dsh-comfyui-workbench')
assert.deepEqual(mod.inject, ['slots'])
assert.equal(typeof mod.apply, 'function')
assert.ok(mod.__test, '应当导出 __test 便于自检')

const { Gallery, Card, Lightbox, ConfirmRemove, ConfirmBulkRemove, metaLine, planPage } = mod.__test
const t = key => key

// ── Card：缩略图 + 四个悬浮动作 ──
const item = {
  path: 'D:\\dsh\\gallery-samples\\comfyui-20261021-162731-7eo6.png',
  name: 'comfyui-20261021-162731-7eo6.png',
  width: 640,
  height: 640,
  seed: 4058497695,
  checkpoint: 'waiNSFWIllustrious_v140.safetensors',
  prompt: 'a cozy lighthouse keeper room at dusk',
  hasMeta: true,
}

const cardHtml = renderToStaticMarkup(React.createElement(Card, { item, t, onOpen() {}, onAction() {} }))
assert.match(cardHtml, /class="cfa-card"/)
assert.match(cardHtml, /\/comfyui-workbench\/api\/file\?path=D%3A%5Cdsh%5Cgallery-samples%5Ccomfyui-20261021-162731-7eo6\.png/)
for (const key of ['copyImage', 'copyPrompt', 'exportWorkflow', 'addToChat', 'remove']) {
  assert.match(cardHtml, new RegExp(`aria-label="${key}"`), `悬浮按钮缺少 ${key}`)
}
assert.match(cardHtml, /640×640/)
assert.match(cardHtml, /seed 4058497695/)
assert.doesNotMatch(cardHtml, /class="cfa-dup"/, '没有副本时不该出现角标')

// 副本角标
const dupCardHtml = renderToStaticMarkup(React.createElement(Card, {
  item: { ...item, duplicateCount: 3, duplicates: ['x.png', 'y.png'] },
  t,
  onOpen() {},
  onAction() {},
}))
assert.match(dupCardHtml, /class="cfa-dup"/)
assert.match(dupCardHtml, /×3/)

// ── metaLine：缺字段时不崩 ──
assert.equal(metaLine({ name: 'x.png' }), 'x.png')
assert.equal(metaLine({ name: 'x.png', width: 1, height: 2, seed: 3 }), '1×2 · seed 3')

// ── Lightbox：提示词与参数都在 ──
const lightboxHtml = renderToStaticMarkup(React.createElement(Lightbox, {
  item: { ...item, negativePrompt: 'blurry', steps: 14, cfgScale: 6, samplerName: 'euler', scheduler: 'normal', mode: 'text2img', createdAt: '2026-10-21T16:27:31.000Z' },
  t,
  onClose() {},
  onAction() {},
}))
assert.match(lightboxHtml, /class="cfa-lb"/)
assert.match(lightboxHtml, /a cozy lighthouse keeper room at dusk/)
assert.match(lightboxHtml, /blurry/)
assert.match(lightboxHtml, /negativePrompt/)
assert.match(lightboxHtml, /class="cfa-lb-zoom"/, '灯箱要带缩放条')
assert.match(lightboxHtml, /class="cfa-lb-zvalue"/)
assert.match(lightboxHtml, /transform:translate\(0px, 0px\) scale\(1\)/, '默认是适应窗口')
assert.doesNotMatch(lightboxHtml, /cfa-lb-nav/, '只有一张时不显示前后箭头')
assert.doesNotMatch(lightboxHtml, /cfa-lb-count/, '只有一张时不显示计数')

// 多张时：箭头 + 计数 + 当前序号
const multiHtml = renderToStaticMarkup(React.createElement(Lightbox, {
  item,
  index: 2,
  count: 9,
  t,
  onClose() {},
  onAction() {},
  onPrev() {},
  onNext() {},
}))
assert.match(multiHtml, /class="cfa-lb-nav prev"/)
assert.match(multiHtml, /class="cfa-lb-nav next"/)
assert.match(multiHtml, />3 \/ 9</)
assert.match(multiHtml, /aria-label="prevImage"/)
assert.match(multiHtml, /aria-label="nextImage"/)

// ── 删除确认层 ──
const confirmHtml = renderToStaticMarkup(React.createElement(ConfirmRemove, {
  item,
  t,
  busy: false,
  onCancel() {},
  onConfirm() {},
}))
assert.match(confirmHtml, /class="cfa-modal"/)
assert.match(confirmHtml, /class="cfa-modal-title"/)
assert.match(confirmHtml, /removeBody/)
assert.match(confirmHtml, /class="cfa-btn-solid-danger"/)
assert.match(confirmHtml, /comfyui-20261021-162731-7eo6\.png/)
assert.doesNotMatch(confirmHtml, /duplicateHint/, '没有副本时不该提副本')

const dupConfirmHtml = renderToStaticMarkup(React.createElement(ConfirmRemove, {
  item: { ...item, duplicateCount: 3, duplicates: ['x.png', 'y.png'] },
  t,
  busy: false,
  onCancel() {},
  onConfirm() {},
}))
assert.match(dupConfirmHtml, /duplicateHint/, '有副本时要说明会一并删除')
assert.match(dupConfirmHtml, /removeConfirm/, '确认按钮要在')
assert.doesNotMatch(dupConfirmHtml, /type="checkbox"/, '删除是彻底删除，不提供「只删一份」的选项')

// ── 批量选择：选择态卡片与批量确认层 ──
const pickHtml = renderToStaticMarkup(React.createElement(Card, {
  item,
  t,
  selecting: true,
  selected: true,
  onToggle() {},
  onOpen() {},
  onAction() {},
}))
assert.match(pickHtml, /cfa-card cfa-selectable selected/)
assert.match(pickHtml, /class="cfa-pick on"/)
assert.doesNotMatch(pickHtml, /class="cfa-actions"/, '选择模式下不该出现悬浮操作条')

const bulkHtml = renderToStaticMarkup(React.createElement(ConfirmBulkRemove, {
  count: 7,
  t,
  busy: false,
  onCancel() {},
  onConfirm() {},
}))
assert.match(bulkHtml, /class="cfa-modal"/)
assert.match(bulkHtml, /bulkRemoveTitle/)
assert.match(bulkHtml, /bulkRemoveBody/)
assert.match(bulkHtml, /class="cfa-btn-solid-danger"/)
assert.doesNotMatch(confirmHtml, /disabled/, '未提交时按钮不该禁用')

// ── Gallery：首屏结构（loading 骨架 + 工具栏） ──
const galleryHtml = renderToStaticMarkup(React.createElement(Gallery, {
  t,
  goToConversation() {},
  openSidebar: () => false,
  visible: true,
}))
assert.match(galleryHtml, /class="cfa-root"/)
assert.match(galleryHtml, /class="cfa-bar"/)
assert.match(galleryHtml, /class="cfa-hint"/, '首屏应当显示扫描提示')
assert.match(galleryHtml, /placeholder="search"/)
assert.doesNotMatch(galleryHtml, /class="cfa-notice"/, '首屏不该有提示条')

// ── 分页决策：底部抖动的根因就在这里 ──
const page = (from, count) => Array.from({ length: count }, (_, i) => ({ path: `p${from + i}.png` }))

// 刚好够到 total → 停
const exact = planPage(page(0, 60), page(60, 44), 60, 104)
assert.equal(exact.items.length, 104)
assert.equal(exact.more, false, '刚好拉完必须停手')

// 还有更多 → 继续
const more = planPage(page(0, 60), page(60, 60), 60, 200)
assert.equal(more.items.length, 120)
assert.equal(more.more, true)

// 空批次（offset 越界）→ 停
const empty = planPage(page(0, 104), [], 104, 104)
assert.equal(empty.items.length, 104)
assert.equal(empty.more, false, '空批次必须停手')

// 整批重复（列表变动导致 offset 分页错位）→ 停，且不产生重复项
const repeated = planPage(page(0, 60), page(0, 60), 60, 200)
assert.equal(repeated.items.length, 60, '重复条目不该被追加')
assert.equal(repeated.more, false, '没有新条目就必须停手')

// 部分重复 → 追加去重后的部分，继续
const partial = planPage([...page(0, 50), ...page(50, 10)], page(50, 60), 60, 200)
assert.equal(partial.items.length, 110)
assert.equal(partial.more, true)

// ── 工作台外壳：两个页签 + 工作流面板空态 ──
const { Workbench, WorkflowPanel } = mod.__test
assert.ok(Workbench !== undefined, '应当导出 Workbench')
assert.ok(WorkflowPanel !== undefined, '应当导出 WorkflowPanel')

const shell = renderToStaticMarkup(React.createElement(Workbench, {
  t,
  visible: true,
  goToConversation() {},
  openSidebar: () => true,
}))
assert.match(shell, /role="tablist"/, '应当有页签条')
// 测试里的 t 是 identity，所以断言的是文案键而不是中文（文案本身在 i18n-data 里）
assert.match(shell, />tabAssets</, '应当有资产库页签')
assert.match(shell, />tabWorkflow</, '应当有工作流页签')
assert.match(shell, /class="cfa-root"/, '默认停在资产库')

// 空列表：给出导入指引而不是一片空白
const panel = renderToStaticMarkup(React.createElement(WorkflowPanel, {
  t,
  visible: true,
  goToConversation() {},
}))
// SSR 不跑 useEffect，首帧停在"加载中"——这正是修掉"把加载中显示成空"的证明
assert.match(panel, /loadingWorkflows/, '首帧应当显示加载中而不是空态')

console.log('render: 全部通过（Card / Lightbox / Gallery / 删除确认 / 批量选择 / 分页 / metaLine / Workbench / WorkflowPanel）')
