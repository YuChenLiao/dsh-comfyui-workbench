/**
 * `comfyui_rerun`：从产物重跑，或做变体。
 *
 * 出图之后最常见的下一步是"再来一张"或"这张构图好但细节差，调一点重跑"。
 * 而 sidecar 里已经躺着复现所需的全部材料：
 *
 * ```json
 * {
 *   "workflowId": "moss-image_图生图",
 *   "workflowHash": "b7eea758…",
 *   "vars": { "seed": 123, "prompt": "…", "width": 1312, "height": 1840 },
 * }
 * ```
 *
 * 原来只能手工抄这些参数回去调 `comfyui_run`。这个工具把它变成一步。
 */
import fs from 'node:fs'
import path from 'node:path'

import { submitWorkflow, waitForRun } from '../../../shared/run/runner.js'
import { asInt, asRecord, asString } from '../../../shared/tools/types.js'
import type { ToolDeps, ToolSpec } from '../../../shared/tools/types.js'
import type { NotifyTarget } from '../../../shared/run/index.js'
import { sweepRun, watchRun } from '../../../shared/run/index.js'
import { loadWorkflowForBatch } from './run.js'

/** 一次最多出几张。 */
const MAX_COUNT = 20

/** sidecar 里跟复现有关的字段。 */
interface Sidecar {
  workflowId?: string
  workflowHash?: string
  vars?: Record<string, unknown>
  seed?: number
  width?: number
  height?: number
  prompt?: string
  negativePrompt?: string
}

/** 找 sidecar：给产物路径就找 `<path>.json`，给 json 就直接用。 */
function locateSidecar(input: string): { sidecarPath: string; imagePath?: string } {
  const resolved = path.resolve(input)
  if (resolved.toLowerCase().endsWith('.json')) {
    return { sidecarPath: resolved }
  }
  // 产物路径 → 同名 .json
  const guess = `${resolved}.json`
  if (fs.existsSync(guess)) return { sidecarPath: guess, imagePath: resolved }
  // 也接受"给的是产物目录里的图，但 sidecar 用了别的扩展名"
  const dir = path.dirname(resolved)
  const base = path.basename(resolved)
  if (fs.existsSync(dir)) {
    const candidates = fs.readdirSync(dir)
      .filter(name => name.startsWith(base) && name.toLowerCase().endsWith('.json'))
    // 排序取第一个：readdirSync 的顺序依文件系统而定，不排序会随机挑到别的 sidecar
    if (candidates.length > 0) return { sidecarPath: path.join(dir, candidates.sort()[0] as string), imagePath: resolved }
  }
  return { sidecarPath: guess, imagePath: resolved }
}

/** 读并校验 sidecar。 */
function readSidecar(sidecarPath: string): Sidecar {
  if (!fs.existsSync(sidecarPath)) {
    throw new Error(`找不到 sidecar：${sidecarPath}。这个工具要从产物旁的 <文件>.json 读取运行参数，请给产物路径或 sidecar 路径本身。`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'))
  } catch (error) {
    throw new Error(`sidecar 不是合法 JSON：${error instanceof Error ? error.message : String(error)}`)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('sidecar 内容不是一个对象。')
  }
  return parsed as Sidecar
}

/**
 * 造工具。
 *
 * @param deps - 与 `comfyui_run` 同一套依赖。
 */
export function rerunTool(deps: ToolDeps): ToolSpec {
  return {
    name: 'comfyui_rerun',
    description:
      '用某个产物当时的参数再跑一次（或做几张变体）。参数从产物旁的 sidecar 读取，'
      + '不必手工抄 seed / prompt。'
      + '服务没在跑时会自动拉起，不用先手动启动，也不要 kill / 重启 ComfyUI 进程。'
      + '只覆盖你想改的：给 vars 或 seed 即可，其余沿用原值。'
      + `count > 1 时按 seed 生成变体（上限 ${MAX_COUNT}）。`,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['from'],
      properties: {
        from: { type: 'string', description: '产物路径（自动找 <路径>.json）或直接给 sidecar 路径。' },
        vars: { type: 'object', description: '只覆盖想改的参数；键必须是该工作流声明过的输入名。', additionalProperties: true },
        seed: {
          type: ['integer', 'string'],
          description: "换 seed。给数字则用它（count>1 时依次 +1）；给 'random' 则每张独立随机；不给则沿用原值递增。",
        },
        count: { type: 'integer', description: `出几张，默认 1，上限 ${MAX_COUNT}。` },
        outputPath: { type: 'string', description: '产物目录；不传用会话目录。' },
        wait: { type: 'boolean', description: '是否同步等出图。默认 false（异步 + 完成后通知）。wait 为真时会带回产物路径并登记资产索引。' },
        waitMs: { type: 'integer', description: 'wait=true 时的等待上限（毫秒）。' },
        tags: { type: 'array', items: { type: 'string' }, description: '给产物打的标签，进资产索引。' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const from = asString(args.from).trim()
      if (from === '') return { ok: false, code: 'bad_input', error: 'from 不能为空：给产物路径或 sidecar 路径。' }

      const { sidecarPath } = locateSidecar(from)
      let sidecar: Sidecar
      try {
        sidecar = readSidecar(sidecarPath)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // 区分"文件不存在"与"存在但内容坏了" —— 前者让用户换路径，后者让他查文件
        const code = message.includes('不是合法 JSON') || message.includes('不是一个对象')
          ? 'sidecar_invalid'
          : 'sidecar_missing'
        return { ok: false, code, error: message }
      }

      const workflowId = asString(sidecar.workflowId).trim()
      if (workflowId === '') {
        return { ok: false, code: 'sidecar_invalid', error: `sidecar 里没有 workflowId：${sidecarPath}` }
      }

      // 工作流可能已经被删或改名 —— 给出相近的候选，别让人去翻列表
      let loaded
      try {
        // loadWorkflowForBatch 内部取 args.workflow，所以要把 id 包一层
        loaded = await loadWorkflowForBatch(deps, { workflow: { id: workflowId } })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          ok: false,
          code: 'workflow_missing',
          error: message,
          // 只承诺真能做到的：`from` 只是定位 sidecar，仍按 sidecar 里的 workflowId 找模板，
          // 模板改了名它照样找不到 —— 别在这儿许诺一条走不通的路。
          hint: '用 comfyui_workflow 看现有工作流（模板可能改过名，或不在这个目录）。不要去改 sidecar —— 它是这张图的复现凭据，改了会失去追溯。',
        }
      }

      // 工作流被改过：vars 可能仍兼容（改了内部参数不影响表面），所以提示但不阻止
      const stale = typeof sidecar.workflowHash === 'string'
        && sidecar.workflowHash !== ''
        && sidecar.workflowHash !== loaded.surface.workflowHash

      const baseVars: Record<string, unknown> = { ...(sidecar.vars ?? {}) }
      const overrides = asRecord(args.vars)
      const merged: Record<string, unknown> = { ...baseVars, ...overrides }

      // seed 槽位名要**从 IO 面里找**，不能写死 `seed`：本仓库自己的 infer 就把
      // `noise_seed` 当一等命名（KSampler 的某些变体、impact pack 都这么叫）。
      // 硬写 `vars.seed` 的话，`applyVariables` 会因"工作流没有这个参数"直接抛
      // variable_unknown —— 整条 rerun 死，而不是降级。
      const seedSlot = loaded.surface.inputs.find(slot => /^(noise_)?seed$/i.test(slot.name))?.name
      const seedArg = args.seed
      const originalSeed = seedSlot !== undefined && typeof merged[seedSlot] === 'number'
        ? (merged[seedSlot] as number)
        : seedSlot === undefined && typeof merged.seed === 'number'
          ? (merged.seed as number)
          : typeof sidecar.seed === 'number' ? sidecar.seed : undefined
      // 允许 seed 以字符串传（模型常把数字包成字符串）
      const seedNumber = typeof seedArg === 'number' && Number.isFinite(seedArg)
        ? seedArg
        : typeof seedArg === 'string' && seedArg.trim() !== '' && Number.isFinite(Number(seedArg))
          ? Number(seedArg)
          : undefined

      let seedPlan: Array<number | undefined>
      if (seedArg === 'random' || String(seedArg).trim().toLowerCase() === 'random') {
        seedPlan = []
      } else if (seedNumber !== undefined) {
        seedPlan = [seedNumber]
      } else {
        seedPlan = originalSeed === undefined ? [undefined] : [originalSeed]
      }

      const count = asInt(args.count, 1, 1, MAX_COUNT)
      const outputDir = asString(args.outputPath).trim() !== ''
        ? asString(args.outputPath).trim()
        : (deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir)

      try {
        deps.assertWritable(outputDir, exec?.agent)
      } catch (error) {
        return { ok: false, code: 'forbidden_output', message: error instanceof Error ? error.message : String(error) }
      }

      const agent = exec?.agent as NotifyTarget | undefined
      const canNotify = agent !== undefined && typeof agent.followup === 'function'
      const tags = Array.isArray(args.tags) ? args.tags.filter((tag): tag is string => typeof tag === 'string') : []

      const wait = args.wait === true
      const waitMs = asInt(args.waitMs, deps.timeoutMs, 1_000, 1_800_000)
      // 总预算：20 条各自吃满 waitMs 最坏是 20×。与 run_batch 一样给个上限。
      const waitStartedAt = Date.now()
      const waitBudgetMs = Math.min(waitMs * count, 30 * 60_000)
      const submitted: Array<{ promptId: string; seed?: number; artifacts?: string[]; pending?: boolean }> = []
      const failures: Array<{ index: number; error: string; code?: string }> = []

      for (let index = 0; index < count; index += 1) {
        // 记这一条当前的 promptId：catch 里要靠它写终态。
        // 不能从 error 上取 —— RunError 只有 code/message，promptId 只被拼进 message 字符串。
        let activePromptId: string | undefined
        const vars: Record<string, unknown> = { ...merged }
        // seed：random 每张独立；给了具体值就依次 +1；否则沿用原值递增。
        // 原值也没有时（sidecar 没记 seed），出多张必须各自随机 —— 否则三张一模一样，
        // "做变体"就没意义了。
        const wantsRandom = seedArg === 'random' || String(seedArg).trim().toLowerCase() === 'random'
        // seedSlot 为 undefined 表示这个工作流根本没有 seed 槽位 —— 那就别注入，
        // 否则 applyVariables 会因为多出不认识的键而整条失败。
        if (seedSlot !== undefined) {
          vars[seedSlot] = wantsRandom || seedPlan[0] === undefined
            ? Math.floor(Math.random() * 0x7fffffff)
            : (seedPlan[0] as number) + index
        }

        try {
          const result = await submitWorkflow({
            client: deps.client,
            workflow: loaded.workflow,
            slots: loaded.surface.inputs,
            vars,
            outputDir,
            timeoutMs: deps.timeoutMs,
            pollIntervalMs: deps.pollIntervalMs,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash,
          })
          activePromptId = result.promptId
          deps.runs.submit(result.promptId, loaded.workflowId)

          if (wait) {
            // 同步等：与管理工具的 done 收敛一致，并在拿到产物时登记索引（tags 才有去处）
            const remaining = Math.max(1_000, waitBudgetMs - (Date.now() - waitStartedAt))
            const outcome = await waitForRun(deps.client, result.promptId, {
              timeoutMs: Math.min(waitMs, remaining),
              pollIntervalMs: deps.pollIntervalMs,
              fallback: {
                outputDir,
                workflowId: loaded.workflowId,
                workflowHash: loaded.surface.workflowHash,
                effective: result.effective,
              },
            })
            if ('pending' in outcome) {
              deps.runs.update(result.promptId, { state: 'unknown', queuePosition: undefined })
              submitted.push({
                promptId: result.promptId,
                pending: true,
                ...(seedSlot !== undefined && typeof vars[seedSlot] === 'number' ? { seed: vars[seedSlot] as number } : {}),
              })
              // 超时不等于不管：continue 掉的话用户既收不到通知，产物也永远不进索引。
              // 有会话就挂 watcher，没有就自己收敛。
              if (canNotify) {
                watchRun({
                  client: deps.client,
                  target: agent,
                  promptId: result.promptId,
                  outputDir,
                  intervalMs: deps.pollIntervalMs,
                  registry: deps.runs,
                  ...(deps.logger === undefined ? {} : { logger: deps.logger }),
                })
              } else {
                sweepRun({
                  client: deps.client,
                  promptId: result.promptId,
                  workflowId: loaded.workflowId,
                  outputDir,
                  intervalMs: deps.pollIntervalMs,
                  registry: deps.runs,
                  ...(deps.logger === undefined ? {} : { logger: deps.logger }),
                })
              }
            } else {
              deps.runs.update(result.promptId, {
                state: 'done',
                finishedAt: Date.now(),
                queuePosition: undefined,
                artifacts: outcome.artifacts.map(artifact => ({
                  path: artifact.path,
                  bytes: artifact.bytes,
                  ...(artifact.width === undefined ? {} : { width: artifact.width }),
                  ...(artifact.height === undefined ? {} : { height: artifact.height }),
                })),
              })
              // tags 只有在这一步才有落点：异步路径没有产物可登记
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
                    tags,
                    status: 'present',
                  })
                } catch {
                  deps.logger?.warn?.('资产索引登记失败（产物已落盘）')
                }
              }
              submitted.push({
                promptId: result.promptId,
                artifacts: outcome.artifacts.map(artifact => artifact.path),
                ...(seedSlot !== undefined && typeof vars[seedSlot] === 'number' ? { seed: vars[seedSlot] as number } : {}),
              })
            }
            continue
          }

          submitted.push({
            promptId: result.promptId,
            ...(seedSlot !== undefined && typeof vars[seedSlot] === 'number' ? { seed: vars[seedSlot] as number } : {}),
          })
          if (canNotify) {
            watchRun({
              client: deps.client,
              target: agent,
              promptId: result.promptId,
              outputDir,
              intervalMs: deps.pollIntervalMs,
              registry: deps.runs,
              ...(deps.logger === undefined ? {} : { logger: deps.logger }),
            })
          } else {
            sweepRun({
              client: deps.client,
              promptId: result.promptId,
              workflowId: loaded.workflowId,
              outputDir,
              intervalMs: deps.pollIntervalMs,
              registry: deps.runs,
              ...(deps.logger === undefined ? {} : { logger: deps.logger }),
            })
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          const code = typeof (error as { code?: unknown }).code === 'string'
            ? (error as { code: string }).code
            : 'rerun_failed'
          failures.push({ index, error: message, code })
          // 提交阶段就失败的话没有 promptId；wait 阶段失败的要记终态，
          // 否则那条记录停在 submitted 时的状态（queued）永远不动。
          if (activePromptId !== undefined) {
            deps.runs.update(activePromptId, {
              state: 'failed',
              finishedAt: Date.now(),
              queuePosition: undefined,
              error: { code, message },
            })
          }
        }
      }

      if (submitted.length === 0) {
        // 全部失败时保留原始错误码（execution_failed 之类），不要一律盖成 rerun_failed
        const primary = failures.find(item => item.code !== undefined)?.code
        return {
          ok: false,
          code: primary ?? 'rerun_failed',
          error: failures.map(item => item.error).join('；'),
          failures,
        }
      }

      // 显式传了 seed 但这个工作流根本没有 seed 槽位：得说清，否则模型以为改了参数
      const seedIgnored = seedArg !== undefined && seedSlot === undefined

      return {
        ok: true,
        workflowId: loaded.workflowId,
        ...(seedIgnored ? { note: '没有识别到 seed / noise_seed 槽位，seed 参数已忽略（若该工作流的种子槽位用了别的名字，请用 vars 直接传）。' } : {}),
        count: submitted.length,
        promptIds: submitted.map(item => item.promptId),
        // 工作流没有 seed 槽位时 item.seed 是 undefined：数组里的 undefined 会让宿主的
        // 无损 JSON 校验整次拒掉（与 #2 同一条路径）。没有就干脆不放这个元素。
        seeds: submitted.flatMap(item => (item.seed === undefined ? [] : [item.seed])),
        ...(wait ? { results: submitted } : {}),
        ...(stale ? {
          staleWorkflow: true,
          hint: '这份 sidecar 记录的工作流版本与当前不同（workflowHash 不一致）。参数名仍兼容的话可以继续；不确定就先用 comfyui_workflow 对一下槽位。',
        } : {}),
        ...(failures.length > 0 ? { failures } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      }
    },
  }
}
