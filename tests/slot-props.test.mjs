/**
 * 槽位 props 归一化：适配层的"另一半"。
 *
 * `slots.ts` 决定挂在哪，这里决定组件收到什么。两条必须钉住：
 * 1. 归一化是**容错**的 —— 宿主 props 漂移时退化成"信息少"，不能抛错把对话流打崩；
 * 2. `mountToolView` 等三个挂载函数**真的把 adapter 接上了** —— 只写函数不接线，
 *    测试全绿但组件收到的是宿主原始 props，比不做还难查。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const require = createRequire(import.meta.url)

async function loadClientModule() {
  let captured = null
  const prevWindow = globalThis.window
  globalThis.window = { __ModuleLoader__: { load: spec => { captured = spec } } }
  try {
    await import('../lib/client.js?slot-props=' + Date.now())
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
  assert.ok(captured, 'client.js 应当向 ModuleLoader 注册 factory')
  return captured.factory(require)
}

/** 造一个能捕获注册项的最小 slots 服务。 */
function captureCtx() {
  const registered = []
  const ctx = {
    get: name => (name === 'slots'
      ? {
        inject: (_slot, fn) => { fn() },
        register: (options, component) => { registered.push({ options, component }); return () => {} },
      }
      : undefined),
    inject: () => {},
  }
  return { ctx, registered }
}

test('toolViewPropsFrom：result 阶段拼出文本、错误码与参数原文', async () => {
  const mod = await loadClientModule()
  const { toolViewPropsFrom } = mod.__test

  const props = toolViewPropsFrom({
    callId: 'call-1',
    toolName: 'comfyui_run',
    phase: 'result',
    block: {
      kind: 'tool-result',
      content: [
        { type: 'text', text: '{"ok":true,' },
        { type: 'image', data: 'xxx' },
        { type: 'text', text: '"promptId":"p1"}' },
      ],
      isError: false,
      error: { code: 'E_BOOM' },
      call: { name: 'comfyui_run', argsRaw: '{"workflow":"sdxl"}' },
    },
  })

  assert.equal(props.callId, 'call-1')
  assert.equal(props.toolName, 'comfyui_run')
  assert.equal(props.phase, 'result')
  assert.equal(props.text, '{"ok":true,\n"promptId":"p1"}', '只拼 text 块，忽略 image 块')
  assert.equal(props.isError, false)
  assert.equal(props.errorCode, 'E_BOOM')
  assert.equal(props.argsRaw, '{"workflow":"sdxl"}', '参数原文从 ToolResultNode.call.argsRaw 取')
})

test('toolViewPropsFrom：缺字段一律降级，不抛错', async () => {
  const mod = await loadClientModule()
  const { toolViewPropsFrom } = mod.__test

  const empty = toolViewPropsFrom({})
  assert.equal(empty.callId, '')
  assert.equal(empty.toolName, '')
  assert.equal(empty.phase, 'preparing', '未知 phase 退化成 preparing')
  assert.equal(empty.text, '')
  assert.equal(empty.isError, false)
  assert.equal('errorCode' in empty, false, '没有错误码时不该塞 undefined')
  assert.equal(empty.argsRaw, '')

  // 脏数据：block 不是对象、content 不是数组、phase 是野值
  const dirty = toolViewPropsFrom({ phase: 'weird', block: 42, content: 'nope' })
  assert.equal(dirty.phase, 'preparing')
  assert.equal(dirty.text, '')

  // start 阶段：argsRaw 直接从 block 上取
  const started = toolViewPropsFrom({ phase: 'start', block: { argsRaw: '{"a":1}' } })
  assert.equal(started.phase, 'start')
  assert.equal(started.argsRaw, '{"a":1}')
})

test('composerStatusPropsFrom / inputDockPropsFrom：只取得到的东西', async () => {
  const mod = await loadClientModule()
  const { composerStatusPropsFrom, inputDockPropsFrom } = mod.__test

  assert.deepEqual(composerStatusPropsFrom({ sessionId: 's1' }), { sessionId: 's1' })
  assert.deepEqual(composerStatusPropsFrom({}), {}, '没有 sessionId 时不留空字段')

  // input.dock 的 ownerProps 是 InputZone = { session, input }
  assert.deepEqual(
    inputDockPropsFrom({ inputZone: { session: { id: 's1' }, input: { draft: '一只猫' } } }),
    { sessionId: 's1', draft: '一只猫' },
  )
  // 宿主也可能把 input 展开到顶层
  assert.deepEqual(inputDockPropsFrom({ draft: 'top' }), { draft: 'top' })
  // 什么都没有
  assert.deepEqual(inputDockPropsFrom({}), { draft: '' })
})

test('mountToolView：adapter 真的接上了（组件收到归一化 props，不是宿主原始 props）', async () => {
  const mod = await loadClientModule()
  const { mountToolView } = mod.__test
  const { ctx, registered } = captureCtx()

  const seen = []
  const ok = mountToolView(ctx, 'comfyui_run', props => { seen.push(props); return null })
  assert.equal(ok, true)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].options.key, 'comfyui_run', 'keyed 槽位的 key 必须是工具名')
  assert.equal(registered[0].options.name, 'tool.call.toolview')

  // 宿主按原样调用注册的组件
  registered[0].component({
    callId: 'c9',
    toolName: 'comfyui_run',
    phase: 'result',
    block: { content: [{ type: 'text', text: '{"ok":true}' }], isError: true },
    // 宿主多给的字段不该原样透传到组件
    useDisclosure: () => {},
    loadImage: () => {},
  })

  assert.equal(seen.length, 1)
  assert.equal(seen[0].callId, 'c9')
  assert.equal(seen[0].text, '{"ok":true}')
  assert.equal(seen[0].isError, true)
  assert.equal('useDisclosure' in seen[0], false, '归一化后不应把宿主内部 hook 透出去')
})

test('mountComposerStatus / mountInputDock：槽位名与 id/order 正确，adapter 同样生效', async () => {
  const mod = await loadClientModule()
  const { mountComposerStatus, mountInputDock } = mod.__test
  const { ctx, registered } = captureCtx()

  const seen = []
  assert.equal(mountComposerStatus(ctx, 'cwf-status', props => { seen.push(props); return null }, 42), true)
  assert.equal(registered[0].options.name, 'conversation.input.left')
  assert.equal(registered[0].options.id, 'cwf-status')
  assert.equal(registered[0].options.order, 42)

  seen.length = 0
  assert.equal(mountInputDock(ctx, 'cwf-dock', props => { seen.push(props); return null }), true)
  assert.equal(registered[1].options.name, 'conversation.input.dock')
  assert.equal(registered[1].options.order, 40, 'order 默认 40')

  registered[1].component({ inputZone: { input: { draft: 'draft!' } } })
  assert.equal(seen[0].draft, 'draft!')
})
