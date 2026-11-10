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
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 解析 React 和 react-dom。
 *
 * **优先用项目自己的**（`devDependencies` 里声明的 react / react-dom）。宿主不再提供：
 * 它的 React 是编译进前端 bundle 的，asar 里没有可 require 的包，而
 * `~/.dsh/profiles/desktop/node_modules` 在升级后也只剩 `react-icons` —— 依赖宿主解析
 * 会让这条测试在某次宿主升级后突然跑不了（发生过）。
 *
 * 回落到宿主 profile 只为兼容旧环境；两边都没有时给一句能照做的报错，而不是
 * `Cannot find module`。
 */
function resolveReactRuntime() {
  const candidates = [path.join(here, '..', 'package.json'), path.join(os.homedir(), '.dsh', 'profiles', 'desktop', 'package.json')]
  const tried = []
  for (const pkgPath of candidates) {
    if (!fs.existsSync(pkgPath)) { tried.push(`${pkgPath}（不存在）`); continue }
    const req = createRequire(pkgPath)
    let entry = ''
    try {
      entry = req.resolve('react-dom/server')
    } catch {
      tried.push(`${path.dirname(pkgPath)}（没装 react-dom）`)
      continue
    }
    // react 与 react-dom 必须同源：多个 React 副本会让 react-dom 认不出 element（$$typeof 不同）
    let dir = path.dirname(entry)
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
    return createRequire(path.join(dir, 'package.json'))
  }
  throw new Error(
    '找不到 react-dom/server。在本仓库执行 `npm i -D react react-dom` 即可（宿主不再提供可 require 的 React）。'
    + `已试过：${tried.join('；')}`,
  )
}

const sameRequire = resolveReactRuntime()
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
for (const key of ['copyImage', 'copyPrompt', 'exportWorkflow', 'addToChat', 'useAsInput', 'remove']) {
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

// ── 触底自动加载的判定（两个面板共用）──
const { shouldLoadMore, pickComposerEditor, isVisibleElement } = mod.__test
assert.equal(typeof shouldLoadMore, 'function', '应当导出 shouldLoadMore')

// ── 会话输入框的挑选：只认「真的能收粘贴」的那个 ──
// 守的是「衣装库点加入对话没反应」那个 bug：宿主在会话 settling 期用
// `visibility:hidden` 藏输入框（矩形仍在），旧逻辑只看元素存不存在 → 以为找到了 →
// 不切页签 → 往隐藏元素派发 paste，宿主照收、用户什么都看不到。
const fakeEditor = ({ visible: shown, scoped = false, lexical = false }) => ({
  isConnected: true,
  getClientRects: () => (shown ? [{ width: 10, height: 10 }] : []),
  closest: () => (scoped ? {} : null),
  hasAttribute: name => lexical && name === 'data-lexical-editor',
})
const visibleOf = element => element.getClientRects().length > 0
assert.equal(typeof pickComposerEditor, 'function', '应当导出 pickComposerEditor')
assert.equal(
  pickComposerEditor([fakeEditor({ visible: false, scoped: true })], visibleOf),
  null,
  '不可见的输入框必须被排除（这正是那个 bug 的起因）',
)
{
  // 引用相等，不是"返回了个非 null 就算过"——隐藏的 scoped 曾经照样满足那种弱断言
  const hiddenScoped = fakeEditor({ visible: false, scoped: true })
  const plain = fakeEditor({ visible: true })
  assert.equal(
    pickComposerEditor([hiddenScoped, plain], visibleOf),
    plain,
    '隐藏的 scoped 不能盖过可见的普通编辑器',
  )
}
{
  const plain = fakeEditor({ visible: true })
  const lexical = fakeEditor({ visible: true, lexical: true })
  const scoped = fakeEditor({ visible: true, scoped: true })
  assert.equal(pickComposerEditor([plain, lexical, scoped], visibleOf), scoped, '优先级：data-input-scroll 内最高')
  assert.equal(pickComposerEditor([plain, lexical], visibleOf), lexical, '其次 lexical 标记')
  assert.equal(pickComposerEditor([plain], visibleOf), plain, '最后任意可见的')
}
assert.equal(pickComposerEditor([], visibleOf), null, '一个都没有时返回 null，调用方据此切页签再等')

// ── 真实判据（生产用的那个，不是测试自己塞的 isVisible 回调）──
// 前面几条都注入了可见性判断，所以判据本身的洞它们抓不到。这里直接喂假元素。
{
  const mk = (options = {}) => ({
    isConnected: options.connected ?? true,
    closest: () => (options.settling === true ? {} : null),
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({
          display: options.display ?? 'block',
          visibility: options.visibility ?? 'visible',
        }),
      },
    },
    getBoundingClientRect: () => ({ width: options.width ?? 600, height: options.height ?? 48 }),
  })
  assert.equal(isVisibleElement(mk()), true, '正常可见的编辑器')
  assert.equal(
    isVisibleElement(mk({ visibility: 'hidden' })),
    false,
    'visibility:hidden 必须算不可见 —— 宿主正是用它藏 settling 期的输入框，而矩形仍然存在',
  )
  assert.equal(isVisibleElement(mk({ settling: true })), false, '宿主标记 settling 时不算可见')
  assert.equal(isVisibleElement(mk({ display: 'none' })), false, 'display:none')
  assert.equal(isVisibleElement(mk({ width: 0, height: 0 })), false, '零尺寸容器')
  assert.equal(isVisibleElement(mk({ connected: false })), false, '脱离文档')
}


const scrollBase = { scrollHeight: 4000, scrollTop: 0, clientHeight: 800, shown: 50, total: 99372, loading: false, now: 1000, busyAt: 0 }
// 顶部：还差得远，不加载
assert.equal(shouldLoadMore(scrollBase), false, '刚打开时不该预取下一页')
// 距底 300px（< 320 余量）：加载
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 4000 - 800 - 300 }), true, '快到底时该自动加载')
// 距底 400px：还不加载
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 4000 - 800 - 400 }), false, '离底还远就别提前拉')
// 正在加载：不重复触发
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 3500, loading: true }), false, '加载中不该再触发')
// 已经全部显示：不加载
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 3500, shown: 99372 }), false, '到底了不该再请求')
// 一条都没有（首屏还没回来 / 筛选为空）：不预取
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 3500, shown: 0, total: 0 }), false, '空列表不该预取')
// 节流窗口内：不重复触发
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 3500, now: 1050, busyAt: 1000 }), false, '100ms 内不该重复触发')
assert.equal(shouldLoadMore({ ...scrollBase, scrollTop: 3500, now: 1200, busyAt: 1000 }), true, '过了节流窗口该允许')

// ── 补满一屏的判定（必须有停手条件，否则失败请求会让 effect 空转）──
const { shouldAutoFill } = mod.__test
assert.equal(typeof shouldAutoFill, 'function', '应当导出 shouldAutoFill')
const fillBase = { scrollHeight: 300, clientHeight: 800, shown: 50, total: 99372, loading: false, lastFilledShown: -1 }
// 内容比可视高度还矮 → 该补
assert.equal(shouldAutoFill(fillBase), true, '不足一屏时该补一页')
// 已经比一屏高 → 不补（用户自己会滚）
assert.equal(shouldAutoFill({ ...fillBase, scrollHeight: 2000 }), false, '够一屏就不该补')
// 加载中 → 不补
assert.equal(shouldAutoFill({ ...fillBase, loading: true }), false, '加载中不该补')
// 页签隐藏（clientHeight 为 0）→ 不补。better-sidebar 的非活动页签是 display:none 保留挂载
assert.equal(shouldAutoFill({ ...fillBase, scrollHeight: 0, clientHeight: 0 }), false, '隐藏时不该补页')
// 上一次补页没拿到新数据（shown 没变）→ 停手。这条挡住"失败后无间隔重试"
assert.equal(shouldAutoFill({ ...fillBase, lastFilledShown: 50 }), false, '补页没进展必须停手')
// 全部显示完 → 不补
assert.equal(shouldAutoFill({ ...fillBase, shown: 99372 }), false, '到底了不该补')
// 空列表 → 不补
assert.equal(shouldAutoFill({ ...fillBase, shown: 0, total: 0 }), false, '空列表不该补')
// 刚换条件：`change()` 清了列表但 `total` 还是旧值 —— 只有 `shown === 0` 这道闸挡得住
assert.equal(shouldAutoFill({ ...fillBase, shown: 0, total: 99372 }), false, '列表空但 total 还在时不该补')
// slack 边界：正好等于可视高度 + 余量仍算"不足一屏"，超出一个像素才算够
assert.equal(shouldAutoFill({ ...fillBase, scrollHeight: 804, clientHeight: 800 }), true, '等于可视高度加余量时仍该补')
assert.equal(shouldAutoFill({ ...fillBase, scrollHeight: 805, clientHeight: 800 }), false, '超过余量一个像素就不该补')

// ── 工作台外壳：两个页签 + 工作流面板空态 ──
const { Workbench, WorkflowAdmin } = mod.__test
assert.ok(Workbench !== undefined, '应当导出 Workbench')
assert.ok(WorkflowAdmin !== undefined, '应当导出 WorkflowAdmin（工作流管理面板）')

const shell = renderToStaticMarkup(React.createElement(Workbench, {
  t,
  visible: true,
  goToConversation() {},
  openSidebar: () => true,
}))
assert.match(shell, /role="tablist"/, '应当有页签条')
// 测试里的 t 是 identity，所以断言的是文案键而不是中文（文案本身在 i18n-data 里）
assert.match(shell, />tabAssets</, '应当有资产库页签')
assert.match(shell, />tabWorkflowAdmin</, '应当有工作流管理页签')
assert.match(shell, />tabTags</, '应当有标签库页签')
assert.match(shell, />tabPoses</, '应当有姿势库页签')
assert.match(shell, />tabCostumes</, '应当有衣装库页签')
assert.match(shell, /class="cfa-root"/, '默认停在资产库')

// 内联样式必须真的注入了 —— **每一个** `<style>` 都要非空。
// 守的是一个只在 SSR 里现形的洞：React 19 的 SSR 对 `<style>` 的 children 只接受单个字符串，
// **长度 ≥2 的数组被整段静默丢弃**（写成 `<style>{A}{B}{C}{D}</style>` → 空的 `<style></style>`；
// Fragment 包起来是 `[object Object]`）。跟"可提升资源"无关：不带 href 的照样中招。
// 浏览器端不受影响，所以肉眼与手测都发现不了。
// 正则放宽到 `<style[^>]*>`：宿主将来若往 style 上加 nonce / data- 属性，不该误报。
const styleBlocks = [...shell.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1])
assert.ok(styleBlocks.length > 0, '外壳应当至少渲染出一个内联 <style>')
for (const [index, css] of styleBlocks.entries()) {
  assert.ok(
    css.trim() !== '',
    `第 ${index + 1} 个内联 <style> 是空的 —— 多半又把多个 CSS 字符串当成了多个 child`,
  )
}
// 第一个 <style> 就是外壳那份（它紧跟在 `<div class="cwb-root">` 之后）
const shellStyle = styleBlocks[0]
for (const [label, marker] of [
  ['外壳', '.cwb-root'],
  ['标签库', '.ctg-root'],
  ['姿势库', '.cps-root'],
  ['衣装库', '.cct-root'],
]) {
  assert.ok(shellStyle.includes(marker), `外壳注入的样式里缺 ${label}的 ${marker}`)
}

// 标签面板：SSR 不跑 useEffect，首帧应当是"正在建索引"而不是空列表
const { TagsPanel, TAGS_CSS } = mod.__test
assert.ok(TagsPanel !== undefined, '应当导出 TagsPanel（标签库面板）')
assert.match(TAGS_CSS, /\.ctg-root/, 'TAGS_CSS 该有根类')
const tags = renderToStaticMarkup(React.createElement(TagsPanel, { t, visible: true }))
assert.match(tags, /ctg-root/, '该渲染出面板根节点')
assert.match(tags, /tagsLoading|tagsSub/, '首帧要说明状态，不能空白')
assert.match(tags, /ctg-chip/, '该有大类筛选按钮')
assert.match(tags, /tagsEmpty/, '没有数据时给提示而不是一片空白')
assert.match(tags, /class="ctg-sync"/, '该有「更新标签」按钮（断言类名，别被 title 里的文案键满足）')

// 姿势库面板：SSR 不跑 useEffect，首帧要有根节点与筛选器，不能是空白
const { PosesPanel, POSES_CSS } = mod.__test
assert.ok(PosesPanel !== undefined, '应当导出 PosesPanel（姿势库面板）')
assert.match(POSES_CSS, /\.cps-root/, 'POSES_CSS 该有根类')
const poses = renderToStaticMarkup(React.createElement(PosesPanel, { t, visible: true, goToConversation() {} }))
assert.match(poses, /cps-root/, '该渲染出面板根节点')
assert.match(poses, /cps-title/, '该有标题')
assert.match(poses, /cps-search/, '该有搜索与筛选条')

// 衣装库面板：同样的首帧要求（它比姿势库多一行英文关键词）
const { CostumesPanel, COSTUMES_CSS } = mod.__test
assert.ok(CostumesPanel !== undefined, '应当导出 CostumesPanel（衣装库面板）')
assert.match(COSTUMES_CSS, /\.cct-root/, 'COSTUMES_CSS 该有根类')
const costumes = renderToStaticMarkup(React.createElement(CostumesPanel, { t, visible: true, goToConversation() {} }))
assert.match(costumes, /cct-root/, '该渲染出面板根节点')
assert.match(costumes, /cct-title/, '该有标题')
assert.match(costumes, /cct-search/, '该有搜索与筛选条')
assert.match(costumes, /cct-toggle/, '该有「只看常规」开关')
assert.match(costumes, /costumesLoading|costumesSub/, '首帧要说明状态，不能空白')
assert.match(costumes, /costumesEmpty/, '没有数据时给提示而不是一片空白')
assert.match(poses, /cps-toggle/, '该有「只看常规」开关')
assert.match(poses, /posesLoading|posesSub/, '首帧要说明状态，不能空白')
assert.match(poses, /posesEmpty/, '没有数据时给提示而不是一片空白')

// 空列表：给出导入指引而不是一片空白
const panel = renderToStaticMarkup(React.createElement(WorkflowAdmin, {
  t,
  visible: true,
  goToConversation() {},
}))
// SSR 不跑 useEffect，首帧停在"加载中"——这正是修掉"把加载中显示成空"的证明
assert.match(panel, /loadingWorkflows/, '首帧应当显示加载中而不是空态')

console.log('render: 全部通过（Card / Lightbox / Gallery / 删除确认 / 批量选择 / 分页 / metaLine / Workbench / WorkflowAdmin / TagsPanel）')
