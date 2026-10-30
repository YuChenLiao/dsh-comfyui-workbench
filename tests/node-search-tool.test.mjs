/**
 * `comfyui_node_search` 的工具壳。
 *
 * 索引本身的判定在 `node-index.test.mjs` 覆盖；这里守三件只有工具层才会错的事：
 * 空条件必须是 `ok:false`、ComfyUI 离线要说清、`detail` 的枚举不能吐超长串。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { NodeIndex, nodeSearchTool, resetNodeIndexCache } from '../lib/index.js'

/** 造一个假 ComfyUI 客户端。 */
function fakeClient(objectInfo, counters = { calls: 0 }) {
  return {
    async objectInfo() {
      counters.calls += 1
      if (objectInfo === 'fail') throw new Error('connect ECONNREFUSED 127.0.0.1:8188')
      return objectInfo
    },
  }
}

const OBJECT_INFO = {
  KSampler: {
    input: {
      required: {
        seed: ['INT', { default: 0 }],
        model: ['MODEL'],
      },
      optional: { denoise: ['FLOAT', { default: 1 }] },
    },
    output: ['LATENT'],
    display_name: 'KSampler',
    description: 'Sample latent.',
    category: 'sampling',
    python_module: 'nodes',
    output_node: false,
  },
  MOSSPromptComposer: {
    input: {
      required: {
        // 真实数据里这种输入有六万多个候选
        artist: [Array.from({ length: 5000 }, (_, i) => `artist_${i}`), {}],
      },
    },
    output: ['STRING'],
    display_name: 'MOSS Prompt Composer',
    description: 'Compose prompt.',
    category: 'moss',
    python_module: 'custom_nodes.ComfyUI-MOSS',
    output_node: false,
  },
  OpenAIChat: {
    input: { required: { prompt: ['STRING'] } },
    output: ['STRING'],
    display_name: 'OpenAI Chat',
    description: 'Hosted OpenAI node.',
    category: 'api',
    python_module: 'comfy_api_nodes.nodes_openai',
    output_node: false,
  },
}

test('空条件返回 ok:false，而不是伪装成"没有匹配"', async () => {
  resetNodeIndexCache()
  const tool = nodeSearchTool({ client: fakeClient(OBJECT_INFO) })
  const result = await tool.execute({})
  assert.equal(result.ok, false)
  assert.match(String(result.error), /至少要给一个查询条件/)
  // 不该出现误导性的"没有匹配"
  assert.equal('nodes' in result, false)
})

test('ComfyUI 离线时明确报错，不返回空列表', async () => {
  resetNodeIndexCache()
  const tool = nodeSearchTool({ client: fakeClient('fail') })
  const result = await tool.execute({ query: 'sampler' })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /读不到节点清单/)
})

test('detail 的枚举输入不吐超长候选串', async () => {
  resetNodeIndexCache()
  const tool = nodeSearchTool({ client: fakeClient(OBJECT_INFO) })
  const result = await tool.execute({ query: 'MOSSPromptComposer', detail: true })
  assert.equal(result.ok, true)
  const bytes = JSON.stringify(result).length
  // 5000 个候选若被 join 进 type，这里会是几十 KB
  assert.ok(bytes < 4000, `detail 输出应当很小，实际 ${bytes} 字节`)
  const detail = result.details.MOSSPromptComposer
  const artist = detail.inputs.required.find(i => i.name === 'artist')
  assert.equal(artist.type, 'COMBO')
  assert.equal(artist.optionCount, 5000)
  assert.equal(artist.options.length, 8, '候选只给前 8 个')
})

test('customOnly 排除内置 API 节点', async () => {
  const index = new NodeIndex(OBJECT_INFO)
  const result = index.search({ customOnly: true })
  const names = result.nodes.map(n => n.classType)
  assert.ok(!names.includes('OpenAIChat'), 'comfy_api_nodes 是内置的，不该算自定义')
  assert.ok(names.includes('MOSSPromptComposer'))
})

test('索引缓存复用：连续两次调用只拉一次 object_info', async () => {
  resetNodeIndexCache()
  const counters = { calls: 0 }
  const tool = nodeSearchTool({ client: fakeClient(OBJECT_INFO, counters) })
  await tool.execute({ query: 'sampler' })
  await tool.execute({ query: 'moss' })
  assert.equal(counters.calls, 1)
})

test('limit 超上限被夹到 30', async () => {
  resetNodeIndexCache()
  const tool = nodeSearchTool({ client: fakeClient(OBJECT_INFO) })
  const result = await tool.execute({ customOnly: true, limit: 500 })
  assert.ok(result.shown <= 30)
})

test('输入条数超限时截断并给出总数（防 202 输入的节点吐出 22KB）', async () => {
  // 真实数据里 LoRA Stacker 有 202 个输入，不截断单节点 22 KB；
  // detail + limit:30 最坏能到 45 KB。枚举截断管不到这种，必须单独截输入条数。
  const many = {}
  for (let i = 0; i < 120; i += 1) many[`in_${i}`] = ['INT', { default: 0 }]
  const info = {
    HugeNode: {
      input: { required: many },
      output: ['IMAGE'],
      display_name: 'Huge Node',
      description: 'Node with 120 inputs.',
      category: 'test',
      python_module: 'nodes',
      output_node: false,
    },
  }
  resetNodeIndexCache()
  const tool = nodeSearchTool({ client: fakeClient(info) })
  const result = await tool.execute({ query: 'HugeNode', detail: true })
  const detail = result.details.HugeNode
  assert.equal(detail.inputs.required.length, 40, '输入最多列 40 个')
  assert.equal(detail.inputs.truncated, true, '截断时要有标记')
  assert.equal(detail.inputs.inputCount, 120, '要给出输入总数')
  assert.ok(JSON.stringify(result).length < 6_000, `输出不该膨胀，实际 ${JSON.stringify(result).length} 字节`)
})
