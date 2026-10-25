import { runTool } from './run.js'
import type { ToolDeps, ToolSpec } from './types.js'
import { workflowEditTool } from './workflow-edit.js'
import { workflowInspectTool } from './workflow-inspect.js'
import { workflowListTool } from './workflow-list.js'

/**
 * 工具分组。
 *
 * 每个工具单独构建、单独注册 —— 一个工具的构造或注册出错只影响它自己，
 * 用户也可以只启用其中几个（配置项 `tools`）。
 *
 * 分组依据是"依赖面"而不是"数量"：读类工具只碰文件与 object_info，
 * 执行类工具还要 ComfyUI 队列与产物落盘，权限与失败面完全不同。
 */
export interface ToolGroupDef {
  /** 组名，配置里开关用的标识。 */
  name: string
  /** 所属组件：工具按"面向谁 + 对象"归属，不按读写权限。 */
  component: 'tool.generate' | 'tool.workflow-edit'
  /** 一句话说明它在做什么，写日志与 /config 用。 */
  title: string
  /** 真正构建；可能抛错（例如 schema 构造异常）。 */
  build: (deps: ToolDeps) => ToolSpec
}

/** 全部工具分组，顺序即注册顺序。 */
export const TOOL_GROUPS: readonly ToolGroupDef[] = [
  {
    name: 'workflow-list',
    component: 'tool.generate',
    title: '列出工作流与缺失模型',
    build: deps => workflowListTool(deps),
  },
  {
    name: 'workflow-inspect',
    component: 'tool.generate',
    title: '查看工作流的输入输出面',
    build: deps => workflowInspectTool(deps),
  },
  {
    name: 'workflow-run',
    component: 'tool.generate',
    title: '执行工作流（异步提交 / 续查）',
    build: deps => runTool(deps),
  },
  {
    name: 'workflow-edit',
    component: 'tool.workflow-edit',
    title: '改工作流标题与说明',
    build: deps => workflowEditTool(deps),
  },
]

/** 注册结果：成功哪些、失败哪些、跳过哪些。 */
export interface ToolRegistrationReport {
  registered: string[]
  failed: Array<{ name: string; message: string }>
  skipped: string[]
}

/**
 * 逐组注册工具，任何一组出问题都不牵连其他组。
 *
 * @param groups - 分组定义。
 * @param deps - 依赖。
 * @param options - enabled 为空数组或 undefined 表示全开；register 是宿主注册函数。
 */
export function registerTools(
  groups: readonly ToolGroupDef[],
  deps: ToolDeps,
  options: {
    enabled?: readonly string[] | undefined
    register: (tool: ToolSpec) => void
    warn?: ((message: string) => void) | undefined
  },
): ToolRegistrationReport {
  const report: ToolRegistrationReport = { registered: [], failed: [], skipped: [] }
  for (const group of groups) {
    if (options.enabled !== undefined && options.enabled.length > 0 && !options.enabled.includes(group.name)) {
      report.skipped.push(group.name)
      continue
    }
    try {
      const tool = group.build(deps)
      options.register(tool)
      report.registered.push(`${group.name}（${tool.name}）`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      report.failed.push({ name: group.name, message })
      options.warn?.(`工具 ${group.name} 注册失败：${message}。其余工具不受影响。`)
    }
  }
  return report
}

/**
 * 组装全部工具（保持向后兼容；新代码请用 registerTools 逐组注册）。
 *
 * @param deps - 依赖（ComfyUI 客户端、目录、超时、覆盖表）。
 */
export function createTools(deps: ToolDeps): ToolSpec[] {
  return TOOL_GROUPS.map(group => group.build(deps))
}
