/**
 * 模板体检：**升级后哪套工作流已经跑不起来了**。
 *
 * 实现在 `shared/comfy/audit.ts` —— 面板的 `/workflows/audit` 与 `comfyui_workflow`
 * 的体检走同一份逻辑。这里只做转发：`auditWorkflows` 的导出名与调用方都不变。
 *
 * 为什么不直接放组件里：面板（`panel-workflow`）不能 import `tool-generate`，
 * 两份实现又必然漂（缺节点判定改一处忘一处，用户看到两份互相矛盾的结论）。
 */
export { auditWorkflows } from '../../../shared/comfy/audit.js'
export type { AuditDeps } from '../../../shared/comfy/audit.js'
