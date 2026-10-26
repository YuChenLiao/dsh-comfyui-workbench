var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/shared/http/respond.ts
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

// src/components/panel-terminal/server/routes.ts
var MAX_PAGE = 2e3;
function createTerminalRoutes(deps) {
  return {
    "/terminal": (url, res, req) => {
      const method = req.method ?? "GET";
      if (method !== "GET" && method !== "HEAD" && method !== "POST") {
        sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u4E2A\u63A5\u53E3\u53EA\u63A5\u53D7 GET / POST\u3002" });
        return;
      }
      if (method === "POST") {
        if (url.searchParams.get("action") === "start") {
          deps.start();
          sendJson(res, 200, { ok: true, started: true, status: deps.status() });
          return;
        }
        deps.buffer.clear();
        sendJson(res, 200, { ok: true });
        return;
      }
      const raw = url.searchParams.get("since");
      const parsed = raw === null ? 0 : Number(raw);
      const since = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
      const slice = deps.buffer.since(since);
      const truncated = slice.lines.length > MAX_PAGE;
      sendJson(res, 200, {
        ok: true,
        lines: truncated ? slice.lines.slice(-MAX_PAGE) : slice.lines,
        cursor: slice.cursor,
        dropped: slice.dropped,
        truncated,
        // 缓冲实例代号：变了说明插件热重载过，前端的 cursor 与屏上内容都不再可信。
        epoch: slice.epoch,
        status: deps.status()
      });
    }
  };
}

// src/shared/host/config.ts
var DEFAULT_CACHE_MS = 4e3;
var DEFAULT_BASE_URL = "http://127.0.0.1:8188";
var ENV_KEYS = [
  ["COMFYUI_URL", "baseUrl"],
  ["COMFYUI_BASE_URL", "baseUrl"],
  ["COMFYUI_TIMEOUT_MS", "timeoutMs"]
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
    idleShutdownMs: int(raw.idleShutdownMs, 3e5, 0, 36e5),
    timeoutMs: int(pick("timeoutMs"), 12e4, 1e3, 36e5),
    pollIntervalMs: int(raw.pollIntervalMs, 1e3, 100, 1e4),
    indexMode: oneOf(raw.indexMode, ["auto", "off"], "auto"),
    betterSidebarTab: oneOf(raw.betterSidebarTab, ["auto", "on", "off"], "auto")
  };
}

// src/runtime.ts
import path16 from "node:path";

// src/shared/comfy/client.ts
import crypto from "node:crypto";

// src/shared/comfy/errors.ts
var RunError = class extends Error {
  code;
  hint;
  detail;
  constructor(code, message, hint, detail) {
    super(message);
    this.name = "RunError";
    this.code = code;
    this.hint = hint;
    this.detail = detail;
  }
  /** 给模型看的完整文案：结论 + 下一步。 */
  render() {
    return this.hint === void 0 ? this.message : `${this.message}
\u4E0B\u4E00\u6B65\uFF1A${this.hint}`;
  }
};
function comfyUnreachable(baseUrl, cause) {
  const detail = cause instanceof Error ? `\uFF08${cause.message}\uFF09` : "";
  return new RunError(
    "comfy_unreachable",
    `\u8FDE\u4E0D\u4E0A ComfyUI\uFF1A${baseUrl}${detail}`,
    "\u786E\u8BA4 ComfyUI \u5728\u8DD1\uFF1B\u5730\u5740\u5728\u8BBE\u7F6E\u91CC\uFF08baseUrl\uFF09\uFF0C\u4E5F\u53EF\u4EE5\u5148\u7528 GET /system_stats \u624B\u5DE5\u9A8C\u8BC1\u3002"
  );
}
function authFailed(baseUrl, status) {
  return new RunError(
    "auth_failed",
    `ComfyUI \u62D2\u7EDD\u4E86\u8BF7\u6C42\uFF1AHTTP ${status}\uFF08${baseUrl}\uFF09`,
    "\u670D\u52A1\u524D\u9762\u53EF\u80FD\u6709\u53CD\u5411\u4EE3\u7406\u6216\u9274\u6743\u3002\u628A\u9700\u8981\u7684\u8BF7\u6C42\u5934\u586B\u5230\u914D\u7F6E\u7684 headers \u91CC\u3002"
  );
}
function submitRejected(body) {
  const detail = body !== null && typeof body === "object" ? body.node_errors : void 0;
  const first = formatNodeErrors(detail);
  return new RunError(
    "submit_rejected",
    `ComfyUI \u62D2\u7EDD\u4E86\u8FD9\u6B21\u63D0\u4EA4${first === "" ? "" : `\uFF1A${first}`}`,
    "\u68C0\u67E5\u88AB\u70B9\u540D\u7684\u8282\u70B9\u53C2\u6570\uFF08\u7C7B\u578B\u3001\u53D6\u503C\u8303\u56F4\uFF09\uFF0C\u6216\u5148\u7528 inspect \u770B\u8BE5\u8282\u70B9\u7684\u8F93\u5165\u3002",
    body
  );
}
function formatNodeErrors(nodeErrors) {
  if (nodeErrors === null || typeof nodeErrors !== "object") return "";
  const parts = [];
  for (const [nodeId, value] of Object.entries(nodeErrors)) {
    const errors = value !== null && typeof value === "object" ? value.errors : void 0;
    if (!Array.isArray(errors) || errors.length === 0) continue;
    const first = errors[0];
    const message = typeof first.message === "string" ? first.message : "";
    const details = typeof first.details === "string" ? ` ${first.details}` : "";
    parts.push(`\u8282\u70B9 ${nodeId}${message === "" ? "" : `\uFF1A${message}${details}`}`);
  }
  return parts.join("\uFF1B");
}

// src/shared/comfy/client.ts
var DEFAULT_REQUEST_TIMEOUT = 12e4;
var ComfyClient = class {
  baseUrl;
  headers;
  requestTimeoutMs;
  ensure;
  /** `/object_info` 缓存：响应可能好几 MB，同一进程不必反复拉。 */
  infoCache = null;
  /** 提交时带的 client_id（ComfyUI 用它区分来源）。 */
  clientId = crypto.randomUUID();
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = options.headers ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
    this.ensure = options.ensure;
  }
  /** 发一个请求；网络层失败统一归成 comfy_unreachable。 */
  async request(path17, init = {}, timeoutMs = this.requestTimeoutMs, skipEnsure = false) {
    if (this.ensure !== void 0 && !skipEnsure) {
      const ready = await this.ensure();
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
    }
    const url = `${this.baseUrl}${path17}`;
    try {
      return await fetch(url, {
        ...init,
        headers: { ...this.headers, ...init.headers ?? {} },
        signal: AbortSignal.timeout(timeoutMs)
      });
    } catch (error) {
      throw comfyUnreachable(this.baseUrl, error);
    }
  }
  /** 存活探测：轻量、不缓存。 */
  async systemStats() {
    const res = await this.request("/system_stats", { method: "GET" }, 1e4);
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status);
    if (!res.ok) throw comfyUnreachable(this.baseUrl, new Error(`/system_stats \u8FD4\u56DE ${res.status}`));
    return await res.json();
  }
  /**
   * 节点清单。
   *
   * @param refresh - 强制重新拉（用户显式刷新时用）。
   */
  async objectInfo(refresh = false, options) {
    if (!refresh && this.infoCache !== null) return this.infoCache;
    const res = await this.request("/object_info", { method: "GET" }, options?.timeoutMs, options?.skipEnsure === true);
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status);
    if (!res.ok) throw comfyUnreachable(this.baseUrl, new Error(`/object_info \u8FD4\u56DE ${res.status}`));
    const parsed = await res.json();
    const info = parsed !== null && typeof parsed === "object" ? parsed : {};
    this.infoCache = info;
    return info;
  }
  /** 提交一份工作流，返回 prompt_id。 */
  async queuePrompt(workflow) {
    const res = await this.request("/prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: this.clientId })
    });
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status);
    if (res.status === 400) {
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      throw submitRejected(body);
    }
    if (!res.ok) {
      throw new RunError("submit_rejected", `\u63D0\u4EA4\u5931\u8D25\uFF1AHTTP ${res.status}`, "\u68C0\u67E5 ComfyUI \u65E5\u5FD7\u91CC\u7684\u62D2\u7EDD\u539F\u56E0\u3002");
    }
    const parsed = await res.json();
    const promptId = parsed !== null && typeof parsed === "object" ? parsed.prompt_id : void 0;
    if (typeof promptId !== "string" || promptId === "") {
      throw new RunError("submit_rejected", "ComfyUI \u6CA1\u6709\u8FD4\u56DE prompt_id\u3002", "\u786E\u8BA4 ComfyUI \u7248\u672C\u652F\u6301 POST /prompt\u3002");
    }
    return promptId;
  }
  /** 查一次 history：没完成时返回 undefined。 */
  async history(promptId) {
    const res = await this.request(`/history/${encodeURIComponent(promptId)}`, { method: "GET" }, 3e4);
    if (!res.ok) return void 0;
    const parsed = await res.json();
    if (parsed === null || typeof parsed !== "object") return void 0;
    const entry = parsed[promptId];
    if (entry === null || typeof entry !== "object") return void 0;
    return entry;
  }
  /** 取产物字节。 */
  async view(ref) {
    const params = new URLSearchParams({
      filename: ref.filename,
      subfolder: ref.subfolder ?? "",
      type: ref.type ?? "output"
    });
    const res = await this.request(`/view?${params.toString()}`, { method: "GET" }, 12e4);
    if (!res.ok) throw new RunError("output_unreadable", `\u53D6\u4EA7\u7269\u5931\u8D25\uFF1AHTTP ${res.status}\uFF08${ref.filename}\uFF09`);
    const array = await res.arrayBuffer();
    if (array.byteLength === 0) throw new RunError("output_unreadable", `\u4EA7\u7269\u662F\u7A7A\u7684\uFF1A${ref.filename}`);
    return Buffer.from(array);
  }
  /**
   * 上传图片到 ComfyUI 的 input 目录。
   *
   * 不手动设 Content-Type：multipart 的 boundary 必须由 fetch 自己生成。
   *
   * @param form - 已装好 `image` 字段的表单。
   */
  async uploadImage(form) {
    const res = await this.request("/upload/image", { method: "POST", body: form }, 12e4);
    if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status);
    if (!res.ok) {
      throw new RunError("output_unreadable", `\u56FE\u7247\u4E0A\u4F20\u5230 ComfyUI \u5931\u8D25\uFF1AHTTP ${res.status}`, "\u786E\u8BA4 ComfyUI \u7248\u672C\u652F\u6301 POST /upload/image\u3002");
    }
    const parsed = await res.json();
    const bag = parsed !== null && typeof parsed === "object" ? parsed : null;
    const name2 = typeof bag?.name === "string" ? bag.name : "";
    if (name2 === "") throw new RunError("output_unreadable", "ComfyUI \u6CA1\u6709\u8FD4\u56DE\u6587\u4EF6\u540D\u3002", "\u68C0\u67E5 /upload/image \u7684\u8FD4\u56DE\u683C\u5F0F\u3002");
    return { name: name2, subfolder: typeof bag?.subfolder === "string" ? bag.subfolder : "" };
  }
  /**
   * 让 ComfyUI 释放显存与模型缓存。
   *
   * 对应界面上的"释放内存"：出完图后主动腾出显存，避免占着不放。
   */
  async free() {
    const res = await this.request("/free", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true })
    }, 2e4);
    if (!res.ok) {
      throw new RunError("comfy_unreachable", `\u91CA\u653E\u5185\u5B58\u5931\u8D25\uFF1AHTTP ${res.status}`, "\u786E\u8BA4 ComfyUI \u5728\u7EBF\u4E14\u7248\u672C\u652F\u6301 POST /free\u3002");
    }
  }
  /** 取消执行（超时收尾必发，否则队列被一条已放弃的任务堵住）。 */
  async interrupt() {
    try {
      await this.request("/interrupt", { method: "POST" }, 1e4);
    } catch {
    }
  }
};

// src/shared/comfy/supervisor.ts
import { spawn } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";

// src/shared/host/paths.ts
import fs from "node:fs";
import path from "node:path";
function homeDir() {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}
function pluginDataDir() {
  return path.join(homeDir(), ".dsh-comfyui-workbench");
}
function workflowsDir() {
  return path.join(pluginDataDir(), "workflows");
}
function canonical(target) {
  const abs = path.resolve(target);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function foldPathCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

// src/shared/comfy/supervisor.ts
async function probe(baseUrl, timeoutMs = 3e3) {
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
function portOf(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return url.port !== "" ? url.port : "8188";
  } catch {
    return "8188";
  }
}
function looksLikeComfy(dir) {
  try {
    if (!fs2.statSync(path2.join(dir, "main.py")).isFile()) return false;
    return fs2.statSync(path2.join(dir, "models")).isDirectory();
  } catch {
    return false;
  }
}
function detectInstallation(extraRoots = []) {
  const candidates = [];
  for (const key of ["COMFYUI_HOME", "COMFYUI_PATH", "COMFYUI_DIR"]) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim() !== "") candidates.push(value.trim());
  }
  for (const root of extraRoots) candidates.push(root);
  const home = homeDir();
  if (home !== "") {
    candidates.push(path2.join(home, "ComfyUI"));
    candidates.push(path2.join(home, "comfyui"));
    candidates.push(path2.join(home, ".dsh-comfyui-workbench", "ComfyUI"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData !== "") {
    candidates.push(path2.join(localAppData, "ComfyUI"));
    candidates.push(path2.join(localAppData, "Programs", "ComfyUI"));
  }
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    candidates.push(path2.join(`${drive}${path2.sep}`, "ComfyUI"));
    candidates.push(path2.join(`${drive}${path2.sep}`, "comfyui"));
    candidates.push(path2.join(`${drive}${path2.sep}`, "ComfyUI_windows_portable", "ComfyUI"));
    candidates.push(...desktopCandidates(`${drive}${path2.sep}`));
  }
  const seen = /* @__PURE__ */ new Set();
  for (const candidate of candidates) {
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (looksLikeComfy(candidate)) return candidate;
  }
  return void 0;
}
function desktopCandidates(root) {
  const installs = path2.join(root, "Comfy-Desktop", "ComfyUI-Installs");
  let names;
  try {
    names = fs2.readdirSync(installs);
  } catch {
    return [];
  }
  return names.map((name2) => path2.join(installs, name2, "ComfyUI"));
}
function interpreterOf(dir) {
  const parent = path2.dirname(dir);
  const candidates = [
    path2.join(dir, "venv", "Scripts", "python.exe"),
    path2.join(dir, "venv", "bin", "python"),
    path2.join(dir, "python_embeded", "python.exe"),
    path2.join(dir, ".venv", "Scripts", "python.exe"),
    // Desktop 版：解释器在 ComfyUI 的上一级（ComfyUI-Installs/<实例>/standalone-env）
    path2.join(parent, "standalone-env", "python.exe"),
    path2.join(parent, "standalone-env", "bin", "python")
  ];
  for (const candidate of candidates) {
    try {
      if (fs2.statSync(candidate).isFile()) return candidate;
    } catch {
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
var ComfySupervisor = class {
  options;
  state = "unknown";
  child = null;
  installDir;
  detail = "";
  lastUsedAt = 0;
  starting = null;
  idleTimer = null;
  constructor(options) {
    this.options = options;
  }
  /** 当前状态快照。 */
  /**
   * 探测到的安装目录（日志文件在它下面的 `user/` 里）。
   *
   * **不能只靠 `start()` 里那次赋值**：外部实例（Desktop 自己起的）根本不会走到
   * `start()`，那时 `installDir` 永远是 undefined，日志就永远读不到 —— 而"想知道
   * 启动进度"恰恰多半发生在外部实例上。所以这里补一次惰性探测。
   */
  installDirOf() {
    if (this.installDir === void 0 && !this.detectTried) {
      this.detectTried = true;
      if (this.options.autoDetect) {
        try {
          this.installDir = (this.options.detect ?? detectInstallation)();
        } catch {
        }
      }
    }
    return this.installDir;
  }
  /** 是否已经尝试过安装探测（负缓存：没装也不能每 2 秒重扫一次盘）。 */
  detectTried = false;
  status() {
    return {
      state: this.state,
      baseUrl: this.options.baseUrl,
      managed: this.child !== null,
      ...this.child?.pid === void 0 ? {} : { pid: this.child.pid },
      ...this.installDir === void 0 ? {} : { installDir: this.installDir },
      ...this.detail === "" ? {} : { detail: this.detail }
    };
  }
  /**
   * 确保服务可用：外部在跑就直接用；没跑就拉起；拉不起来返回 false。
   *
   * @returns 是否可用。
   */
  async ensureReady() {
    this.lastUsedAt = Date.now();
    if (await probe(this.options.baseUrl)) {
      if (this.state !== "starting" && this.state !== "ready") {
        this.state = this.child === null ? "external" : "ready";
      }
      return true;
    }
    if (this.starting !== null) return await this.starting;
    if (!this.options.autoDetect && this.options.startCommand === void 0) {
      this.state = "failed";
      this.detail = `\u8FDE\u4E0D\u4E0A ${this.options.baseUrl}\uFF0C\u4E14\u672A\u5F00\u542F\u81EA\u52A8\u63A2\u6D4B\u3002`;
      return false;
    }
    this.starting = this.start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }
  /** 拉起进程并等待就绪。 */
  async start() {
    if (!this.options.autoStart && this.options.startCommand === void 0) {
      this.state = "failed";
      this.detail = `\u8FDE\u4E0D\u4E0A ${this.options.baseUrl}\uFF0C\u4E14 autoStart \u5DF2\u5173\u95ED\u3002`;
      return false;
    }
    this.state = "starting";
    const install = this.options.startCommand === void 0 ? detectInstallation() : void 0;
    if (this.options.startCommand === void 0 && install === void 0) {
      this.state = "failed";
      this.detail = "\u6CA1\u6709\u63A2\u6D4B\u5230 ComfyUI \u5B89\u88C5\uFF08\u9700\u8981\u542B main.py \u4E0E models \u76EE\u5F55\uFF09\u3002";
      return false;
    }
    if (install !== void 0) this.installDir = install;
    const argv = this.options.startCommand ?? [interpreterOf(install), "main.py", "--port", portOf(this.options.baseUrl)];
    const cwd = install ?? void 0;
    try {
      const child = spawn(argv[0], argv.slice(1), {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        detached: false,
        windowsHide: true,
        env: {
          ...process.env,
          // 不指定的话 Windows 上 Python 按控制台代码页输出（GBK），
          // 面板里就是满屏乱码。统一成 UTF-8，解码侧才稳定。
          PYTHONIOENCODING: "utf-8",
          PYTHONUNBUFFERED: "1"
        }
      });
      this.pipeOutput(child);
      child.on("exit", () => {
        if (this.child === child) {
          this.child = null;
          if (this.state === "ready") this.state = "unknown";
        }
      });
      this.child = child;
      this.detail = `\u5DF2\u62C9\u8D77\uFF1A${argv.join(" ")}`;
      this.options.logger?.info?.(`[comfy] \u62C9\u8D77\u670D\u52A1\uFF1A${argv.join(" ")}\uFF08cwd=${cwd ?? "\u9ED8\u8BA4"}\uFF09`);
    } catch (error) {
      this.state = "failed";
      this.detail = `\u62C9\u8D77\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`;
      return false;
    }
    const deadline = Date.now() + this.options.readyTimeoutMs;
    while (Date.now() < deadline) {
      if (await probe(this.options.baseUrl, 2e3)) {
        this.state = "ready";
        this.armIdleTimer();
        return true;
      }
      if (this.child === null) {
        this.state = "failed";
        this.detail = "\u8FDB\u7A0B\u5DF2\u9000\u51FA\uFF08\u53EF\u80FD\u7F3A\u5C11\u4F9D\u8D56\u6216\u7AEF\u53E3\u88AB\u5360\u7528\uFF09\u3002";
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, 1e3));
    }
    this.state = "failed";
    this.detail = `\u7B49\u5F85 ${Math.round(this.options.readyTimeoutMs / 1e3)} \u79D2\u4ECD\u672A\u5C31\u7EEA\u3002`;
    return false;
  }
  /**
   * 把子进程的 stdout/stderr 接到 options.onOutput。
   *
   * 用 TextDecoder 而不是 `setEncoding('utf8')`：进程退出时可能把多字节字符截断在
   * 半个字符上，`decode(..., { stream: true })` 能跨块拼接，最后再 flush 一次。
   */
  pipeOutput(child) {
    const sink = this.options.onOutput;
    const attach = (stream, readable) => {
      if (readable === null) return;
      const decoder = new TextDecoder("utf-8", { fatal: false });
      readable.on("data", (chunk) => {
        const text = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
        if (text !== "") sink?.(stream, text);
      });
      readable.on("end", () => {
        const rest = decoder.decode();
        if (rest !== "") sink?.(stream, rest);
      });
      readable.on("error", () => {
      });
    };
    attach("out", child.stdout);
    attach("err", child.stderr);
  }
  /** 启动空闲回收定时器（只针对自己拉起的进程）。 */
  armIdleTimer() {
    if (this.options.idleShutdownMs <= 0 || this.idleTimer !== null) return;
    this.idleTimer = setInterval(() => {
      if (this.child === null) {
        this.clearIdleTimer();
        return;
      }
      if (Date.now() - this.lastUsedAt < this.options.idleShutdownMs) return;
      this.stop();
    }, Math.min(6e4, Math.max(5e3, Math.floor(this.options.idleShutdownMs / 4))));
    this.idleTimer.unref?.();
  }
  clearIdleTimer() {
    if (this.idleTimer !== null) {
      clearInterval(this.idleTimer);
      this.idleTimer = null;
    }
  }
  /** 停掉自己拉起的进程。外部实例永不触碰。 */
  stop() {
    this.clearIdleTimer();
    const child = this.child;
    if (child === null) {
      this.detail = "\u6CA1\u6709\u672C\u63D2\u4EF6\u62C9\u8D77\u7684\u8FDB\u7A0B\uFF0C\u672A\u505C\u6B62\u4EFB\u4F55\u4E1C\u897F\u3002";
      return false;
    }
    try {
      child.kill();
    } catch {
    }
    this.child = null;
    this.state = "unknown";
    this.detail = "\u5DF2\u505C\u6B62\u672C\u63D2\u4EF6\u62C9\u8D77\u7684\u8FDB\u7A0B\u3002";
    return true;
  }
  /** 释放定时器（插件卸载时调用）。 */
  dispose() {
    this.clearIdleTimer();
  }
};

// src/shared/comfy/upload.ts
import fs3 from "node:fs";
import path3 from "node:path";

// src/shared/comfy/output-buffer.ts
var DEFAULT_CAPACITY = 2e3;
var ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[()][A-Z0-9]/g;
function stripAnsi(text) {
  return text.replace(ANSI, "");
}
function splitLines(raw) {
  const out = [];
  for (const piece of raw.split("\n")) {
    const clean = stripAnsi(piece);
    const body = clean.endsWith("\r") ? clean.slice(0, -1) : clean;
    const at = body.lastIndexOf("\r");
    out.push(at >= 0 ? body.slice(at + 1) : body);
  }
  return out;
}
var TerminalBuffer = class {
  capacity;
  buf = [];
  /** 写入位置（覆盖式）。 */
  head = 0;
  nextSeq = 1;
  droppedCount = 0;
  /** 本实例的唯一代号（热重载会换一个）。 */
  epoch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  constructor(capacity = DEFAULT_CAPACITY) {
    this.capacity = Math.max(1, Math.floor(capacity));
  }
  /** 追加一段原始输出（自动切行、剥 ANSI、处理回车重写）。 */
  push(stream, raw) {
    const parts = splitLines(raw);
    for (let i = 0; i < parts.length; i += 1) {
      const text = parts[i];
      if (i === parts.length - 1 && text === "") continue;
      const line = { seq: this.nextSeq, stream, text, at: Date.now() };
      this.nextSeq += 1;
      if (this.buf.length < this.capacity) {
        this.buf.push(line);
      } else {
        this.buf[this.head] = line;
        this.head = (this.head + 1) % this.capacity;
        this.droppedCount += 1;
      }
    }
  }
  /** 按 cursor 取增量。cursor 为 0 表示要当前全部（受容量限制）。 */
  since(cursor) {
    const ordered = this.ordered();
    const lines = cursor <= 0 ? ordered : ordered.filter((line) => line.seq > cursor);
    const last = ordered.length === 0 ? this.nextSeq - 1 : ordered[ordered.length - 1].seq;
    return {
      lines,
      cursor: last,
      dropped: this.droppedCount,
      epoch: this.epoch
    };
  }
  /** 当前行数。 */
  size() {
    return this.buf.length;
  }
  /** 清空（cursor 不回退：前端拿着旧 cursor 来也不会看到重复内容）。 */
  clear() {
    this.droppedCount = 0;
    this.buf = [];
    this.head = 0;
  }
  /** 按写入顺序取出（环形数组被覆盖后 head 是最旧位置）。 */
  ordered() {
    if (this.buf.length < this.capacity) return [...this.buf];
    return [...this.buf.slice(this.head), ...this.buf.slice(0, this.head)];
  }
};

// src/shared/comfy/log-tail.ts
import fs4 from "node:fs";
import path4 from "node:path";
var TAIL_LINES = 200;
function readTail(file, lines = TAIL_LINES) {
  let fd;
  try {
    fd = fs4.openSync(file, "r");
    const size = fs4.fstatSync(fd).size;
    if (size === 0) return "";
    const chunk = 64 * 1024;
    let pos = size;
    let found = 0;
    const pieces = [];
    while (pos > 0 && found <= lines) {
      const readSize = Math.min(chunk, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs4.readSync(fd, buf, 0, readSize, pos);
      pieces.unshift(buf);
      const probe2 = Buffer.concat(pieces).toString("utf8");
      found = (probe2.match(/\n/g) ?? []).length;
    }
    const out = Buffer.concat(pieces).toString("utf8");
    const all = out.split("\n");
    if (all.length > 0 && all[all.length - 1] === "") all.pop();
    return all.slice(-lines).join("\n");
  } catch {
    return "";
  } finally {
    if (fd !== void 0) {
      try {
        fs4.closeSync(fd);
      } catch {
      }
    }
  }
}
var LogTail = class {
  constructor(file) {
    this.file = file;
  }
  offset = 0;
  lastSize = -1;
  started = false;
  /** 当前跟踪的路径（诊断用）。 */
  get path() {
    return this.file;
  }
  /**
   * 读一次增量。
   *
   * 第一次调用给末尾若干行（让面板立刻有内容），之后只给新增部分。
   * 文件不存在时返回空串，不报错 —— 服务没起来时这是常态。
   *
   * @returns 新增文本；没有新增则空串。
   */
  poll() {
    let stat;
    try {
      stat = fs4.statSync(this.file);
    } catch {
      this.started = false;
      this.offset = 0;
      this.lastSize = -1;
      return "";
    }
    if (this.started && stat.size < this.lastSize) {
      this.started = false;
      this.offset = 0;
    }
    this.lastSize = stat.size;
    if (!this.started) {
      this.started = true;
      this.offset = 0;
      const tail = readTail(this.file);
      this.offset = stat.size;
      return tail === "" ? "" : `${tail}
`;
    }
    if (stat.size <= this.offset) return "";
    let fd;
    try {
      fd = fs4.openSync(this.file, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs4.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      return buf.toString("utf8");
    } catch {
      return "";
    } finally {
      if (fd !== void 0) {
        try {
          fs4.closeSync(fd);
        } catch {
        }
      }
    }
  }
  /** 探测 ComfyUI 安装目录下的日志文件路径；找不到返回 undefined。 */
  static locate(installDir) {
    if (installDir === void 0 || installDir === "") return void 0;
    const candidate = path4.join(installDir, "user", "comfyui.log");
    try {
      if (fs4.existsSync(candidate)) return candidate;
    } catch {
    }
    return void 0;
  }
};

// src/shared/authz/authorize.ts
import path6 from "node:path";

// src/shared/authz/legacy-paths.ts
import fs5 from "node:fs";
import path5 from "node:path";
function comfyImageOutputDir() {
  const file = path5.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs5.readFileSync(file, "utf8"));
    const dir = parsed !== null && typeof parsed === "object" ? parsed.outputDir : void 0;
    return typeof dir === "string" && dir.trim() !== "" ? dir : void 0;
  } catch {
    return void 0;
  }
}

// src/shared/authz/authorize.ts
function isAuthorized(target, roots) {
  if (typeof target !== "string" || target.trim() === "") return false;
  if (target.includes("\0")) return false;
  const abs = foldPathCase(canonical(target));
  return roots.some((root) => {
    const base = foldPathCase(root.path);
    return abs === base || abs.startsWith(base.endsWith(path6.sep) ? base : base + path6.sep);
  });
}

// src/shared/authz/roots.ts
import fs6 from "node:fs";
import path7 from "node:path";
var rootsCache = { at: 0, key: "", value: [] };
function rootsOf(ctx, settings) {
  const assetRoots = settings.assetRoots ?? [];
  const cacheKey = `${settings.roots.join("|")}|${settings.outputDir ?? ""}|${assetRoots.join("|")}`;
  const now = Date.now();
  if (rootsCache.key === cacheKey && now - rootsCache.at < 2e3) return rootsCache.value;
  const candidates = [];
  for (const item of settings.roots) candidates.push({ path: item, kind: "custom" });
  try {
    const cwd = ctx.get?.("workingDirectory");
    const dir = cwd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") candidates.push({ path: dir, kind: "workspace" });
  } catch {
  }
  try {
    const registry = ctx.get?.("workspaceRegistry");
    const list = typeof registry?.list === "function" ? registry.list() : [];
    if (Array.isArray(list)) {
      for (const workspace of list) {
        const p = workspace !== null && typeof workspace === "object" ? workspace.path : void 0;
        if (typeof p === "string") candidates.push({ path: p, kind: "workspace" });
      }
    }
  } catch {
  }
  const outputDir = comfyImageOutputDir();
  if (outputDir !== void 0) candidates.push({ path: outputDir, kind: "output" });
  candidates.push({ path: process.cwd(), kind: "cwd" });
  candidates.push({
    path: settings.uploadsDir ?? path7.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path7.join(pluginDataDir(), "outputs"), kind: "output" });
  if (typeof settings.outputDir === "string" && settings.outputDir !== "") {
    candidates.push({ path: settings.outputDir, kind: "output" });
  }
  for (const extra of assetRoots) candidates.push({ path: extra, kind: "custom" });
  const seen = /* @__PURE__ */ new Set();
  const roots = [];
  for (const candidate of candidates) {
    const abs = canonical(candidate.path);
    const key = foldPathCase(abs);
    if (seen.has(key)) continue;
    seen.add(key);
    let exists = false;
    try {
      exists = fs6.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path7.basename(abs) || abs, kind: candidate.kind });
  }
  rootsCache = { at: now, key: cacheKey, value: roots };
  return roots;
}

// src/shared/host/logger.ts
function resolveLogger(ctx, scope) {
  const direct = ctx.logger;
  if (typeof direct === "function") {
    try {
      const scoped = direct(scope);
      if (scoped !== null && typeof scoped === "object") return scoped;
    } catch {
    }
  }
  if (direct !== null && typeof direct === "object") return direct;
  const viaGet = ctx.get?.("logger");
  if (viaGet !== null && typeof viaGet === "object") return viaGet;
  return void 0;
}

// src/shared/host/workspace.ts
import fs7 from "node:fs";
import path8 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs7.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
}
function cwdCandidate() {
  const cwd = process.cwd();
  if (cwd === "" || looksInternal(cwd)) return void 0;
  return cwd;
}
function probeWorkspace(ctx) {
  const cwd = process.cwd();
  const probe2 = {
    env: typeof process.env.DSH_WORKSPACE === "string" && process.env.DSH_WORKSPACE.trim() !== "" ? process.env.DSH_WORKSPACE : null,
    cwd,
    cwdInternal: looksInternal(cwd),
    workingDirectory: null,
    serviceCount: 0,
    serviceKeys: []
  };
  for (const name2 of ["workspaceRegistry", "workspace", "workspaces", "workspaceStore"]) {
    try {
      if (typeof ctx.get?.(name2) !== "undefined") probe2.serviceKeys.push(name2);
    } catch {
    }
  }
  const explicit = process.env.DSH_WORKSPACE;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    try {
      const wd = ctx.get?.("workingDirectory");
      if (typeof wd?.defaultDirectory === "string") probe2.workingDirectory = wd.defaultDirectory;
    } catch {
    }
    return { guess: { dir: path8.resolve(explicit.trim()), source: "env" }, probe: probe2 };
  }
  try {
    const wd = ctx.get?.("workingDirectory");
    const dir = wd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") probe2.workingDirectory = dir;
    if (typeof dir === "string" && dir !== "" && !looksInternal(dir)) {
      return { guess: { dir: path8.resolve(dir), source: "workingDirectory" }, probe: probe2 };
    }
  } catch {
  }
  let paths = [];
  try {
    const service = ctx.get?.("workspaceRegistry");
    const raw = typeof service?.list === "function" ? service.list() : [];
    if (Array.isArray(raw)) {
      paths = raw.map((item) => item !== null && typeof item === "object" ? item.path : void 0).filter((item) => typeof item === "string" && item !== "");
    }
  } catch {
    paths = [];
  }
  probe2.serviceCount = paths.length;
  if (paths.length > 0) {
    const norm = (value) => foldPathCase(value.replace(/\\/g, "/").replace(/\/+$/, ""));
    const cwdNorm = norm(cwd);
    const related = paths.map((item) => ({ item, target: norm(item) })).filter(({ target }) => cwdNorm === target || cwdNorm.startsWith(`${target}/`)).sort((a, b) => b.target.length - a.target.length)[0]?.item;
    return { guess: { dir: related ?? paths[0], source: "service" }, probe: probe2 };
  }
  const candidate = cwdCandidate();
  const guess = candidate === void 0 ? void 0 : { dir: candidate, source: "cwd" };
  return { guess, probe: probe2 };
}
function sessionWorkspaceDir(ctx, agent) {
  if (agent === null || typeof agent !== "object") return void 0;
  const holder = agent;
  const session = holder.session ?? holder.sessionId ?? holder.id;
  if (session === void 0 || session === null) return void 0;
  let service;
  try {
    service = ctx.get?.("workingDirectory");
  } catch {
    return void 0;
  }
  if (service === null || typeof service !== "object") return void 0;
  const getter = service.get;
  if (typeof getter !== "function") return void 0;
  let result;
  try {
    result = getter.call(service, session);
  } catch {
    return void 0;
  }
  if (typeof result === "string") {
    return result !== "" && !looksInternal(result) ? path8.resolve(result) : void 0;
  }
  if (result !== null && typeof result === "object") {
    const candidate = result.path ?? result.directory;
    if (typeof candidate === "string" && candidate !== "" && !looksInternal(candidate)) return path8.resolve(candidate);
  }
  return void 0;
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path8.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path8.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
import fs8 from "node:fs";
import path9 from "node:path";
function indexPath() {
  return path9.join(pluginDataDir(), "assets.jsonl");
}
var AssetIndex = class {
  file;
  rows = /* @__PURE__ */ new Map();
  loadedAt = 0;
  dirty = false;
  /** 自上次压实以来的追加次数。 */
  appends = 0;
  constructor(file = indexPath()) {
    this.file = file;
  }
  /** 从磁盘加载（带 2 秒缓存）。 */
  ensureLoaded() {
    const now = Date.now();
    if (now - this.loadedAt < 2e3 && !this.dirty) return;
    this.rows.clear();
    let text = "";
    try {
      text = fs8.readFileSync(this.file, "utf8");
    } catch {
      this.loadedAt = now;
      return;
    }
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      try {
        const record = JSON.parse(line);
        if (typeof record.path === "string") this.rows.set(record.path, record);
      } catch {
      }
    }
    this.loadedAt = now;
    this.dirty = false;
  }
  /** 追加一条（同路径覆盖内存里的旧值，文件里以后再写为准）。 */
  add(record) {
    this.ensureLoaded();
    this.rows.set(record.path, record);
    ensureDir(path9.dirname(this.file));
    fs8.appendFileSync(this.file, `${JSON.stringify(record)}
`, "utf8");
    this.dirty = true;
    this.loadedAt = Date.now();
  }
  /** 批量登记。 */
  addMany(records) {
    for (const record of records) this.add(record);
  }
  /** 移除一个路径的索引行。 */
  remove(target) {
    this.ensureLoaded();
    if (!this.rows.has(target)) return;
    this.rows.delete(target);
    this.rewrite();
  }
  /** 当前全部记录。 */
  all() {
    this.ensureLoaded();
    return [...this.rows.values()];
  }
  /**
   * 检索。
   *
   * 排序固定 `createdAt` 倒序；游标是上一页最后一条的 createdAt（文件会变，offset 会跳项）。
   */
  search(query) {
    this.ensureLoaded();
    const q = (query.q ?? "").trim().toLowerCase();
    const tags = query.tag ?? [];
    let items = [...this.rows.values()].filter((record) => {
      if (query.status !== void 0 && record.status !== query.status) return false;
      if (query.workflow !== void 0 && record.workflowId !== query.workflow) return false;
      if (query.kind !== void 0) {
        const media = /^(image|video|audio)\//;
        if (query.kind === "file") {
          if (media.test(record.mime)) return false;
        } else if (!record.mime.startsWith(`${query.kind}/`)) {
          return false;
        }
      }
      if (tags.length > 0 && !tags.every((tag) => record.tags.includes(tag))) return false;
      if (query.since !== void 0 && record.createdAt < query.since) return false;
      if (query.until !== void 0 && record.createdAt > query.until) return false;
      if (q !== "") {
        const haystack = `${record.path} ${record.workflowId} ${record.tags.join(" ")}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
    items.sort((a, b) => a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);
    if (query.cursor !== void 0) items = items.filter((record) => record.createdAt < query.cursor);
    const limit = Math.min(200, Math.max(1, query.limit ?? 60));
    const page = items.slice(0, limit);
    const last = page[page.length - 1];
    return { items: page, next: items.length > limit && last !== void 0 ? last.createdAt : void 0 };
  }
  /** 用给定记录整体重写索引（压实 / 重建都走它）。 */
  rewrite(records) {
    const list = records ?? [...this.rows.values()];
    ensureDir(path9.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs8.writeFileSync(this.file, body === "" ? "" : `${body}
`, "utf8");
    this.rows = new Map(list.map((record) => [record.path, record]));
    this.loadedAt = Date.now();
    this.dirty = false;
  }
  /** 现有行数（用于是否需要压实的判断）。 */
  get size() {
    this.ensureLoaded();
    return this.rows.size;
  }
};

// src/components/panel-gallery/server/store/rebuild.ts
import fs13 from "node:fs";
import path14 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
var SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
var PNG_META_READ_BYTES = 64 * 1024;

// src/components/panel-gallery/server/scan/collect.ts
import fs11 from "node:fs";
import path11 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs10 from "node:fs";
import path10 from "node:path";

// src/components/panel-gallery/server/scan/png-text.ts
import fs9 from "node:fs";
import zlib from "node:zlib";

// src/components/panel-gallery/server/scan/sidecar.ts
import fs12 from "node:fs";
import "node:path";

// src/components/panel-gallery/server/scan/mime.ts
import path13 from "node:path";

// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs15 from "node:fs";
import path15 from "node:path";

// src/shared/media/png-text.ts
import fs14 from "node:fs";
import zlib2 from "node:zlib";

// src/shared/media/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/shared/run/notify.ts
import crypto3 from "node:crypto";
var watchers = /* @__PURE__ */ new Map();
function stopAllWatchers() {
  for (const [, watcher] of watchers) clearInterval(watcher.timer);
  watchers.clear();
}

// src/http/router.ts
var router_exports = {};
__export(router_exports, {
  PREFIX: () => PREFIX,
  createDispatch: () => createDispatch
});
var PREFIX = "/comfyui-workbench/api";
var WRITABLE = /* @__PURE__ */ new Set(["/delete", "/delete-many", "/assets/rebuild", "/run", "/service/stop", "/upload"]);
var POST_ONLY = /* @__PURE__ */ new Set(["/run", "/free"]);
var READ_ONLY = /* @__PURE__ */ new Set(["GET", "HEAD"]);
function createDispatch(ctx) {
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const sub = url.pathname.slice(PREFIX.length) || "/";
      if (sub === "/") {
        sendJson(res, 200, { ok: true, plugin: "dsh-comfyui-workbench" });
        return;
      }
      const { exact, prefix } = mergedRoutes(ctx);
      let route = exact[sub];
      if (route === void 0 && prefix !== void 0) {
        const hit = [...prefix].sort((a, b) => b.base.length - a.base.length).find((item) => sub.startsWith(item.base));
        if (hit !== void 0) route = hit.handle;
      }
      if (route === void 0) {
        sendJson(res, 404, { ok: false, error: "unknown-route", message: `\u6CA1\u6709\u8FD9\u4E2A\u63A5\u53E3\uFF1A${sub}` });
        return;
      }
      const selfManaged = sub === "/workflows" || sub.startsWith("/workflows/") || sub === "/terminal";
      const writable = WRITABLE.has(sub);
      const methodOk = POST_ONLY.has(sub) ? req.method === "POST" : writable ? req.method === "POST" || req.method === "DELETE" : READ_ONLY.has(req.method ?? "");
      if (!selfManaged && !methodOk) {
        sendJson(res, 405, {
          ok: false,
          error: "method-not-allowed",
          message: writable ? "\u8FD9\u4E2A\u63A5\u53E3\u53EA\u63A5\u53D7 POST / DELETE\u3002" : "\u8FD9\u4E2A\u63A5\u53E3\u662F\u53EA\u8BFB\u7684\u3002"
        });
        return;
      }
      await route(url, res, req);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) sendJson(res, 500, { ok: false, error: "internal", message });
      else res.destroy();
    }
  };
}

// src/runtime.ts
var SHARED_PROP = "__dshComfyuiWorkbench";
function sharedOf(ctx) {
  const anchor = ctx.root ?? ctx;
  let slot = anchor[SHARED_PROP];
  if (slot === void 0) {
    slot = { current: void 0, refs: 0, tables: /* @__PURE__ */ new Map(), httpMounted: false };
    anchor[SHARED_PROP] = slot;
  }
  return slot;
}
function mountRoutes(ctx, componentId, table) {
  const tables = sharedOf(ctx).tables;
  tables.set(componentId, table);
  return () => {
    tables.delete(componentId);
  };
}
function mergedRoutes(ctx) {
  const exact = {};
  const prefix = [];
  for (const table of sharedOf(ctx).tables.values()) {
    Object.assign(exact, table.exact);
    if (table.prefix !== void 0) prefix.push(...table.prefix);
  }
  return { exact, prefix };
}
function ensureHttp(ctx, rt) {
  const shared = sharedOf(ctx);
  if (shared.httpMounted) return;
  const server = ctx.get?.("webServer");
  if (server === void 0 || typeof server.register !== "function") {
    rt.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 webServer \u670D\u52A1\uFF0C\u9762\u677F\u63A5\u53E3\u672A\u6CE8\u518C\u3002");
    return;
  }
  const { createDispatch: createDispatch2, PREFIX: PREFIX2 } = router_exports;
  try {
    const dispose = server.register({ kind: "prefix", path: PREFIX2, handler: createDispatch2(ctx) });
    shared.httpMounted = true;
    if (typeof dispose === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => () => {
        shared.httpMounted = false;
        dispose();
      }, "comfyui-workbench: http prefix");
    }
    rt.info(`[comfyui-workbench] API \u5C31\u7EEA\uFF1A${PREFIX2}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate prefix route")) throw error;
    rt.info("[comfyui-workbench] HTTP \u524D\u7F00\u5DF2\u5B58\u5728\uFF08\u91CD\u8F7D\uFF09\uFF0C\u6CBF\u7528\u73B0\u6709\u5B9E\u4F8B");
  }
}
function acquire(ctx, config) {
  const shared = sharedOf(ctx);
  shared.refs += 1;
  shared.currentCaller = ctx;
  if (shared.current !== void 0) return shared.current;
  shared.httpMounted = false;
  shared.current = create(ctx, config);
  return shared.current;
}
function release(ctx) {
  const shared = sharedOf(ctx);
  shared.refs -= 1;
  if (shared.refs > 0 || shared.current === void 0) return;
  shared.current.supervisor.dispose();
  stopAllWatchers();
  shared.tables.clear();
  shared.current = void 0;
  shared.refs = 0;
}
function create(ctx, config) {
  const settings = resolveSettings(config, process.env);
  const logger = resolveLogger(ctx, "comfyui-workbench");
  const warn = (message) => {
    logger?.warn?.(message);
  };
  const info = (message) => {
    logger?.info?.(message);
  };
  const flowDir = settings.workflowsDir ?? workflowsDir();
  const uploadsDir = settings.uploadsDir ?? `${pluginDataDir()}/uploads`;
  ensureDir(uploadsDir);
  const { guess, probe: probe2 } = probeWorkspace(ctx);
  const resolved = resolveOutputDir(settings.outputDir, guess, pluginDataDir());
  const outputDir = resolved.dir;
  ensureDir(outputDir);
  const sessionOutputDirs = /* @__PURE__ */ new Set();
  const resolveOutputDirFor = (agent) => {
    if (settings.outputDir !== null) return settings.outputDir;
    const sessionDir = sessionWorkspaceDir(ctx, agent);
    if (sessionDir === void 0) return outputDir;
    const dir = path16.join(sessionDir, "comfyui-output");
    ensureDir(dir);
    sessionOutputDirs.add(canonical(dir));
    return dir;
  };
  const terminal = new TerminalBuffer(2e3);
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand },
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger,
    onOutput: (stream, text) => terminal.push(stream, text)
  });
  const logTailRef = { current: void 0 };
  const pumpLog = () => {
    if (supervisor.status().managed) return;
    const installDir = supervisor.installDirOf();
    const file = LogTail.locate(installDir);
    if (file === void 0) return;
    if (logTailRef.current === void 0 || logTailRef.current.path !== file) {
      logTailRef.current = new LogTail(file);
      terminal.push("out", `\u2014\u2014 \u4EE5\u4E0B\u6765\u81EA\u65E5\u5FD7\u6587\u4EF6 ${file} \u2014\u2014
`);
    }
    const chunk = logTailRef.current.poll();
    if (chunk !== "") terminal.push("out", chunk);
  };
  const logTimer = setInterval(pumpLog, 2e3);
  logTimer.unref?.();
  pumpLog();
  if (typeof ctx.effect === "function") {
    ctx.effect(() => () => {
      clearInterval(logTimer);
    }, "runtime: log pump");
  }
  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady()
  });
  const index = settings.indexFile === null ? new AssetIndex() : new AssetIndex(settings.indexFile);
  const rootsSettings = { ...settings, resolvedOutputDir: outputDir };
  const assertWritable = (dir, agent) => {
    const roots = rootsOf(ctx, rootsSettings);
    if (roots.length === 0) return;
    if (isAuthorized(dir, roots)) return;
    const sessionDir = sessionWorkspaceDir(ctx, agent);
    if (sessionDir !== void 0) {
      const sessionOutput = canonical(path16.join(sessionDir, "comfyui-output"));
      sessionOutputDirs.add(sessionOutput);
      if (isAuthorized(dir, [...roots, { path: sessionOutput, label: "session-output", kind: "workspace" }])) return;
    }
    throw new Error(`\u8F93\u51FA\u76EE\u5F55\u4E0D\u5728\u6388\u6743\u8303\u56F4\u5185\uFF1A${dir}\u3002\u8BF7\u5728\u914D\u7F6E\u7684 assetRoots \u91CC\u52A0\u4E0A\u5B83\uFF0C\u6216\u6539\u7528 workspace \u5185\u7684\u76EE\u5F55\u3002`);
  };
  const track = (dispose) => {
    if (typeof dispose !== "function") return;
    const owner = sharedOf(ctx).currentCaller ?? ctx;
    if (typeof owner.effect === "function") owner.effect(() => dispose, "comfyui-workbench: disposer");
  };
  info(`[comfyui-workbench] \u8FD0\u884C\u65F6\u5C31\u7EEA\uFF1A\u4EA7\u7269 ${outputDir}\uFF08\u6765\u6E90 ${resolved.source}\uFF09`);
  return {
    settings,
    client,
    supervisor,
    terminal,
    index,
    flowDir,
    outputDir,
    resolveOutputDirFor,
    sessionOutputDirs,
    outputSource: resolved.source,
    outputProbe: probe2,
    uploadsDir,
    assertWritable,
    logger,
    warn,
    info,
    track,
    tools: { registered: [], failed: [], skipped: [] }
  };
}

// src/entries/terminal.ts
var name = "dsh-comfyui-workbench:terminal";
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
var inject = ["webServer", "workspaceRegistry"];
function apply(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.terminal")) {
    warnDisabled("panel.terminal");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "terminal: runtime");
  ensureHttp(ctx, rt);
  const table = createTerminalRoutes({
    buffer: rt.terminal,
    status: () => rt.supervisor.status(),
    // 不等就绪：启动要几十秒，接口立刻返回，进度由轮询的 status 反映。
    start: () => {
      void rt.supervisor.ensureReady().catch(() => {
      });
    }
  });
  if (typeof ctx.effect === "function") {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, "panel.terminal", { exact: table });
      return () => {
        unmount();
      };
    }, "terminal: routes");
  } else {
    mountRoutes(ctx, "panel.terminal", { exact: table });
  }
  rt.info("[comfyui-workbench] \u7EC8\u7AEF\u9762\u677F\u5DF2\u4E0A\u7EBF");
}
export {
  apply,
  inject,
  name
};
