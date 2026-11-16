// src/shared/host/config.ts
var DEFAULT_CACHE_MS = 4e3;
var DEFAULT_BASE_URL = "http://127.0.0.1:8188";
var DEFAULT_POSES_ORIGIN = "https://ai-pose-gallery.anhao.app";
var ENV_KEYS = [
  ["COMFYUI_URL", "baseUrl"],
  ["COMFYUI_BASE_URL", "baseUrl"],
  ["COMFYUI_TIMEOUT_MS", "timeoutMs"],
  ["COMFYUI_RUN_WAIT", "runWait"]
];
function fromEnv(env) {
  const out = {};
  for (const [envKey, configKey] of ENV_KEYS) {
    const value = env[envKey];
    if (typeof value === "string" && value.trim() !== "") out[configKey] = value;
  }
  return out;
}
function resolveSettings(input, env = process.env) {
  const envSettings = fromEnv(env);
  const raw = input !== null && typeof input === "object" ? input : {};
  const pick = (key) => raw[key] !== void 0 ? raw[key] : envSettings[key];
  const envProgress = ["1", "true", "yes", "on"].includes(String(env.COMFYUI_PROGRESS_WS ?? "").trim().toLowerCase());
  const int = (value, fallback, min, max) => {
    const n = typeof value === "number" ? Math.round(value) : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  const str = (value, fallback) => typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  const oneOf = (value, allowed, fallback) => typeof value === "string" && allowed.includes(value) ? value : fallback;
  const listOf = (value) => Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim() !== "") : [];
  const recordOf = (value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === "string") out[key] = item;
    }
    return out;
  };
  const outputDir = raw.outputDir;
  return {
    roots: listOf(raw.roots),
    maxDepth: int(raw.maxDepth, 3, 0, 8),
    maxItems: int(raw.maxItems, 4e3, 50, 2e4),
    cacheMs: int(raw.cacheMs, DEFAULT_CACHE_MS, 0, 6e4),
    includeHidden: raw.includeHidden === true,
    baseUrl: str(pick("baseUrl"), DEFAULT_BASE_URL).replace(/\/+$/, ""),
    headers: recordOf(raw.headers),
    outputDir: typeof outputDir === "string" && outputDir.trim() !== "" ? outputDir.trim() : null,
    workflowsDir: typeof raw.workflowsDir === "string" && raw.workflowsDir.trim() !== "" ? raw.workflowsDir.trim() : null,
    uploadsDir: typeof raw.uploadsDir === "string" && raw.uploadsDir.trim() !== "" ? raw.uploadsDir.trim() : null,
    indexFile: typeof raw.indexFile === "string" && raw.indexFile.trim() !== "" ? raw.indexFile.trim() : null,
    disabledComponents: Array.isArray(raw.disabledComponents) ? raw.disabledComponents.filter((item) => typeof item === "string" && item.trim() !== "").map((item) => item.trim()) : [],
    assetRoots: listOf(raw.assetRoots),
    strictVars: raw.strictVars !== false,
    runMode: oneOf(raw.runMode, ["conversation", "direct"], "conversation"),
    returnImages: oneOf(raw.returnImages, ["first", "all", "none"], "first"),
    autoDetect: raw.autoDetect !== false,
    autoStart: raw.autoStart !== false,
    startCommand: listOf(raw.startCommand),
    readyTimeoutMs: int(raw.readyTimeoutMs, 18e4, 5e3, 9e5),
    // 默认**不回收**：`/queue` 只能看到 prompt 队列，看不到模型下载/安装。用户拉一个大模型
    // 超过 5 分钟、期间没有工具调用，实例就会被判成"空闲"杀掉 —— 那正是"下到一半被打断、
    // 卡在下载状态"的经典事故。想省显存自己设成 300000；开着时回收前会先问 `/queue`。
    idleShutdownMs: int(raw.idleShutdownMs, 0, 0, 36e5),
    timeoutMs: int(pick("timeoutMs"), 12e4, 1e3, 36e5),
    // 默认异步：出图要几分钟，让工具调用一直挂着会让用户以为连接断了。
    // 想每次都同步拿产物（顺带登记资产索引）就设成 sync。
    runWait: oneOf(pick("runWait"), ["async", "sync"], "async"),
    runWaitMaxMs: int(raw.runWaitMaxMs, 18e5, 1e3, 18e5),
    pollIntervalMs: int(raw.pollIntervalMs, 1e3, 100, 1e4),
    indexMode: oneOf(raw.indexMode, ["auto", "off"], "auto"),
    betterSidebarTab: oneOf(raw.betterSidebarTab, ["auto", "on", "off"], "auto"),
    progressStream: raw.progressStream === true || envProgress === true,
    posesOrigin: (() => {
      const value = str(raw.posesOrigin, DEFAULT_POSES_ORIGIN).replace(/\/+$/, "");
      return /^https:\/\//.test(value) ? value : DEFAULT_POSES_ORIGIN;
    })()
  };
}

// src/entries/sync-wait.ts
var name = "dsh-comfyui-workbench:sync-wait";
var COMPONENT = "tool.sync-wait";
function apply(_ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${COMPONENT} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\uFF1A\u51FA\u56FE\u5DE5\u5177\u4E0D\u518D\u63A5\u53D7 wait\uFF0C\u4E00\u5F8B\u5F02\u6B65\u3002`);
    return;
  }
}
export {
  apply,
  name
};
