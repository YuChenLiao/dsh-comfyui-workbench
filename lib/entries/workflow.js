var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/entries/workflow.ts
import fs16 from "node:fs";
import os from "node:os";
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
      const text = typeof bag.exception_message === "string" ? bag.exception_message : "";
      const node = bag.node_id === void 0 ? "" : `\u8282\u70B9 ${String(bag.node_id)}`;
      const type = typeof bag.node_type === "string" ? bag.node_type : "";
      const head = [node, type].filter((part) => part !== "").join(" ");
      const detail = `${head}${head === "" ? "" : "\uFF1A"}${text}`;
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

// src/shared/comfy/upload.ts
import fs3 from "node:fs";
import path3 from "node:path";
async function ensureComfyImage(client, value) {
  const looksLocal = /[\\/]/.test(value) || path3.isAbsolute(value);
  if (!looksLocal) return value;
  let bytes;
  try {
    bytes = fs3.readFileSync(value);
  } catch (error) {
    throw new RunError(
      "variable_type",
      `\u8BFB\u4E0D\u5230\u8FD9\u5F20\u56FE\uFF1A${value}`,
      "\u786E\u8BA4\u6587\u4EF6\u8FD8\u5728\uFF1B\u4E0A\u4F20\u5668\u7ED9\u7684\u8DEF\u5F84\u4F1A\u843D\u5728\u63D2\u4EF6\u7684 uploads \u76EE\u5F55\u91CC\u3002",
      error
    );
  }
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), path3.basename(value));
  form.append("overwrite", "true");
  const res = await client.uploadImage(form);
  const subfolder = res.subfolder === "" ? "" : `${res.subfolder}/`;
  return `${subfolder}${res.name}`;
}
async function materializeImages(client, vars, imageSlots) {
  const next = { ...vars };
  const notes = [];
  for (const name2 of imageSlots) {
    const value = next[name2];
    if (typeof value !== "string" || value === "") continue;
    const before = value;
    const after = await ensureComfyImage(client, value);
    if (after !== before) {
      next[name2] = after;
      notes.push(`${name2}\uFF1A\u672C\u5730\u56FE\u5DF2\u9001\u8FDB ComfyUI \u7684 input\uFF0C\u63D0\u4EA4\u65F6\u7528\u6587\u4EF6\u540D ${after}\u3002`);
    }
  }
  return { vars: next, notes };
}

// src/shared/comfy/models.ts
var MODEL_FIELD = /(ckpt|checkpoint|unet|model|lora|vae).*name$/i;
function availableModels(info) {
  const names = /* @__PURE__ */ new Set();
  for (const node of Object.values(info)) {
    const bags = [node.input?.required, node.input?.optional];
    for (const bag of bags) {
      if (bag === void 0 || bag === null) continue;
      for (const [field, decl] of Object.entries(bag)) {
        if (!MODEL_FIELD.test(field)) continue;
        if (!Array.isArray(decl) || !Array.isArray(decl[0])) continue;
        for (const candidate of decl[0]) {
          if (typeof candidate === "string" && candidate !== "") names.add(candidate);
        }
      }
    }
  }
  return names;
}
function missingModels(models, available) {
  const missing = [];
  for (const model of models) {
    if (model.name === "") continue;
    if (available.has(model.name)) continue;
    missing.push(model.name);
  }
  return missing;
}
function suggestModels(available, kind, limit = 3) {
  const all = [...available];
  if (kind === "checkpoint") {
    return all.filter((name2) => /\.(safetensors|ckpt)$/i.test(name2) && !/(lora|upscale|vae|realesrgan|control)/i.test(name2)).slice(0, limit);
  }
  return all.slice(0, limit);
}

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

// src/components/panel-workflow/server/config-api.ts
function createConfigHandler(deps) {
  return (_url, res) => {
    const diagnostics = deps.getDiagnostics?.() ?? {};
    sendJson(res, 200, {
      ok: true,
      config: {
        baseUrl: deps.settings.baseUrl,
        outputDir: deps.outputDir,
        outputSource: deps.outputSource ?? "config",
        workflowsDir: deps.workflowsDir,
        runMode: deps.settings.runMode,
        returnImages: deps.settings.returnImages,
        timeoutMs: deps.settings.timeoutMs,
        ...diagnostics.components === void 0 ? {} : { components: diagnostics.components },
        ...diagnostics.tools === void 0 ? {} : { tools: diagnostics.tools }
      }
    });
  };
}

// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path4 from "node:path";

// src/shared/media/png-text.ts
import fs4 from "node:fs";
import zlib from "node:zlib";

// src/shared/media/constants.ts
var SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
var PNG_META_READ_BYTES = 64 * 1024;

// src/shared/media/png-text.ts
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

// src/shared/workflow/variables.ts
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
    const text = String(value);
    if (slot.options !== void 0 && slot.options.length > 0 && !slot.options.includes(text)) {
      throw new VariableError("variable_type", `\u53C2\u6570 ${slot.name} \u53EA\u63A5\u53D7\uFF1A${slot.options.join(" / ")}\u3002`, { slot: slot.name });
    }
    return text;
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

// src/shared/run/runner.ts
var pending = /* @__PURE__ */ new Map();
function rememberRun(promptId, context) {
  pending.set(promptId, context);
  if (pending.size > 50) {
    const oldest = [...pending.entries()].sort((a, b) => a[1].submittedAt - b[1].submittedAt)[0];
    if (oldest !== void 0) pending.delete(oldest[0]);
  }
}
function recallRun(promptId) {
  return pending.get(promptId);
}
function forgetRun(promptId) {
  pending.delete(promptId);
}
function requiredNodes(workflow) {
  const set = /* @__PURE__ */ new Set();
  for (const node of Object.values(workflow)) {
    if (node !== null && typeof node === "object" && typeof node.class_type === "string" && node.class_type !== "") {
      set.add(node.class_type);
    }
  }
  return [...set];
}
function outputKindOf(classType) {
  return /^(preview|image\s*comparer)/i.test(classType) ? "preview" : "save";
}
function fileRefsOf(outputs, workflow) {
  const found = [];
  if (outputs === void 0) return found;
  for (const [nodeId, bag] of Object.entries(outputs)) {
    const kind = outputKindOf(String(workflow?.[nodeId]?.class_type ?? ""));
    if (bag === null || typeof bag !== "object") continue;
    for (const value of Object.values(bag)) {
      const list = Array.isArray(value) ? value : [value];
      for (const item of list) {
        if (item === null || typeof item !== "object") continue;
        const ref = item;
        if (typeof ref.filename !== "string" || ref.filename === "") continue;
        found.push({
          filename: ref.filename,
          subfolder: typeof ref.subfolder === "string" ? ref.subfolder : "",
          type: typeof ref.type === "string" ? ref.type : "output",
          nodeId,
          kind
        });
      }
    }
  }
  return found;
}
function mimeOf(file) {
  const table = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav"
  };
  return table[path4.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function targetFor(outputDir, filename) {
  const safe = path4.basename(filename);
  const first = path4.join(outputDir, safe);
  if (!fs5.existsSync(first)) return first;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return path4.join(outputDir, `${stamp}-${safe}`);
}
function digestOf(bytes) {
  return crypto2.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}
async function submitWorkflow(options) {
  const { client, slots, vars } = options;
  const notes = [];
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
  const imageSlots = slots.filter((slot) => slot.type === "image" || slot.type === "mask").map((slot) => slot.name);
  if (imageSlots.length > 0) {
    const moved = await materializeImages(client, applied.effective, imageSlots);
    notes.push(...moved.notes);
    if (moved.notes.length > 0) {
      applied = applyVariables(options.workflow, slots, { ...moved.vars });
    }
  }
  const promptId = await client.queuePrompt(applied.workflow);
  options.onStage?.("queued");
  rememberRun(promptId, {
    workflowId: options.workflowId,
    workflowHash: options.workflowHash,
    outputDir: options.outputDir,
    effective: applied.effective,
    writeMetadata: options.writeMetadata !== false,
    submittedAt: Date.now(),
    workflow: options.workflow
  });
  return { promptId, effective: applied.effective, notes };
}
async function checkRun(client, promptId) {
  const entry = await client.history(promptId);
  if (entry === void 0) return { done: false };
  if (entry.status?.status_str === "error") throw executionFailed(entry, promptId);
  const hasOutputs = entry.outputs !== void 0 && Object.keys(entry.outputs).length > 0;
  return { done: entry.status?.completed === true || hasOutputs, entry };
}
async function collectArtifacts(client, promptId, entry, context) {
  const all = fileRefsOf(entry.outputs, context.workflow);
  const durable = all.filter((ref) => ref.kind === "save" && ref.type !== "temp");
  const fallback = all.filter((ref) => ref.kind === "save");
  const refs = durable.length > 0 ? durable : fallback.length > 0 ? fallback : all;
  const skipped = all.length - refs.length;
  if (refs.length === 0) throw noOutput(true);
  ensureDir(context.outputDir);
  const artifacts = [];
  const unreadable = [];
  for (const ref of refs) {
    let bytes;
    try {
      bytes = await client.view({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    } catch (error) {
      unreadable.push(`${ref.filename}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
      continue;
    }
    const target = targetFor(context.outputDir, ref.filename);
    fs5.writeFileSync(target, bytes);
    const artifact = { path: target, digest: digestOf(bytes), mime: mimeOf(target), bytes: bytes.length };
    if (path4.extname(target).toLowerCase() === ".png") {
      const parsed = readPngTextChunks(target, bytes.length);
      if (parsed !== void 0 && parsed.width > 0 && parsed.height > 0) {
        artifact.width = parsed.width;
        artifact.height = parsed.height;
      }
    }
    artifacts.push(artifact);
  }
  if (artifacts.length === 0) {
    throw outputUnreadable(refs[0]?.filename ?? "", new Error(`\u5168\u90E8 ${refs.length} \u4E2A\u4EA7\u7269\u90FD\u53D6\u4E0D\u56DE\uFF1A${unreadable.join("\uFF1B")}`));
  }
  const durationMs = Date.now() - context.submittedAt;
  const primary = artifacts[0];
  let metadataPath;
  if (context.writeMetadata && primary !== void 0) {
    metadataPath = `${primary.path}.json`;
    const meta = {
      plugin: "dsh-comfyui-workbench",
      createdAt: (/* @__PURE__ */ new Date()).toISOString(),
      workflowId: context.workflowId,
      workflowHash: context.workflowHash,
      vars: context.effective,
      prompt: typeof context.effective.prompt === "string" ? context.effective.prompt : void 0,
      negativePrompt: typeof context.effective.negative_prompt === "string" ? context.effective.negative_prompt : void 0,
      seed: typeof context.effective.seed === "number" ? context.effective.seed : void 0,
      width: primary.width,
      height: primary.height,
      durationMs,
      artifacts: artifacts.map((item) => ({ path: item.path, digest: item.digest, bytes: item.bytes })),
      comfy: { url: client.baseUrl, promptId }
    };
    try {
      fs5.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}
`, "utf8");
    } catch {
      metadataPath = void 0;
    }
  }
  forgetRun(promptId);
  return {
    ok: true,
    promptId,
    workflowId: context.workflowId,
    artifacts,
    durationMs,
    effective: context.effective,
    notes: [
      ...skipped > 0 ? [`\u5DF2\u8DF3\u8FC7 ${skipped} \u5F20\u9884\u89C8\u56FE\uFF1A\u5B83\u4EEC\u6765\u81EA PreviewImage \u4E4B\u7C7B\u7684\u8282\u70B9\uFF0C\u662F ComfyUI \u7684\u4E34\u65F6\u8F93\u51FA\uFF0C\u4E0D\u662F\u4EA7\u7269\u3002`] : [],
      ...unreadable.length > 0 ? [`\u6709 ${unreadable.length} \u4E2A\u4EA7\u7269\u53D6\u4E0D\u56DE\uFF0C\u5DF2\u8DF3\u8FC7\uFF1A${unreadable.join("\uFF1B")}`] : []
    ],
    ...metadataPath === void 0 ? {} : { metadataPath }
  };
}
async function resumeRun(client, promptId, fallback) {
  const context = recallRun(promptId) ?? {
    workflowId: "unknown",
    workflowHash: "",
    outputDir: fallback.outputDir,
    effective: {},
    writeMetadata: true,
    submittedAt: Date.now()
  };
  const state = await checkRun(client, promptId);
  if (!state.done || state.entry === void 0) {
    return {
      ok: true,
      pending: true,
      promptId,
      waitedMs: 0,
      hint: "\u8FD8\u5728\u51FA\u56FE\u3002\u7B49\u4E00\u4F1A\u513F\u518D\u67E5\u4E00\u6B21\uFF1BComfyUI \u4FA7\u4E0D\u4F1A\u56E0\u4E3A\u8C03\u7528\u7ED3\u675F\u800C\u4E2D\u65AD\u3002"
    };
  }
  return await collectArtifacts(client, promptId, state.entry, context);
}

// src/shared/run/notify.ts
import crypto3 from "node:crypto";
var watchers = /* @__PURE__ */ new Map();
function stopAllWatchers() {
  for (const [, watcher] of watchers) clearInterval(watcher.timer);
  watchers.clear();
}

// src/shared/workflow/detect.ts
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

// src/shared/workflow/infer.ts
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
function outputKindOf2(classType) {
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
    outputs.push({ nodeId: id, key: "images", kind: outputKindOf2(classType), count: "dynamic", label: titleOf(node) });
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
      const empty = value === "" || value === null || value === void 0;
      const required = empty && (type === "image" || type === "mask");
      const slot = {
        name: name2,
        bind: `${id}.inputs.${key}`,
        label: titleOf(node),
        type,
        required,
        group: classify({ name: name2, type, required }),
        ...required ? {} : { default: value }
      };
      slots.push(slot);
      taken.set(name2, slot);
    }
  }
  if (!slots.some((slot) => slot.group === "basic")) {
    const candidates = slots.filter((slot) => slot.type === "string" && /text|prompt|character|action|caption|description|wildcard/i.test(slot.name));
    for (const slot of candidates.slice(0, 2)) {
      slot.group = "basic";
      notes.push(`\u6CA1\u6709\u8BC6\u522B\u51FA\u6807\u51C6\u63D0\u793A\u8BCD\u53C2\u6570\uFF0C\u5DF2\u628A ${slot.name} \u63D0\u4E3A\u5E38\u7528\u53C2\u6570\u3002`);
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
  return {
    slots: limitSlots(slots, notes),
    models: inferModels(nodes),
    outputs: inferOutputs(nodes, notes),
    notes
  };
}
var MAX_EXPOSED_SLOTS = 24;
var PRIORITY = [
  /^(prompt|negative_prompt|text|text_g|text_l|caption|character|action|wildcard)$/i,
  /^(seed|noise_seed|steps|cfg|denoise|strength|width|height|batch_size|guidance)$/i,
  /^(sampler_name|scheduler|checkpoint|model|lora_name)$/i
];
function rankOf(slot) {
  if (slot.group === "basic") return 0;
  for (let index = 0; index < PRIORITY.length; index += 1) {
    if (PRIORITY[index].test(slot.name)) return index + 1;
  }
  return PRIORITY.length + 1;
}
function limitSlots(slots, notes) {
  if (slots.length <= MAX_EXPOSED_SLOTS) return slots;
  const kept = slots.map((slot, index) => ({ slot, index, rank: rankOf(slot) })).sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.index - b.index).slice(0, MAX_EXPOSED_SLOTS).sort((a, b) => a.index - b.index).map((item) => item.slot);
  notes.push(`\u53C2\u6570\u592A\u591A\uFF08${slots.length} \u4E2A\uFF09\uFF0C\u53EA\u66B4\u9732\u4E86\u6700\u76F8\u5173\u7684 ${MAX_EXPOSED_SLOTS} \u4E2A\uFF1B\u5176\u4F59\u4ECD\u53EF\u7528 persist \u6539\u8282\u70B9\u3002`);
  return kept;
}
function classify(slot) {
  if (slot.required && (slot.type === "image" || slot.type === "mask")) return "basic";
  if (slot.type === "image" && /^(input_image|image|init_image|reference|image_path)$/i.test(slot.name)) return "basic";
  if (slot.type === "string" && /^(prompt|negative_prompt|text)$/i.test(slot.name)) return "basic";
  return "advanced";
}

// src/shared/workflow/surface.ts
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
    enabled: typeof meta?.enabled === "boolean" ? meta.enabled : true,
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

// src/shared/workflow/store.ts
import fs6 from "node:fs";
import path5 from "node:path";
function pathsOf(dir, id) {
  return {
    workflow: path5.join(dir, `${id}.json`),
    schema: path5.join(dir, `${id}.schema.json`),
    meta: path5.join(dir, `${id}.meta.json`)
  };
}
function readJson(file) {
  try {
    const parsed = JSON.parse(fs6.readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function listWorkflowIds(dir) {
  let names;
  try {
    names = fs6.readdirSync(dir);
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
function writeMeta(dir, id, meta) {
  ensureDir(dir);
  const merged = {
    ...meta,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs6.writeFileSync(pathsOf(dir, id).meta, `${JSON.stringify(merged, null, 2)}
`, "utf8");
}

// src/components/panel-workflow/server/run-api.ts
function createRunHandler(deps) {
  return async (_url, res, req) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const outputPathOf = () => typeof body.outputPath === "string" && body.outputPath.trim() !== "" ? body.outputPath.trim() : deps.settings.outputDir ?? deps.defaultOutputDir;
    const resumeId = typeof body.promptId === "string" ? body.promptId.trim() : "";
    if (resumeId !== "") {
      try {
        deps.assertWritable(outputPathOf());
      } catch (error) {
        sendJson(res, 400, { ok: false, error: "forbidden-output", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      try {
        const outcome = await resumeRun(deps.client, resumeId, { outputDir: outputPathOf() });
        if ("pending" in outcome) {
          sendJson(res, 200, { ok: true, pending: true, promptId: resumeId });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective
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
    const outputPath = outputPathOf();
    const timeoutMs = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) ? Math.min(36e5, Math.max(1e3, Math.round(body.timeoutMs))) : deps.settings.timeoutMs;
    try {
      deps.assertWritable(outputPath);
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: "forbidden-output",
        message: error instanceof Error ? error.message : String(error)
      });
      return;
    }
    try {
      const submitted = await submitWorkflow({
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
        pending: true,
        promptId: submitted.promptId,
        effectiveVars: submitted.effective,
        notes: submitted.notes
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

// src/components/panel-workflow/server/service-api.ts
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

// src/components/panel-workflow/server/workflows-api.ts
function toListItem(surface, available) {
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
    workflowHash: surface.workflowHash,
    enabled: surface.enabled,
    ...available === null ? {} : (() => {
      const missing = missingModels(surface.models, available);
      if (missing.length === 0) return {};
      const primary2 = surface.models.find((model) => model.primary === true) ?? surface.models[0];
      return {
        missingModels: missing,
        modelHint: `\u672C\u673A\u6CA1\u6709\uFF1A${missing.join("\u3001")}\u3002\u53EF\u7528\u7684\u66FF\u4EE3\uFF1A${suggestModels(available, primary2?.kind ?? "checkpoint").join("\u3001") || "\uFF08\u4E00\u4E2A\u90FD\u6CA1\u6709\uFF09"}`
      };
    })()
  };
}
async function handleWorkflowList(dir, _url, res, available) {
  const { entries, broken } = listEntries(dir);
  sendJson(res, 200, {
    ok: true,
    count: entries.length,
    workflows: entries.map((entry) => toListItem(entry.surface, available)),
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
async function handleWorkflowUpdate(dir, id, res, req) {
  const entry = readEntry(dir, id);
  if (entry === void 0) {
    sendJson(res, 404, { ok: false, error: "not-found", message: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${id}` });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
    return;
  }
  const bag = body !== null && typeof body === "object" ? body : {};
  const next = {
    ...entry.meta ?? {},
    ...typeof bag.title === "string" ? { title: bag.title.trim() } : {},
    ...typeof bag.description === "string" ? { description: bag.description.trim() } : {},
    ...typeof bag.enabled === "boolean" ? { enabled: bag.enabled } : {},
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    updatedBy: "user"
  };
  writeMeta(dir, id, next);
  const updated = readEntry(dir, id);
  sendJson(res, 200, {
    ok: true,
    workflowId: id,
    enabled: updated?.surface.enabled ?? true,
    title: updated?.surface.title ?? "",
    description: updated?.surface.description ?? ""
  });
}

// src/components/panel-workflow/server/routes.ts
function createWorkflowRoutes(deps) {
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, outputSource, getDiagnostics, getExporter } = deps;
  return {
    exact: {
      // 同一路径两种方法：GET 列出工作流，POST 批量导出（导出由相册组件提供）。
      "/workflows": async (url, res, req) => {
        if (req.method === "GET" || req.method === "HEAD") {
          let available = null;
          try {
            available = availableModels(await client.objectInfo(false, { timeoutMs: 2e3, skipEnsure: true }));
          } catch {
            available = null;
          }
          await handleWorkflowList(workflowDir, url, res, available);
          return;
        }
        if (req.method === "POST") {
          const exporter = getExporter();
          if (exporter === void 0) {
            sendJson(res, 404, { ok: false, error: "unknown-route", message: "\u6279\u91CF\u5BFC\u51FA\u9700\u8981\u76F8\u518C\u7EC4\u4EF6\u3002" });
            return;
          }
          await exporter(url, res, req);
          return;
        }
        sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "/workflows \u53EA\u63A5\u53D7 GET\uFF08\u5217\u8868\uFF09\u6216 POST\uFF08\u6279\u91CF\u5BFC\u51FA\uFF09\u3002" });
      },
      "/run": createRunHandler({ client, workflowDir, settings, assertWritable, defaultOutputDir }),
      "/free": async (_url, res) => {
        try {
          await client.free();
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/service": handleServiceStatus.bind(null, supervisor),
      "/service/stop": handleServiceStop.bind(null, supervisor),
      "/config": createConfigHandler({
        settings,
        outputDir: defaultOutputDir,
        workflowsDir: workflowDir,
        outputSource,
        getDiagnostics
      })
    },
    list: async (url, res) => {
      let available = null;
      try {
        available = availableModels(await client.objectInfo(false, { timeoutMs: 2e3, skipEnsure: true }));
      } catch {
        available = null;
      }
      await handleWorkflowList(workflowDir, url, res, available);
    },
    detail: (id, res) => handleWorkflowDetail(workflowDir, id, res),
    update: (id, res, req) => handleWorkflowUpdate(workflowDir, id, res, req),
    detailIdOf: workflowIdFromPath,
    byId: async (url, res, req) => {
      const sub = url.pathname.slice(url.pathname.indexOf("/workflows"));
      const id = workflowIdFromPath(sub);
      if (id === void 0) {
        sendJson(res, 404, { ok: false, error: "unknown-route", message: "\u7F3A\u5C11\u5DE5\u4F5C\u6D41 id\u3002" });
        return;
      }
      if (req.method === "GET" || req.method === "HEAD") {
        handleWorkflowDetail(workflowDir, id, res);
        return;
      }
      if (req.method === "POST") {
        await handleWorkflowUpdate(workflowDir, id, res, req);
        return;
      }
      sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u4E2A\u63A5\u53E3\u53EA\u63A5\u53D7 GET / POST\u3002" });
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

// src/shared/authz/authorize.ts
import path7 from "node:path";

// src/shared/authz/legacy-paths.ts
import fs7 from "node:fs";
import path6 from "node:path";
function comfyImageOutputDir() {
  const file = path6.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs7.readFileSync(file, "utf8"));
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
  const abs = canonical(target).toLowerCase();
  return roots.some((root) => {
    const base = root.path.toLowerCase();
    return abs === base || abs.startsWith(base.endsWith(path7.sep) ? base : base + path7.sep);
  });
}

// src/shared/authz/roots.ts
import fs8 from "node:fs";
import path8 from "node:path";
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
    path: settings.uploadsDir ?? path8.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path8.join(pluginDataDir(), "outputs"), kind: "output" });
  if (typeof settings.outputDir === "string" && settings.outputDir !== "") {
    candidates.push({ path: settings.outputDir, kind: "output" });
  }
  for (const extra of assetRoots) candidates.push({ path: extra, kind: "custom" });
  const seen = /* @__PURE__ */ new Set();
  const roots = [];
  for (const candidate of candidates) {
    const abs = canonical(candidate.path);
    const key = abs.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let exists = false;
    try {
      exists = fs8.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path8.basename(abs) || abs, kind: candidate.kind });
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
import fs9 from "node:fs";
import path9 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs9.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
}
function cwdCandidate() {
  const cwd = process.cwd();
  if (cwd === "" || looksInternal(cwd)) return void 0;
  return cwd;
}
function workspaceDirOf(ctx) {
  const explicit = process.env.DSH_WORKSPACE;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return { dir: path9.resolve(explicit.trim()), source: "env" };
  }
  let paths = [];
  try {
    const service = ctx.get?.("workspace");
    const raw = typeof service?.list === "function" ? service.list() : [];
    if (Array.isArray(raw)) {
      paths = raw.map((item) => item !== null && typeof item === "object" ? item.path : void 0).filter((item) => typeof item === "string" && item !== "");
    }
  } catch {
    paths = [];
  }
  if (paths.length > 0) {
    const cwd2 = process.cwd();
    const related = paths.find((item) => cwd2 === item || cwd2.startsWith(`${item}\\`) || cwd2.startsWith(`${item}/`));
    return { dir: related ?? paths[0], source: "service" };
  }
  const cwd = cwdCandidate();
  return cwd === void 0 ? void 0 : { dir: cwd, source: "cwd" };
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path9.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path9.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
import fs10 from "node:fs";
import path10 from "node:path";
function indexPath() {
  return path10.join(pluginDataDir(), "assets.jsonl");
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
      text = fs10.readFileSync(this.file, "utf8");
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
    ensureDir(path10.dirname(this.file));
    fs10.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path10.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs10.writeFileSync(this.file, body === "" ? "" : `${body}
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
import fs15 from "node:fs";
import path15 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/components/panel-gallery/server/scan/collect.ts
import fs13 from "node:fs";
import path12 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs12 from "node:fs";
import path11 from "node:path";

// src/components/panel-gallery/server/scan/png-text.ts
import fs11 from "node:fs";
import zlib2 from "node:zlib";

// src/components/panel-gallery/server/scan/sidecar.ts
import fs14 from "node:fs";
import "node:path";

// src/components/panel-gallery/server/scan/mime.ts
import path14 from "node:path";

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
      const selfManaged = sub === "/workflows" || sub.startsWith("/workflows/");
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
function componentStateOf(rt) {
  const disabled = new Set(rt.settings.disabledComponents);
  return {
    "panel.gallery": !disabled.has("panel.gallery"),
    "panel.workflow": !disabled.has("panel.workflow"),
    "tool.generate": !disabled.has("tool.generate"),
    "tool.workflow-edit": !disabled.has("tool.workflow-edit")
  };
}
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
  shared.current.ownerCtx = ctx;
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
  const guess = workspaceDirOf(ctx);
  const resolved = resolveOutputDir(settings.outputDir, guess, pluginDataDir());
  const outputDir = resolved.dir;
  ensureDir(outputDir);
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand },
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger
  });
  const client = new ComfyClient({
    baseUrl: settings.baseUrl,
    headers: settings.headers,
    requestTimeoutMs: settings.timeoutMs,
    ensure: () => supervisor.ensureReady()
  });
  const index = settings.indexFile === null ? new AssetIndex() : new AssetIndex(settings.indexFile);
  const rootsSettings = { ...settings, resolvedOutputDir: outputDir };
  const assertWritable = (dir) => {
    const roots = rootsOf(ctx, rootsSettings);
    if (roots.length === 0) return;
    if (!isAuthorized(dir, roots)) {
      throw new Error(`\u8F93\u51FA\u76EE\u5F55\u4E0D\u5728\u6388\u6743\u8303\u56F4\u5185\uFF1A${dir}\u3002\u8BF7\u5728\u914D\u7F6E\u7684 assetRoots \u91CC\u52A0\u4E0A\u5B83\uFF0C\u6216\u6539\u7528 workspace \u5185\u7684\u76EE\u5F55\u3002`);
    }
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
    index,
    flowDir,
    outputDir,
    outputSource: resolved.source,
    uploadsDir,
    assertWritable,
    logger,
    warn,
    info,
    track,
    tools: { registered: [], failed: [], skipped: [] }
  };
}

// src/entries/workflow.ts
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
var name = "dsh-comfyui-workbench:workflow";
var inject = ["webServer"];
function recordFailure(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = path16.join(process.env.USERPROFILE ?? os.homedir(), ".dsh-comfyui-workbench");
    fs16.mkdirSync(dir, { recursive: true });
    fs16.writeFileSync(path16.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] workflow entry
${message}
`, "utf8");
  } catch {
  }
}
function apply(ctx, config) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}
function applyInner(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.workflow")) {
    warnDisabled("panel.workflow");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "workflow: runtime");
  ensureHttp(ctx, rt);
  const routes = createWorkflowRoutes({
    client: rt.client,
    supervisor: rt.supervisor,
    workflowDir: rt.flowDir,
    settings: rt.settings,
    assertWritable: rt.assertWritable,
    defaultOutputDir: rt.outputDir,
    outputSource: rt.outputSource,
    getDiagnostics: () => ({ components: componentStateOf(rt), tools: rt.tools }),
    getExporter: () => rt.exportWorkflows
  });
  const table = {
    exact: routes.exact,
    prefix: [{ base: "/workflows/", handle: routes.byId }]
  };
  if (typeof ctx.effect === "function") {
    ctx.effect(() => mountRoutes(ctx, "panel.workflow", table), "workflow: routes");
  } else {
    mountRoutes(ctx, "panel.workflow", table);
  }
  rt.info("[comfyui-workbench] \u5DE5\u4F5C\u6D41\u7BA1\u7406\u5DF2\u4E0A\u7EBF");
}
export {
  apply,
  inject,
  name
};
