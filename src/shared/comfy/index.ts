/**
 * comfy 域：与 ComfyUI 服务通信。
 *
 * 只依赖 host 与 workflow 的类型定义。不含"什么时候跑、产物叫什么"这类业务，
 * 那些在 run/ 里；这样换 HTTP 实现或加 /ws 都不影响上层。
 */
export { ComfyClient } from './client.js'
export type { ComfyClientOptions } from './client.js'
export { describeNodeErrors } from './errors.js'
export {
  asRunError,
  authFailed,
  comfyUnreachable,
  executionFailed,
  nodeMissing,
  noOutput,
  outputUnreadable,
  RunError,
  submitRejected,
  timedOut,
} from './errors.js'
export type { RunErrorCode } from './errors.js'
export { ComfySupervisor, detectInstallation, queueBusy, shouldReclaim } from './supervisor.js'
export { isQueueBusy, parseQueue } from './queue.js'
export type { QueueSnapshot } from './queue.js'
export { ensureComfyImage, materializeImages } from './upload.js'
export { availableModels, missingModels, suggestModels } from './models.js'
// 模板体检：工具（`comfyui_workflow { audit: true }`）与面板（`/workflows/audit`）共用。
// 放进 barrel，避免下一个人靠 deep import 去找它。
export { auditWorkflows } from './audit.js'
export type { AuditDeps } from './audit.js'
export type { UploadedImage } from './upload.js'
export type { ServiceState, ServiceStatus, SupervisorOptions } from './supervisor.js'
export type { FileRef, HistoryEntry, ObjectInfo, ObjectInfoNode } from './types.js'
