/**
 * `comfyui_node_search`：按节点的各项信息搜索本机 ComfyUI 的节点。
 *
 * 为什么值得做：`comfyui_workflow_inspect` 只能告诉你"缺了哪些节点"，但它不知道
 * 「有哪些节点能做放大」这类问题。模型改工作流时最需要的是"还有哪些同类节点"。
 *
 * 与官方 comfy-mcp 的 `nodes` 工具的区别：它 8 个 action 且深度绑 comfy-cli，
 * 这里只做 search 一个动作、只依赖 ComfyUI 在跑、并且按上下文预算裁剪
 * （默认一行摘要，limit 上限 30）。
 */
import { NodeIndex } from '../../../shared/comfy/node-index.js'
import type { NodeQuery, NodeSearchResult } from '../../../shared/comfy/node-index.js'
import type { ComfyClient } from '../../../shared/comfy/client.js'
import { asInt, asString } from '../../../shared/tools/types.js'
import type { LoggerLike } from '../../../shared/host/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'

export interface NodeSearchDeps {
  client: ComfyClient
  logger?: LoggerLike | undefined
}

/**
 * 建索引是几 MB 的解析，进程内缓存一份。
 *
 * 缓存键带上 baseUrl —— 同一个进程可能连不同的 ComfyUI 实例（换端口、连远程），
 * 不区分的话切换后最多 60 秒内会命中上一个实例的索引。
 */
let cached: { index: NodeIndex; at: number; baseUrl: string } | undefined

/** 缓存多久。装完新节点不重启也能在 1 分钟后看到。 */
const TTL_MS = 60_000

/** 取（或重建）索引。 */
async function indexOf(deps: NodeSearchDeps): Promise<NodeIndex> {
  const now = Date.now()
  if (cached !== undefined && cached.baseUrl === deps.client.baseUrl && now - cached.at < TTL_MS) {
    return cached.index
  }
  // skipEnsure: 不能因为"搜个节点"就把 ComfyUI 拉起来
  const raw = await deps.client.objectInfo(false, { timeoutMs: 20_000, skipEnsure: true })
  const index = new NodeIndex(raw as Record<string, unknown>)
  cached = { index, at: now, baseUrl: deps.client.baseUrl }
  return index
}

/** 清缓存（测试用）。 */
export function resetNodeIndexCache(): void {
  cached = undefined
}

/**
 * 造工具。
 *
 * @param deps - ComfyUI 客户端。
 */
export function nodeSearchTool(deps: NodeSearchDeps): ToolSpec {
  return {
    name: 'comfyui_node_search',
    description:
      '按节点的各项信息搜索本机 ComfyUI 已安装的节点。用于：想知道"有哪些节点能做放大/去背景/换脸"；'
      + '遇到不认识的自定义节点时查它的用途；某个模型文件能被哪些节点加载。'
      + '返回精简列表（类名、显示名、分类、所属包、一句话说明与命中原因）；detail=true 才给输入输出。'
      + '至少要给一个条件 —— 不加筛选地列出全部节点没有意义，也不会被接受。'
      + '注意：节点的元数据（display_name / description / search_aliases）都是英文，用中文查不到结果；'
      + 'hasModel 要给模型文件名的一段（如 "waiNSFWIllustrious"），不要给 "upscale" 这类普通词。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        query: { type: 'string', description: '自由文本：匹配类名、显示名、ComfyUI 自带的搜索别名、分类与描述。如 "upscale"、"mask"、"switch"。元数据是英文，中文查不到' },
        category: { type: 'string', description: '分类过滤（前缀匹配），如 "image"、"image/upscale"、"model"。不传则不限' },
        produces: { type: 'string', description: '输出类型过滤，如 "IMAGE"、"LATENT"、"MASK"、"MODEL"' },
        accepts: { type: 'string', description: '输入类型过滤：找"能吃 IMAGE 的节点"就传 IMAGE' },
        pack: { type: 'string', description: '限定扩展包，如 "comfyui-impact-pack"；"core" 表示只要内置节点' },
        hasModel: { type: 'string', description: '模型文件名的一段（如 "waiNSFWIllustrious"），找出哪个节点的可选值里有它。给普通词会误命中无关枚举' },
        customOnly: { type: 'boolean', description: '只要自定义节点，不要内置的' },
        limit: { type: 'integer', description: '最多几条，默认 8，上限 30' },
        detail: { type: 'boolean', description: 'true 时附带输入输出结构（默认只给一行摘要）' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const query: NodeQuery = {
        query: asString(args.query).trim() === '' ? undefined : asString(args.query).trim(),
        category: asString(args.category).trim() === '' ? undefined : asString(args.category).trim(),
        produces: asString(args.produces).trim() === '' ? undefined : asString(args.produces).trim(),
        accepts: asString(args.accepts).trim() === '' ? undefined : asString(args.accepts).trim(),
        pack: asString(args.pack).trim() === '' ? undefined : asString(args.pack).trim(),
        hasModel: asString(args.hasModel).trim() === '' ? undefined : asString(args.hasModel).trim(),
        customOnly: args.customOnly === true,
        limit: asInt(args.limit, 8, 1, 30),
        detail: args.detail === true,
      }

      let index: NodeIndex
      try {
        index = await indexOf(deps)
      } catch (error) {
        // 离线时明确说清，不静默返回空 —— 那会让模型以为"没有这个节点"
        return {
          ok: false,
          error: `读不到节点清单（ComfyUI 可能没在跑）：${error instanceof Error ? error.message : String(error)}`,
          hint: '节点搜索需要 ComfyUI 在线（要读它的 /object_info）。',
        }
      }

      // 空条件不能落到下面"没有匹配"的分支：那会返回 ok:true + 一句误导性的
      // "本机 N 个节点里没有匹配的"，而 description 承诺的是"不会被接受"。
      if (query.query === undefined && query.category === undefined && query.produces === undefined
        && query.accepts === undefined && query.pack === undefined && query.hasModel === undefined
        && query.customOnly !== true) {
        return {
          ok: false,
          error: '至少要给一个查询条件（query / category / produces / accepts / pack / hasModel / customOnly）。',
          hint: `不加筛选地列出全部 ${index.size} 个节点会挤爆上下文，所以不做。可以先用 category 或 produces 收窄。`,
          categories: index.categories(),
        }
      }

      const result: NodeSearchResult = index.search(query)
      if (result.total === 0) {
        return {
          ok: true,
          total: 0,
          shown: 0,
          nodes: [],
          hint: `本机 ${index.size} 个节点里没有匹配的。试试放宽条件，或先看有哪些分类：${index.categories().slice(0, 8).join(', ')}`,
        }
      }

      // detail 模式下，被截断的节点要说一句 —— 否则调用方以为那就是全部输入
      const truncatedNames = result.details === undefined
        ? []
        : Object.entries(result.details)
          .filter(([, detail]) => detail.inputs.truncated === true)
          .map(([name]) => name)

      return {
        ok: true,
        total: index.size,
        matched: result.total,
        shown: result.shown,
        ...(result.details === undefined ? {} : { details: result.details }),
        nodes: result.nodes,
        ...(truncatedNames.length === 0
          ? {}
          : { truncationHint: `这些节点的输入超过 40 个，只列了前 40 个：${truncatedNames.join('、')}` }),
        ...(result.total > result.shown ? { hint: `只显示前 ${result.shown} 条，共 ${result.total} 条匹配。缩小条件或提高 limit。` } : {}),
      }
    },
  }
}
