// src/index.ts
import fs17 from "node:fs";

// src/comfy/client.ts
import crypto from "node:crypto";

// src/comfy/errors.ts
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
function asRunError(error, fallback = "execution_failed") {
  if (error instanceof RunError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new RunError(fallback, message);
}
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
function nodeMissing(missing) {
  return new RunError(
    "node_missing",
    `\u5DE5\u4F5C\u6D41\u9700\u8981\u8FD9\u4E9B\u8282\u70B9\uFF0C\u4F46 ComfyUI \u91CC\u6CA1\u6709\uFF1A${missing.join("\u3001")}`,
    "\u5148\u5B89\u88C5\u5BF9\u5E94\u7684\u81EA\u5B9A\u4E49\u8282\u70B9\u5305\uFF0C\u6216\u6362\u6210\u53EA\u542B\u5185\u7F6E\u8282\u70B9\u7684\u5DE5\u4F5C\u6D41\u3002",
    { missing }
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
function executionFailed(entry, promptId) {
  const detail = failureDetail(entry);
  return new RunError(
    "execution_failed",
    `ComfyUI \u6267\u884C\u5931\u8D25\uFF08prompt ${promptId}\uFF09${detail === "" ? "" : `\uFF1A${detail}`}`,
    "\u901A\u5E38\u662F\u6A21\u578B/\u8282\u70B9\u53C2\u6570\u4E0D\u5339\u914D\u6216\u663E\u5B58\u4E0D\u8DB3\u3002\u964D\u5206\u8FA8\u7387\u6216\u6362\u5E95\u6A21\u540E\u91CD\u8BD5\u3002",
    entry
  );
}
function failureDetail(entry) {
  if (entry === null || typeof entry !== "object") return "";
  const status = entry.status;
  const messages = status !== null && typeof status === "object" ? status.messages : void 0;
  if (!Array.isArray(messages)) return "";
  for (const message of messages) {
    if (!Array.isArray(message) || message.length < 2) continue;
    if (message[0] !== "execution_error") continue;
    const payload = message[1];
    if (payload !== null && typeof payload === "object") {
      const bag = payload;
      const text3 = typeof bag.exception_message === "string" ? bag.exception_message : "";
      const node = bag.node_id === void 0 ? "" : `\u8282\u70B9 ${String(bag.node_id)}`;
      const type = typeof bag.node_type === "string" ? bag.node_type : "";
      const head = [node, type].filter((part) => part !== "").join(" ");
      const detail = `${head}${head === "" ? "" : "\uFF1A"}${text3}`;
      if (detail.trim() !== "") return detail.trim();
    }
  }
  return "";
}
function noOutput(hintTerminal) {
  return new RunError(
    "no_output",
    "\u6267\u884C\u5B8C\u6210\u4E86\uFF0C\u4F46\u6CA1\u6709\u62FF\u5230\u4EFB\u4F55\u4EA7\u7269\u6587\u4EF6\u3002",
    hintTerminal ? "\u5DE5\u4F5C\u6D41\u672B\u7AEF\u7F3A\u5C11 SaveImage / PreviewImage \u8282\u70B9\uFF0C\u4EA7\u7269\u4E0D\u4F1A\u88AB\u4FDD\u5B58\u3002\u8865\u4E00\u4E2A\u8F93\u51FA\u8282\u70B9\u518D\u8BD5\u3002" : "\u68C0\u67E5\u8F93\u51FA\u8282\u70B9\u662F\u5426\u88AB ComfyUI \u8DF3\u8FC7\uFF08\u7F13\u5B58\u6216\u6761\u4EF6\u5206\u652F\uFF09\u3002"
  );
}
function outputUnreadable(filename, cause) {
  const detail = cause instanceof Error ? `\uFF08${cause.message}\uFF09` : "";
  return new RunError("output_unreadable", `\u53D6\u4E0D\u56DE\u4EA7\u7269\u5B57\u8282\uFF1A${filename}${detail}`, "\u91CD\u8BD5\u4E00\u6B21\uFF1B\u6301\u7EED\u5931\u8D25\u5C31\u7528 GET /view \u624B\u5DE5\u4E0B\u8F7D\u9A8C\u8BC1\u3002");
}
function timedOut(waitedMs, promptId) {
  return new RunError(
    "timeout",
    `\u7B49\u4E86 ${Math.round(waitedMs / 1e3)} \u79D2\u4ECD\u672A\u5B8C\u6210\uFF08prompt ${promptId}\uFF09\u3002`,
    "\u5DF2\u5411 ComfyUI \u53D1\u51FA\u53D6\u6D88\u3002\u53EF\u4EE5\u8C03\u5927 timeoutMs\uFF0C\u6216\u964D\u4F4E\u5206\u8FA8\u7387/\u6B65\u6570\u3002"
  );
}

// src/comfy/client.ts
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
  async request(path18, init = {}, timeoutMs = this.requestTimeoutMs) {
    if (this.ensure !== void 0) {
      const ready = await this.ensure();
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
    }
    const url = `${this.baseUrl}${path18}`;
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
  async objectInfo(refresh = false) {
    if (!refresh && this.infoCache !== null) return this.infoCache;
    const res = await this.request("/object_info", { method: "GET" });
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
  /** 取消执行（超时收尾必发，否则队列被一条已放弃的任务堵住）。 */
  async interrupt() {
    try {
      await this.request("/interrupt", { method: "POST" }, 1e4);
    } catch {
    }
  }
};

// src/comfy/supervisor.ts
import { spawn } from "node:child_process";
import fs2 from "node:fs";
import path2 from "node:path";

// src/host/paths.ts
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

// src/comfy/supervisor.ts
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
function interpreterOf(dir) {
  const candidates = [
    path2.join(dir, "venv", "Scripts", "python.exe"),
    path2.join(dir, "venv", "bin", "python"),
    path2.join(dir, "python_embeded", "python.exe"),
    path2.join(dir, ".venv", "Scripts", "python.exe")
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
        stdio: "ignore",
        detached: false,
        windowsHide: true
      });
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

// src/host/config.ts
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
    assetRoots: listOf(raw.assetRoots),
    strictVars: raw.strictVars !== false,
    runMode: oneOf(raw.runMode, ["conversation", "direct"], "conversation"),
    returnImages: oneOf(raw.returnImages, ["first", "all", "none"], "first"),
    autoDetect: raw.autoDetect !== false,
    autoStart: raw.autoStart !== false,
    startCommand: listOf(raw.startCommand),
    readyTimeoutMs: int(raw.readyTimeoutMs, 18e4, 5e3, 9e5),
    idleShutdownMs: int(raw.idleShutdownMs, 3e5, 0, 36e5),
    timeoutMs: int(pick("timeoutMs"), 3e5, 1e3, 36e5),
    pollIntervalMs: int(raw.pollIntervalMs, 1e3, 100, 1e4),
    indexMode: oneOf(raw.indexMode, ["auto", "off"], "auto"),
    betterSidebarTab: oneOf(raw.betterSidebarTab, ["auto", "on", "off"], "auto")
  };
}

// src/host/logger.ts
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

// src/http/router.ts
import fs15 from "node:fs";
import path16 from "node:path";

// src/store/index-file.ts
import fs3 from "node:fs";
import path3 from "node:path";
function indexPath() {
  return path3.join(pluginDataDir(), "assets.jsonl");
}
var AssetIndex = class {
  file;
  rows = /* @__PURE__ */ new Map();
  loadedAt = 0;
  dirty = false;
  constructor(file = indexPath()) {
    this.file = file;
  }
  /** 从磁盘加载（带 2 秒缓存）。 */
  ensureLoaded() {
    const now = Date.now();
    if (now - this.loadedAt < 2e3 && !this.dirty) return;
    this.rows.clear();
    let text3 = "";
    try {
      text3 = fs3.readFileSync(this.file, "utf8");
    } catch {
      this.loadedAt = now;
      return;
    }
    for (const line of text3.split("\n")) {
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
    ensureDir(path3.dirname(this.file));
    fs3.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path3.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs3.writeFileSync(this.file, body === "" ? "" : `${body}
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

// src/store/rebuild.ts
import fs8 from "node:fs";
import path8 from "node:path";

// src/scan/constants.ts
var IMAGE_EXTS = /* @__PURE__ */ new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".bmp"]);
var SKIP_DIRS = /* @__PURE__ */ new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  ".dsh",
  ".archive"
]);
var SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
var PNG_META_READ_BYTES = 64 * 1024;
var MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp"
};

// src/scan/collect.ts
import fs6 from "node:fs";
import path5 from "node:path";

// src/scan/embedded.ts
import fs5 from "node:fs";
import path4 from "node:path";

// src/scan/graph.ts
function entriesOf(graph) {
  const out = [];
  for (const [id, node] of Object.entries(graph)) {
    if (node === null || typeof node !== "object") continue;
    const inputs = node.inputs;
    if (inputs === null || typeof inputs !== "object") continue;
    out.push([id, { class_type: node.class_type, inputs }]);
  }
  return out;
}
var text = (value) => typeof value === "string" && value.trim() !== "" ? value : void 0;
var num = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
function extractFromGraph(graph) {
  const entries = entriesOf(graph);
  if (entries.length === 0) return void 0;
  const byId = new Map(entries.map(([id, node]) => [id, node]));
  const followText = (link, depth) => {
    if (depth > 3 || !Array.isArray(link) || link.length === 0) return void 0;
    const node = byId.get(String(link[0]));
    if (node === void 0) return void 0;
    const own = text(node.inputs.text);
    if (own !== void 0) return own;
    for (const key of Object.keys(node.inputs)) {
      const value = node.inputs[key];
      if (Array.isArray(value)) {
        const found = followText(value, depth + 1);
        if (found !== void 0) return found;
      }
    }
    return void 0;
  };
  const samplerEntry = entries.find(
    ([, node]) => /sampler/i.test(String(node.class_type)) && node.inputs.positive !== void 0 && node.inputs.negative !== void 0
  );
  const samplerInputs = samplerEntry === void 0 ? {} : samplerEntry[1].inputs;
  const allTexts = entries.map(([, node]) => text(node.inputs.text)).filter((value) => value !== void 0);
  const positive = samplerEntry === void 0 ? void 0 : followText(samplerInputs.positive, 0);
  const negative = samplerEntry === void 0 ? void 0 : followText(samplerInputs.negative, 0);
  const fallbackPositive = allTexts.length > 0 ? allTexts[0] : void 0;
  const fallbackNegative = allTexts.length > 1 ? allTexts[allTexts.length - 1] : void 0;
  const sizeNode = entries.map(([, node]) => node).find((node) => typeof node.inputs.width === "number" && typeof node.inputs.height === "number");
  const checkpoint = entries.map(([, node]) => node.inputs.ckpt_name ?? node.inputs.unet_name ?? node.inputs.model_name).find((value) => typeof value === "string" && value !== "");
  return {
    prompt: positive ?? fallbackPositive,
    negativePrompt: negative ?? fallbackNegative,
    seed: num(samplerInputs.seed) ?? num(samplerInputs.noise_seed),
    steps: num(samplerInputs.steps),
    cfgScale: num(samplerInputs.cfg),
    samplerName: text(samplerInputs.sampler_name),
    scheduler: text(samplerInputs.scheduler),
    width: sizeNode === void 0 ? void 0 : num(sizeNode.inputs.width),
    height: sizeNode === void 0 ? void 0 : num(sizeNode.inputs.height),
    checkpoint,
    workflow: graph
  };
}
function modelFromWorkflow(workflow) {
  if (workflow === null || typeof workflow !== "object") return void 0;
  for (const node of Object.values(workflow)) {
    if (node === null || typeof node !== "object") continue;
    const inputs = node.inputs;
    if (inputs === null || typeof inputs !== "object") continue;
    const bag = inputs;
    for (const key of ["ckpt_name", "unet_name", "model_name"]) {
      const value = bag[key];
      if (typeof value === "string" && value !== "") return value;
    }
  }
  return void 0;
}

// src/scan/png-text.ts
import fs4 from "node:fs";
import zlib from "node:zlib";
function readPngTextChunks(imagePath, size) {
  if (size < 16) return void 0;
  const length = Math.min(size, PNG_META_READ_BYTES);
  let fd;
  try {
    fd = fs4.openSync(imagePath, "r");
    const buffer = Buffer.alloc(length);
    const read = fs4.readSync(fd, buffer, 0, length, 0);
    if (read < 24) return void 0;
    if (buffer[0] !== 137 || buffer.toString("ascii", 1, 4) !== "PNG") return void 0;
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    const chunks = [];
    let offset = 8;
    while (offset + 12 <= read) {
      const chunkLength = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);
      if (type === "IDAT" || type === "IEND") break;
      if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
        const data = buffer.subarray(offset + 8, Math.min(offset + 8 + chunkLength, read));
        const zero = data.indexOf(0);
        if (zero > 0) {
          const keyword = data.toString("latin1", 0, zero);
          let value;
          try {
            if (type === "tEXt") {
              value = data.toString("latin1", zero + 1);
            } else if (type === "zTXt") {
              value = zlib.inflateSync(data.subarray(zero + 2)).toString("utf8");
            } else {
              const rest = data.subarray(zero + 3);
              const languageEnd = rest.indexOf(0);
              const translatedEnd = rest.indexOf(0, languageEnd + 1);
              value = rest.subarray(translatedEnd + 1).toString("utf8");
            }
          } catch {
            value = void 0;
          }
          if (value !== void 0) chunks.push({ keyword, value });
        }
      }
      offset += 12 + chunkLength;
    }
    return { chunks, width, height };
  } catch {
    return void 0;
  } finally {
    if (fd !== void 0) fs4.closeSync(fd);
  }
}

// src/scan/embedded.ts
function readEmbeddedMeta(imagePath, stat) {
  if (path4.extname(imagePath).toLowerCase() !== ".png") return void 0;
  const parsed = readPngTextChunks(imagePath, stat.size);
  if (parsed === void 0) return void 0;
  const promptChunk = parsed.chunks.find((chunk) => chunk.keyword === "prompt");
  if (promptChunk === void 0) return void 0;
  let graph;
  try {
    graph = JSON.parse(promptChunk.value);
  } catch {
    return void 0;
  }
  if (graph === null || typeof graph !== "object" || Array.isArray(graph)) return void 0;
  const extracted = extractFromGraph(graph);
  if (extracted === void 0) return void 0;
  return {
    ...extracted,
    width: parsed.width ?? extracted.width,
    height: parsed.height ?? extracted.height,
    source: "embedded"
  };
}
function hasEmbeddedPromptHint(imagePath) {
  if (path4.extname(imagePath).toLowerCase() !== ".png") return false;
  let fd;
  try {
    fd = fs5.openSync(imagePath, "r");
    const buffer = Buffer.alloc(256);
    const read = fs5.readSync(fd, buffer, 0, 256, 0);
    if (read < 64 || buffer[0] !== 137) return false;
    const head = buffer.toString("latin1", 0, read);
    return head.includes("tEXt") && head.includes("prompt");
  } catch {
    return false;
  } finally {
    if (fd !== void 0) fs5.closeSync(fd);
  }
}

// src/scan/collect.ts
function collectImages(root, options) {
  const generated = [];
  const bare = [];
  let truncatedGenerated = false;
  let truncatedBare = false;
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs6.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name2 = entry.name;
      if (!options.includeHidden && name2.startsWith(".")) continue;
      const full = path5.join(dir, name2);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name2)) continue;
        if (depth + 1 > options.maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTS.has(path5.extname(name2).toLowerCase())) continue;
      let stat;
      try {
        stat = fs6.statSync(full);
      } catch {
        continue;
      }
      const generatedFlag = fs6.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full);
      const record = {
        path: full,
        name: name2,
        dir,
        size: stat.size,
        mtime: stat.mtimeMs,
        generated: generatedFlag
      };
      if (generatedFlag) {
        if (generated.length < options.maxItems) generated.push(record);
        else truncatedGenerated = true;
      } else if (bare.length < options.maxItems) {
        bare.push(record);
      } else {
        truncatedBare = true;
      }
    }
  };
  walk(root, 0);
  const files = generated.concat(bare);
  files.sort((a, b) => b.mtime - a.mtime);
  return { files, truncated: truncatedGenerated || truncatedBare, truncatedGenerated, truncatedBare };
}

// src/scan/sidecar.ts
import fs7 from "node:fs";
import "node:path";
var metaCache = /* @__PURE__ */ new Map();
function sidecarPathOf(imagePath) {
  return `${imagePath}.json`;
}
function readMeta(imagePath) {
  const metaPath = sidecarPathOf(imagePath);
  let sidecarStat;
  let imageStat;
  try {
    sidecarStat = fs7.statSync(metaPath);
  } catch {
    sidecarStat = void 0;
  }
  try {
    imageStat = fs7.statSync(imagePath);
  } catch {
    imageStat = void 0;
  }
  const sidecarKey = sidecarStat !== void 0 && sidecarStat.isFile() ? sidecarStat.mtimeMs : -1;
  const imageKey = imageStat !== void 0 ? imageStat.mtimeMs : -1;
  const cached = metaCache.get(imagePath);
  if (cached !== void 0 && cached.sidecarMtimeMs === sidecarKey && cached.imageMtimeMs === imageKey) {
    return cached.meta;
  }
  let meta;
  if (sidecarStat !== void 0 && sidecarStat.isFile() && sidecarStat.size > 0 && sidecarStat.size <= SIDECAR_MAX_BYTES) {
    try {
      const parsed = JSON.parse(fs7.readFileSync(metaPath, "utf8"));
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        meta = { ...parsed, source: "sidecar" };
      }
    } catch {
      meta = void 0;
    }
  }
  if (meta === void 0 && imageStat !== void 0 && imageStat.isFile()) {
    meta = readEmbeddedMeta(imagePath, imageStat);
  }
  metaCache.set(imagePath, { sidecarMtimeMs: sidecarKey, imageMtimeMs: imageKey, meta });
  return meta;
}
function readFullSidecar(imagePath) {
  return readMeta(imagePath);
}

// src/scan/summary.ts
var PROMPT_CLIP = 1200;
var NEGATIVE_CLIP = 800;
var text2 = (value) => typeof value === "string" && value.trim() !== "" ? value : void 0;
function clip(value, max) {
  if (value === void 0) return void 0;
  return value.length > max ? `${value.slice(0, max)}\u2026` : value;
}
var num2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
function metaSummary(meta) {
  if (meta === void 0) return { hasMeta: false };
  return {
    hasMeta: true,
    // sidecar 是插件自己的记录；embedded 表示从 PNG 的 prompt 块现读出来的。
    metaSource: text2(meta.source),
    prompt: clip(text2(meta.prompt), PROMPT_CLIP),
    negativePrompt: clip(text2(meta.negativePrompt), NEGATIVE_CLIP),
    mode: text2(meta.mode),
    seed: num2(meta.seed),
    width: num2(meta.width),
    height: num2(meta.height),
    steps: num2(meta.steps),
    cfgScale: num2(meta.cfgScale),
    strength: num2(meta.strength),
    samplerName: text2(meta.samplerName),
    scheduler: text2(meta.scheduler),
    checkpoint: text2(meta.checkpoint) ?? modelFromWorkflow(meta.workflow),
    createdAt: text2(meta.createdAt),
    workflow: meta.workflow !== void 0 && meta.workflow !== null
  };
}

// src/scan/list-item.ts
function toListItem(file, rootLabel) {
  return {
    path: file.path,
    name: file.name,
    dir: file.dir,
    root: rootLabel,
    size: file.size,
    mtime: file.mtime,
    ...metaSummary(readMeta(file.path))
  };
}

// src/scan/mime.ts
import path7 from "node:path";
function mimeOf(filePath) {
  return MIME_BY_EXT[path7.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// src/store/rebuild.ts
function rebuildFromSidecars(roots, options) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const root of roots) {
    const scanned = collectImages(root, options);
    for (const file of scanned.files) {
      if (seen.has(file.path)) continue;
      seen.add(file.path);
      const meta = readMeta(file.path);
      if (meta === void 0) continue;
      const workflowId = typeof meta.workflowId === "string" ? meta.workflowId : "";
      const workflowHash = typeof meta.workflowHash === "string" ? meta.workflowHash : "";
      const promptId = meta.comfy !== null && typeof meta.comfy === "object" ? String(meta.comfy.promptId ?? "") : "";
      const createdAt = typeof meta.createdAt === "string" ? meta.createdAt : new Date(file.mtime).toISOString();
      const tags = Array.isArray(meta.tags) ? meta.tags.filter((tag) => typeof tag === "string") : [];
      let bytes = file.size;
      try {
        bytes = fs8.statSync(file.path).size;
      } catch {
      }
      out.push({
        digest: typeof meta.digest === "string" ? meta.digest : "",
        path: file.path,
        bytes,
        mime: mimeOfExt(path8.extname(file.path)),
        ...typeof meta.width === "number" ? { width: meta.width } : {},
        ...typeof meta.height === "number" ? { height: meta.height } : {},
        workflowId,
        workflowHash,
        promptId,
        createdAt,
        tags,
        status: "present"
      });
    }
  }
  return out;
}
function mimeOfExt(ext) {
  switch (ext.toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".avif":
      return "image/avif";
    case ".bmp":
      return "image/bmp";
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mp3":
      return "audio/mpeg";
    case ".wav":
      return "audio/wav";
    default:
      return "application/octet-stream";
  }
}

// src/assets/authorize.ts
import path10 from "node:path";

// src/assets/paths.ts
import fs9 from "node:fs";
import path9 from "node:path";
function comfyImageOutputDir() {
  const file = path9.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs9.readFileSync(file, "utf8"));
    const dir = parsed !== null && typeof parsed === "object" ? parsed.outputDir : void 0;
    return typeof dir === "string" && dir.trim() !== "" ? dir : void 0;
  } catch {
    return void 0;
  }
}

// src/assets/authorize.ts
function isAuthorized(target, roots) {
  if (typeof target !== "string" || target.trim() === "") return false;
  if (target.includes("\0")) return false;
  const abs = canonical(target).toLowerCase();
  return roots.some((root) => {
    const base = root.path.toLowerCase();
    return abs === base || abs.startsWith(base.endsWith(path10.sep) ? base : base + path10.sep);
  });
}

// src/assets/roots.ts
import fs10 from "node:fs";
import path11 from "node:path";
var rootsCache = { at: 0, key: "", value: [] };
function rootsOf(ctx, settings) {
  const cacheKey = settings.roots.join("|");
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
  const seen = /* @__PURE__ */ new Set();
  const roots = [];
  for (const candidate of candidates) {
    const abs = canonical(candidate.path);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let exists = false;
    try {
      exists = fs10.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path11.basename(abs) || abs, kind: candidate.kind });
  }
  rootsCache = { at: now, key: cacheKey, value: roots };
  return roots;
}

// src/assets/scan-cache.ts
var scanCache = /* @__PURE__ */ new Map();
var MAX_ENTRIES = 64;
function scanRoot(root, settings, force) {
  const key = `${root}|${settings.maxDepth}|${settings.maxItems}|${settings.includeHidden}`;
  const now = Date.now();
  if (!force && settings.cacheMs > 0) {
    const hit = scanCache.get(key);
    if (hit !== void 0 && now - hit.at < settings.cacheMs) return hit.value;
  }
  const value = collectImages(root, settings);
  scanCache.set(key, { at: now, value });
  if (scanCache.size > MAX_ENTRIES) {
    const oldest = [...scanCache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest !== void 0) scanCache.delete(oldest[0]);
  }
  return value;
}
function clearScanCache() {
  scanCache.clear();
}

// src/assets/service.ts
import fs12 from "node:fs";
import path13 from "node:path";

// src/assets/dedupe.ts
function duplicateKey(item) {
  if (typeof item.seed !== "number") return void 0;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim().slice(0, 160) : "";
  if (prompt === "") return void 0;
  return `${item.seed}|${item.width ?? 0}x${item.height ?? 0}|${prompt}`;
}
function dedupeItems(items) {
  const groups = /* @__PURE__ */ new Map();
  const order = [];
  for (const item of items) {
    const key = duplicateKey(item);
    if (key === void 0) {
      order.push({ item, group: void 0 });
      continue;
    }
    let group = groups.get(key);
    if (group === void 0) {
      group = { items: [] };
      groups.set(key, group);
      order.push({ item, group });
    }
    group.items.push(item);
  }
  const emitted = /* @__PURE__ */ new Set();
  const result = [];
  for (const entry of order) {
    if (entry.group === void 0) {
      result.push(entry.item);
      continue;
    }
    if (emitted.has(entry.group)) continue;
    emitted.add(entry.group);
    const sorted = entry.group.items.slice().sort((a, b) => {
      const bySource = (a.metaSource === "sidecar" ? 0 : 1) - (b.metaSource === "sidecar" ? 0 : 1);
      if (bySource !== 0) return bySource;
      const byDepth = a.path.length - b.path.length;
      if (byDepth !== 0) return byDepth;
      return b.mtime - a.mtime;
    });
    const first = sorted[0];
    if (first === void 0) continue;
    const primary = { ...first };
    if (sorted.length > 1) {
      primary.duplicateCount = sorted.length;
      primary.duplicates = sorted.slice(1, 21).map((other) => other.path);
    }
    result.push(primary);
  }
  return result;
}

// src/assets/thumbs.ts
import crypto2 from "node:crypto";
import fs11 from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path12 from "node:path";
import { pathToFileURL } from "node:url";
var THUMB_EDGE = 360;
var sharpPromise = null;
function tryImportSharp() {
  const specifier = "sharp";
  return import(
    /* @vite-ignore */
    specifier
  ).then((mod) => {
    const bag = mod;
    return bag.default ?? mod;
  }).catch(async () => {
    const bases = [];
    if (typeof process.env.DSH_PROFILE_DIR === "string" && process.env.DSH_PROFILE_DIR !== "") {
      bases.push(process.env.DSH_PROFILE_DIR);
    }
    const home = homeDir();
    if (home !== "") bases.push(path12.join(home, ".dsh", "profiles"));
    bases.push(path12.join(path12.dirname(process.execPath), "node_modules", "@deepseek-ai", "dsh"));
    for (const base of bases) {
      try {
        const req = createRequire(path12.join(base, "package.json"));
        const resolved = req.resolve("sharp");
        const mod = await import(pathToFileURL(resolved).href);
        return mod.default ?? mod;
      } catch {
      }
    }
    return null;
  });
}
function loadSharp() {
  if (sharpPromise === null) sharpPromise = tryImportSharp();
  return sharpPromise;
}
function thumbDir() {
  return path12.join(os.tmpdir(), "dsh-comfyui-workbench-thumbs");
}
function thumbPathFor(target, stat) {
  const key = crypto2.createHash("sha1").update(`${target.toLowerCase()}|${stat.mtimeMs}|${stat.size}|${THUMB_EDGE}`).digest("hex");
  return path12.join(thumbDir(), `${key}.webp`);
}
async function ensureThumb(target, stat) {
  const sharp = await loadSharp();
  if (sharp === null) return void 0;
  const dir = thumbDir();
  const file = thumbPathFor(target, stat);
  try {
    if (fs11.statSync(file).size > 0) return file;
  } catch {
  }
  try {
    fs11.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await sharp(target, { animated: false, limitInputPixels: 268435456 }).rotate().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(temp);
    fs11.renameSync(temp, file);
    return file;
  } catch {
    return void 0;
  }
}

// src/assets/service.ts
var UnknownRootError = class extends Error {
  constructor() {
    super("\u8FD9\u4E2A\u6839\u76EE\u5F55\u4E0D\u5728\u8D44\u4EA7\u5E93\u7684\u767D\u540D\u5355\u91CC\u3002");
    this.name = "UnknownRootError";
  }
};
function queryItems(roots, settings, query) {
  if (roots.length === 0) {
    return { total: 0, merged: false, offset: query.offset, limit: query.limit, truncated: false, items: [] };
  }
  const targets = query.root === "all" ? roots : roots.filter((root) => root.path === query.root);
  if (targets.length === 0) throw new UnknownRootError();
  let truncated = false;
  const merged = [];
  for (const root of targets) {
    const scanned = scanRoot(root.path, settings, query.refresh);
    truncated = truncated || scanned.truncated;
    for (const file of scanned.files) merged.push({ file, label: root.label });
  }
  merged.sort((a, b) => b.file.mtime - a.file.mtime);
  const items = [];
  for (const { file, label } of merged) {
    if (!query.all && file.generated !== true) continue;
    const item = toListItem(file, label);
    if (!query.all && item.hasMeta !== true) continue;
    if (query.q !== "") {
      const haystack = `${item.name} ${item.prompt ?? ""} ${item.negativePrompt ?? ""}`.toLowerCase();
      if (!haystack.includes(query.q)) continue;
    }
    items.push(item);
  }
  const visible = query.dedupe ? dedupeItems(items) : items;
  return {
    total: visible.length,
    merged: query.dedupe,
    offset: query.offset,
    limit: query.limit,
    truncated,
    items: visible.slice(query.offset, query.offset + query.limit)
  };
}
function deleteOne(target, roots) {
  if (!isAuthorized(target, roots)) {
    return { target, removed: [], error: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u5728\u8D44\u4EA7\u5E93\u7684\u767D\u540D\u5355\u91CC\u3002", code: "forbidden" };
  }
  if (!IMAGE_EXTS.has(path13.extname(target).toLowerCase())) {
    return { target, removed: [], error: "\u53EA\u80FD\u5220\u9664\u56FE\u7247\uFF0C\u8DEF\u5F84\u770B\u8D77\u6765\u4E0D\u662F\u56FE\u7247\u3002", code: "not-an-image" };
  }
  let stat;
  try {
    stat = fs12.statSync(target);
  } catch {
    return { target, removed: [], error: "\u6587\u4EF6\u5DF2\u7ECF\u4E0D\u5728\u4E86\u3002", code: "missing" };
  }
  if (!stat.isFile()) {
    return { target, removed: [], error: "\u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6\u3002", code: "not-a-file" };
  }
  const sidecar = `${target}.json`;
  const thumb = thumbPathFor(target, stat);
  const removed = [];
  try {
    fs12.unlinkSync(target);
    removed.push(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { target, removed, error: `\u5220\u9664\u5931\u8D25\uFF1A${message}`, code: "delete-failed" };
  }
  try {
    if (fs12.existsSync(sidecar)) {
      fs12.unlinkSync(sidecar);
      removed.push(sidecar);
    }
  } catch {
  }
  try {
    fs12.unlinkSync(thumb);
  } catch {
  }
  return { target, removed };
}
function deleteMany(paths, roots) {
  const removed = [];
  const failed = [];
  for (const one of paths) {
    const result = deleteOne(one, roots);
    if (result.error !== void 0) {
      failed.push({ path: one, error: result.code ?? "unknown", message: result.error });
    } else {
      removed.push(...result.removed);
    }
  }
  return { removed, failed };
}
function collectWorkflows(paths, roots, readFullSidecar2) {
  const entries = [];
  const used = /* @__PURE__ */ new Set();
  let skipped = 0;
  for (const one of paths) {
    if (!isAuthorized(one, roots)) {
      skipped += 1;
      continue;
    }
    const meta = readFullSidecar2(one);
    const workflow = meta?.workflow;
    if (workflow === void 0 || workflow === null) {
      skipped += 1;
      continue;
    }
    const base = path13.basename(one, path13.extname(one));
    let name2 = `${base}.workflow.json`;
    for (let i = 2; used.has(name2); i += 1) name2 = `${base}-${i}.workflow.json`;
    used.add(name2);
    entries.push({ name: name2, data: Buffer.from(`${JSON.stringify(workflow, null, 2)}
`, "utf8") });
  }
  return { entries, skipped };
}

// src/assets/zip.ts
var CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = (c & 1) !== 0 ? 3988292384 ^ c >>> 1 : c >>> 1;
    table[n] = c;
  }
  return table;
})();
function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = crc >>> 8 ^ (CRC_TABLE[(crc ^ (buffer[i] ?? 0)) & 255] ?? 0);
  }
  return (crc ^ -1) >>> 0;
}
function buildZip(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name2 = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(67324752, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(2048, 6);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name2.length, 26);
    locals.push(local, name2, entry.data);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(33639248, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(2048, 8);
    header.writeUInt32LE(crc, 16);
    header.writeUInt32LE(entry.data.length, 20);
    header.writeUInt32LE(entry.data.length, 24);
    header.writeUInt16LE(name2.length, 28);
    header.writeUInt32LE(offset, 42);
    central.push(header, name2);
    offset += local.length + name2.length + entry.data.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(101010256, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

// src/http/respond.ts
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}
async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 512 * 1024) throw new Error("\u8BF7\u6C42\u4F53\u8D85\u8FC7 512KB");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}
function pathsFromBody(body, limit) {
  const raw = body.paths;
  if (!Array.isArray(raw)) return void 0;
  const paths = raw.filter((item) => typeof item === "string" && item !== "");
  if (paths.length === 0 || paths.length > limit) return void 0;
  return paths;
}

// src/run/runner.ts
import crypto3 from "node:crypto";
import fs13 from "node:fs";
import path14 from "node:path";

// src/workflow/variables.ts
var VariableError = class extends Error {
  code;
  detail;
  constructor(code, message, detail = {}) {
    super(message);
    this.name = "VariableError";
    this.code = code;
    this.detail = detail;
  }
};
function substitute(value, bag) {
  if (typeof value === "string") {
    const exact = /^\{\{(\w+)\}\}$/.exec(value);
    if (exact !== null) {
      const name2 = exact[1];
      if (name2 !== void 0 && name2 in bag) return bag[name2];
      return value;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (match, name2) => name2 in bag ? String(bag[name2]) : match);
  }
  if (Array.isArray(value)) return value.map((item) => substitute(item, bag));
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [key, inner] of Object.entries(value)) out[key] = substitute(inner, bag);
    return out;
  }
  return value;
}
function setByBind(workflow, bind, value) {
  const parts = bind.split(".");
  if (parts.length !== 3 || parts[1] !== "inputs") return false;
  const nodeId = parts[0];
  const key = parts[2];
  if (nodeId === void 0 || key === void 0) return false;
  const node = workflow[nodeId];
  if (node === void 0 || node.inputs === null || typeof node.inputs !== "object") return false;
  node.inputs[key] = value;
  return true;
}
function coerce(slot, value) {
  if (slot.type === "number") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
    throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u9700\u8981\u6570\u5B57\uFF0C\u6536\u5230 ${JSON.stringify(value)}\u3002`, { slot: slot.name });
  }
  if (slot.type === "boolean") {
    if (typeof value === "boolean") return value;
    throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u9700\u8981 true / false\uFF0C\u6536\u5230 ${JSON.stringify(value)}\u3002`, { slot: slot.name });
  }
  if (slot.type === "enum") {
    const text3 = String(value);
    if (slot.options !== void 0 && slot.options.length > 0 && !slot.options.includes(text3)) {
      throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u53EA\u63A5\u53D7\uFF1A${slot.options.join(" / ")}\u3002`, { slot: slot.name });
    }
    return text3;
  }
  if (slot.type === "image" || slot.type === "mask") {
    if (typeof value !== "string" || value.trim() === "") {
      throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u9700\u8981\u56FE\u7247\u8DEF\u5F84\u3002`, { slot: slot.name });
    }
    return value;
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u9700\u8981\u5B57\u7B26\u4E32\uFF0C\u6536\u5230 ${JSON.stringify(value)}\u3002`, { slot: slot.name });
}
function applyVariables(workflow, slots, vars) {
  const copy = structuredClone(workflow);
  const effective = {};
  const known = new Set(slots.map((slot) => slot.name));
  const unknown = Object.keys(vars).filter((key) => !known.has(key));
  if (unknown.length > 0) {
    throw new VariableError("variable_unknown", `\u5DE5\u4F5C\u6D41\u6CA1\u6709\u8FD9\u4E9B\u53C2\u6570\uFF1A${unknown.join("\u3001")}\u3002`, { unknown });
  }
  const missing = [];
  for (const slot of slots) {
    const provided = vars[slot.name];
    const value = provided === void 0 ? slot.default : provided;
    if (value === void 0 || value === "") {
      if (slot.required) missing.push(slot.name);
      continue;
    }
    const coerced = coerce(slot, value);
    effective[slot.name] = coerced;
    if (slot.bind !== void 0) setByBind(copy, slot.bind, coerced);
  }
  if (missing.length > 0) {
    throw new VariableError("variable_unbound", `\u7F3A\u5C11\u5FC5\u586B\u53C2\u6570\uFF1A${missing.join("\u3001")}\u3002`, { missing });
  }
  return { workflow: substitute(copy, effective), effective };
}

// src/run/runner.ts
function requiredNodes(workflow) {
  const set = /* @__PURE__ */ new Set();
  for (const node of Object.values(workflow)) {
    if (node !== null && typeof node === "object" && typeof node.class_type === "string" && node.class_type !== "") {
      set.add(node.class_type);
    }
  }
  return [...set];
}
function fileRefsOf(outputs) {
  const found = [];
  if (outputs === void 0) return found;
  for (const [nodeId, bag] of Object.entries(outputs)) {
    if (bag === null || typeof bag !== "object") continue;
    for (const value of Object.values(bag)) {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) {
        if (item === null || typeof item !== "object") continue;
        const bag2 = item;
        if (typeof bag2.filename !== "string" || bag2.filename === "") continue;
        found.push({
          nodeId,
          ref: {
            filename: bag2.filename,
            ...typeof bag2.subfolder === "string" ? { subfolder: bag2.subfolder } : {},
            ...typeof bag2.type === "string" ? { type: bag2.type } : {}
          }
        });
      }
    }
  }
  return found;
}
function mimeOf2(file) {
  const ext = path14.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}
function targetFor(outputDir, filename) {
  const safe = path14.basename(filename);
  const first = path14.join(outputDir, safe);
  if (!fs13.existsSync(first)) return first;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return path14.join(outputDir, `${stamp}-${safe}`);
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function runWorkflow(options) {
  const { client, slots, vars, outputDir, timeoutMs, pollIntervalMs } = options;
  const notes = [];
  const startedAt = Date.now();
  let applied;
  try {
    applied = applyVariables(options.workflow, slots, vars);
  } catch (error) {
    if (error instanceof VariableError) {
      throw new RunError(error.code, error.message, "\u68C0\u67E5\u53C2\u6570\u540D\u4E0E\u7C7B\u578B\uFF1B\u4E0D\u8BA4\u8BC6\u7684\u53C2\u6570\u4E0D\u4F1A\u88AB\u9759\u9ED8\u5FFD\u7565\u3002", error.detail);
    }
    throw asRunError(error, "workflow_invalid");
  }
  options.onStage?.("preflight");
  const info = await client.objectInfo();
  const known = new Set(Object.keys(info));
  if (known.size > 0) {
    const missing = requiredNodes(applied.workflow).filter((name2) => !known.has(name2));
    if (missing.length > 0) throw nodeMissing(missing);
  } else {
    notes.push("/object_info \u4E3A\u7A7A\uFF0C\u8DF3\u8FC7\u8282\u70B9\u9884\u68C0\uFF08\u53EF\u80FD\u662F\u521A\u542F\u52A8\u7684 ComfyUI\uFF09\u3002");
  }
  const promptId = await client.queuePrompt(applied.workflow);
  options.onStage?.("queued");
  options.onStage?.("running");
  const deadline = startedAt + timeoutMs;
  let entry;
  let done = false;
  while (!done) {
    if (Date.now() > deadline) {
      await client.interrupt();
      throw timedOut(Date.now() - startedAt, promptId);
    }
    await sleep(pollIntervalMs);
    entry = await client.history(promptId);
    if (entry === void 0) continue;
    const status = entry.status;
    if (status?.status_str === "error") throw executionFailed(entry, promptId);
    const hasOutputs = entry.outputs !== void 0 && Object.keys(entry.outputs).length > 0;
    if (status?.completed === true || hasOutputs) done = true;
  }
  options.onStage?.("fetching");
  const refs = fileRefsOf(entry?.outputs);
  if (refs.length === 0) throw noOutput(true);
  ensureDir(outputDir);
  const artifacts = [];
  for (const { ref } of refs) {
    let bytes;
    try {
      bytes = await client.view(ref);
    } catch (error) {
      throw outputUnreadable(ref.filename, error);
    }
    const target = targetFor(outputDir, ref.filename);
    fs13.writeFileSync(target, bytes);
    const digest = digestOf(bytes);
    const artifact = {
      path: target,
      digest,
      mime: mimeOf2(target),
      bytes: bytes.length
    };
    if (path14.extname(target).toLowerCase() === ".png") {
      const parsed = readPngTextChunks(target, bytes.length);
      if (parsed !== void 0 && parsed.width > 0 && parsed.height > 0) {
        artifact.width = parsed.width;
        artifact.height = parsed.height;
      }
    }
    artifacts.push(artifact);
  }
  const durationMs = Date.now() - startedAt;
  let metadataPath;
  const primary = artifacts[0];
  if (options.writeMetadata !== false && primary !== void 0) {
    metadataPath = `${primary.path}.json`;
    const meta = {
      plugin: "dsh-comfyui-workbench",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      workflowId: options.workflowId,
      workflowHash: options.workflowHash,
      vars: applied.effective,
      prompt: typeof applied.effective.prompt === "string" ? applied.effective.prompt : void 0,
      negativePrompt: typeof applied.effective.negative_prompt === "string" ? applied.effective.negative_prompt : void 0,
      seed: typeof applied.effective.seed === "number" ? applied.effective.seed : void 0,
      width: primary.width,
      height: primary.height,
      durationMs,
      artifacts: artifacts.map((item) => ({ path: item.path, digest: item.digest, bytes: item.bytes })),
      comfy: { url: client.baseUrl, promptId },
      notes,
      workflow: applied.workflow
    };
    try {
      fs13.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}
`, "utf8");
    } catch {
      metadataPath = void 0;
      notes.push("sidecar \u5199\u5165\u5931\u8D25\uFF08\u4EA7\u7269\u5DF2\u5B58\u5728\uFF0C\u4EC5\u7F3A\u5143\u6570\u636E\uFF09\u3002");
    }
  }
  return { promptId, artifacts, durationMs, effective: applied.effective, notes, ...metadataPath === void 0 ? {} : { metadataPath } };
}
function digestOf(bytes) {
  return crypto3.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}

// src/workflow/detect.ts
function detectFormat(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return "invalid";
  const bag = value;
  if (Array.isArray(bag.nodes) && Array.isArray(bag.links)) return "ui";
  const entries = Object.entries(bag);
  if (entries.length === 0) return "invalid";
  let nodeLike = 0;
  for (const [, node] of entries) {
    if (node === null || typeof node !== "object") continue;
    const candidate = node;
    if (typeof candidate.class_type === "string" && candidate.inputs !== null && typeof candidate.inputs === "object") {
      nodeLike += 1;
    }
  }
  return nodeLike > 0 && nodeLike === entries.length ? "api" : "invalid";
}

// src/workflow/infer.ts
var INTERNAL_INPUT = [
  /^(ckpt_name|unet_name|model_name|lora_name|vae_name|control_net_name|clip_name|style_model_name)$/i,
  /^(vae|clip|batch_size|filename_prefix|sampler_state|widgets_values|noise_seed_offset)$/i,
  /^(save_prefix|save_to_comfyui|output_dir)$/i
];
function isLink(value) {
  return Array.isArray(value) && value.length === 2 && typeof value[1] === "number" && (typeof value[0] === "string" || typeof value[0] === "number");
}
function nodesOf(workflow) {
  const out = [];
  for (const [id, node] of Object.entries(workflow)) {
    if (node === null || typeof node !== "object") continue;
    if (typeof node.class_type !== "string") continue;
    if (node.inputs === null || typeof node.inputs !== "object") continue;
    out.push([id, node]);
  }
  return out;
}
function titleOf(node) {
  const title = node._meta !== void 0 && node._meta !== null ? node._meta.title : void 0;
  if (typeof title === "string" && title.trim() !== "") return title;
  return typeof node.class_type === "string" ? node.class_type : "node";
}
function traceText(byId, link, depth = 0) {
  if (depth > 3 || !isLink(link)) return void 0;
  const node = byId.get(String(link[0]));
  if (node === void 0) return void 0;
  for (const [key, value] of Object.entries(node.inputs)) {
    if (typeof value === "string" && value.trim() !== "" && /^(text|prompt|text_g|text_l|positive)$/i.test(key)) {
      return { nodeId: String(link[0]), key };
    }
  }
  for (const value of Object.values(node.inputs)) {
    if (isLink(value)) {
      const found = traceText(byId, value, depth + 1);
      if (found !== void 0) return found;
    }
  }
  return void 0;
}
function imageKindOf(key, value) {
  const nameHit = /(input_?image|image|mask|init_image|reference)/i.test(key);
  const pathHit = typeof value === "string" && /\.(png|jpe?g|webp|bmp|gif|avif)$/i.test(value);
  if (!nameHit && !pathHit) return void 0;
  return /mask/i.test(key) ? "mask" : "image";
}
function typeOf(key, value) {
  const image = imageKindOf(key, value);
  if (image !== void 0) return image;
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return void 0;
}
var MODEL_RULES = [
  { pattern: /checkpoint/i, fields: ["ckpt_name"], kind: "checkpoint" },
  { pattern: /(unet|diffusion)/i, fields: ["unet_name", "model_name"], kind: "diffusion" },
  { pattern: /lora/i, fields: ["lora_name"], kind: "lora" },
  { pattern: /vae/i, fields: ["vae_name"], kind: "vae" },
  { pattern: /upscale/i, fields: ["model_name"], kind: "upscale" }
];
var MODEL_EXT = /\.(safetensors|ckpt|pt|pth|gguf|bin)$/i;
function inferModels(nodes) {
  const found = [];
  for (const [id, node] of nodes) {
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    const rule = MODEL_RULES.find((entry) => entry.pattern.test(classType));
    for (const key of rule?.fields ?? []) {
      const value = node.inputs[key];
      if (typeof value === "string" && value !== "") {
        found.push({ name: value, kind: rule?.kind ?? "other", nodeId: id });
        break;
      }
    }
    if (rule !== void 0) continue;
    for (const [key, value] of Object.entries(node.inputs)) {
      if (/(ckpt|checkpoint|unet|model|lora|vae).*name$/i.test(key) && typeof value === "string" && MODEL_EXT.test(value)) {
        found.push({ name: value, kind: "other", nodeId: id });
        break;
      }
    }
  }
  const primary = found.find((entry) => entry.kind === "checkpoint") ?? found.find((entry) => entry.kind === "diffusion") ?? found[0];
  if (primary !== void 0) primary.primary = true;
  const seen = /* @__PURE__ */ new Set();
  return found.filter((entry) => {
    const key = `${entry.kind}|${entry.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function referencedIds(nodes) {
  const used = /* @__PURE__ */ new Set();
  for (const [, node] of nodes) {
    for (const value of Object.values(node.inputs)) {
      if (isLink(value)) used.add(String(value[0]));
    }
  }
  return used;
}
function outputKindOf(classType) {
  if (/video|animated|gif|mp4|webm|h264/i.test(classType)) return "video";
  if (/audio|sound|wave|mp3|flac/i.test(classType)) return "audio";
  if (/image|png|jpeg|webp|preview|save/i.test(classType)) return "image";
  return "file";
}
function inferOutputs(nodes, notes) {
  const used = referencedIds(nodes);
  const terminals = nodes.filter(([id]) => !used.has(id));
  const outputs = [];
  for (const [id, node] of terminals) {
    const classType = typeof node.class_type === "string" ? node.class_type : "";
    if (/loader|encode|sampler|conditioning|lora|vae|clip/i.test(classType) && !/save|preview/i.test(classType)) continue;
    outputs.push({ nodeId: id, key: "images", kind: outputKindOf(classType), count: "dynamic", label: titleOf(node) });
  }
  if (outputs.length === 0) {
    notes.push("\u6CA1\u6709\u8BC6\u522B\u51FA\u672B\u7AEF\u8F93\u51FA\u8282\u70B9\uFF1A\u6A21\u677F\u53EF\u80FD\u7F3A\u5C11 SaveImage / PreviewImage\uFF0C\u8FD0\u884C\u540E\u53EF\u80FD\u62FF\u4E0D\u5230\u4EA7\u7269\u3002");
  }
  return outputs;
}
function inferSurface(workflow, extraInternal = []) {
  const nodes = nodesOf(workflow);
  const notes = [];
  const byId = new Map(nodes.map(([id, node]) => [id, node]));
  const sampler = nodes.find(
    ([, node]) => /sampler/i.test(String(node.class_type)) && node.inputs.positive !== void 0 && node.inputs.negative !== void 0
  );
  const positive = sampler === void 0 ? void 0 : traceText(byId, sampler[1].inputs.positive);
  const negative = sampler === void 0 ? void 0 : traceText(byId, sampler[1].inputs.negative);
  const slots = [];
  const taken = /* @__PURE__ */ new Map();
  for (const [id, node] of nodes) {
    for (const [key, value] of Object.entries(node.inputs)) {
      if (isLink(value)) continue;
      if (INTERNAL_INPUT.some((pattern) => pattern.test(key))) continue;
      if (extraInternal.includes(key)) continue;
      const type = typeOf(key, value);
      if (type === void 0) continue;
      let name2 = key;
      if (positive !== void 0 && positive.nodeId === id && positive.key === key) name2 = "prompt";
      else if (negative !== void 0 && negative.nodeId === id && negative.key === key) name2 = "negative_prompt";
      const existing = taken.get(name2);
      if (existing !== void 0) {
        if (existing.type === type && existing.default === value) continue;
        const renamed = `${name2}_${id}`;
        notes.push(`\u53C2\u6570 ${name2} \u5728\u8282\u70B9 ${id} \u4E0A\u53E6\u6709\u53D6\u503C\uFF0C\u5DF2\u91CD\u547D\u540D\u4E3A ${renamed}\u3002`);
        name2 = renamed;
      }
      const required = value === "" || value === null || value === void 0;
      const slot = {
        name: name2,
        bind: `${id}.inputs.${key}`,
        label: titleOf(node),
        type,
        required,
        group: classify(name2, type),
        ...required ? {} : { default: value }
      };
      slots.push(slot);
      taken.set(name2, slot);
    }
  }
  const basicCount = slots.filter((slot) => slot.group === "basic").length;
  if (basicCount > 3) {
    let kept = 0;
    for (const slot of slots) {
      if (slot.group !== "basic") continue;
      kept += 1;
      if (kept > 3) slot.group = "advanced";
    }
    notes.push(`\u57FA\u7840\u53C2\u6570\u8D85\u8FC7 3 \u4E2A\uFF0C\u5176\u4F59 ${basicCount - 3} \u4E2A\u5DF2\u6298\u8FDB"\u66F4\u591A\u53C2\u6570"\u3002`);
  }
  return { slots, models: inferModels(nodes), outputs: inferOutputs(nodes, notes), notes };
}
function classify(name2, type) {
  if (type === "image" || type === "mask") return "basic";
  if (type === "string" && /^(prompt|negative_prompt|text)$/i.test(name2)) return "basic";
  return "advanced";
}

// src/workflow/surface.ts
import crypto4 from "node:crypto";
function hashWorkflow(workflow) {
  return crypto4.createHash("sha256").update(JSON.stringify(workflow)).digest("hex");
}
function mergeSlot(base, override) {
  const merged = { ...base, ...override, name: override.name };
  if (override.bind === void 0 && base.bind !== void 0) merged.bind = base.bind;
  return merged;
}
function extraSlots(slots, schema) {
  if (schema?.vars === void 0) return slots;
  const known = new Set(slots.map((slot) => slot.name));
  const out = [...slots];
  for (const declared of schema.vars) {
    if (known.has(declared.name)) continue;
    out.push({
      name: declared.name,
      label: declared.label ?? declared.name,
      type: declared.type ?? "string",
      required: declared.required ?? false,
      group: declared.group ?? "advanced",
      ...declared.bind === void 0 ? {} : { bind: declared.bind },
      ...declared.default === void 0 ? {} : { default: declared.default },
      ...declared.options === void 0 ? {} : { options: declared.options },
      ...declared.min === void 0 ? {} : { min: declared.min },
      ...declared.max === void 0 ? {} : { max: declared.max },
      ...declared.step === void 0 ? {} : { step: declared.step },
      ...declared.hint === void 0 ? {} : { hint: declared.hint },
      ...declared.secret === void 0 ? {} : { secret: declared.secret }
    });
  }
  return out;
}
function mergeModels(inferred, schema) {
  const declared = schema?.models;
  if (declared === void 0 || declared.length === 0) return inferred;
  const out = declared.map((entry) => ({
    name: entry.name,
    kind: entry.kind ?? "other",
    nodeId: entry.nodeId ?? "",
    ...entry.primary === void 0 ? {} : { primary: entry.primary }
  }));
  if (!out.some((entry) => entry.primary === true) && out.length > 0 && out[0] !== void 0) out[0].primary = true;
  return out;
}
function buildSurface(input) {
  const { workflowId, workflow, schema, meta } = input;
  const inferred = inferSurface(workflow, schema?.internalInputs ?? []);
  const declared = schema?.vars ?? [];
  const slots = extraSlots(inferred.slots, schema).map((slot) => {
    const override = declared.find((entry) => entry.name === slot.name);
    return override === void 0 ? slot : mergeSlot(slot, override);
  });
  return {
    workflowId,
    title: meta?.title ?? schema?.title ?? workflowId,
    description: meta?.description ?? schema?.description ?? "",
    workflowHash: hashWorkflow(workflow),
    models: mergeModels(inferred.models, schema),
    inputs: slots,
    outputs: inferred.outputs,
    meta: {
      nodeCount: Object.keys(workflow).length,
      missingNodes: [],
      source: declared.length > 0 ? "declared" : "inferred"
    }
  };
}

// src/workflow/store.ts
import fs14 from "node:fs";
import path15 from "node:path";
function pathsOf(dir, id) {
  return {
    workflow: path15.join(dir, `${id}.json`),
    schema: path15.join(dir, `${id}.schema.json`),
    meta: path15.join(dir, `${id}.meta.json`)
  };
}
function readJson(file) {
  try {
    const parsed = JSON.parse(fs14.readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function listWorkflowIds(dir) {
  let names;
  try {
    names = fs14.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name2) => name2.endsWith(".json") && !name2.endsWith(".schema.json") && !name2.endsWith(".meta.json")).map((name2) => name2.slice(0, -".json".length)).sort();
}
function readEntry(dir, id) {
  const files = pathsOf(dir, id);
  const workflow = readJson(files.workflow);
  if (workflow === void 0) return void 0;
  if (detectFormat(workflow) !== "api") return void 0;
  const schema = readJson(files.schema);
  const meta = readJson(files.meta);
  return { id, workflow, schema, meta, surface: buildSurface({ workflowId: id, workflow, schema, meta }) };
}
function listEntries(dir) {
  const entries = [];
  const broken = [];
  for (const id of listWorkflowIds(dir)) {
    const entry = readEntry(dir, id);
    if (entry === void 0) broken.push(id);
    else entries.push(entry);
  }
  return { entries, broken };
}
function writeWorkflow(dir, id, workflow) {
  ensureDir(dir);
  fs14.writeFileSync(pathsOf(dir, id).workflow, `${JSON.stringify(workflow, null, 2)}
`, "utf8");
}
function writeMeta(dir, id, meta) {
  ensureDir(dir);
  const merged = {
    ...meta,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs14.writeFileSync(pathsOf(dir, id).meta, `${JSON.stringify(merged, null, 2)}
`, "utf8");
}

// src/http/run-api.ts
function createRunHandler(deps) {
  return async (_url, res, req) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const workflowId = typeof body.workflowId === "string" ? body.workflowId.trim() : "";
    if (workflowId === "") {
      sendJson(res, 400, { ok: false, error: "bad-body", message: "\u9700\u8981 workflowId\u3002" });
      return;
    }
    const entry = readEntry(deps.workflowDir, workflowId);
    if (entry === void 0) {
      sendJson(res, 404, { ok: false, error: "no-workflow", message: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${workflowId}` });
      return;
    }
    const vars = body.vars !== null && typeof body.vars === "object" && !Array.isArray(body.vars) ? body.vars : {};
    const outputPath = typeof body.outputPath === "string" && body.outputPath.trim() !== "" ? body.outputPath.trim() : deps.settings.outputDir ?? process.cwd();
    const timeoutMs = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) ? Math.min(36e5, Math.max(1e3, Math.round(body.timeoutMs))) : deps.settings.timeoutMs;
    try {
      const outcome = await runWorkflow({
        client: deps.client,
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs,
        pollIntervalMs: deps.settings.pollIntervalMs,
        workflowId,
        workflowHash: entry.surface.workflowHash
      });
      sendJson(res, 200, {
        ok: true,
        promptId: outcome.promptId,
        durationMs: outcome.durationMs,
        artifacts: outcome.artifacts,
        effectiveVars: outcome.effective,
        notes: outcome.notes
      });
    } catch (error) {
      const bag = error !== null && typeof error === "object" ? error : null;
      sendJson(res, 200, {
        ok: false,
        code: typeof bag?.code === "string" ? bag.code : "execution_failed",
        message: error instanceof Error ? error.message : String(error),
        ...typeof bag?.hint === "string" ? { hint: bag.hint } : {}
      });
    }
  };
}

// src/http/service-api.ts
function handleServiceStatus(supervisor, _url, res) {
  sendJson(res, 200, { ok: true, service: supervisor.status() });
}
function handleServiceStop(supervisor, _url, res) {
  const stopped = supervisor.stop();
  sendJson(res, 200, {
    ok: true,
    stopped,
    service: supervisor.status(),
    ...stopped ? {} : { message: "\u6CA1\u6709\u672C\u63D2\u4EF6\u62C9\u8D77\u7684\u8FDB\u7A0B\uFF0C\u672A\u505C\u6B62\u4EFB\u4F55\u4E1C\u897F\u3002" }
  });
}

// src/http/workflows-api.ts
function toListItem2(surface) {
  const primary = surface.models.find((model) => model.primary === true) ?? surface.models[0];
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    undescribed: surface.description === "",
    model: primary?.name ?? "",
    modelKind: primary?.kind ?? "",
    otherModels: surface.models.filter((model) => model !== primary).map((model) => model.name),
    inputKinds: [...new Set(surface.inputs.map((slot) => slot.type))],
    inputCount: surface.inputs.length,
    basicCount: surface.inputs.filter((slot) => slot.group === "basic").length,
    outputs: surface.outputs.map((slot) => ({ kind: slot.kind, count: slot.count })),
    nodes: surface.meta.nodeCount,
    workflowHash: surface.workflowHash
  };
}
function handleWorkflowList(dir, _url, res) {
  const { entries, broken } = listEntries(dir);
  sendJson(res, 200, {
    ok: true,
    count: entries.length,
    workflows: entries.map((entry) => toListItem2(entry.surface)),
    ...broken.length > 0 ? { broken } : {}
  });
}
function handleWorkflowDetail(dir, id, res) {
  const entry = readEntry(dir, id);
  if (entry === void 0) {
    sendJson(res, 404, { ok: false, error: "no-workflow", message: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${id}` });
    return;
  }
  sendJson(res, 200, { ok: true, surface: entry.surface });
}
function workflowIdFromPath(sub) {
  const prefix = "/workflows/";
  if (!sub.startsWith(prefix)) return void 0;
  const rest = sub.slice(prefix.length);
  if (rest === "" || rest.includes("/")) return void 0;
  try {
    return decodeURIComponent(rest);
  } catch {
    return void 0;
  }
}

// src/http/router.ts
var PREFIX = "/comfyui-workbench/api";
var WRITABLE = /* @__PURE__ */ new Set(["/delete", "/delete-many", "/assets/rebuild", "/run", "/service/stop"]);
var POST_ONLY = /* @__PURE__ */ new Set(["/run"]);
function createHandler(ctx, settings, index, workflowDir, client, supervisor) {
  const roots = () => rootsOf(ctx, settings);
  const handleRoots = (_url, res) => {
    const list = roots();
    sendJson(res, 200, { ok: true, roots: list.map((root) => ({ ...root, id: root.path })) });
  };
  const handleItems = (url, res) => {
    const list = roots();
    if (list.length === 0) {
      sendJson(res, 200, { ok: true, items: [], total: 0, truncated: false, roots: [] });
      return;
    }
    const query = {
      root: url.searchParams.get("root") ?? "all",
      q: (url.searchParams.get("q") ?? "").trim().toLowerCase(),
      all: url.searchParams.get("all") === "1",
      refresh: url.searchParams.get("refresh") === "1",
      dedupe: url.searchParams.get("dedupe") !== "0",
      offset: Math.max(0, Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0),
      limit: Math.min(500, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "60", 10) || 60))
    };
    try {
      const page = queryItems(list, settings, query);
      sendJson(res, 200, { ok: true, ...page });
    } catch (error) {
      if (error instanceof UnknownRootError) {
        sendJson(res, 400, { ok: false, error: "unknown-root", message: error.message });
        return;
      }
      throw error;
    }
  };
  const handleMeta = (url, res) => {
    const target = url.searchParams.get("path") ?? "";
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: "forbidden", message: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u5728\u8D44\u4EA7\u5E93\u7684\u767D\u540D\u5355\u91CC\u3002" });
      return;
    }
    const meta = readFullSidecar(target);
    if (meta === void 0) {
      sendJson(res, 404, { ok: false, error: "no-metadata", message: "\u8FD9\u5F20\u56FE\u7247\u6CA1\u6709\u53EF\u8BFB\u7684\u5143\u6570\u636E\uFF08sidecar\uFF09\u3002" });
      return;
    }
    sendJson(res, 200, { ok: true, meta });
  };
  const handleWorkflow = (url, res) => {
    const target = url.searchParams.get("path") ?? "";
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: "forbidden", message: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u5728\u8D44\u4EA7\u5E93\u7684\u767D\u540D\u5355\u91CC\u3002" });
      return;
    }
    const meta = readFullSidecar(target);
    const workflow = meta?.workflow;
    if (workflow === void 0 || workflow === null) {
      sendJson(res, 404, { ok: false, error: "no-workflow", message: "\u8FD9\u5F20\u56FE\u7247\u6CA1\u6709\u8BB0\u5F55\u5DE5\u4F5C\u6D41\u3002" });
      return;
    }
    const body = `${JSON.stringify(workflow, null, 2)}
`;
    const filename = `${path16.basename(target, path16.extname(target))}.workflow.json`;
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Content-Disposition": `attachment; filename="${filename.replace(/["\\]/g, "_")}"`,
      "Cache-Control": "no-store"
    });
    res.end(body);
  };
  const handleFile = async (url, res) => {
    const target = url.searchParams.get("path") ?? "";
    if (!isAuthorized(target, roots())) {
      sendJson(res, 403, { ok: false, error: "forbidden", message: "\u8FD9\u4E2A\u8DEF\u5F84\u4E0D\u5728\u8D44\u4EA7\u5E93\u7684\u767D\u540D\u5355\u91CC\u3002" });
      return;
    }
    let stat;
    try {
      stat = fs15.statSync(target);
    } catch {
      sendJson(res, 404, { ok: false, error: "missing", message: "\u6587\u4EF6\u5DF2\u7ECF\u4E0D\u5728\u4E86\u3002" });
      return;
    }
    if (!stat.isFile()) {
      sendJson(res, 400, { ok: false, error: "not-a-file", message: "\u8DEF\u5F84\u4E0D\u662F\u6587\u4EF6\u3002" });
      return;
    }
    if (url.searchParams.get("thumb") === "1") {
      const thumb = await ensureThumb(target, stat);
      if (thumb !== void 0) {
        try {
          const thumbStat = fs15.statSync(thumb);
          res.writeHead(200, {
            "Content-Type": "image/webp",
            "Content-Length": thumbStat.size,
            "Cache-Control": "private, max-age=86400"
          });
          const thumbStream = fs15.createReadStream(thumb);
          thumbStream.on("error", () => {
            res.destroy();
          });
          thumbStream.pipe(res);
          return;
        } catch {
        }
      }
    }
    res.writeHead(200, {
      "Content-Type": mimeOf(target),
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=86400"
    });
    const stream = fs15.createReadStream(target);
    stream.on("error", () => {
      res.destroy();
    });
    stream.pipe(res);
  };
  const statusForCode = (code) => {
    if (code === "forbidden") return 403;
    if (code === "missing") return 404;
    if (code === "delete-failed") return 500;
    return 400;
  };
  const handleDelete = (url, res) => {
    const result = deleteOne(url.searchParams.get("path") ?? "", roots());
    if (result.error !== void 0) {
      sendJson(res, statusForCode(result.code), { ok: false, error: result.code, message: result.error });
      return;
    }
    clearScanCache();
    sendJson(res, 200, { ok: true, removed: result.removed });
  };
  const handleDeleteMany = async (_url, res, req) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const paths = pathsFromBody(body, 500);
    if (paths === void 0) {
      sendJson(res, 400, { ok: false, error: "bad-paths", message: "\u8BF7\u6C42\u91CC\u9700\u8981 1\u2013500 \u4E2A paths\u3002" });
      return;
    }
    const result = deleteMany(paths, roots());
    clearScanCache();
    sendJson(res, 200, { ok: true, ...result });
  };
  const handleWorkflows = async (_url, res, req) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const paths = pathsFromBody(body, 500);
    if (paths === void 0) {
      sendJson(res, 400, { ok: false, error: "bad-paths", message: "\u8BF7\u6C42\u91CC\u9700\u8981 1\u2013500 \u4E2A paths\u3002" });
      return;
    }
    const { entries, skipped } = collectWorkflows(paths, roots(), readFullSidecar);
    if (entries.length === 0) {
      sendJson(res, 404, { ok: false, error: "no-workflow", message: "\u9009\u4E2D\u7684\u56FE\u7247\u90FD\u6CA1\u6709\u53EF\u5BFC\u51FA\u7684\u5DE5\u4F5C\u6D41\u3002" });
      return;
    }
    const zip = buildZip(entries);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Length": zip.length,
      "Content-Disposition": `attachment; filename="comfyui-workbench-workflows-${stamp}.zip"`,
      "X-Workbench-Skipped": String(skipped),
      "Cache-Control": "no-store"
    });
    res.end(zip);
  };
  const handleAssets = (url, res) => {
    const tags = url.searchParams.getAll("tag").filter((tag) => tag !== "");
    const kindRaw = url.searchParams.get("kind") ?? "";
    const statusRaw = url.searchParams.get("status") ?? "";
    const kind = ["image", "video", "audio", "file"].includes(kindRaw) ? kindRaw : void 0;
    const status = ["present", "missing", "archived"].includes(statusRaw) ? statusRaw : void 0;
    const page = index.search({
      ...url.searchParams.get("q") === null ? {} : { q: url.searchParams.get("q") ?? "" },
      ...url.searchParams.get("workflow") === null ? {} : { workflow: url.searchParams.get("workflow") ?? "" },
      ...tags.length === 0 ? {} : { tag: tags },
      ...kind === void 0 ? {} : { kind },
      ...status === void 0 ? {} : { status },
      ...url.searchParams.get("since") === null ? {} : { since: url.searchParams.get("since") ?? "" },
      ...url.searchParams.get("until") === null ? {} : { until: url.searchParams.get("until") ?? "" },
      ...url.searchParams.get("cursor") === null ? {} : { cursor: url.searchParams.get("cursor") ?? "" },
      limit: Math.min(200, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "60", 10) || 60))
    });
    sendJson(res, 200, { ok: true, total: page.items.length, items: page.items, next: page.next ?? null });
  };
  const handleRebuild = (url, res) => {
    const list = roots();
    if (list.length === 0) {
      sendJson(res, 200, { ok: true, rebuilt: 0, roots: 0 });
      return;
    }
    const records = rebuildFromSidecars(list.map((root) => root.path), {
      maxDepth: settings.maxDepth,
      maxItems: settings.maxItems,
      includeHidden: settings.includeHidden
    });
    index.rewrite(records);
    sendJson(res, 200, { ok: true, rebuilt: records.length, roots: list.length });
  };
  const routes = {
    "/assets": handleAssets,
    "/assets/rebuild": handleRebuild,
    "/roots": handleRoots,
    "/items": handleItems,
    "/meta": handleMeta,
    "/workflow": handleWorkflow,
    "/file": handleFile,
    "/delete": handleDelete,
    "/delete-many": handleDeleteMany,
    "/run": createRunHandler({ client, workflowDir, settings }),
    "/service": handleServiceStatus.bind(null, supervisor),
    "/service/stop": handleServiceStop.bind(null, supervisor)
  };
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const sub = url.pathname.slice(PREFIX.length) || "/";
      if (sub === "/workflows") {
        if (req.method === "GET" || req.method === "HEAD") return handleWorkflowList(workflowDir, url, res);
        if (req.method === "POST") return handleWorkflows(url, res, req);
        sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "/workflows \u53EA\u63A5\u53D7 GET\uFF08\u5217\u8868\uFF09\u6216 POST\uFF08\u6279\u91CF\u5BFC\u51FA\uFF09\u3002" });
        return;
      }
      const detailId = workflowIdFromPath(sub);
      if (detailId !== void 0) {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u4E2A\u63A5\u53E3\u662F\u53EA\u8BFB\u7684\u3002" });
          return;
        }
        handleWorkflowDetail(workflowDir, detailId, res);
        return;
      }
      const writable = WRITABLE.has(sub);
      const methodOk = POST_ONLY.has(sub) ? req.method === "POST" : writable ? req.method === "POST" || req.method === "DELETE" : req.method === "GET" || req.method === "HEAD";
      if (!methodOk) {
        sendJson(res, 405, {
          ok: false,
          error: "method-not-allowed",
          message: writable ? "\u8FD9\u4E2A\u63A5\u53E3\u53EA\u63A5\u53D7 POST / DELETE\u3002" : "\u8FD9\u4E2A\u63A5\u53E3\u662F\u53EA\u8BFB\u7684\u3002"
        });
        return;
      }
      if (sub === "/") {
        sendJson(res, 200, { ok: true, plugin: "dsh-comfyui-workbench" });
        return;
      }
      const route = routes[sub];
      if (route === void 0) {
        sendJson(res, 404, { ok: false, error: "unknown-route", message: `\u6CA1\u6709\u8FD9\u4E2A\u63A5\u53E3\uFF1A${sub}` });
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

// src/tools/run.ts
import fs16 from "node:fs";
import path17 from "node:path";

// src/tools/types.ts
function jsonOutput() {
  return {
    schema: { type: "object", additionalProperties: true },
    render: (_args, value) => [
      { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }
    ]
  };
}
function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}
function asInt(value, fallback, min, max) {
  const n = typeof value === "number" ? Math.round(value) : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
function asRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// src/tools/run.ts
var MAX_INLINE_BYTES = 2 * 1024 * 1024;
var MAX_INLINE_COUNT = 3;
function isImageArtifact(artifact) {
  return artifact.mime.startsWith("image/");
}
function loadWorkflow(deps, args) {
  const spec = asRecord(args.workflow);
  const id = asString(spec.id).trim();
  if (id !== "") {
    const entry = readEntry(deps.workflowsDir, id);
    if (entry === void 0) throw new Error(`\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${id}\u3002\u5148\u7528 comfyui_workflow_list \u770B\u6709\u54EA\u4E9B\u3002`);
    return { workflowId: id, workflow: entry.workflow, surface: entry.surface };
  }
  const filePath = asString(spec.path).trim();
  if (filePath === "") throw new Error('\u9700\u8981 workflow\uFF1A{"id":"\u2026"} \u6216 {"path":"\u2026"}\u3002');
  let raw;
  try {
    raw = JSON.parse(fs16.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`\u8BFB\u4E0D\u4E86\u5DE5\u4F5C\u6D41\u6587\u4EF6\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("\u5DE5\u4F5C\u6D41\u6587\u4EF6\u4E0D\u662F JSON \u5BF9\u8C61\u3002");
  const workflow = raw;
  const workflowId = path17.basename(filePath, path17.extname(filePath));
  return { workflowId, workflow, surface: buildSurface({ workflowId, workflow }) };
}
function runTool(deps) {
  return {
    name: "comfyui_run",
    description: "\u6267\u884C\u4E00\u4E2A ComfyUI \u5DE5\u4F5C\u6D41\u3002\u53C2\u6570\u7528 vars \u4F20\uFF08\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u58F0\u660E\u8FC7\u7684\u8F93\u5165\u540D\uFF0C\u53EF\u7528 comfyui_workflow_list / inspect \u67E5\uFF09\u3002\u8FD4\u56DE\u503C\u5305\u542B\u4EA7\u7269\u8DEF\u5F84\u3001\u539F\u59CB\u50CF\u7D20\u5C3A\u5BF8\u4E0E\u56FE\u7247\u672C\u8EAB\uFF1B\u56FE\u7247\u5DF2\u7ECF\u7ED9\u4F60\u4E86\uFF0C\u4E0D\u8981\u518D read \u6587\u4EF6\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["workflow"],
      properties: {
        workflow: {
          type: "object",
          description: '\u5DE5\u4F5C\u6D41\u6807\u8BC6\uFF1A{"id":"sdxl"} \u6307\u5411\u5DE5\u4F5C\u6D41\u76EE\u5F55\uFF0C\u6216 {"path":"D:/\u67D0\u5904/workflow.json"} \u6307\u5411\u5355\u6587\u4EF6',
          properties: {
            id: { type: "string" },
            path: { type: "string" }
          }
        },
        vars: {
          type: "object",
          description: "\u53D8\u91CF\u7ED1\u5B9A\u3002\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u7684\u8F93\u5165\u540D\uFF1B\u4E0D\u8BA4\u8BC6\u7684\u952E\u4F1A\u62A5\u9519\u800C\u4E0D\u662F\u88AB\u5FFD\u7565\u3002",
          additionalProperties: true
        },
        outputPath: { type: "string", description: "\u4EA7\u7269\u843D\u76D8\u76EE\u5F55\uFF1B\u4E0D\u4F20\u7528\u914D\u7F6E\u7684 outputDir" },
        timeoutMs: { type: "integer", description: "\u7B49\u5F85\u4E0A\u9650\uFF08\u6BEB\u79D2\uFF09\uFF0C\u9ED8\u8BA4\u53D6\u914D\u7F6E" },
        returnImages: { type: "string", enum: ["first", "all", "none"], description: "\u54CD\u5E94\u91CC\u5E26\u51E0\u5F20\u56FE\uFF0C\u9ED8\u8BA4 first" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => {
        const blocks = [];
        const bag = value !== null && typeof value === "object" ? value : {};
        const artifacts = Array.isArray(bag.artifacts) ? bag.artifacts : [];
        const lines = [];
        if (bag.ok === true) {
          lines.push(`\u5DE5\u4F5C\u6D41 ${String(bag.workflowId)} \u6267\u884C\u5B8C\u6210\uFF0C\u7528\u65F6 ${String(bag.durationMs)} ms\u3002`);
          for (const item of artifacts) {
            const size = item.width !== void 0 && item.height !== void 0 ? `\uFF0C\u539F\u56FE ${item.width}\xD7${item.height}` : "";
            lines.push(`- ${item.path}\uFF08${item.mime}\uFF0C${Math.round(item.bytes / 1024)} KB${size}\uFF09`);
          }
          if (Array.isArray(bag.notes) && bag.notes.length > 0) lines.push(`\u5907\u6CE8\uFF1A${bag.notes.join("\uFF1B")}`);
          lines.push("\u56FE\u7247\u5DF2\u968F\u54CD\u5E94\u8FD4\u56DE\uFF1B\u9700\u8981\u518D\u6B21\u5904\u7406\u65F6\u8BF7\u7528\u4E0A\u9762\u7684\u8DEF\u5F84\u6307\u5411\u539F\u56FE\uFF0C\u4E0D\u8981\u7528\u54CD\u5E94\u91CC\u7684\u526F\u672C\u3002");
        } else {
          lines.push(String(bag.message ?? "\u6267\u884C\u5931\u8D25\u3002"));
          if (typeof bag.hint === "string" && bag.hint !== "") lines.push(`\u4E0B\u4E00\u6B65\uFF1A${bag.hint}`);
        }
        blocks.push({ type: "text", text: lines.join("\n") });
        for (const item of Array.isArray(bag.inlineImages) ? bag.inlineImages : []) {
          blocks.push({ type: "image", data: item.data, mimeType: item.mimeType });
        }
        return blocks;
      }
    },
    async execute(args) {
      const loaded = loadWorkflow(deps, args);
      const outputDir = asString(args.outputPath).trim() !== "" ? asString(args.outputPath).trim() : deps.outputDir;
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
      const pending = deps.overrides.get(loaded.workflowId);
      const preNotes = [];
      if (pending !== void 0 && pending.length > 0) {
        for (const patch of pending) {
          const node = loaded.workflow[patch.nodeId];
          if (node !== void 0 && node.inputs !== null && typeof node.inputs === "object") node.inputs[patch.input] = patch.value;
        }
        deps.overrides.delete(loaded.workflowId);
        preNotes.push(`\u5DF2\u5E94\u7528 ${pending.length} \u5904\u4E00\u6B21\u6027\u53C2\u6570\u8986\u76D6\uFF08\u672A\u5199\u5165\u6A21\u677F\uFF09\u3002`);
      }
      try {
        const outcome = await runWorkflow({
          client: deps.client,
          workflow: loaded.workflow,
          slots: loaded.surface.inputs,
          vars: asRecord(args.vars),
          outputDir,
          timeoutMs,
          pollIntervalMs: deps.pollIntervalMs,
          workflowId: loaded.workflowId,
          workflowHash: loaded.surface.workflowHash
        });
        const mode = asString(args.returnImages, "first");
        const inline = [];
        if (mode !== "none") {
          const limit = mode === "all" ? MAX_INLINE_COUNT : 1;
          for (const artifact of outcome.artifacts.filter(isImageArtifact).slice(0, limit)) {
            if (artifact.bytes > MAX_INLINE_BYTES) continue;
            try {
              inline.push({ data: fs16.readFileSync(artifact.path).toString("base64"), mimeType: artifact.mime });
            } catch {
            }
          }
        }
        const createdAt = (/* @__PURE__ */ new Date()).toISOString();
        const tags = Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === "string") : [];
        for (const artifact of outcome.artifacts) {
          try {
            deps.index.add({
              digest: artifact.digest,
              path: artifact.path,
              bytes: artifact.bytes,
              mime: artifact.mime,
              ...artifact.width === void 0 ? {} : { width: artifact.width },
              ...artifact.height === void 0 ? {} : { height: artifact.height },
              workflowId: loaded.workflowId,
              workflowHash: loaded.surface.workflowHash,
              promptId: outcome.promptId,
              createdAt,
              tags,
              status: "present"
            });
          } catch {
            deps.logger?.warn?.("\u8D44\u4EA7\u7D22\u5F15\u767B\u8BB0\u5931\u8D25\uFF08\u4EA7\u7269\u5DF2\u843D\u76D8\uFF09");
          }
        }
        const notes = [...preNotes, ...outcome.notes];
        const skipped = outcome.artifacts.filter(isImageArtifact).length - inline.length;
        if (skipped > 0 && mode !== "none") {
          notes.push(`${skipped} \u5F20\u56FE\u8D85\u8FC7 ${Math.round(MAX_INLINE_BYTES / 1024 / 1024)} MB \u6216\u8D85\u51FA\u5F20\u6570\u4E0A\u9650\uFF0C\u53EA\u7ED9\u4E86\u8DEF\u5F84\u3002`);
        }
        return {
          ok: true,
          workflowId: loaded.workflowId,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
          inlineImages: inline,
          notes
        };
      } catch (error) {
        const code = error !== null && typeof error === "object" ? error.code : void 0;
        const hint = error !== null && typeof error === "object" ? error.hint : void 0;
        return {
          ok: false,
          code: typeof code === "string" ? code : "execution_failed",
          message: error instanceof Error ? error.message : String(error),
          ...typeof hint === "string" ? { hint } : {}
        };
      }
    }
  };
}

// src/tools/workflow-edit.ts
function boundSlot(slots, nodeId, input) {
  const bind = `${nodeId}.inputs.${input}`;
  return slots.find((slot) => slot.bind === bind);
}
function coerce2(slot, value) {
  if (slot === void 0) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
    throw new Error("\u503C\u53EA\u80FD\u662F\u5B57\u7B26\u4E32\u3001\u6570\u5B57\u6216\u5E03\u5C14\u3002");
  }
  if (slot.type === "number") {
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n)) throw new Error(`${slot.name} \u9700\u8981\u6570\u5B57\u3002`);
    return n;
  }
  if (slot.type === "boolean") {
    if (typeof value !== "boolean") throw new Error(`${slot.name} \u9700\u8981 true / false\u3002`);
    return value;
  }
  if (slot.type === "enum") {
    const text3 = String(value);
    if (slot.options !== void 0 && slot.options.length > 0 && !slot.options.includes(text3)) {
      throw new Error(`${slot.name} \u53EA\u63A5\u53D7\uFF1A${slot.options.join(" / ")}\u3002`);
    }
    return text3;
  }
  return typeof value === "string" ? value : String(value);
}
function workflowEditTool(deps) {
  return {
    name: "comfyui_workflow_edit",
    description: "\u4FEE\u6539\u5DE5\u4F5C\u6D41\u7684\u7528\u9014\u5907\u6CE8\uFF0C\u6216\u8C03\u6574\u67D0\u4E2A\u8282\u70B9\u7684\u53C2\u6570\u3002patches \u9ED8\u8BA4\u53EA\u5F71\u54CD\u4E0B\u4E00\u6B21\u8FD0\u884C\uFF08\u4E0D\u5199\u6A21\u677F\uFF09\uFF1B\u8981\u5199\u56DE\u6A21\u677F\u5FC5\u987B\u5E26 persist=true \u4E0E expectHash\u3002\u88AB\u53D8\u91CF\u63A7\u5236\uFF08bind\uFF09\u7684\u53C2\u6570\u4E0D\u80FD\u76F4\u63A5 patch\uFF0C\u5E94\u5148\u6539\u90A3\u4E2A\u53D8\u91CF\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["workflowId"],
      properties: {
        workflowId: { type: "string" },
        notes: {
          type: "object",
          description: "\u7528\u9014\u5907\u6CE8\uFF1Atitle / description / tags\u3002\u5199\u8FDB <id>.meta.json\uFF0C\u7528\u6237\u4E0E\u6A21\u578B\u90FD\u53EF\u6539\u3002",
          properties: {
            title: { type: "string" },
            description: { type: "string" },
            tags: { type: "array", items: { type: "string" } }
          }
        },
        patches: {
          type: "array",
          description: "\u8282\u70B9\u53C2\u6570\u4FEE\u6539",
          items: {
            type: "object",
            required: ["nodeId", "input", "value"],
            properties: {
              nodeId: { type: "string" },
              input: { type: "string" },
              value: { type: ["string", "number", "boolean"] }
            }
          }
        },
        persist: { type: "boolean", description: "true \u624D\u5199\u56DE\u6A21\u677F\uFF08\u9ED8\u8BA4 false\uFF09" },
        expectHash: { type: "string", description: "persist=true \u65F6\u5FC5\u586B\uFF1A\u8BFB\u53D6\u65F6\u62FF\u5230\u7684 workflowHash" }
      }
    },
    output: jsonOutput(),
    async execute(args) {
      const workflowId = asString(args.workflowId).trim();
      if (workflowId === "") return { ok: false, message: "\u9700\u8981 workflowId\u3002" };
      const entry = readEntry(deps.workflowsDir, workflowId);
      if (entry === void 0) return { ok: false, message: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${workflowId}\u3002` };
      const changed = [];
      const notes = asRecord(args.notes);
      const patchesRaw = Array.isArray(args.patches) ? args.patches : [];
      const persist = args.persist === true;
      if (Object.keys(notes).length > 0) {
        const next = {
          title: typeof notes.title === "string" ? notes.title : entry.meta?.title,
          description: typeof notes.description === "string" ? notes.description : entry.meta?.description,
          tags: Array.isArray(notes.tags) ? notes.tags.filter((tag) => typeof tag === "string") : entry.meta?.tags,
          updatedBy: "agent"
        };
        writeMeta(deps.workflowsDir, workflowId, next);
      }
      const overrides = [];
      for (const item of patchesRaw) {
        const patch = item !== null && typeof item === "object" ? item : {};
        const nodeId = asString(patch.nodeId);
        const input = asString(patch.input);
        if (nodeId === "" || input === "") return { ok: false, message: "\u6BCF\u6761 patch \u90FD\u9700\u8981 nodeId \u4E0E input\u3002" };
        const node = entry.workflow[nodeId];
        if (node === void 0) {
          return { ok: false, message: `\u5DE5\u4F5C\u6D41 ${workflowId} \u91CC\u6CA1\u6709\u8282\u70B9 ${nodeId}\u3002`, nodes: Object.keys(entry.workflow) };
        }
        if (!(input in node.inputs)) {
          return { ok: false, message: `\u8282\u70B9 ${nodeId} \u6CA1\u6709\u8F93\u5165 ${input}\u3002`, inputs: Object.keys(node.inputs) };
        }
        const current = node.inputs[input];
        if (Array.isArray(current) && current.length === 2 && typeof current[1] === "number") {
          return {
            ok: false,
            code: "param_not_editable",
            message: `${nodeId}.inputs.${input} \u662F\u4E0A\u6E38\u8FDE\u7EBF\uFF0C\u6539\u5B83\u4E0D\u4F1A\u751F\u6548\u3002`,
            hint: "\u6CBF\u7740\u8FDE\u7EBF\u627E\u5230\u771F\u6B63\u6301\u6709\u503C\u7684\u8282\u70B9\uFF0C\u6539\u90A3\u4E00\u4E2A\u3002"
          };
        }
        const slot = boundSlot(entry.surface.inputs, nodeId, input);
        if (slot !== void 0) {
          return {
            ok: false,
            code: "param_bound",
            message: `${nodeId}.inputs.${input} \u7531\u53D8\u91CF ${slot.name} \u63A7\u5236\uFF0C\u76F4\u63A5\u6539\u4F1A\u88AB\u53D8\u91CF\u66FF\u6362\u8986\u76D6\u3002`,
            hint: `\u7528 comfyui_run \u4F20 ${slot.name}\uFF0C\u800C\u4E0D\u662F patch \u8282\u70B9\u3002`
          };
        }
        let value;
        try {
          value = coerce2(slot, patch.value);
        } catch (error) {
          return { ok: false, code: "param_type", message: error instanceof Error ? error.message : String(error) };
        }
        overrides.push({ nodeId, input, value });
        changed.push({ nodeId, input, before: current, after: value });
      }
      let persisted = false;
      if (persist && overrides.length > 0) {
        const expectHash = asString(args.expectHash).trim();
        if (expectHash === "") {
          return { ok: false, message: "persist=true \u9700\u8981 expectHash\uFF08\u8BFB\u53D6\u65F6\u62FF\u5230\u7684 workflowHash\uFF09\u3002" };
        }
        if (expectHash !== entry.surface.workflowHash) {
          return {
            ok: false,
            code: "hash_mismatch",
            message: `\u6A21\u677F\u5DF2\u88AB\u6539\u52A8\uFF08\u5F53\u524D ${entry.surface.workflowHash.slice(0, 8)}\uFF0C\u4F60\u8BFB\u5230\u7684\u662F ${expectHash.slice(0, 8)}\uFF09\u3002`,
            hint: "\u91CD\u65B0 inspect \u4E00\u6B21\u62FF\u5230\u65B0 hash\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u8986\u76D6\u3002",
            currentHash: entry.surface.workflowHash
          };
        }
        const next = structuredClone(entry.workflow);
        for (const patch of overrides) {
          const node = next[patch.nodeId];
          if (node !== void 0) node.inputs[patch.input] = patch.value;
        }
        writeWorkflow(deps.workflowsDir, workflowId, next);
        persisted = true;
      } else if (overrides.length > 0) {
        deps.overrides.set(workflowId, overrides);
      }
      return {
        ok: true,
        workflowId,
        changed,
        persisted,
        scope: persisted ? "template" : "next-run",
        hint: persisted ? "\u5DF2\u5199\u56DE\u6A21\u677F\uFF0C\u4E4B\u540E\u7684\u8FD0\u884C\u90FD\u4F1A\u7528\u65B0\u503C\u3002" : "\u53EA\u5BF9\u4E0B\u4E00\u6B21\u8FD0\u884C\u751F\u6548\uFF1B\u8981\u5199\u56DE\u6A21\u677F\u8BF7\u518D\u8C03\u7528\u4E00\u6B21\u5E76\u5E26 persist + expectHash\u3002",
        notesUpdated: Object.keys(notes).length > 0
      };
    }
  };
}

// src/tools/workflow-inspect.ts
var SECRET_KEY = /(api_?key|token|secret|passw(or)?d|credential|auth)/i;
function isSecret(key, slots, bindOf) {
  if (SECRET_KEY.test(key)) return true;
  return slots.some((slot) => slot.secret === true && slot.bind === bindOf);
}
function displayValue(value, secret) {
  if (secret) return "[redacted]";
  if (Array.isArray(value) && value.length === 2 && typeof value[1] === "number") {
    return `\u2190 node ${String(value[0])}[${value[1]}]`;
  }
  return value;
}
function nodeView(workflowId, nodeId, node, surface) {
  const inputs = {};
  for (const [key, value] of Object.entries(node.inputs)) {
    inputs[key] = displayValue(value, isSecret(key, surface.inputs, `${nodeId}.inputs.${key}`));
  }
  return {
    workflowId,
    nodeId,
    classType: typeof node.class_type === "string" ? node.class_type : "",
    title: node._meta !== void 0 && node._meta !== null && typeof node._meta.title === "string" ? node._meta.title : "",
    inputs,
    note: "\u5E26 \u2190 \u7684\u662F\u4E0A\u6E38\u8FDE\u7EBF\uFF08\u7531\u522B\u7684\u8282\u70B9\u63D0\u4F9B\uFF09\uFF0C\u6539\u5B83\u4E0D\u4F1A\u751F\u6548\u3002"
  };
}
function nodeList(workflow) {
  return Object.entries(workflow).filter(([, node]) => node !== null && typeof node === "object" && typeof node.class_type === "string").map(([id, node]) => ({
    nodeId: id,
    classType: String(node.class_type),
    title: node._meta !== void 0 && node._meta !== null && typeof node._meta.title === "string" ? node._meta.title : ""
  }));
}
function surfaceView(surface, missing) {
  const primary = surface.models.find((model) => model.primary === true) ?? surface.models[0];
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    workflowHash: surface.workflowHash,
    models: { primary: primary?.name ?? "", kind: primary?.kind ?? "", others: surface.models.filter((model) => model !== primary).map((model) => model.name) },
    inputs: surface.inputs.map((slot) => ({
      name: slot.name,
      label: slot.label,
      type: slot.type,
      required: slot.required,
      ...slot.default === void 0 ? {} : { default: slot.default },
      ...slot.options === void 0 ? {} : { options: slot.options },
      ...slot.min === void 0 ? {} : { min: slot.min },
      ...slot.max === void 0 ? {} : { max: slot.max },
      group: slot.group,
      ...slot.secret === true ? { secret: true } : {}
    })),
    outputs: surface.outputs,
    nodes: surface.meta.nodeCount,
    missingNodes: missing
  };
}
function workflowInspectTool(deps) {
  return {
    name: "comfyui_workflow_inspect",
    description: "\u67E5\u770B\u5DE5\u4F5C\u6D41\u7EC6\u8282\u3002\u4E0D\u4F20 nodeId\uFF1A\u8FD4\u56DE\u8F93\u5165\u8F93\u51FA\u9762 + \u8282\u70B9\u6E05\u5355\uFF08id/classType/title\uFF09+ \u7F3A\u5931\u8282\u70B9\u9884\u68C0\u3002\u4F20 nodeId\uFF1A\u8FD4\u56DE\u8BE5\u8282\u70B9\u7684\u5B8C\u6574\u914D\u7F6E\uFF08\u542B\u8FDE\u7EBF\u6765\u6E90\uFF09\u3002\u6539\u53C2\u6570\u524D\u5148\u7528\u5B83\u786E\u8BA4\u73B0\u72B6\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["workflowId"],
      properties: {
        workflowId: { type: "string", description: "\u5DE5\u4F5C\u6D41 id\uFF08\u7528 comfyui_workflow_list \u67E5\uFF09" },
        nodeId: { type: "string", description: "\u53EA\u770B\u8FD9\u4E00\u4E2A\u8282\u70B9" }
      }
    },
    output: jsonOutput(),
    async execute(args) {
      const workflowId = asString(args.workflowId).trim();
      if (workflowId === "") return { ok: false, message: "\u9700\u8981 workflowId\u3002" };
      const entry = readEntry(deps.workflowsDir, workflowId);
      if (entry === void 0) {
        return { ok: false, message: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${workflowId}\u3002\u5148\u7528 comfyui_workflow_list \u770B\u6709\u54EA\u4E9B\u3002` };
      }
      const nodeId = asString(args.nodeId).trim();
      if (nodeId !== "") {
        const node = entry.workflow[nodeId];
        if (node === void 0) {
          return { ok: false, message: `\u5DE5\u4F5C\u6D41 ${workflowId} \u91CC\u6CA1\u6709\u8282\u70B9 ${nodeId}\u3002`, nodes: nodeList(entry.workflow) };
        }
        return { ok: true, ...nodeView(workflowId, nodeId, node, entry.surface) };
      }
      let missing = [];
      try {
        const info = await deps.client.objectInfo();
        const known = new Set(Object.keys(info));
        if (known.size > 0) {
          missing = [...new Set(Object.values(entry.workflow).map((node) => String(node.class_type ?? "")).filter((name2) => name2 !== "" && !known.has(name2)))];
        }
      } catch (error) {
        deps.logger?.warn?.(`[${workflowId}] \u9884\u68C0\u8DF3\u8FC7\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }
      return {
        ok: true,
        ...surfaceView(entry.surface, missing),
        nodes: nodeList(entry.workflow),
        hint: "\u8981\u770B\u67D0\u4E2A\u8282\u70B9\u7684\u5177\u4F53\u53C2\u6570\uFF0C\u7528\u540C\u4E00\u4E2A\u5DE5\u5177\u52A0 nodeId\u3002"
      };
    }
  };
}

// src/tools/workflow-list.ts
function toListItem3(surface) {
  const primary = surface.models.find((model) => model.primary === true) ?? surface.models[0];
  const others = surface.models.filter((model) => model !== primary).map((model) => model.name);
  return {
    workflowId: surface.workflowId,
    title: surface.title,
    description: surface.description,
    undescribed: surface.description === "",
    models: {
      primary: primary?.name ?? "",
      kind: primary?.kind ?? "",
      others
    },
    inputKinds: [...new Set(surface.inputs.map((slot) => slot.type).filter((type) => type !== "number" && type !== "boolean" && type !== "enum"))],
    inputs: surface.inputs.map((slot) => ({ name: slot.name, type: slot.type, required: slot.required })),
    outputs: surface.outputs.map((slot) => ({ kind: slot.kind, count: slot.count })),
    nodes: surface.meta.nodeCount
  };
}
function workflowListTool(deps) {
  return {
    name: "comfyui_workflow_list",
    description: "\u5217\u51FA\u672C\u673A\u53EF\u7528\u7684 ComfyUI \u5DE5\u4F5C\u6D41\u3002\u6BCF\u9879\u542B id\u3001\u6807\u9898\u3001\u4F5C\u7528\u5907\u6CE8\u3001\u5E95\u6A21\u540D\u3001\u8F93\u5165\u79CD\u7C7B\uFF08text/image/mask\uFF09\u4E0E\u8F93\u51FA\u5F62\u72B6\u3002\u7528\u6237\u6CA1\u6709\u6307\u5B9A\u5DE5\u4F5C\u6D41\u65F6\u7528\u5B83\u5728\u5176\u4E2D\u6311\u9009\uFF1B\u7528\u6237\u5DF2\u6307\u5B9A\u65F6\u4E0D\u5FC5\u8C03\u7528\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", description: "\u6309\u6807\u9898 / \u5907\u6CE8 / \u6A21\u578B\u540D\u8FC7\u6EE4\uFF08\u4E0D\u533A\u5206\u5927\u5C0F\u5199\uFF09" }
      }
    },
    output: jsonOutput(),
    async execute(args) {
      const query = asString(args.q).trim().toLowerCase();
      const { entries, broken } = listEntries(deps.workflowsDir);
      const items = entries.map((entry) => toListItem3(entry.surface)).filter((item) => {
        if (query === "") return true;
        const haystack = `${String(item.title)} ${String(item.description)} ${String(item.models.primary)}`.toLowerCase();
        return haystack.includes(query);
      });
      return {
        ok: true,
        count: items.length,
        workflows: items,
        ...broken.length > 0 ? { broken, brokenHint: "\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u662F\u53EF\u7528\u7684 API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF0C\u5DF2\u8DF3\u8FC7\u3002" } : {},
        ...items.length === 0 && broken.length === 0 ? { hint: "\u5DE5\u4F5C\u6D41\u76EE\u5F55\u662F\u7A7A\u7684\u3002\u7528 dsh workbench import <file> \u5BFC\u5165\u4E00\u4EFD API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF08ComfyUI \u91CC Export (API)\uFF09\u3002" } : {}
      };
    }
  };
}

// src/tools/registry.ts
function createTools(deps) {
  return [
    workflowListTool(deps),
    workflowInspectTool(deps),
    runTool(deps),
    workflowEditTool(deps)
  ];
}

// src/index.ts
var name = "dsh-comfyui-workbench";
var inject = ["webServer"];
function readVersion() {
  try {
    const parsed = JSON.parse(fs17.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    return typeof parsed.version === "string" ? parsed.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
}
var VERSION = readVersion();
function apply(ctx, config) {
  const settings = resolveSettings(config);
  const logger = resolveLogger(ctx, name);
  const warn = logger?.warn ?? console.warn;
  const info = logger?.info ?? console.info;
  const flowDir = settings.workflowsDir ?? workflowsDir();
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand },
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger
  });
  if (typeof ctx.effect === "function") ctx.effect(() => () => supervisor.dispose(), `${name}: supervisor`);
  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady()
  });
  const track = (dispose) => {
    if (typeof dispose === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => dispose, `${name}: disposer`);
    }
  };
  const assetIndex = new AssetIndex();
  const server = ctx.get?.("webServer");
  if (server === void 0 || typeof server.register !== "function") {
    warn(`[${name}] \u62FF\u4E0D\u5230 webServer \u670D\u52A1\uFF0C\u8D44\u4EA7\u5E93 API \u672A\u6CE8\u518C\u3002`);
  } else {
    const handler = createHandler(ctx, settings, assetIndex, flowDir, client, supervisor);
    if (typeof ctx.effect === "function") {
      ctx.effect(() => server.register({ kind: "prefix", path: PREFIX, handler }), `${name}: http routes`);
    } else {
      server.register({ kind: "prefix", path: PREFIX, handler });
    }
    info(`[${name}] v${VERSION} \u8D44\u4EA7\u5E93 API \u5C31\u7EEA\uFF1A${PREFIX}\uFF08\u6700\u5927\u6DF1\u5EA6 ${settings.maxDepth}\uFF09`);
  }
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    warn(`[${name}] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u5DE5\u4F5C\u6D41\u5DE5\u5177\u672A\u6CE8\u518C\uFF08\u8D44\u4EA7\u5E93\u4ECD\u53EF\u7528\uFF09\u3002`);
    return;
  }
  for (const spec of createTools({
    client,
    workflowsDir: flowDir,
    outputDir: settings.outputDir ?? process.cwd(),
    timeoutMs: settings.timeoutMs,
    pollIntervalMs: settings.pollIntervalMs,
    overrides: /* @__PURE__ */ new Map(),
    index: assetIndex,
    logger
  })) {
    track(tools.register(spec));
  }
  info(`[${name}] \u5DE5\u4F5C\u6D41\u5DE5\u5177\u5DF2\u6CE8\u518C\uFF1Alist / inspect / run / edit\uFF08\u6570\u636E\u76EE\u5F55 ${pluginDataDir()}\uFF09`);
}
export {
  VERSION,
  apply,
  inject,
  name
};
