/**
 * 姿势库的模型侧工具。
 *
 * 两个：`comfyui_pose_search` 找人，`comfyui_pose_fetch` 把线稿落到 uploads。
 *
 * ## 为什么不加「按姿势直接出图」
 *
 * 那是澜姿的定位（它自带 provider、自己调 API）。工作台已经有 `comfyui_run`，
 * 出图这条路只能有一条，否则 seed 记录、运行记录、通知会出现两套。
 * 这里只负责**把线稿变成工作流能吃的输入图**，剩下的交给现有的 run 链路。
 */
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { PosesIndex, PoseHit } from './catalog.js'
import type { PoseImages } from './images.js'

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 工具返回里只用这些字段：姿势库有 1439 个视角，全给会把上下文吃光。 */
function brief(hit: PoseHit): Record<string, unknown> {
  return {
    id: hit.id,
    name: hit.name,
    category: hit.category,
    system: hit.system,
    views: hit.viewCount,
    ...(hit.adult ? { adult: true } : {}),
  }
}

export interface PoseToolDeps {
  index: PosesIndex
  images: PoseImages
  uploadsDir: () => string
}

/**
 * `comfyui_pose_search`：按中文名 / 编号 / 分类找姿势组。
 *
 * @param deps - 索引。
 */
export function poseSearchTool(deps: PoseToolDeps): ToolSpec {
  return {
    name: 'comfyui_pose_search',
    description:
      '在姿势参考库里找姿势（288 组、1439 个角度，来自 Danbooru 社区的人体参考图库）。'
      + '返回姿势 id、中文名、分类与角度数，**不含图片**。拿到 id 后用 comfyui_pose_fetch 取线稿，'
      + '再把它当工作流的输入图（ControlNet / 图生图）。',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词：中文姿势名、编号（P001）或分类（坐姿）。可用空格分隔多个词做 AND。' },
        system: {
          type: 'string',
          enum: ['full', 'sexy', 'bust', 'pair'],
          description: '体系：full 全身标准 / sexy 全身性感 / bust 上半身 / pair 双人。不传则全部。',
        },
        category: { type: 'string', description: '动作分类，如「坐姿」「站姿」「趴卧」「跪立」。不传则全部。' },
        onlySafe: { type: 'boolean', description: '只看常规姿势（默认 false，即全部）。' },
        limit: { type: 'integer', description: '最多返回几组，默认 10，上限 30。' },
      },
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
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
          poses: [],
          total: 0,
          note: unfiltered === 0
            ? '没有匹配的姿势。换个词试试，或者去掉 system / category。'
            : `有 ${unfiltered} 组符合关键词，但被 system / category / onlySafe 过滤掉了。去掉条件再查。`,
        }
      }

      return {
        ok: true,
        total: result.total,
        poses: result.items.map(brief),
      }
    },
  }
}

/**
 * `comfyui_pose_fetch`：把某个角度（或某个姿势的正脸）的线稿落盘，返回可当输入图的路径。
 *
 * 落盘而不是只回 URL：工作流的输入图要能上传到 ComfyUI，本机路径才是现有链路认的东西。
 *
 * @param deps - 索引 + 取图器。
 */
export function poseFetchTool(deps: PoseToolDeps): ToolSpec {
  return {
    name: 'comfyui_pose_fetch',
    description:
      '把姿势参考图（人体线稿）下载到本机 uploads 目录，返回文件路径，用作工作流的输入图。'
      + '传姿势 id 就给正面，传视角 id（如 full_single_P001_side）就给那个角度。',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '姿势 id（full_single_P001）或视角 id（full_single_P001_side）。' },
        size: {
          type: 'string',
          enum: ['thumb', 'full'],
          description: 'thumb 是 300×400 缩略图（快、够做姿势参考），full 是原尺寸 PNG。默认 full。',
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async args => {
      const id = asString(args.id).trim()
      if (id === '') return { ok: false, error: 'id 不能为空' }
      const found = deps.index.findView(id)
      if (found === undefined) {
        return { ok: false, error: `没有这个姿势视角：${id}。先用 comfyui_pose_search 找 id。` }
      }
      const size = asString(args.size, 'full') === 'thumb' ? 'thumb' : 'full'
      const relativePath = size === 'full' ? found.view.full : found.view.thumb
      try {
        const { file, mediaType } = await deps.images.materialize(relativePath, deps.uploadsDir())
        return {
          ok: true,
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
    },
  }
}
