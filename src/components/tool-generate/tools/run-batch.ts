/**
 * `comfyui_run_batch`：一次提交多个任务。
 *
 * 为什么值得单独做一个工具：ComfyUI 自己有队列，连着 POST 几次比"调一次工具、
 * 等模型返回、再调一次"快得多 —— 后者每一轮都要把工具的 schema 与结果重新塞进
 * 上下文。批量提交在**一次工具调用里**把所有 promptId 拿回来。
 *
 * 两条设计约束：
 * - **默认全部异步**：批量场景更不该阻塞。提交完立刻返回，出图各自推回对话。
 * - **部分失败不整体失败**：一条参数名写错不该让另外九条也发不出去。逐条报结果。
 */
import { submitWorkflow, waitForRun } from '../../../shared/run/runner.js'
import { applyOverrides, overrideNotes } from '../../../shared/run/overrides.js'
import { asInt, asString } from '../../../shared/tools/types.js'
import type { ToolDeps } from '../../../shared/tools/types.js'
import type { ToolSpec } from '../../../shared/tools/types.js'
import type { NotifyTarget } from '../../../shared/run/notify.js'
import { watchRun } from '../../../shared/run/notify.js'

/** 一次最多提交几个。 */
const MAX_RUNS = 20

/** 批量同步等待的总预算上限。超过就标 pending 交给后台通知。 */
const BATCH_WAIT_BUDGET_MS = 30 * 60_000

/** 一条提交请求。 */
interface RunItem {
  /** 工作流 id 或路径；不填则用外层 workflow。 */
  workflow?: { id?: string; path?: string }
  vars?: Record<string, unknown>
  outputPath?: string
}

/** 逐条结果。 */
interface RunResultItem {
  index: number
  ok: boolean
  promptId?: string
  workflowId?: string
  error?: string
  code?: string
  /** wait=true 且到时仍未出图。已挂后台通知，不会丢。 */
  pending?: boolean
  /** wait=true 且已出图时的产物路径。 */
  artifacts?: string[]
  /** 覆盖提示与预检提示。 */
  notes?: string[]
  /** pending 且没有会话通道时的提示。 */
  hint?: string
}

/** 从外层和内层合成工作流标识。 */
function mergeWorkflow(outer: unknown, inner: unknown): unknown {
  if (inner !== undefined && inner !== null) return inner
  return outer
}

/**
 * 造工具。
 *
 * @param deps - 与单次提交相同的一套依赖。
 */
export function runBatchTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_run_batch',
    description:
      '一次提交多个 ComfyUI 任务（同一工作流跑多组参数，或不同工作流各跑一次）。'
      + '返回每条的 promptId 或错误；**部分失败不影响其它条目**。'
      + '默认异步：提交完立刻返回，出图后各自推回对话。'
      + `一次最多 ${MAX_RUNS} 条。`
      + '注意：一次性参数覆盖（comfyui_workflow_edit persist=false）用完即清，'
      + '所以通常只有**第一条**会带上它（若第一条提交失败，会顺延给下一条）；'
      + '想让每条都变，请直接写进 vars 或落盘模板。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['runs'],
      properties: {
        workflow: {
          type: 'object',
          description: '共用工作流：{"id":"sdxl"} 或 {"path":"D:/某处/workflow.json"}。各条可各自覆盖。',
          properties: { id: { type: 'string' }, path: { type: 'string' } },
        },
        runs: {
          type: 'array',
          description: `提交清单，每条含 vars（可选 workflow / outputPath），最多 ${MAX_RUNS} 条。`,
          items: {
            type: 'object',
            properties: {
              workflow: {
                type: 'object',
                description: '这一条单独指定的工作流，覆盖外层。',
                properties: { id: { type: 'string' }, path: { type: 'string' } },
              },
              vars: { type: 'object', description: '变量绑定，键必须是该工作流声明过的输入名。', additionalProperties: true },
              outputPath: { type: 'string', description: '这一条的产物目录，不填用会话目录。' },
            },
          },
        },
        wait: {
          type: 'boolean',
          description: '是否同步等全部出图。默认 false（全部异步）。批量同步等待很容易撞超时，一般不要开。',
        },
        timeoutMs: { type: 'integer', description: 'wait=true 时单条等待上限（毫秒）。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const raw = Array.isArray(args.runs) ? args.runs : []
      if (raw.length === 0) return { ok: false, error: 'runs 不能为空。' }
      if (raw.length > MAX_RUNS) {
        return { ok: false, error: `一次最多提交 ${MAX_RUNS} 条，收到 ${raw.length} 条。请分批。` }
      }

      const sessionDir = deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1_000, 3_600_000)
      const agent = exec?.agent as NotifyTarget | undefined
      const canNotify = agent !== undefined && typeof agent.followup === 'function'

      const items: RunResultItem[] = []
      const submittedIds: string[] = []
      // 串行等待要有个总预算：不设的话 20 条 × timeoutMs 最坏能挂几个小时。
      // 预算按"条数 × 单条上限"取，但封顶 30 分钟（对齐 watchRun 的 maxWaitMs）。
      const startedAt = Date.now()
      const totalBudgetMs = Math.min(timeoutMs * raw.length, BATCH_WAIT_BUDGET_MS)

      // 串行提交：ComfyUI 的队列本身是串行执行的，并发 POST 只是把请求压进队列，
      // 但会让"哪一条对应哪个 promptId"更难对账（尤其有失败时）。
      for (const [index, entry] of raw.entries()) {
        const item = (entry ?? {}) as RunItem
        try {
          const outputDir = asString(item.outputPath).trim() !== '' ? asString(item.outputPath).trim() : sessionDir
          try {
            deps.assertWritable(outputDir, exec?.agent)
          } catch (error) {
            // 与单次工具报同一个 code，别让调用方按 code 分支时对不上
            const denied = new Error(error instanceof Error ? error.message : String(error)) as Error & { code?: string }
            denied.code = 'forbidden_output'
            throw denied
          }

          const workflowArg = mergeWorkflow(args.workflow, item.workflow)
          const loaded = await loadForBatch(deps, workflowArg)

          // 一次性参数覆盖（来自 comfyui_workflow_edit persist=false）必须被应用并清掉 ——
          // 否则批量跑的是旧参数，而覆盖还留在 map 里等下一次。
          //
          // 与单次工具走同一个 applyOverrides，别在这里再复刻一份 —— 两份逻辑迟早漂移。
          const pending = deps.overrides.get(loaded.workflowId)
          const applied = applyOverrides(
            loaded.workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>,
            loaded.surface,
            (item.vars ?? {}) as Record<string, unknown>,
            pending,
          )
          const batchVars = applied.vars
          const batchNotes = overrideNotes(applied)

          const submitted = await submitWorkflow({
            client: deps.client,
            workflow: loaded.workflow,
            slots: loaded.surface.inputs,
            vars: batchVars,
            outputDir,
            timeoutMs,
            pollIntervalMs: deps.pollIntervalMs,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash,
          })

          // 提交成功才消耗覆盖：参数写错 / 缺节点这类失败不该把用户刚改的值吃掉。
          if (pending !== undefined && pending.length > 0) deps.overrides.delete(loaded.workflowId)

          submittedIds.push(submitted.promptId)

          if (args.wait !== true) {
            items.push({
              index,
              ok: true,
              promptId: submitted.promptId,
              workflowId: loaded.workflowId,
              ...(submitted.notes.length === 0 && batchNotes.length === 0
                ? {}
                : { notes: [...submitted.notes, ...batchNotes] }),
            })
            if (canNotify) watchOne(deps, agent, submitted.promptId, outputDir)
          } else {
            // 同步等待。每条各自等到产物或超时；超时的条目改用后台通知兜底 ——
            // 不能"等不到就什么都不管"，那和默认异步比反而是退步。
            const remaining = Math.max(1_000, totalBudgetMs - (Date.now() - startedAt))
            const outcome = await waitForRun(deps.client, submitted.promptId, {
              timeoutMs: Math.min(timeoutMs, remaining),
              pollIntervalMs: deps.pollIntervalMs,
              fallback: {
                outputDir,
                workflowId: loaded.workflowId,
                workflowHash: loaded.surface.workflowHash,
                effective: submitted.effective,
              },
            })

            if ('pending' in outcome) {
              items.push({
                index,
                ok: true,
                promptId: submitted.promptId,
                workflowId: loaded.workflowId,
                pending: true,
                ...(submitted.notes.length === 0 && batchNotes.length === 0
                  ? {}
                  : { notes: [...submitted.notes, ...batchNotes] }),
                ...(canNotify ? {} : { hint: '这条还没出图，且没有会话通道推送结果 —— 稍后用 comfyui_run 传 promptId 查。' }),
              })
              if (canNotify) watchOne(deps, agent, submitted.promptId, outputDir)
            } else {
              // 与单次运行一样登记资产索引：索引是派生，失败不该让本次算失败
              const createdAt = new Date().toISOString()
              for (const artifact of outcome.artifacts) {
                try {
                  deps.index.add({
                    digest: artifact.digest,
                    path: artifact.path,
                    bytes: artifact.bytes,
                    mime: artifact.mime,
                    ...(artifact.width === undefined ? {} : { width: artifact.width }),
                    ...(artifact.height === undefined ? {} : { height: artifact.height }),
                    workflowId: loaded.workflowId,
                    workflowHash: loaded.surface.workflowHash,
                    promptId: outcome.promptId,
                    createdAt,
                    tags: [],
                    status: 'present',
                  })
                } catch {
                  deps.logger?.warn?.('资产索引登记失败（产物已落盘）')
                }
              }
              items.push({
                index,
                ok: true,
                promptId: submitted.promptId,
                workflowId: loaded.workflowId,
                artifacts: outcome.artifacts.map(artifact => artifact.path),
                ...(submitted.notes.length === 0 && batchNotes.length === 0
                  ? {}
                  : { notes: [...submitted.notes, ...batchNotes] }),
              })
            }
          }
        } catch (error) {
          // 单条失败不中断：把错误记在这一条上，继续下一条
          const code = typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : 'run_failed'
          items.push({
            index,
            ok: false,
            code,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }

      const okCount = items.filter(item => item.ok).length
      return {
        ok: okCount > 0,
        submitted: okCount,
        failed: items.length - okCount,
        promptIds: submittedIds,
        results: items,
        ...(canNotify ? {} : { hint: '没有可用的会话通道，出图结果不会主动推回对话 —— 用 comfyui_run 带 promptId 回来查。' }),
      }
    },
  }
}

/** 挂一条后台等待者，出图后推回对话。 */
function watchOne(deps: ToolDeps, agent: NotifyTarget, promptId: string, outputDir: string): void {
  watchRun({
    client: deps.client,
    target: agent,
    promptId,
    outputDir,
    ...(deps.logger === undefined ? {} : { logger: deps.logger }),
  })
}

/** 从 run.ts 借工作流加载逻辑（同一套校验规则，不另写一份）。 */
async function loadForBatch(deps: ToolDeps, workflowArg: unknown) {
  const { loadWorkflowForBatch } = await import('./run.js')
  return loadWorkflowForBatch(deps, { workflow: workflowArg })
}
