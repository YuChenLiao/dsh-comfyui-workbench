/**
 * 工作流列表的分组 / 筛选 / 折叠逻辑。
 *
 * 这一层是纯函数，所以每条规则都能直接断言。要钉住的是四类真实坑：
 * 1. 把放大模型当底模（`infer.ts` 的 primary 兜底会让 `4x-UltraSharp.pth` 变成 model）；
 * 2. Windows 的 `\` 与 POSIX 的 `/` 把同一套底模拆成两组；
 * 3. 搜到了却因为组是折叠的看不见；
 * 4. 首次打开就全展开，一屏全是卡片。
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import path from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

/**
 * 载入浏览器端 bundle。
 *
 * 它不像服务端那样导出 ESM 名字：`lib/client.js` 向 `window.__ModuleLoader__` 注册一个
 * factory，宿主再 `factory(require)` 把它装配起来。测试要拿到 `__test` 就得走同一条路 ——
 * 直接 `import { __test } from '../lib/client.js'` 会报 "does not provide an export named"。
 */
let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { captured = spec },
  },
}
await import('../lib/client.js?cache-bust=' + Date.now())
assert.ok(captured, 'client.js 应当向 ModuleLoader 注册 factory')
const mod = captured.factory(createRequire(path.join(here, '..', 'package.json')))

const {
  groupWorkflows,
  groupsToExpandForAudit,
  isFiltering,
  matchesFilter,
  modelGroupOf,
  resolveExpanded,
  TAIL_LABEL,
} = mod.__test

/** 造一条列表项（只填分组会用到的字段）。 */
function item(over = {}) {
  return {
    workflowId: 'wf',
    title: 'Workflow',
    description: '',
    model: 'sd_xl_base.safetensors',
    modelKind: 'checkpoint',
    otherModels: [],
    inputKinds: ['string'],
    inputCount: 2,
    basicCount: 1,
    outputs: [{ kind: 'image', count: 1 }],
    nodes: 5,
    workflowHash: 'h',
    enabled: true,
    ...over,
  }
}

test('按底模分组：checkpoint / diffusion 各自成组，组头去掉扩展名', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'a', model: 'sdxl/base.safetensors', modelKind: 'checkpoint' }),
    item({ workflowId: 'b', model: 'sdxl/base.safetensors', modelKind: 'checkpoint' }),
    item({ workflowId: 'c', model: 'flux/dev.safetensors', modelKind: 'diffusion' }),
  ])
  assert.equal(groups.length, 2)
  const sdxl = groups.find(group => group.items.some(row => row.workflowId === 'a'))
  assert.equal(sdxl.label, 'base', '组头显示文件名去扩展名')
  assert.equal(sdxl.kind, 'checkpoint')
  assert.equal(sdxl.items.length, 2)
  const flux = groups.find(group => group.items.some(row => row.workflowId === 'c'))
  assert.equal(flux.kind, 'diffusion')
})

test('斜杠与大小写归一：同一套底模不能被拆成两组', () => {
  // Windows 存档常见 `SDXL\base.safetensors`，POSIX 是 `sdxl/base.safetensors`
  const groups = groupWorkflows([
    item({ workflowId: 'a', model: 'SDXL\\base.safetensors', modelKind: 'checkpoint' }),
    item({ workflowId: 'b', model: 'sdxl/base.safetensors', modelKind: 'checkpoint' }),
  ])
  assert.equal(groups.length, 1, `同一套底模被拆成了 ${groups.length} 组`)
  assert.equal(groups[0].items.length, 2)
})

test('放大 / 无模型进兜底组，且固定置底', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'up', model: '4x-UltraSharp.pth', modelKind: 'upscale' }),
    item({ workflowId: 'bare', model: '', modelKind: '' }),
    item({ workflowId: 'sdxl', model: 'sdxl/base.safetensors', modelKind: 'checkpoint' }),
  ])
  assert.equal(groups.length, 2, '放大与无模型应该合成同一个兜底组')
  assert.equal(groups[groups.length - 1].label, TAIL_LABEL, '兜底组必须置底')
  assert.equal(groups[0].key.includes('sdxl'), true, '真实底模组在前')
  assert.equal(groups[groups.length - 1].items.length, 2)
})

test('排序：启用多的组在前，其余按名字', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'a', model: 'aaa.safetensors', modelKind: 'checkpoint', enabled: false }),
    item({ workflowId: 'b', model: 'bbb.safetensors', modelKind: 'checkpoint', enabled: true }),
    item({ workflowId: 'c', model: 'bbb.safetensors', modelKind: 'checkpoint', enabled: true }),
  ])
  assert.equal(groups[0].label, 'bbb', '启用 2 条的组排在启用 0 条的前面')
  assert.equal(groups[0].enabledCount, 2)
  assert.equal(groups[1].enabledCount, 0)
})

test('筛选：启用 / 停用 / 吃图 / 有告警', () => {
  const enabled = item({ workflowId: 'a' })
  const disabled = item({ workflowId: 'b', enabled: false })
  const image = item({ workflowId: 'c', imageSlots: ['image'] })
  const warning = item({ workflowId: 'd', missingModels: ['x.safetensors'] })

  assert.equal(matchesFilter(enabled, 'all'), true)
  assert.equal(matchesFilter(disabled, 'all'), true)
  assert.equal(matchesFilter(disabled, 'enabled'), false)
  assert.equal(matchesFilter(disabled, 'disabled'), true)
  assert.equal(matchesFilter(image, 'image'), true)
  assert.equal(matchesFilter(enabled, 'image'), false)
  assert.equal(matchesFilter(warning, 'warning'), true)
  assert.equal(matchesFilter(enabled, 'warning'), false)
  // 拿不到 object_info 时没有 missingModels —— 不该把全部工作流都标成"有告警"
  assert.equal(matchesFilter(item({ workflowId: 'e', missingModels: undefined }), 'warning'), false)
})

test('搜索命中标题 / id / 底模 / 用途备注，且大小写不敏感', () => {
  const rows = [
    item({ workflowId: 'text2img', title: '文生图', description: '基础出图', model: 'sdxl/base.safetensors' }),
    item({ workflowId: 'upscale', title: '放大', description: '把图放大四倍', model: '4x-UltraSharp.pth', modelKind: 'upscale' }),
  ]
  const byTitle = groupWorkflows(rows, { query: '放大' })
  assert.equal(byTitle.length, 1)
  assert.equal(byTitle[0].items[0].workflowId, 'upscale')

  const byId = groupWorkflows(rows, { query: 'TEXT2IMG' })
  assert.equal(byId.length, 1)
  assert.equal(byId[0].items[0].workflowId, 'text2img')

  const byModel = groupWorkflows(rows, { query: 'sdxl' })
  assert.equal(byModel[0].items[0].workflowId, 'text2img')

  const byNote = groupWorkflows(rows, { query: '四倍' })
  assert.equal(byNote[0].items[0].workflowId, 'upscale')
})

test('搜不到任何东西时返回空数组（不是留着全部）', () => {
  const groups = groupWorkflows([item({ workflowId: 'a' })], { query: 'no-such-workflow' })
  assert.deepEqual(groups, [])
})

test('折叠状态：搜索/筛选强制全展，无记录默认全收，有记录按记录', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'a', model: 'aaa.safetensors' }),
    item({ workflowId: 'b', model: 'bbb.safetensors' }),
  ])
  const keys = groups.map(group => group.key)

  // 没有任何记录 → 全收（首屏简洁）
  const fresh = resolveExpanded(groups, {}, false)
  for (const key of keys) assert.equal(fresh[key], false, `没有记录时 ${key} 不该展开`)

  // 用户手动展开过一组 → 只展开那一组
  const remembered = resolveExpanded(groups, { [keys[0]]: true }, false)
  assert.equal(remembered[keys[0]], true)
  assert.equal(remembered[keys[1]], false)

  // 搜索中 → 强制全展（否则搜到了却看不见）
  const searching = resolveExpanded(groups, {}, true)
  for (const key of keys) assert.equal(searching[key], true, '搜索时每个可见组都要展开')
})

test('isFiltering：只有真正在过滤时才算', () => {
  assert.equal(isFiltering('', 'all'), false)
  assert.equal(isFiltering('   ', 'all'), false)
  assert.equal(isFiltering('放大', 'all'), true)
  assert.equal(isFiltering('', 'enabled'), true)
})

test('体检后要展开哪些组：命中告警的组', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'dead', model: 'aaa.safetensors' }),
    item({ workflowId: 'ok', model: 'bbb.safetensors' }),
  ])
  const keys = groupsToExpandForAudit(groups, new Set(['dead']))
  assert.equal(keys.length, 1)
  assert.equal(keys[0], groups.find(group => group.items[0].workflowId === 'dead').key)
  assert.deepEqual(groupsToExpandForAudit(groups, new Set()), [])
})

test('modelGroupOf：空 model 与未知 kind 都进兜底组', () => {
  assert.equal(modelGroupOf(item({ model: '', modelKind: '' })).tail, true)
  assert.equal(modelGroupOf(item({ model: 'x.safetensors', modelKind: 'vae' })).tail, true)
  assert.equal(modelGroupOf(item({ model: 'x.safetensors', modelKind: 'lora' })).tail, true)
  assert.equal(modelGroupOf(item({ model: 'x.safetensors', modelKind: 'checkpoint' })).tail, false)
})

test('groupWorkflows 真的应用了筛选（不是只把参数收下）', () => {
  const items = [
    item({ workflowId: 'on', model: 'aaa.safetensors' }),
    item({ workflowId: 'off', model: 'bbb.safetensors', enabled: false }),
  ]
  const enabledOnly = groupWorkflows(items, { filter: 'enabled' })
  assert.equal(enabledOnly.flatMap(group => group.items).length, 1)
  assert.equal(enabledOnly[0].items[0].workflowId, 'on')

  const disabledOnly = groupWorkflows(items, { filter: 'disabled' })
  assert.equal(disabledOnly[0].items[0].workflowId, 'off')
})

test('搜索两侧都做大小写归一（标题大写、查询小写也要命中）', () => {
  const groups = groupWorkflows([item({ workflowId: 'a', title: 'TEXT2IMG' })], { query: 'text2img' })
  assert.equal(groups.length, 1, '标题大写 + 查询小写时应当命中')
})

test('底模名前后空格不影响分组', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'a', model: '  sdxl/base.safetensors  ', modelKind: 'checkpoint' }),
    item({ workflowId: 'b', model: 'sdxl/base.safetensors', modelKind: 'checkpoint' }),
  ])
  assert.equal(groups.length, 1, '带空格的底模名应当与不带空格的分到同一组')
})

test('组级告警：组内有一个模板缺模型，整组 warning 为 true', () => {
  const groups = groupWorkflows([
    item({ workflowId: 'ok', model: 'aaa.safetensors' }),
    item({ workflowId: 'bad', model: 'aaa.safetensors', missingModels: ['x.safetensors'] }),
  ])
  assert.equal(groups.length, 1)
  assert.equal(groups[0].warning, true, '组头红点靠这个字段（收起时也要看得见）')

  const clean = groupWorkflows([item({ workflowId: 'ok', model: 'aaa.safetensors' })])
  assert.equal(clean[0].warning, false)
})
