/**
 * run 域：把「一份模板 + 一组变量」变成「一次执行 + 一批产物」。
 *
 * 依赖 comfy（传输）、workflow（模板与变量）、scan（读 PNG 尺寸）、host（路径）。
 */
export {
  checkRun,
  collectArtifacts,
  forgetRun,
  recallRun,
  rememberRun,
  resumeRun,
  runWorkflow,
  submitWorkflow,
} from './runner.js'
export type {
  Artifact,
  PendingContext,
  PendingRun,
  RunOptions,
  RunOutcome,
} from './runner.js'
