/**
 * tools 域：暴露给模型的四个工具。
 *
 * 四个是刻意压出来的数量：每个工具都有固定 schema 与指引成本，进每次请求。
 * 「看清单 → 点开某个节点」合成一个工具（nodeId 的有无就是档位），
 * 「改说明 + 调参」也合成一个入口。
 */
export { createTools, registerTools, TOOL_GROUPS } from './tools/registry.js'
export type { ToolGroupDef, ToolRegistrationReport } from './tools/registry.js'
export type { Override, ToolBlock, ToolDeps, ToolSpec, ToolText } from '../../shared/tools/types.js'
