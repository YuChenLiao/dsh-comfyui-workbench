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
import { acquire, componentStateOf, ensureHttp, mountRoutes, release } from '../runtime.js'

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
  const rt = acquire(ctx, config)
  if (!componentStateOf(rt)['panel.workflow']) {
    rt.info('[comfyui-workbench] 组件 panel.workflow 已按配置关闭。')
    return
  }

  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(), 'workflow: runtime')
  ensureHttp(rt)

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
  })

  const table = {
    exact: routes.exact,
    prefix: [{ base: '/workflows/', handle: routes.byId }],
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => mountRoutes('panel.workflow', table), 'workflow: routes')
  } else {
    mountRoutes('panel.workflow', table)
  }
  rt.info('[comfyui-workbench] 工作流管理已上线')
}
