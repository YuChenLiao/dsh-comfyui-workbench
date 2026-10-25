/**
 * 组件：用户面板 · 工作流管理。
 *
 * 列出工作流、切换是否对模型可用、写用途备注。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { createWorkflowRoutes } from '../components/panel-workflow/server/routes.js'
import type { HostContext } from '../shared/host/types.js'
import { resolveSettings } from '../shared/host/config.js'
import { acquire, componentStateOf, ensureHttp, mountRoutes, release } from '../runtime.js'

/** 组件被配置关闭时的统一提示。 */
function warnDisabled(id: string): void {
  console.warn(`[comfyui-workbench] 组件 ${id} 已按配置关闭。`)
}

export const name = 'dsh-comfyui-workbench:workflow'

export const inject = ['webServer']

/** 把失败原因落盘：宿主会吞掉 apply 的异常，不写下来就无从排查。 */
function recordFailure(error: unknown): void {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ''}` : String(error)
  try {
    const dir = path.join(process.env.USERPROFILE ?? os.homedir(), '.dsh-comfyui-workbench')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'last-error.log'), `[${new Date().toISOString()}] workflow entry
${message}
`, 'utf8')
  } catch {
    // 连日志都写不了就只能放弃
  }
}

export function apply(ctx: HostContext, config: unknown): void {
  try {
    applyInner(ctx, config)
  } catch (error) {
    recordFailure(error)
    throw error
  }
}

function applyInner(ctx: HostContext, config: unknown): void {
  // 先看配置：被关掉的组件不该白建一份运行时（acquire 会构造客户端与监督器）。
  if (new Set(resolveSettings(config, process.env).disabledComponents).has('panel.workflow')) {
    warnDisabled('panel.workflow')
    return
  }

  const rt = acquire(ctx, config)

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'workflow: runtime')
  ensureHttp(ctx, rt)

  const routes = createWorkflowRoutes({
    client: rt.client,
    supervisor: rt.supervisor,
    workflowDir: rt.flowDir,
    settings: rt.settings,
    assertWritable: rt.assertWritable,
    defaultOutputDir: rt.outputDir,
    outputSource: rt.outputSource,
    getDiagnostics: () => ({ components: componentStateOf(rt), tools: rt.tools }),
    getExporter: () => rt.exportWorkflows,
    workspaceProbe: rt.outputProbe as unknown as Record<string, unknown>,
  })

  const table = {
    exact: routes.exact,
    prefix: [{ base: '/workflows/', handle: routes.byId }],
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => mountRoutes(ctx, 'panel.workflow', table), 'workflow: routes')
  } else {
    mountRoutes(ctx, 'panel.workflow', table)
  }
  rt.info('[comfyui-workbench] 工作流管理已上线')
}
