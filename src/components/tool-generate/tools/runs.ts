/**
 * `comfyui_runs`：查正在跑与最近跑过的任务。
 *
 * 补的是"提交之后那几分钟"的空白。出图中位 115 秒、最长 336 秒，这段时间里
 * 模型不知道能不能继续、要不要等、是不是已经失败了。
 *
 * 与面板的分工：面板给人看（秒级刷新），这个工具给模型按需查（结构化）。
 * 进度本身**不进对话** —— 一条 30 步的图有 30 条进度、一批 10 张有 300 条，
 * 每写一次都要排一轮回合，比"每张一条"糟一个数量级。
 */
import { asInt, asString } from '../../../shared/tools/types.js'
import type { ToolDeps } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { RunState } from '../../../shared/run/registry.js'

/** 允许筛的状态。 */
const STATES: readonly RunState[] = ['queued', 'running', 'done', 'failed', 'unknown']

/** 把一条记录压成工具输出里的形状。 */
function view(record: ReturnType<ToolDeps['runs']['list']>[number]): Record<string, unknown> {
  const now = Date.now()
  const elapsedMs = (record.finishedAt ?? now) - record.submittedAt
  return {
    promptId: record.promptId,
    workflowId: record.workflowId,
    state: record.state,
    ...(record.batchId === undefined ? {} : { batchId: record.batchId }),
    elapsedMs,
    ...(record.queuePosition === undefined ? {} : { queuePosition: record.queuePosition }),
    ...(record.progress === undefined ? {} : { progress: record.progress }),
    ...(record.artifacts === undefined ? {} : { artifacts: record.artifacts.map(a => a.path) }),
    ...(record.error === undefined ? {} : { error: record.error }),
    ...(record.stale === true ? { stale: true, note: '插件重启前就在跑，状态已不可知' } : {}),
  }
}

/**
 * 造工具。
 *
 * @param deps - 只需运行注册表。
 */
export function runsTool(deps: Pick<ToolDeps, 'runs'>): ToolSpec {
  return {
    name: 'comfyui_runs',
    description:
      '查 ComfyUI 任务的运行状态：正在跑、排队中、最近完成或失败的。'
      + '提交之后出图要几分钟，用这个工具确认"那批出完了没"，而不是靠对话里插进来的通知。'
      + '读的是插件自己的运行记录，**不会拉起 ComfyUI**、也不会等它就绪 —— '
      + '所以服务没起来时它照样能答（那正是查"为什么没出图"的场景）。'
      + '不传 state 时按时间倒序给最近的。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: {
        state: {
          type: 'string',
          enum: ['queued', 'running', 'done', 'failed', 'unknown'],
          description: '只看某个状态。running 是正在算的，queued 是排队中的（带 queuePosition）。',
        },
        batchId: { type: 'string', description: '只看某一批（comfyui_run_batch 提交时给的批次 id）。' },
        limit: { type: 'integer', description: '最多几条，默认 10，上限 50。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args) {
      const stateArg = asString(args.state).trim()
      if (stateArg !== '' && !STATES.includes(stateArg as RunState)) {
        return { ok: false, error: `state 只能是 ${STATES.join(' / ')}。` }
      }
      const batchId = asString(args.batchId).trim()
      const limit = asInt(args.limit, 10, 1, 50)

      const records = deps.runs.list({
        ...(stateArg === '' ? {} : { state: stateArg as RunState }),
        ...(batchId === '' ? {} : { batchId }),
        limit,
      })

      return {
        ok: true,
        active: deps.runs.activeCount(),
        count: records.length,
        runs: records.map(view),
        ...(records.length === 0
          ? { hint: '没有符合条件的记录。提交任务后稍等再查，或去掉 state 筛选。' }
          : {}),
      }
    },
  }
}
