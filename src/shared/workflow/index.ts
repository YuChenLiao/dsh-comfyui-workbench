/**
 * workflow 域：模板 → IO 面 → 变量应用。
 *
 * 依赖方向只有 host（数据目录与路径工具）。不依赖 scan / assets / http：
 * "怎么读磁盘上的图" 与 "怎么跑一个工作流" 是两件事，混在一起就没法单独测试。
 */
export { detectFormat, formatHint } from './detect.js'
export { convertUiToApi } from './from-ui.js'
export type { UiConversion } from './from-ui.js'
export type { WorkflowFormat } from './detect.js'
export { inferSurface } from './infer.js'
export type { Inferred } from './infer.js'
export { buildSurface, hashWorkflow } from './surface.js'
export {
  importWorkflowFile,
  listEntries,
  listWorkflowIds,
  pathsOf,
  readEntry,
  removeWorkflow,
  sanitizeId,
  WorkflowFormatError,
  writeMeta,
  writeSchema,
  writeWorkflow,
} from './store.js'
export type { WorkflowEntry } from './store.js'
export { applyVariables, VariableError } from './variables.js'
export type { AppliedVariables, VariableErrorCode } from './variables.js'
export type {
  ApiNode,
  ApiWorkflow,
  IOSlot,
  ModelRef,
  OutputSlot,
  VarType,
  WorkflowIOSurface,
  WorkflowMeta,
  WorkflowSchema,
} from './types.js'
