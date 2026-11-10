/**
 * 姿势库的模型侧工具。
 *
 * **一个工具、两条路径**：`comfyui_pose`，给 `query` 是搜，给 `id` 是取图。
 * 原来拆成 search / fetch 两个，模型得先决定"我现在该调哪个"——那是个假选择，
 * 因为两个动作是同一个对象（姿势）上的连续动作，`query` 与 `id` 天然互斥。
 *
 * ## 为什么不加「按姿势直接出图」
 *
 * 那是澜姿的定位（它自带 provider、自己调 API）。工作台已经有 `comfyui_run`，
 * 出图这条路只能有一条，否则 seed 记录、运行记录、通知会出现两套。
 * 这里只负责**把线稿变成工作流能吃的输入图**，剩下的交给现有的 run 链路。
 *
 * ## 为什么搜索不直接把缩略图落盘
 *
 * 想过让搜索结果带上可用的图路径，省掉"搜完再取一次"。实测否决：一次搜 10 条就是
 * 10 次第三方图床请求（`ai-pose-gallery.anhao.app`），那个站点不稳，会把一次毫秒级的
 * 索引查询变成几秒的等待，而且大部分结果模型根本不会用。**搜索保持轻**，要图就传 id。
 */
import { asString } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { PosesIndex, PoseHit } from './catalog.js'
import type { PoseImages } from './images.js'

/** 工具返回里只用这些字段：姿势库有 1439 个视角，全给会把上下文吃光。 */
function brief(hit: PoseHit): Record<string, unknown> {
  return {
    id: hit.id,
    name: hit.name,
    category: hit.category,
    system: hit.system,
    views: hit.viewCount,
    adult: hit.adult,
  }
}

export interface PoseToolDeps {
  index: PosesIndex
  images: PoseImages
  uploadsDir: () => string
}

/** 搜：按中文名 / 编号 / 分类找姿势组。 */
function search(deps: PoseToolDeps, args: Record<string, unknown>): Record<string, unknown> {
  const query = asString(args.query).trim()
  const system = asString(args.system).trim()
  const category = asString(args.category).trim()
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30)
  const onlySafe = args.onlySafe === true

  const known = deps.index.stats().systems.map(item => item.id)
  if (system !== '' && !known.includes(system)) {
    return { ok: false, error: `system 只能是 ${known.join(' / ')}，收到「${system}」。` }
  }

  const result = deps.index.search({ query, systemId: system, category, onlySafe, limit })
  if (result.items.length === 0) {
    // 区分"本来就没有"与"被筛掉了"：后者去掉条件就有了，前者要换词
    const all = deps.index.search({ query, limit: 1 })
    const unfiltered = all.total
    return {
      ok: true,
      mode: 'search',
      poses: [],
      total: 0,
      note: unfiltered === 0
        ? '没有匹配的姿势。换个词试试，或者去掉 system / category。'
        : `有 ${unfiltered} 组符合关键词，但被 system / category / onlySafe 过滤掉了。去掉条件再查。`,
    }
  }

  return {
    ok: true,
    mode: 'search',
    total: result.total,
    poses: result.items.map(brief),
    hint: '要哪组的图就把它的 id 传给同一个工具（不带 query）。',
  }
}

/** 取图：把某个角度（或某个姿势的正脸）的线稿落盘，返回可当输入图的路径。 */
async function fetchView(deps: PoseToolDeps, id: string, sizeArg: unknown): Promise<Record<string, unknown>> {
  const found = deps.index.findView(id)
  if (found === undefined) {
    return { ok: false, error: `没有这个姿势视角：${id}。先不带 id 搜一下拿到正确的 id。` }
  }
  const size = asString(sizeArg, 'full') === 'thumb' ? 'thumb' : 'full'
  const relativePath = size === 'full' ? found.view.full : found.view.thumb
  try {
    const { file, mediaType } = await deps.images.materialize(relativePath, deps.uploadsDir())
    return {
      ok: true,
      mode: 'fetch',
      file,
      mediaType,
      size,
      pose: {
        id: found.pose.id,
        name: found.pose.name,
        system: found.pose.system,
        category: found.pose.category,
        angle: found.view.angle,
        viewId: found.view.id,
      },
      next: '把 file 作为工作流的图片输入（comfyui_run 的 vars 里对应那个 image 槽位）。',
    }
  } catch (error) {
    return {
      ok: false,
      error: `姿势线稿取不到：${error instanceof Error ? error.message : String(error)}`,
      hint: '图来自第三方图床（ai-pose-gallery.anhao.app），它不可用时这条就取不到；姿势检索本身不受影响。',
    }
  }
}

/**
 * `comfyui_pose`：**给 query 搜索，给 id 取图**。
 *
 * @param deps - 索引 + 取图器。
 */
export function poseTool(deps: PoseToolDeps): ToolSpec {
  return {
    name: 'comfyui_pose',
    description:
      '姿势参考库（288 组、1439 个角度，来自 Danbooru 社区的人体参考图库）。'
      + '**给 query 是搜**：返回姿势 id、中文名、分类与角度数，不含图片；'
      + '**给 id 是取图**：把那个姿势的人体线稿落到本机 uploads，返回路径，可当工作流的输入图'
      + '（ControlNet / 图生图）。传姿势 id 给正面，传视角 id（如 full_single_P001_side）给那个角度。'
      + '两件事合在一个工具里，因为没有"先取图再搜"这种顺序 —— 一定是先搜到 id 再取。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词：中文姿势名、编号（P001）或分类（坐姿）。空格分隔多个词做 AND。给 id 时忽略。' },
        system: {
          type: 'string',
          enum: ['full', 'sexy', 'bust', 'pair'],
          description: '搜索结果按体系筛：full 全身标准 / sexy 全身性感 / bust 上半身 / pair 双人。不传则全部。',
        },
        category: { type: 'string', description: '搜索结果按动作分类筛，如「坐姿」「站姿」「趴卧」「跪立」。不传则全部。' },
        onlySafe: { type: 'boolean', description: '搜索结果只看常规姿势（默认 false，即全部）。' },
        limit: { type: 'integer', description: '搜索最多返回几组，默认 10，上限 30。' },
        id: { type: 'string', description: '姿势 id（full_single_P001）或视角 id（full_single_P001_side）。**给了它就取图，不是搜索。**' },
        size: {
          type: 'string',
          enum: ['thumb', 'full'],
          description: '取图尺寸：thumb 是 300×400 缩略图（快、够做姿势参考），full 是原尺寸 PNG。默认 full。',
        },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
      const id = asString(args.id).trim()
      if (id !== '') return fetchView(deps, id, args.size)
      return search(deps, args)
    },
  }
}
