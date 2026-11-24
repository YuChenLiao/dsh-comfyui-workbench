import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

const {
  createHostToolRegistrar,
  deliverSessionNotice,
  mountHostRoutes,
  NOTICE_SOURCE_KIND,
  noticeMessage,
  onHostDispose,
  registerHostTool,
  registerHostTools,
} = await import('../lib/index.js')

const require = createRequire(import.meta.url)

async function loadClientModule() {
  let captured = null
  const prevWindow = globalThis.window
  globalThis.window = {
    __ModuleLoader__: {
      load(spec) {
        captured = spec
      },
    },
  }
  try {
    await import('../lib/client.js?host-adapter-test=' + Date.now())
  } finally {
    if (prevWindow === undefined) delete globalThis.window
    else globalThis.window = prevWindow
  }
  assert.ok(captured, 'client.js 应当向 ModuleLoader 注册 factory')
  return captured.factory(require)
}

test('服务端适配层：tools 缺失或无 register 时安全降级并告警', () => {
  const warnings = []
  const okMissing = registerHostTool(
    { get: () => undefined },
    { name: 'demo_tool' },
    { warn: msg => warnings.push(msg), missingMessage: 'missing tools' },
  )
  assert.equal(okMissing, false)
  assert.deepEqual(warnings, ['missing tools'])

  const countInvalid = registerHostTools(
    { get: () => ({}) },
    [{ name: 'a' }, { name: 'b' }],
    { warn: msg => warnings.push(msg), missingMessage: 'invalid tools' },
  )
  assert.equal(countInvalid, 0)
  assert.deepEqual(warnings, ['missing tools', 'invalid tools'])

  assert.equal(createHostToolRegistrar({ get: () => undefined }), undefined)
})

test('服务端适配层：tools.register 成功时追踪 disposer，抛错时兜底或透传', () => {
  let disposed = 0
  const effects = []
  const registered = []
  const ctx = {
    get: name => (name === 'tools'
      ? {
        register: spec => {
          if (spec.name === 'boom') throw new Error('bad spec')
          registered.push(spec.name)
          return () => { disposed += 1 }
        },
      }
      : undefined),
    effect: (run, label) => {
      const cleanup = run()
      effects.push({ label, cleanup })
    },
  }

  const warnings = []
  const hooks = []
  const count = registerHostTools(
    ctx,
    [{ name: 'good' }, { name: 'boom' }],
    {
      label: 'test',
      warn: msg => warnings.push(msg),
      onRegistered: spec => hooks.push(spec.name),
    },
  )
  assert.equal(count, 1)
  assert.deepEqual(registered, ['good'])
  assert.deepEqual(hooks, ['good'])
  assert.equal(effects.length, 1)
  assert.equal(effects[0].label, 'test: tool good')
  assert.match(warnings[0], /boom.*bad spec/)

  effects[0].cleanup()
  assert.equal(disposed, 1)

  const registrar = createHostToolRegistrar(ctx, { label: 'gen' })
  assert.equal(typeof registrar, 'function')
  assert.throws(() => registrar({ name: 'boom' }), /bad spec/)
})

test('服务端适配层：ctx.effect 缺失时 onHostDispose 与 mountHostRoutes 兼容运行', () => {
  assert.doesNotThrow(() => onHostDispose({}, 'no-effect', () => {}))

  let mounted = 0
  let unmounted = 0
  const unmountDirect = mountHostRoutes({}, 'direct', () => {
    mounted += 1
    return () => { unmounted += 1 }
  })
  assert.equal(mounted, 1)
  unmountDirect()
  assert.equal(unmounted, 1)

  let effectCleanup = null
  mountHostRoutes(
    {
      effect: run => {
        effectCleanup = run()
      },
    },
    'with-effect',
    () => {
      mounted += 1
      return () => { unmounted += 1 }
    },
  )
  assert.equal(mounted, 2)
  assert.equal(typeof effectCleanup, 'function')
  effectCleanup()
  assert.equal(unmounted, 2)
})

test('会话通知适配层：noticeMessage 信封结构与 deliverSessionNotice 异常吞吐', () => {
  assert.equal(NOTICE_SOURCE_KIND, 'plugin:dsh-comfyui-workbench')
  const msg = noticeMessage('出图完成', 'msg-1')
  assert.deepEqual(msg, {
    id: 'msg-1',
    role: 'user',
    content: [{ type: 'text', text: '出图完成' }],
    source: { kind: 'plugin:dsh-comfyui-workbench' },
  })

  const sent = []
  deliverSessionNotice({ followup: m => sent.push(m) }, 'hello', { id: 'msg-2' })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].id, 'msg-2')
  assert.equal(sent[0].source.kind, NOTICE_SOURCE_KIND)

  const warnings = []
  assert.doesNotThrow(() => {
    deliverSessionNotice(
      { followup: () => { throw new Error('session closed') } },
      'ignored',
      { logger: { info: () => {}, warn: m => warnings.push(m), error: () => {} }, tag: 'batch' },
    )
  })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /\[batch\] 通知未送达：session closed/)

  // logger.warn 自己抛错也不能逃逸
  assert.doesNotThrow(() => {
    deliverSessionNotice(
      { followup: () => { throw new Error('followup fail') } },
      'ignored',
      { logger: { info: () => {}, warn: () => { throw new Error('logger fail') }, error: () => {} } },
    )
  })
})

test('客户端适配层：slots 缺失、betterSidebar 缺席与扩展槽位安全降级', async () => {
  const mod = await loadClientModule()
  const {
    mountWorkbenchEntries,
    mountToolView,
    mountComposerSlot,
    mountInputDock,
    navigateToConversation,
    hostLocale,
  } = mod.__test

  // slots 缺失时不抛错，openSidebar 返回 false
  const noSlots = mountWorkbenchEntries(
    { get: () => undefined, inject: () => {} },
    {
      title: () => 'T',
      description: () => 'D',
      renderTabIcon: () => null,
      renderPanelIcon: () => null,
      renderTab: () => null,
      renderMain: () => null,
    },
  )
  assert.equal(noSlots.openSidebar(), false)
  assert.equal(mountToolView({ get: () => undefined }, {}, null), false)
  assert.equal(mountComposerSlot({ get: () => undefined }, {}, null), false)
  assert.equal(mountInputDock({ get: () => undefined }, {}, null), false)

  // betterSidebar 缺席时仍正常注册 sidebar.panellist 与 main
  const registeredSlots = []
  const withSlotsOnly = mountWorkbenchEntries(
    {
      get: name => (name === 'slots'
        ? {
          inject: (slotName, fn) => {
            registeredSlots.push(slotName)
            fn()
          },
          register: (opts, _comp) => {
            registeredSlots.push(`reg:${opts.name}`)
            return () => {}
          },
        }
        : undefined),
      inject: () => {
        // betterSidebar 未安装，不触发回调
      },
    },
    {
      title: () => 'T',
      description: () => 'D',
      renderTabIcon: () => null,
      renderPanelIcon: () => null,
      renderTab: () => null,
      renderMain: () => null,
    },
  )
  assert.equal(withSlotsOnly.openSidebar(), false)
  assert.deepEqual(registeredSlots, ['sidebar.panellist', 'reg:sidebar.panellist', 'main', 'reg:main'])

  // betterSidebar 存在且无 scope.effect 时降级直接注册并支持 openSidebar
  const opened = []
  let disposedTab = 0
  const withSidebar = mountWorkbenchEntries(
    {
      get: () => undefined,
      inject: (_names, run) => {
        run({
          betterSidebar: {
            registerTab: () => () => { disposedTab += 1 },
            openTab: seed => opened.push(seed.type),
          },
        })
      },
    },
    {
      title: () => 'T',
      description: () => 'D',
      renderTabIcon: () => null,
      renderPanelIcon: () => null,
      renderTab: () => null,
      renderMain: () => null,
    },
  )
  assert.equal(withSidebar.openSidebar(), true)
  assert.deepEqual(opened, ['comfyui-workbench:workbench'])
  assert.equal(disposedTab, 0)

  // runtime 辅助：layout / locale 缺失时安全兜底
  assert.doesNotThrow(() => navigateToConversation({ get: () => undefined }))
  assert.doesNotThrow(() => navigateToConversation({ get: () => { throw new Error('no layout') } }))
  assert.equal(hostLocale({ get: () => undefined }), 'zh')
  assert.equal(hostLocale({ get: () => ({ getSnapshot: () => ({ active: 'en-US' }) }) }), 'en-US')
})
