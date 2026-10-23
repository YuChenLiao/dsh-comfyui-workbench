import { runTool } from './run.js'
import type { ToolDeps, ToolSpec } from './types.js'
import { workflowEditTool } from './workflow-edit.js'
import { workflowInspectTool } from './workflow-inspect.js'
import { workflowListTool } from './workflow-list.js'

/**
 * 组装全部工具。
 *
 * @param deps - 依赖（ComfyUI 客户端、目录、超时、覆盖表）。
 */
export function createTools(deps: ToolDeps): ToolSpec[] {
  return [
    workflowListTool(deps),
    workflowInspectTool(deps),
    runTool(deps),
    workflowEditTool(deps),
  ]
}
