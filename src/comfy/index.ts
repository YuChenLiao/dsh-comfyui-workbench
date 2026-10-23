/**
 * comfy 域：与 ComfyUI 服务通信。
 *
 * 只依赖 host 与 workflow 的类型定义。不含"什么时候跑、产物叫什么"这类业务，
 * 那些在 run/ 里；这样换 HTTP 实现或加 /ws 都不影响上层。
 */
export { ComfyClient } from './client.js'
export type { ComfyClientOptions } from './client.js'
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
export type { FileRef, HistoryEntry, ObjectInfo, ObjectInfoNode } from './types.js'
