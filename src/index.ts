/**
 * 包根入口（name 必须是不带子路径的包名）。
 *
 * 为什么需要它：宿主只给**包根说明符**装配浏览器端
 * （`dsh-client-modules` 的 `exactPackageSpecifier` 明确排除包子路径）。
 * 七个组件是 `dsh-comfyui-workbench/<name>` 这样的子路径 entry，能注册服务端，
 * 但挂不上 client —— 少了这条包根 entry，侧栏图标与 better-sidebar 页签根本不会被加载。
 *
 * 所以这条 entry 只做两件事：让包根的 `exports["./client"]` 被装配、
 * 把共享运行时初始化好（七条组件 entry 直接复用）。
 */
import { apply as applyDanbooru } from './entries/danbooru.js'
import { apply as applyEdit } from './entries/edit.js'
import { apply as applyGallery } from './entries/gallery.js'
import { apply as applyGenerate } from './entries/generate.js'
import { apply as applyTerminal } from './entries/terminal.js'
import { apply as applyTags } from './entries/tags.js'
import { apply as applyPoses } from './entries/poses.js'
import { apply as applyCostumes } from './entries/costumes.js'
import { apply as applyWorkflow } from './entries/workflow.js'
import type { HostContext } from './shared/host/types.js'
import { mountWorkbenchSkill } from './shared/host/skill.js'
import { readToggles, writeToggles } from './shared/host/toggles.js'
import { acquire, componentStateOf, ensureHttp, mountRoutes, release } from './runtime.js'
import type { Runtime } from './runtime.js'
import { createConfigHandler } from './components/panel-workflow/server/config-api.js'
export { handleWorkflowList } from './components/panel-workflow/server/workflows-api.js'
export { createRunHandler } from './components/panel-workflow/server/run-api.js'
export { createWorkflowRoutes } from './components/panel-workflow/server/routes.js'

export const name = 'dsh-comfyui-workbench'

/**
 * 注入清单。
 *
 * - `webServer`：HTTP 前缀由这里兜底注册。若 core 拿不到，前缀会落到第一个拿到它的
 *   组件 entry 身上 —— 那样单独关掉那个组件，其余面板就跟着失效。
 * - `workspaceRegistry`：产物目录要落在用户当前的工作区。注入的作用是**时序**：
 *   服务未就绪时 fiber 处于 INACTIVE、`apply` 不执行，探测会等它 ACTIVE 之后再跑
 *   （`ctx.reflect.get` 本身不要求注入）。另一个坑是服务名 —— 它叫 `workspaceRegistry`，
 *   `workspace` 只是它在 storages 里的域名（`workspace.json` 的 `unit.name`），
 *   两者混淆过一次，导致探测静默失效。
 */
export const inject = ['webServer', 'workspaceRegistry']

/**
 * 挂上 `/config`。
 *
 * 必须由 core 提供：界面靠它决定"哪些页签该出现"。它曾只在工作流组件里注册，
 * 于是关掉工作流后 `/config` 404，前端 catch 退化成全开 —— 被关掉的页签照样显示。
 *
 * `apply` 与 `applyAll` 都要调它，否则测试路径（走 applyAll）拿不到 components 字段。
 */
function mountConfig(ctx: HostContext, rt: ReturnType<typeof acquire>): void {
  const table = {
    exact: {
      '/config': createConfigHandler({
        settings: rt.settings,
        outputDir: rt.outputDir,
        workflowsDir: rt.flowDir,
        outputSource: rt.outputSource,
        workspaceProbe: rt.outputProbe as unknown as Record<string, unknown>,
        // 缺了这两项，界面拿不到"哪些组件被关掉"，会退化成全开。
        getDiagnostics: () => ({
          components: componentStateOf(rt),
          tools: rt.tools,
        }),
        // 面板开关：写在插件数据目录的 settings.json，改完下一次提交就生效，
        // 不用碰 profile 里的 cordis.patch.yml（那要重启）。
        toggles: { read: readToggles, write: writeToggles },
      }),
    },
  }
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, 'core.config', table)
      return () => { unmount() }
    }, 'core: config')
  } else {
    mountRoutes(ctx, 'core.config', table)
  }
}

export function apply(ctx: HostContext, config: unknown): void {
  const rt = acquire(ctx, config)
  // 必须配对：只 acquire 不 release 会让 refs 永不到 0，旧 Runtime 带着失效的 ctx 存活，
  // 重载时注册 effect 会抛 INACTIVE_EFFECT（相册整块消失，要等第二次重载才自愈）。
  if (typeof ctx.effect === 'function') ctx.effect(() => () => release(ctx), 'core: runtime')

  // 前缀也由 core 兜一次：核心 entry 不会被单独关掉，重载后它能把 API 重新挂上。
  ensureHttp(ctx, rt)
  mountConfig(ctx, rt)
  mountWorkbenchSkill(ctx)
}

/**
 * 一次装载全部七个组件（测试与"只想挂一条 entry"的场景用）。
 *
 * 生产环境不用它：`cordis.patch.yml` 里是八条 entry（一条包根 + 七条组件），
 * 每条各自注册，宿主才能单独开关。
 */
export function applyAll(ctx: HostContext, config: unknown): Runtime {
  // 与 apply 一致：先建 runtime 并挂 /config，再逐个装组件。
  // **返回 runtime** 是为了让测试能验装配结果（例如"运行记录确实落在 outputDir 下"）——
  // 不返回的话，`new RunRegistry(outputDir)` 漏传目录这种事没有任何测试守得住。
  const rt = acquire(ctx, config)
  mountConfig(ctx, rt)
  mountWorkbenchSkill(ctx)
  applyGallery(ctx, config)
  applyWorkflow(ctx, config)
  applyTags(ctx, config)
  applyPoses(ctx, config)
  applyCostumes(ctx, config)
  applyGenerate(ctx, config)
  applyEdit(ctx, config)
  applyDanbooru(ctx, config)
  applyTerminal(ctx, config)
  return rt
}

// 测试与诊断用：这些能力要能被单独验证。
export { stripAnsi, TerminalBuffer } from './shared/comfy/output-buffer.js'
export { TagIndex, searchTagsLinear } from './components/tool-danbooru/server/tag-index.js'
export { applyOverrides, overrideNotes } from './shared/run/overrides.js'
export { fileRefsOf, pickArtifacts } from './shared/run/runner.js'
export { parseWait, WAIT_MAX_MS, WAIT_MIN_MS } from './shared/tools/types.js'
export { isFillerTail, searchWithPrefixFallback } from './shared/search/fallback.js'
export { readPref, writePref } from './shared/host/prefs.js'
export { mountWorkbenchSkill, WORKBENCH_SKILL_DESCRIPTION, WORKBENCH_SKILL_NAME } from './shared/host/skill.js'
export { dedupeItems, looseKey } from './components/panel-gallery/server/assets/dedupe.js'
export { adviceFor, classifyFailure, modelNameIn } from './shared/comfy/failure-kind.js'
export { describeNodeErrors, executionFailed } from './shared/comfy/errors.js'
export type { FailureKind } from './shared/comfy/failure-kind.js'
export { NodeIndex } from './shared/comfy/node-index.js'
export { watchProgress } from './shared/comfy/progress.js'
export type { ProgressTick } from './shared/comfy/progress.js'
export { nodeSearchTool, resetNodeIndexCache } from './components/tool-generate/tools/node-search.js'
export { planOrder, runBatchTool } from './components/tool-generate/tools/run-batch.js'
export { composeTool } from './components/tool-generate/tools/compose.js'
export { planSlots, ROLE_CN } from './components/tool-generate/tools/compose-slots.js'
export { buildPrompt } from './components/tool-generate/tools/compose-prompt.js'
export { runsTool } from './components/tool-generate/tools/runs.js'
export { rerunTool } from './components/tool-generate/tools/rerun.js'
export { loadWorkflowForBatch } from './components/tool-generate/tools/run.js'
export { listWorkflows } from './components/tool-generate/tools/workflow-list.js'
export { inspectWorkflow } from './components/tool-generate/tools/workflow-inspect.js'
export { auditWorkflows } from './components/tool-generate/tools/workflow-audit.js'
export { workflowTool } from './components/tool-generate/tools/workflow.js'
export { ComfyClient } from './shared/comfy/client.js'
export { RunRegistry } from './shared/run/registry.js'
export { sweepRun, watchRun } from './shared/run/notify.js'
export { BatchCollector } from './shared/run/batch-notify.js'
export type { SettledRun } from './shared/run/batch-notify.js'
export { codeOf, codeOrDefault, finalStateOf, giveUpMessage, isFatalRunError, isRetryable, SWEEP_MIN_BUDGET_MS, sweepBudgetOf, TRANSIENT_FINAL_STATE, TRANSIENT_LIMIT } from './shared/run/policy.js'
export { waitForRun } from './shared/run/runner.js'
export type { RunRecord, RunState } from './shared/run/registry.js'
export { COSTUME_ANIME_PATH, COSTUME_PATH } from './entries/costumes.js'
export { batchLookup, MAX_BATCH_QUERIES } from './components/tool-danbooru/tools/lookup-batch.js'
export { isNsfw, nsfwVerdictOf } from './shared/gallery/nsfw.js'
export { ComfySupervisor } from './shared/comfy/supervisor.js'
export { LogTail, readTail } from './shared/comfy/log-tail.js'
export { createTerminalRoutes } from './components/panel-terminal/server/routes.js'
export { runTool } from './components/tool-generate/tools/run.js'
export { createGalleryRoutes } from './components/panel-gallery/server/routes.js'
export { probeWorkspace, resolveOutputDir, sessionWorkspaceDir, workspaceDirOf } from './shared/host/workspace.js'
export { effectiveProgressStream, readToggles, resetToggleCache, togglesPath, writeToggles } from './shared/host/toggles.js'
export type { TogglePatch, Toggles } from './shared/host/toggles.js'
export { isAuthorized } from './shared/authz/authorize.js'
export { foldPathCase } from './shared/host/paths.js'
export {
  bundledDir,
  createTagCache,
  danbooruLookupTool,
  danbooruSyncTool,
  ownStorePath,
  pickNames,
  pruneSharedAliases,
  readStore,
  runSync,
  currentMirrors,
  fetchJson,
  MIRRORS,
  searchOnline,
  searchOnlineDetailed,
  searchTags,
  storePath,
  syncKind,
  useMirrors,
  useTimeout,
  worthKeeping,
  writeStore,
  DEFAULT_SYNC,
  DANBOORU_COMPONENT,
  importUpstream,
  KIND_OF_CATEGORY,
  parseCsvLine,
  rowToRecord,
  TAG_KINDS,
  UPSTREAM_BASE,
  UPSTREAM_FILES,
  GROUP_INDEX_TITLE,
  groupsPath,
  normalizeTag,
  parseGroupIndex,
  parseGroupPage,
  readGroups,
  syncGroups,
  categoryMapPath,
  categoryOf,
  readCategoryMap,
} from './components/tool-danbooru/index.js'
export type { TagKind, UpstreamResult, UpstreamRow } from './components/tool-danbooru/index.js'
export { registerTools, TOOL_GROUPS } from './components/tool-generate/index.js'
export { toModelItem } from './components/tool-generate/tools/workflow-list.js'
export { toPanelItem } from './components/panel-workflow/server/workflows-api.js'
export { createTagsIndex } from './components/panel-tags/server/api.js'
export type { TagHit, TagsIndex, TagSearchResult, TagStats } from './components/panel-tags/server/api.js'
export { createTagsRoutes } from './components/panel-tags/server/routes.js'
export { createSyncJob } from './components/panel-tags/server/sync-job.js'
export { createPosesIndex, bundledCatalogPath } from './components/panel-poses/server/catalog.js'
export type { PoseHit, PoseCatalog, PosesIndex, PoseStats } from './components/panel-poses/server/catalog.js'
export { createImageCache, createPoseImages } from './components/panel-poses/server/images.js'
export type { PoseImage, PoseImages, PoseImageStats } from './components/panel-poses/server/images.js'
export { createPosesRoutes } from './components/panel-poses/server/routes.js'
export { createCostumesIndex, bundledCostumePath } from './components/panel-costumes/server/catalog.js'
export type { CostumeItem, CostumeCatalog, CostumesIndex, CostumeStats } from './components/panel-costumes/server/catalog.js'
export { createCostumeRoutes } from './components/panel-costumes/server/routes.js'
export { costumeTool } from './components/panel-costumes/server/tools.js'
export { poseTool } from './components/panel-poses/server/tools.js'
export type { SyncJob, SyncJobState } from './components/panel-tags/server/sync-job.js'
export { acquire, release, componentStateOf, mergedRoutes } from './runtime.js'
