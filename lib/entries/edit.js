// src/components/tool-generate/tools/run.ts
import fs7 from "node:fs";
import path6 from "node:path";

// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path4 from "node:path";

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

// src/shared/media/png-text.ts
import fs2 from "node:fs";
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
    fd = fs2.openSync(imagePath, "r");
    const buffer = Buffer.alloc(length);
    const read = fs2.readSync(fd, buffer, 0, length, 0);
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
    if (fd !== void 0) fs2.closeSync(fd);
  }
}

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
import fs3 from "node:fs";
import path2 from "node:path";
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
    if (!fs3.statSync(path2.join(dir, "main.py")).isFile()) return false;
    return fs3.statSync(path2.join(dir, "models")).isDirectory();
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
    names = fs3.readdirSync(installs);
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
      if (fs3.statSync(candidate).isFile()) return candidate;
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
import fs4 from "node:fs";
import path3 from "node:path";
async function ensureComfyImage(client, value) {
  const looksLocal = /[\\/]/.test(value) || path3.isAbsolute(value);
  if (!looksLocal) return value;
  let bytes;
  try {
    bytes = fs4.readFileSync(value);
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
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
async function waitForRun(client, promptId, options) {
  const startedAt = Date.now();
  options.onStage?.("waiting");
  const deadline = startedAt + options.timeoutMs;
  for (; ; ) {
    const state = await checkRun(client, promptId);
    if (state.done && state.entry !== void 0) {
      options.onStage?.("fetching");
      const context = recallRun(promptId) ?? {
        workflowId: options.fallback.workflowId ?? "unknown",
        workflowHash: options.fallback.workflowHash ?? "",
        outputDir: options.fallback.outputDir,
        effective: options.fallback.effective ?? {},
        writeMetadata: true,
        submittedAt: startedAt
      };
      return await collectArtifacts(client, promptId, state.entry, context);
    }
    if (Date.now() > deadline) {
      return {
        ok: true,
        pending: true,
        promptId,
        waitedMs: Date.now() - startedAt,
        hint: "\u8FD8\u5728\u51FA\u56FE\u3002\u7528\u540C\u4E00\u4E2A\u5DE5\u5177\u4F20 promptId \u7EED\u67E5\uFF1B\u8FD9\u6B21\u8C03\u7528\u7ED3\u675F\u540E ComfyUI \u4FA7\u4E0D\u4F1A\u4E2D\u65AD\u3002"
      };
    }
    await sleep(options.pollIntervalMs);
  }
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
var NOTICE_SOURCE_KIND = "plugin:dsh-comfyui-workbench";
var watchers = /* @__PURE__ */ new Map();
function noticeMessage(text) {
  return {
    id: crypto3.randomUUID(),
    role: "user",
    content: [{ type: "text", text }],
    source: { kind: NOTICE_SOURCE_KIND }
  };
}
function deliver(target, text, logger) {
  try {
    target.followup(noticeMessage(text));
  } catch (error) {
    logger?.warn?.(`[notify] \u901A\u77E5\u672A\u9001\u8FBE\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
}
function watchRun(options) {
  const { client, target, promptId, outputDir } = options;
  const intervalMs = options.intervalMs ?? 5e3;
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1e3;
  const startedAt = Date.now();
  const stop = () => {
    const current = watchers.get(promptId);
    if (current !== void 0) {
      clearInterval(current.timer);
      watchers.delete(promptId);
    }
  };
  stop();
  const timer = setInterval(() => {
    void (async () => {
      try {
        const state = await checkRun(client, promptId);
        if (!state.done || state.entry === void 0) {
          if (Date.now() - startedAt > maxWaitMs) {
            stop();
            deliver(
              target,
              `\u5DE5\u4F5C\u6D41\u4ECD\u5728\u8DD1\uFF08promptId ${promptId}\uFF09\uFF0C\u5DF2\u7ECF\u7B49\u4E86 ${Math.round((Date.now() - startedAt) / 6e4)} \u5206\u949F\uFF0C\u5148\u4E0D\u76EF\u4E86\u3002
\u9700\u8981\u7ED3\u679C\u65F6\u8BA9\u6A21\u578B\u7528 comfyui_run \u4F20\u8FD9\u4E2A promptId\u3002`,
              options.logger
            );
          }
          return;
        }
        const context = recallRun(promptId) ?? {
          workflowId: "unknown",
          workflowHash: "",
          outputDir,
          effective: {},
          writeMetadata: true,
          submittedAt: startedAt
        };
        const outcome = await collectArtifacts(client, promptId, state.entry, context);
        stop();
        const lines = [`\u5DE5\u4F5C\u6D41 ${context.workflowId} \u51FA\u56FE\u5B8C\u6210\uFF0C\u7528\u65F6 ${Math.round(outcome.durationMs / 1e3)} \u79D2\u3002`, ""];
        for (const artifact of outcome.artifacts) {
          const size = artifact.width !== void 0 && artifact.height !== void 0 ? ` \xB7 ${artifact.width}\xD7${artifact.height}` : "";
          lines.push(`- ${artifact.path}${size} \xB7 ${Math.round(artifact.bytes / 1024)} KB`);
        }
        deliver(target, lines.join("\n"), options.logger);
      } catch (error) {
        stop();
        const message = error instanceof Error ? error.message : String(error);
        options.logger?.warn?.(`[notify] ${promptId} \u7B49\u5F85\u5931\u8D25\uFF1A${message}`);
        deliver(target, `\u5DE5\u4F5C\u6D41\u6267\u884C\u5931\u8D25\uFF08promptId ${promptId}\uFF09\uFF1A${message}`, options.logger);
      }
    })();
  }, intervalMs);
  timer.unref?.();
  watchers.set(promptId, { timer, startedAt });
  return stop;
}
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
function writeWorkflow(dir, id, workflow) {
  ensureDir(dir);
  fs6.writeFileSync(pathsOf(dir, id).workflow, `${JSON.stringify(workflow, null, 2)}
`, "utf8");
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

// src/shared/tools/types.ts
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

// src/components/tool-generate/tools/run.ts
function loadWorkflow(deps, args) {
  const spec = asRecord(args.workflow);
  const id = asString(spec.id).trim();
  if (id !== "") {
    const entry = readEntry(deps.workflowsDir, id);
    if (entry === void 0) throw new Error(`\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${id}\u3002\u5148\u7528 comfyui_workflow_list \u770B\u6709\u54EA\u4E9B\u3002`);
    if (!entry.surface.enabled) {
      throw new Error(`\u5DE5\u4F5C\u6D41 ${id} \u5DF2\u88AB\u505C\u7528\uFF0C\u4E0D\u80FD\u6267\u884C\u3002\u9700\u8981\u7684\u8BDD\u5728\u5DE5\u4F5C\u6D41\u7BA1\u7406\u9762\u677F\u91CC\u91CD\u65B0\u542F\u7528\u3002`);
    }
    return { workflowId: id, workflow: entry.workflow, surface: entry.surface };
  }
  const filePath = asString(spec.path).trim();
  if (filePath === "") throw new Error('\u9700\u8981 workflow\uFF1A{"id":"\u2026"} \u6216 {"path":"\u2026"}\u3002');
  let raw;
  try {
    raw = JSON.parse(fs7.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`\u8BFB\u4E0D\u4E86\u5DE5\u4F5C\u6D41\u6587\u4EF6\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("\u5DE5\u4F5C\u6D41\u6587\u4EF6\u4E0D\u662F JSON \u5BF9\u8C61\u3002");
  const workflow = raw;
  const workflowId = path6.basename(filePath, path6.extname(filePath));
  return { workflowId, workflow, surface: buildSurface({ workflowId, workflow }) };
}
function runTool(deps) {
  return {
    name: "comfyui_run",
    description: "\u6267\u884C\u4E00\u4E2A ComfyUI \u5DE5\u4F5C\u6D41\u3002\u53C2\u6570\u7528 vars \u4F20\uFF08\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u58F0\u660E\u8FC7\u7684\u8F93\u5165\u540D\uFF0C\u53EF\u7528 comfyui_workflow_list / inspect \u67E5\uFF09\u3002\u8FD4\u56DE\u503C\u5305\u542B\u4EA7\u7269\u8DEF\u5F84\u4E0E\u539F\u59CB\u50CF\u7D20\u5C3A\u5BF8\uFF1B\u5BBF\u4E3B\u4E0D\u56DE\u4F20\u56FE\u7247\u672C\u8EAB\uFF0C\u9700\u8981\u770B\u56FE\u65F6\u6309\u8FD4\u56DE\u7684\u8DEF\u5F84\u8BFB\u53D6\u539F\u56FE\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        promptId: {
          type: "string",
          description: "\u7EED\u67E5\u4E00\u6B21\u5DF2\u63D0\u4EA4\u4F46\u8FD8\u6CA1\u51FA\u5B8C\u7684\u8FD0\u884C\uFF08\u4E0A\u4E00\u6B21\u8FD4\u56DE\u91CC\u7ED9\u7684 promptId\uFF09\u3002\u4F20\u4E86\u5B83\u5C31\u4E0D\u7528\u518D\u7ED9 workflow\u3002"
        },
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
        returnImages: {
          type: "string",
          enum: ["first", "all", "none"],
          description: "\u5DF2\u5F03\u7528\uFF1A\u5DE5\u5177\u7ED3\u679C\u4E0D\u80FD\u627F\u8F7D\u4E8C\u8FDB\u5236\u56FE\u7247\uFF0C\u56FE\u7247\u4E00\u5F8B\u53EA\u7ED9\u8DEF\u5F84\u3002\u4FDD\u7559\u8BE5\u53C2\u6570\u53EA\u4E3A\u517C\u5BB9\u65E7\u8C03\u7528\u3002"
        }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => {
        const blocks = [];
        const bag = value !== null && typeof value === "object" ? value : {};
        const artifacts = Array.isArray(bag.artifacts) ? bag.artifacts : [];
        const lines = [];
        if (bag.pending === true) {
          lines.push(String(bag.message ?? "\u5DF2\u63D0\u4EA4\uFF0C\u8FD8\u5728\u51FA\u56FE\u3002"));
          if (typeof bag.hint === "string" && bag.hint !== "") lines.push(String(bag.hint));
          lines.push(`promptId\uFF1A${String(bag.promptId)}`);
          blocks.push({ type: "text", text: lines.join(String.fromCharCode(10)) });
          return blocks;
        }
        if (bag.ok === true) {
          lines.push(`\u5DE5\u4F5C\u6D41 ${String(bag.workflowId)} \u6267\u884C\u5B8C\u6210\uFF0C\u7528\u65F6 ${String(bag.durationMs)} ms\u3002`);
          for (const item of artifacts) {
            const size = item.width !== void 0 && item.height !== void 0 ? `\uFF0C\u539F\u56FE ${item.width}\xD7${item.height}` : "";
            lines.push(`- ${item.path}\uFF08${item.mime}\uFF0C${Math.round(item.bytes / 1024)} KB${size}\uFF09`);
          }
          if (Array.isArray(bag.notes) && bag.notes.length > 0) lines.push(`\u5907\u6CE8\uFF1A${bag.notes.join("\uFF1B")}`);
          lines.push("\u56FE\u7247\u53EA\u7ED9\u8DEF\u5F84\uFF1A\u9700\u8981\u770B\u56FE\u6216\u7EE7\u7EED\u5904\u7406\u65F6\uFF0C\u7528\u4E0A\u9762\u7684\u8DEF\u5F84\u8BFB\u53D6\u539F\u56FE\uFF1B\u54CD\u5E94\u91CC\u6CA1\u6709\u56FE\u7247\u526F\u672C\u3002");
        } else {
          lines.push(String(bag.message ?? "\u6267\u884C\u5931\u8D25\u3002"));
          if (typeof bag.hint === "string" && bag.hint !== "") lines.push(`\u4E0B\u4E00\u6B65\uFF1A${bag.hint}`);
        }
        blocks.push({ type: "text", text: lines.join("\n") });
        return blocks;
      }
    },
    async execute(args, exec) {
      const resumeId = asString(args.promptId).trim();
      if (resumeId !== "") {
        try {
          const outcome = await resumeRun(deps.client, resumeId, { outputDir: deps.outputDir });
          return formatOutcome(outcome, deps);
        } catch (error) {
          return failureOf(error);
        }
      }
      const loaded = loadWorkflow(deps, args);
      const outputDir = asString(args.outputPath).trim() !== "" ? asString(args.outputPath).trim() : deps.outputDir;
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
      const pending2 = deps.overrides.get(loaded.workflowId);
      const preNotes = [];
      if (pending2 !== void 0 && pending2.length > 0) {
        for (const patch of pending2) {
          const node = loaded.workflow[patch.nodeId];
          if (node !== void 0 && node.inputs !== null && typeof node.inputs === "object") node.inputs[patch.input] = patch.value;
        }
        deps.overrides.delete(loaded.workflowId);
        preNotes.push(`\u5DF2\u5E94\u7528 ${pending2.length} \u5904\u4E00\u6B21\u6027\u53C2\u6570\u8986\u76D6\uFF08\u672A\u5199\u5165\u6A21\u677F\uFF09\u3002`);
      }
      try {
        deps.assertWritable(outputDir);
      } catch (error) {
        return { ok: false, code: "forbidden_output", message: error instanceof Error ? error.message : String(error) };
      }
      try {
        const submitted = await submitWorkflow({
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
        if (args.wait !== true) {
          const agent = exec?.agent;
          const canNotify = agent !== void 0 && typeof agent.followup === "function";
          if (canNotify) {
            watchRun({
              client: deps.client,
              target: agent,
              promptId: submitted.promptId,
              outputDir,
              ...deps.logger === void 0 ? {} : { logger: deps.logger }
            });
          }
          return {
            ok: true,
            pending: true,
            promptId: submitted.promptId,
            waitedMs: 0,
            message: `\u5DF2\u63D0\u4EA4\uFF08promptId ${submitted.promptId}\uFF09\uFF0CComfyUI \u6B63\u5728\u51FA\u56FE\u3002`,
            hint: canNotify ? "\u51FA\u56FE\u5B8C\u6210\u540E\u6211\u4F1A\u5728\u8FD9\u4E2A\u5BF9\u8BDD\u91CC\u4E3B\u52A8\u901A\u77E5\u4F60\uFF08\u542B\u4EA7\u7269\u8DEF\u5F84\uFF09\uFF1B\u4E5F\u53EF\u4EE5\u968F\u65F6\u7528 comfyui_run \u4F20 promptId \u624B\u52A8\u67E5\u3002" : "\u51FA\u56FE\u8981\u51E0\u5206\u949F\u3002\u7A0D\u540E\u7528 comfyui_run \u4F20 promptId \u5C31\u80FD\u53D6\u7ED3\u679C\uFF1B\u8FD9\u6B21\u8C03\u7528\u7ED3\u675F\u540E\u4EFB\u52A1\u4E0D\u4F1A\u4E2D\u65AD\u3002",
            notes: submitted.notes
          };
        }
        const outcome = await waitForRun(deps.client, submitted.promptId, {
          timeoutMs: asInt(args.waitMs, deps.timeoutMs, 1e3, 18e5),
          pollIntervalMs: deps.pollIntervalMs,
          fallback: {
            outputDir,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash,
            effective: submitted.effective
          }
        });
        if ("pending" in outcome) return formatOutcome(outcome, deps);
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
        return {
          ok: true,
          workflowId: outcome.workflowId !== "" ? outcome.workflowId : loaded.workflowId,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
          notes: outcome.notes
        };
      } catch (error) {
        return failureOf(error);
      }
    }
  };
}
function formatOutcome(outcome, _deps) {
  if ("pending" in outcome) {
    return {
      ok: true,
      pending: true,
      promptId: outcome.promptId,
      waitedMs: outcome.waitedMs,
      message: `\u5DF2\u63D0\u4EA4\uFF0C\u7B49\u4E86 ${Math.round(outcome.waitedMs / 1e3)} \u79D2\u8FD8\u5728\u51FA\u56FE\u3002`,
      hint: outcome.hint
    };
  }
  return {
    ok: true,
    promptId: outcome.promptId,
    workflowId: outcome.workflowId,
    durationMs: outcome.durationMs,
    artifacts: outcome.artifacts,
    effectiveVars: outcome.effective,
    notes: outcome.notes
  };
}
function failureOf(error) {
  const bag = error !== null && typeof error === "object" ? error : null;
  return {
    ok: false,
    code: typeof bag?.code === "string" ? bag.code : "execution_failed",
    message: error instanceof Error ? error.message : String(error),
    ...typeof bag?.hint === "string" ? { hint: bag.hint } : {}
  };
}

// src/components/tool-workflow-edit/tools/workflow-edit.ts
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
    const text = String(value);
    if (slot.options !== void 0 && slot.options.length > 0 && !slot.options.includes(text)) {
      throw new Error(`${slot.name} \u53EA\u63A5\u53D7\uFF1A${slot.options.join(" / ")}\u3002`);
    }
    return text;
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

// src/components/tool-generate/tools/workflow-inspect.ts
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
      let absentModels = [];
      let modelHint = "";
      try {
        const info = await deps.client.objectInfo();
        const known = new Set(Object.keys(info));
        if (known.size > 0) {
          missing = [...new Set(Object.values(entry.workflow).map((node) => String(node.class_type ?? "")).filter((name2) => name2 !== "" && !known.has(name2)))];
          const available = availableModels(info);
          absentModels = missingModels(entry.surface.models, available);
          if (absentModels.length > 0) {
            const primary = entry.surface.models.find((model) => model.primary === true) ?? entry.surface.models[0];
            modelHint = `\u672C\u673A\u6CA1\u6709\uFF1A${absentModels.join("\u3001")}\u3002\u53EF\u7528\u7684\u66FF\u4EE3\uFF1A${suggestModels(available, primary?.kind ?? "checkpoint").join("\u3001") || "\uFF08\u4E00\u4E2A\u90FD\u6CA1\u6709\uFF09"}`;
          }
        }
      } catch (error) {
        deps.logger?.warn?.(`[${workflowId}] \u9884\u68C0\u8DF3\u8FC7\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }
      return {
        ok: true,
        ...surfaceView(entry.surface, missing),
        ...absentModels.length === 0 ? {} : { missingModels: absentModels, modelHint },
        nodes: nodeList(entry.workflow),
        hint: "\u8981\u770B\u67D0\u4E2A\u8282\u70B9\u7684\u5177\u4F53\u53C2\u6570\uFF0C\u7528\u540C\u4E00\u4E2A\u5DE5\u5177\u52A0 nodeId\u3002"
      };
    }
  };
}

// src/components/tool-generate/tools/workflow-list.ts
function toListItem(surface) {
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
    nodes: surface.meta.nodeCount,
    enabled: surface.enabled
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
        q: { type: "string", description: "\u6309\u6807\u9898 / \u5907\u6CE8 / \u6A21\u578B\u540D\u8FC7\u6EE4\uFF08\u4E0D\u533A\u5206\u5927\u5C0F\u5199\uFF09" },
        includeDisabled: { type: "boolean", description: "\u8FDE\u88AB\u7BA1\u7406\u5458\u505C\u7528\u7684\u5DE5\u4F5C\u6D41\u4E00\u8D77\u5217\u51FA\uFF08\u9ED8\u8BA4\u53EA\u770B\u53EF\u7528\u7684\uFF09" }
      }
    },
    output: jsonOutput(),
    async execute(args) {
      const query = asString(args.q).trim().toLowerCase();
      const { entries, broken } = listEntries(deps.workflowsDir);
      let available = null;
      try {
        available = availableModels(await deps.client.objectInfo());
      } catch {
        available = null;
      }
      const showDisabled = args.includeDisabled === true;
      const hidden = showDisabled ? 0 : entries.filter((entry) => !entry.surface.enabled).length;
      const visible = showDisabled ? entries : entries.filter((entry) => entry.surface.enabled);
      const items = visible.map((entry) => {
        const item = toListItem(entry.surface);
        if (available === null) return item;
        const missing = missingModels(entry.surface.models, available);
        if (missing.length === 0) return item;
        const primary = entry.surface.models.find((model) => model.primary === true) ?? entry.surface.models[0];
        return {
          ...item,
          missingModels: missing,
          modelHint: `\u672C\u673A\u6CA1\u6709\uFF1A${missing.join("\u3001")}\u3002\u53EF\u7528\u7684\u66FF\u4EE3\uFF1A${suggestModels(available, primary?.kind ?? "checkpoint").join("\u3001") || "\uFF08\u4E00\u4E2A\u90FD\u6CA1\u6709\uFF09"}`
        };
      }).filter((item) => {
        if (query === "") return true;
        const haystack = `${String(item.title)} ${String(item.description)} ${String(item.models.primary)}`.toLowerCase();
        return haystack.includes(query);
      });
      return {
        ok: true,
        count: items.length,
        workflows: items,
        ...broken.length > 0 ? { broken, brokenHint: "\u8FD9\u4E9B\u6587\u4EF6\u4E0D\u662F\u53EF\u7528\u7684 API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF0C\u5DF2\u8DF3\u8FC7\u3002" } : {},
        ...hidden > 0 ? { hiddenCount: hidden, hiddenHint: `\u53E6\u6709 ${hidden} \u4E2A\u5DE5\u4F5C\u6D41\u88AB\u505C\u7528\uFF08\u9762\u677F\u91CC\u53EF\u91CD\u65B0\u542F\u7528\uFF09\u3002` } : {},
        ...items.length === 0 && broken.length === 0 ? { hint: "\u6CA1\u6709\u53EF\u7528\u7684\u5DE5\u4F5C\u6D41\u3002\u7528\u9762\u677F\u542F\u7528\u4E00\u4E2A\uFF0C\u6216\u5BFC\u5165\u4E00\u4EFD API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF08ComfyUI \u91CC Export (API)\uFF09\u3002" } : {}
      };
    }
  };
}

// src/components/tool-generate/tools/registry.ts
var TOOL_GROUPS = [
  {
    name: "workflow-list",
    component: "tool.generate",
    title: "\u5217\u51FA\u5DE5\u4F5C\u6D41\u4E0E\u7F3A\u5931\u6A21\u578B",
    build: (deps) => workflowListTool(deps)
  },
  {
    name: "workflow-inspect",
    component: "tool.generate",
    title: "\u67E5\u770B\u5DE5\u4F5C\u6D41\u7684\u8F93\u5165\u8F93\u51FA\u9762",
    build: (deps) => workflowInspectTool(deps)
  },
  {
    name: "workflow-run",
    component: "tool.generate",
    title: "\u6267\u884C\u5DE5\u4F5C\u6D41\uFF08\u5F02\u6B65\u63D0\u4EA4 / \u7EED\u67E5\uFF09",
    build: (deps) => runTool(deps)
  },
  {
    name: "workflow-edit",
    component: "tool.workflow-edit",
    title: "\u6539\u5DE5\u4F5C\u6D41\u6807\u9898\u4E0E\u8BF4\u660E",
    build: (deps) => workflowEditTool(deps)
  }
];
function registerTools(groups, deps, options) {
  const report = { registered: [], failed: [], skipped: [] };
  for (const group of groups) {
    if (options.enabled !== void 0 && options.enabled.length > 0 && !options.enabled.includes(group.name)) {
      report.skipped.push(group.name);
      continue;
    }
    try {
      const tool = group.build(deps);
      options.register(tool);
      report.registered.push(`${group.name}\uFF08${tool.name}\uFF09`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.failed.push({ name: group.name, message });
      options.warn?.(`\u5DE5\u5177 ${group.name} \u6CE8\u518C\u5931\u8D25\uFF1A${message}\u3002\u5176\u4F59\u5DE5\u5177\u4E0D\u53D7\u5F71\u54CD\u3002`);
    }
  }
  return report;
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
import path8 from "node:path";

// src/shared/authz/legacy-paths.ts
import fs8 from "node:fs";
import path7 from "node:path";
function comfyImageOutputDir() {
  const file = path7.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs8.readFileSync(file, "utf8"));
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
    return abs === base || abs.startsWith(base.endsWith(path8.sep) ? base : base + path8.sep);
  });
}

// src/shared/authz/roots.ts
import fs9 from "node:fs";
import path9 from "node:path";
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
    path: settings.uploadsDir ?? path9.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path9.join(pluginDataDir(), "outputs"), kind: "output" });
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
      exists = fs9.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path9.basename(abs) || abs, kind: candidate.kind });
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
import fs10 from "node:fs";
import path10 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs10.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
}
function cwdCandidate() {
  const cwd = process.cwd();
  if (cwd === "" || looksInternal(cwd)) return void 0;
  return cwd;
}
function workspaceDirOf(ctx) {
  const explicit = process.env.DSH_WORKSPACE;
  if (typeof explicit === "string" && explicit.trim() !== "") {
    return { dir: path10.resolve(explicit.trim()), source: "env" };
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
    return { dir: path10.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path10.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
import fs11 from "node:fs";
import path11 from "node:path";
function indexPath() {
  return path11.join(pluginDataDir(), "assets.jsonl");
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
      text = fs11.readFileSync(this.file, "utf8");
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
    ensureDir(path11.dirname(this.file));
    fs11.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path11.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs11.writeFileSync(this.file, body === "" ? "" : `${body}
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
import fs16 from "node:fs";
import path16 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/components/panel-gallery/server/scan/collect.ts
import fs14 from "node:fs";
import path13 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs13 from "node:fs";
import path12 from "node:path";

// src/components/panel-gallery/server/scan/png-text.ts
import fs12 from "node:fs";
import zlib2 from "node:zlib";

// src/components/panel-gallery/server/scan/sidecar.ts
import fs15 from "node:fs";
import "node:path";

// src/components/panel-gallery/server/scan/mime.ts
import path15 from "node:path";

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

// src/entries/edit.ts
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
var name = "dsh-comfyui-workbench:edit";
var inject = ["tools"];
function apply(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("tool.workflow-edit")) {
    warnDisabled("tool.workflow-edit");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "edit: runtime");
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    rt.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u5DE5\u4F5C\u6D41\u7F16\u8F91\u5DE5\u5177\u672A\u6CE8\u518C\u3002");
    return;
  }
  const report = registerTools(TOOL_GROUPS, {
    client: rt.client,
    workflowsDir: rt.flowDir,
    outputDir: rt.outputDir,
    timeoutMs: rt.settings.timeoutMs,
    pollIntervalMs: rt.settings.pollIntervalMs,
    overrides: /* @__PURE__ */ new Map(),
    index: rt.index,
    assertWritable: rt.assertWritable,
    logger: rt.logger
  }, {
    enabled: TOOL_GROUPS.filter((group) => group.component === "tool.workflow-edit").map((group) => group.name),
    register: (spec) => rt.track(tools.register(spec)),
    warn: rt.warn
  });
  rt.tools.registered.push(...report.registered);
  rt.tools.failed.push(...report.failed);
  rt.tools.skipped.push(...report.skipped);
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] \u5DE5\u5177 ${failure.name} \u672A\u6CE8\u518C\uFF1A${failure.message}`);
  rt.info(`[comfyui-workbench] \u5DE5\u4F5C\u6D41\u7F16\u8F91\u5DE5\u5177\u5DF2\u6CE8\u518C ${report.registered.length} \u4E2A`);
}
export {
  apply,
  inject,
  name
};
