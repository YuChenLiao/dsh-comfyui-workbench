/**
 * run 域：把「一份模板 + 一组变量」变成「一次执行 + 一批产物」。
 *
 * 依赖 comfy（传输）、workflow（模板与变量）、scan（读 PNG 尺寸）、host（路径）。
 */
export {
  checkRun,
  collectArtifacts,
  fileRefsOf,
  pickArtifacts,
  forgetRun,
  recallRun,
  rememberRun,
  resumeRun,
  runWorkflow,
  submitWorkflow,
  waitForRun,
} from './runner.js'
export { stopAllWatchers, sweepRun, watchRun } from './notify.js'
export { BatchCollector } from './batch-notify.js'
export type { SettledRun } from './batch-notify.js'
export type { NotifyTarget } from './notify.js'
export type {
  Artifact,
  PendingContext,
  PendingRun,
  RunOptions,
  RunOutcome,
} from './runner.js'
export { applyOverrides, overrideNotes } from './overrides.js'
export type { OverrideOutcome } from './overrides.js'
export { codeOf, codeOrDefault, finalStateOf, giveUpMessage, isFatalRunError, isRetryable, SWEEP_MIN_BUDGET_MS, sweepBudgetOf, TRANSIENT_FINAL_STATE, TRANSIENT_LIMIT } from './policy.js'
