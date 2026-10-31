// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs5 from "node:fs";
import path4 from "node:path";

// src/shared/host/paths.ts
import fs from "node:fs";
import path from "node:path";
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

// src/shared/run/policy.ts
var TRANSIENT_LIMIT = 6;
var TRANSIENT_FINAL_STATE = "unknown";
function codeOf(error) {
  if (error === null || typeof error !== "object") return "";
  const code = error.code;
  return typeof code === "string" ? code : "";
}
function isRetryable(error) {
  const code = codeOf(error);
  return code !== "execution_failed" && code !== "auth_failed";
}
function finalStateOf(error) {
  const code = codeOf(error);
  if (code === "execution_failed" || code === "auth_failed" || code === "no_output" || code === "output_unreadable") return "failed";
  return TRANSIENT_FINAL_STATE;
}
function codeOrDefault(error, fallback = "wait_failed") {
  const code = codeOf(error);
  return code === "" ? fallback : code;
}
function isFatalRunError(error) {
  return !isRetryable(error);
}
function giveUpMessage(error, promptId, failures) {
  const code = codeOf(error);
  const detail = error instanceof Error ? error.message : String(error);
  if (code === "no_output") {
    return `\u5DE5\u4F5C\u6D41\u6267\u884C\u5B8C\u6210\u4E86\uFF0C\u4F46\u6CA1\u6709\u62FF\u5230\u4EFB\u4F55\u4EA7\u7269\u6587\u4EF6\uFF08promptId ${promptId}\uFF09\u3002\u68C0\u67E5\u672B\u7AEF\u662F\u5426\u6709 SaveImage / PreviewImage \u8282\u70B9\uFF0C\u6216\u8BE5\u8282\u70B9\u662F\u5426\u88AB bypass\u3002`;
  }
  if (code === "output_unreadable") {
    return `\u6267\u884C\u5B8C\u6210\u4E86\uFF0C\u4F46\u4EA7\u7269\u6587\u4EF6\u8BFB\u4E0D\u51FA\u6765\uFF08promptId ${promptId}\uFF09\uFF1A${detail}\u3002\u68C0\u67E5\u8F93\u51FA\u76EE\u5F55\u7684\u6743\u9650\u4E0E\u78C1\u76D8\u7A7A\u95F4\u3002`;
  }
  if (code === "execution_failed") {
    return `\u5DE5\u4F5C\u6D41\u6267\u884C\u5931\u8D25\uFF08promptId ${promptId}\uFF09\uFF1A${detail}`;
  }
  if (code === "auth_failed") {
    return `ComfyUI \u8BA4\u8BC1\u5931\u8D25\uFF08promptId ${promptId}\uFF09\uFF1A${detail}\u3002\u68C0\u67E5 baseUrl \u4E0E\u51ED\u636E\u914D\u7F6E\u3002`;
  }
  return `\u8FDE\u7EED ${failures} \u6B21\u67E5\u4E0D\u5230 /history\uFF08promptId ${promptId}\uFF09\uFF1A${detail}
\u4EFB\u52A1\u53EF\u80FD\u8FD8\u5728 ComfyUI \u90A3\u8FB9\u8DD1\u3002\u7A0D\u540E\u7528 comfyui_run \u4F20\u8FD9\u4E2A promptId \u7EED\u67E5\u3002`;
}

// src/shared/comfy/client.ts
import crypto from "node:crypto";

// src/shared/comfy/failure-kind.ts
var MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i;
var RULES = [
  {
    kind: "oom",
    test: ({ text }) => (
      // 英文各种写法：CUDA 的 out of memory、PyTorch 的 "OOM when allocating tensor"、
      // 系统的 "Cannot allocate memory"（Errno 12）
      /out of memory|cuda oom|allocation on device|not enough memory|outofmemoryerror|memory allocation|cannot allocate memory|oom when allocating|errno 12/i.test(text) || /显存不足|显存不够|内存不足|内存不够|分配失败/.test(text)
    )
  },
  {
    kind: "missing_node",
    test: ({ text }) => /cannot execute because node|node type not found|class_type.*not found|does not exist.*node|missing node/i.test(text) || /the following node types were not found/i.test(text) || /node ['"`].+['"`] not found/i.test(text) || /节点.*(不存在|未安装|找不到)/.test(text)
  },
  {
    kind: "missing_model",
    // 只有"文件不存在" + 模型扩展名才算缺模型。
    // "Value not in list" 不归这里 —— 那个值可能只是拼写错了，候选里本来就有正确的，
    // 交给下面 bad_param 并点名"你写的是 X，候选里是 Y"。
    test: ({ text }) => /(no such file|not found|does not exist|cannot find|unable to locate)/i.test(text) && MODEL_EXT.test(text)
  },
  {
    kind: "bad_input",
    test: ({ text }) => /cannot identify image file|invalid image|image must be|failed to open image|unsupported image/i.test(text)
  },
  {
    kind: "bad_param",
    test: ({ text }) => /value not in list|out of range|must be (a |an )?(int|float|bool|number|string)|expected .* got|invalid (value|argument|parameter)/i.test(text) || /参数.*(不合法|越界|不在|无效)/.test(text)
  }
];
function classifyFailure(ctx) {
  for (const rule of RULES) {
    if (rule.test(ctx)) return rule.kind;
  }
  return "unknown";
}
function modelNameIn(text) {
  const rejected = text.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`]/i);
  if (rejected?.[1] !== void 0 && /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)x?$/i.test(rejected[1])) {
    return rejected[1];
  }
  const match = text.match(/[\w./\\-]+\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i);
  return match?.[0]?.trim();
}
function rejectedValueAndOptions(text) {
  const match = text.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`][\s\S]{0,40}?\[([^\]]*)\]/i);
  if (match === null) return void 0;
  const value = match[1]?.trim();
  if (value === void 0 || value === "") return void 0;
  const options = (match[2] ?? "").split(",").map((item) => item.trim().replace(/^['"`]|['"`]$/g, "")).filter((item) => item !== "");
  return { value, options };
}
function dimensionsIn(text) {
  const match = text.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
  if (match === null) return void 0;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : void 0;
}
function suggestSmaller(width, height) {
  const longEdge = Math.max(width, height);
  const scale = longEdge <= 1024 ? 0.5 : 1024 / longEdge;
  const snap = (value) => Math.max(256, Math.round(value * scale / 64) * 64);
  return { width: snap(width), height: snap(height) };
}
function similarity(a, b) {
  if (a === b) return 1;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  if (short === "") return 0;
  if (long.startsWith(short)) return short.length / long.length;
  let hit = 0;
  const pool = long.split("");
  for (const char of short) {
    const index = pool.indexOf(char);
    if (index >= 0) {
      hit += 1;
      pool.splice(index, 1);
    }
  }
  return hit / long.length;
}
function adviceFor(kind, ctx, options = {}) {
  const where = [ctx.nodeId === void 0 ? "" : `\u8282\u70B9 ${ctx.nodeId}`, ctx.nodeType ?? ""].filter((part) => part !== "").join(" ");
  switch (kind) {
    case "oom": {
      const size = dimensionsIn(ctx.text) ?? (options.width !== void 0 && options.height !== void 0 ? { width: options.width, height: options.height } : void 0);
      const smaller = size === void 0 ? void 0 : suggestSmaller(size.width, size.height);
      const base = size === void 0 ? "\u663E\u5B58\u4E0D\u591F\u3002\u628A\u957F\u8FB9\u964D\u5230 1024 \u4EE5\u5185\u518D\u8BD5" : `\u663E\u5B58\u4E0D\u591F\uFF08\u5F53\u524D ${size.width}\xD7${size.height}\uFF09\u3002\u964D\u5230 ${smaller?.width ?? 1024}\xD7${smaller?.height ?? 1024} \u518D\u8BD5`;
      return `${base}\uFF1B\u4E5F\u53EF\u4EE5\u5173\u6389\u5360\u663E\u5B58\u7684\u7A0B\u5E8F\uFF0C\u6216\u7ED9 ComfyUI \u52A0 --lowvram \u542F\u52A8\u53C2\u6570\u3002`;
    }
    case "missing_model": {
      const name = modelNameIn(ctx.text);
      const target = name === void 0 ? "\u7F3A\u7684\u90A3\u4E2A\u6A21\u578B\u6587\u4EF6" : `${name}`;
      return `\u627E\u4E0D\u5230${target}\u3002\u7528 comfyui_node_search \u7684 hasModel \u4F20\u6587\u4EF6\u540D\u7247\u6BB5\uFF0C\u80FD\u67E5\u51FA\u672C\u673A\u54EA\u4E9B\u8282\u70B9\u7684\u53EF\u9009\u503C\u91CC\u771F\u6709\u5B83\uFF1B\u786E\u5B9E\u6CA1\u6709\u5C31\u53BB ComfyUI \u7684 models \u76EE\u5F55\u8865\u4E0A\uFF08\u6216\u5728 ComfyUI-Manager \u91CC\u88C5\uFF09\u3002`;
    }
    case "missing_node":
      return `${where === "" ? "\u67D0\u4E2A\u8282\u70B9" : where} \u5728\u672C\u673A\u4E0D\u5B58\u5728\uFF1A\u591A\u534A\u662F\u6269\u5C55\u5305\u6CA1\u88C5\u3002\u7528 comfyui_node_search \u4F20\u5B83\u7684\u7C7B\u540D\u67E5\u5C5E\u4E8E\u54EA\u4E2A\u5305\uFF0C\u518D\u5728 ComfyUI-Manager \u91CC\u88C5\uFF1B\u88C5\u5B8C\u8981\u91CD\u542F ComfyUI\u3002`;
    case "bad_input":
      return `\u8F93\u5165\u56FE\u6709\u95EE\u9898\uFF08${where === "" ? "\u67D0\u4E2A\u56FE\u7247\u8F93\u5165" : where}\uFF09\u3002\u56FE\u7247\u7C7B\u8282\u70B9\u53EA\u8BA4 ComfyUI input/ \u76EE\u5F55\u91CC\u7684\u6587\u4EF6\u540D\uFF0C\u672C\u5730\u7EDD\u5BF9\u8DEF\u5F84\u4F1A\u88AB\u5224\u65E0\u6548\uFF08comfyui_run \u4F1A\u81EA\u52A8\u642C\u8FD0\uFF09\uFF1B\u82E5\u4ECD\u5931\u8D25\uFF0C\u786E\u8BA4\u90A3\u4E2A\u6587\u4EF6\u771F\u7684\u662F\u56FE\u7247\u3001\u6CA1\u88AB\u622A\u65AD\u3001\u4E5F\u6CA1\u88AB\u5220\u6389\u3002`;
    case "bad_param": {
      const rejected = rejectedValueAndOptions(ctx.text);
      if (rejected !== void 0) {
        const near = rejected.options.map((option) => ({ option, score: similarity(rejected.value, option) })).filter((item) => item.score > 0.6).sort((a, b) => b.score - a.score).slice(0, 3).map((item) => item.option);
        const nearHint = near.length > 0 ? `\uFF1B\u5019\u9009\u91CC\u6700\u63A5\u8FD1\u7684\u662F ${near.map((item) => `'${item}'`).join("\u3001")}` : "";
        return `${where === "" ? "\u67D0\u4E2A\u53C2\u6570" : where}\u7684\u53D6\u503C '${rejected.value}' \u4E0D\u5728\u5019\u9009\u5217\u8868\u91CC${nearHint}\u3002\u6539 vars \u91CC\u8FD9\u4E2A\u952E\u518D\u8BD5\uFF08\u5171 ${rejected.options.length} \u4E2A\u5019\u9009\uFF0C\u53EF\u7528 comfyui_workflow_inspect \u770B\u5168\uFF09\u3002`;
      }
      return `${where === "" ? "\u67D0\u4E2A\u53C2\u6570" : where}\u7684\u53D6\u503C\u4E0D\u5408\u6CD5\uFF08\u4E0D\u5728\u5019\u9009\u5217\u8868\u6216\u8D85\u51FA\u8303\u56F4\uFF09\u3002\u7528 comfyui_workflow_inspect \u52A0\u8BE5\u8282\u70B9\u7684 nodeId \u770B\u5B83\u7684\u53EF\u9009\u503C\u4E0E\u8303\u56F4\uFF0C\u518D\u6539 vars \u91CD\u8BD5\u3002`;
    }
    default:
      return "\u901A\u5E38\u662F\u6A21\u578B/\u8282\u70B9\u53C2\u6570\u4E0D\u5339\u914D\u3002\u5148\u7528 comfyui_workflow_inspect \u770B\u7F3A\u4E0D\u7F3A\u8282\u70B9\u4E0E\u6A21\u578B\uFF0C\u518D\u964D\u5206\u8FA8\u7387\u6216\u6362\u5E95\u6A21\u91CD\u8BD5\u3002";
  }
}

// src/shared/comfy/errors.ts
var RunError = class extends Error {
  code;
  hint;
  detail;
  /**
   * 执行失败的细分类型（只有 `execution_failed` 会带）。
   *
   * 单独一个字段而不改 `code`：调用方可能按 `code` 分支，
   * 而 `kind` 是用来区分"该降分辨率"还是"该去装模型"的。
   */
  kind;
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
function nodeMissing(missing) {
  return new RunError(
    "node_missing",
    `\u5DE5\u4F5C\u6D41\u9700\u8981\u8FD9\u4E9B\u8282\u70B9\uFF0C\u4F46 ComfyUI \u91CC\u6CA1\u6709\uFF1A${missing.join("\u3001")}`,
    "\u5148\u5B89\u88C5\u5BF9\u5E94\u7684\u81EA\u5B9A\u4E49\u8282\u70B9\u5305\uFF0C\u6216\u6362\u6210\u53EA\u542B\u5185\u7F6E\u8282\u70B9\u7684\u5DE5\u4F5C\u6D41\u3002",
    { missing }
  );
}
function executionFailed(entry, promptId, size) {
  const failure = failureDetail(entry);
  const ctx = { text: failure.text, nodeId: failure.nodeId, nodeType: failure.nodeType };
  const kind = classifyFailure(ctx);
  const advice = adviceFor(kind, ctx, size ?? {});
  const error = new RunError(
    "execution_failed",
    `ComfyUI \u6267\u884C\u5931\u8D25\uFF08prompt ${promptId}\uFF09${failure.text === "" ? "" : `\uFF1A${failure.text}`}`,
    // 建议按类给，不再是同一句"通常是参数不匹配或显存不足"
    advice,
    entry
  );
  error.kind = kind;
  return error;
}
function failureDetail(entry) {
  if (entry === null || typeof entry !== "object") return { text: "" };
  const status = entry.status;
  const messages = status !== null && typeof status === "object" ? status.messages : void 0;
  if (!Array.isArray(messages)) return { text: "" };
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
      if (detail.trim() !== "") {
        return {
          text: detail.trim(),
          ...typeof bag.node_id === "string" || typeof bag.node_id === "number" ? { nodeId: String(bag.node_id) } : {},
          ...type === "" ? {} : { nodeType: type }
        };
      }
    }
  }
  return { text: "" };
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

// src/shared/comfy/supervisor.ts
import { spawn } from "node:child_process";
import fs3 from "node:fs";
import path2 from "node:path";

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
  for (const name of imageSlots) {
    const value = next[name];
    if (typeof value !== "string" || value === "") continue;
    const before = value;
    const after = await ensureComfyImage(client, value);
    if (after !== before) {
      next[name] = after;
      notes.push(`${name}\uFF1A\u672C\u5730\u56FE\u5DF2\u9001\u8FDB ComfyUI \u7684 input\uFF0C\u63D0\u4EA4\u65F6\u7528\u6587\u4EF6\u540D ${after}\u3002`);
    }
  }
  return { vars: next, notes };
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
      const name = exact[1];
      if (name !== void 0 && name in bag) return bag[name];
      return value;
    }
    return value.replace(/\{\{(\w+)\}\}/g, (match, name) => name in bag ? String(bag[name]) : match);
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
    const missing = requiredNodes(applied.workflow).filter((name) => !known.has(name));
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
  if (entry.status?.status_str === "error") {
    const effective = recallRun(promptId)?.effective;
    const width = typeof effective?.width === "number" ? effective.width : void 0;
    const height = typeof effective?.height === "number" ? effective.height : void 0;
    throw executionFailed(
      entry,
      promptId,
      width === void 0 || height === void 0 ? void 0 : { width, height }
    );
  }
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
  let transientFailures = 0;
  let collectFailures = 0;
  for (; ; ) {
    let state;
    try {
      state = await checkRun(client, promptId);
      transientFailures = 0;
    } catch (error) {
      if (isFatalRunError(error)) throw error;
      transientFailures += 1;
      if (transientFailures >= TRANSIENT_LIMIT) throw error;
      if (Date.now() > deadline) {
        return {
          ok: true,
          pending: true,
          promptId,
          waitedMs: Date.now() - startedAt,
          hint: `\u8FDE\u7EED ${transientFailures} \u6B21\u67E5\u8BE2\u5931\u8D25\uFF08${error instanceof Error ? error.message : String(error)}\uFF09\u3002\u4EFB\u52A1\u53EF\u80FD\u8FD8\u5728\u8DD1\uFF0C\u7528 comfyui_run \u4F20\u8FD9\u4E2A promptId \u7EED\u67E5\u3002`
        };
      }
      await sleep(options.pollIntervalMs);
      continue;
    }
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
      try {
        return await collectArtifacts(client, promptId, state.entry, context);
      } catch (error) {
        if (!isRetryable(error)) throw error;
        collectFailures += 1;
        if (collectFailures >= TRANSIENT_LIMIT) throw error;
        await sleep(options.pollIntervalMs);
        continue;
      }
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
async function runWorkflow(options) {
  const submitted = await submitWorkflow(options);
  const outcome = await waitForRun(options.client, submitted.promptId, {
    timeoutMs: options.timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    fallback: {
      outputDir: options.outputDir,
      workflowId: options.workflowId,
      workflowHash: options.workflowHash,
      effective: submitted.effective
    },
    ...options.onStage === void 0 ? {} : { onStage: (stage) => options.onStage?.(stage) }
  });
  return "pending" in outcome ? outcome : { ...outcome, notes: [...submitted.notes, ...outcome.notes] };
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
    try {
      logger?.warn?.(`[notify] \u901A\u77E5\u672A\u9001\u8FBE\uFF1A${error instanceof Error ? error.message : String(error)}`);
    } catch {
    }
  }
}
function watchRun(options) {
  const { client, target, promptId, outputDir } = options;
  const intervalMs = Math.max(50, options.intervalMs ?? 5e3);
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
  const emit = (payload) => {
    if (options.onSettled !== void 0) {
      try {
        options.onSettled(payload);
      } catch (error) {
        try {
          options.logger?.warn?.(`[notify] \u7ED3\u679C\u4EA4\u4ED8\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
        } catch {
        }
      }
      return;
    }
    deliver(target, payload.text, options.logger);
  };
  let inflight = false;
  let settled = false;
  let transientFailures = 0;
  const timer = setInterval(() => {
    void (async () => {
      if (settled || inflight) return;
      inflight = true;
      try {
        if (options.registry !== void 0) {
          try {
            const queue = await client.queue();
            const runningAt = queue.running.indexOf(promptId);
            const pendingAt = queue.pending.indexOf(promptId);
            if (runningAt >= 0) {
              options.registry.update(promptId, {
                state: "running",
                startedAt: options.registry.get(promptId)?.startedAt ?? Date.now(),
                queuePosition: 0
              });
            } else if (pendingAt >= 0) {
              options.registry.update(promptId, { state: "queued", queuePosition: pendingAt + 1 });
            }
          } catch {
          }
        }
        const state = await checkRun(client, promptId);
        if (!state.done || state.entry === void 0) {
          transientFailures = 0;
          if (Date.now() - startedAt > maxWaitMs) {
            stop();
            settled = true;
            options.registry?.update(promptId, {
              state: "unknown",
              finishedAt: Date.now(),
              queuePosition: void 0,
              error: {
                code: "wait_timeout",
                message: maxWaitMs >= 6e4 ? `\u7B49\u4E86 ${Math.round(maxWaitMs / 6e4)} \u5206\u949F\u4ECD\u672A\u51FA\u56FE\u3002` : `\u7B49\u4E86 ${Math.round(maxWaitMs / 1e3)} \u79D2\u4ECD\u672A\u51FA\u56FE\u3002`
              }
            });
            emit({
              ok: false,
              text: `\u5DE5\u4F5C\u6D41\u4ECD\u5728\u8DD1\uFF08promptId ${promptId}\uFF09\uFF0C\u5DF2\u7ECF\u7B49\u4E86 ${Math.round((Date.now() - startedAt) / 6e4)} \u5206\u949F\uFF0C\u5148\u4E0D\u76EF\u4E86\u3002
\u9700\u8981\u7ED3\u679C\u65F6\u8BA9\u6A21\u578B\u7528 comfyui_run \u4F20\u8FD9\u4E2A promptId\u3002`
            });
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
        settled = true;
        options.registry?.update(promptId, {
          state: "done",
          finishedAt: Date.now(),
          queuePosition: void 0,
          artifacts: outcome.artifacts.map((artifact) => ({
            path: artifact.path,
            bytes: artifact.bytes,
            ...artifact.width === void 0 ? {} : { width: artifact.width },
            ...artifact.height === void 0 ? {} : { height: artifact.height }
          }))
        });
        emit({
          ok: true,
          text: lines.join("\n"),
          artifacts: outcome.artifacts.map((artifact) => artifact.path),
          // 明细也带上：默认异步路径的汇总原来只有纯路径，而 wait 路径有宽高体积 ——
          // 同一批产物在两条路径上展示不一致。
          artifactDetails: outcome.artifacts.map((artifact) => ({
            path: artifact.path,
            ...artifact.width === void 0 ? {} : { width: artifact.width },
            ...artifact.height === void 0 ? {} : { height: artifact.height },
            ...artifact.bytes === void 0 ? {} : { bytes: artifact.bytes }
          }))
        });
      } catch (error) {
        if (settled) return;
        const message = error instanceof Error ? error.message : String(error);
        const code = codeOf(error) === "" ? "wait_failed" : codeOf(error);
        if (!isFatalRunError(error)) {
          transientFailures += 1;
          if (transientFailures < TRANSIENT_LIMIT) {
            try {
              options.logger?.warn?.(`[notify] ${promptId} \u7B2C ${transientFailures} \u6B21\u67E5\u8BE2\u5931\u8D25\uFF0C\u7EE7\u7EED\u7B49\uFF1A${message}`);
            } catch {
            }
            return;
          }
          stop();
          settled = true;
          options.registry?.update(promptId, {
            state: finalStateOf(error),
            // finishedAt 必须写：runs.ts 的 elapsedMs 用 (finishedAt ?? now)，
            // 缺了它一条 failed 记录的"耗时"会一直涨。
            finishedAt: Date.now(),
            queuePosition: void 0,
            // error 也要落：面板与 comfyui_runs 读的是记录，不是会话通知。
            // 只发通知不写记录 = 留一条无法排查的 unknown。
            error: {
              code: codeOf(error) === "" ? "wait_failed" : codeOf(error),
              message,
              ...typeof error.kind === "string" ? { kind: error.kind } : {}
            }
          });
          emit({ ok: false, text: giveUpMessage(error, promptId, TRANSIENT_LIMIT) });
          return;
        }
        transientFailures = 0;
        stop();
        const kind = typeof error.kind === "string" ? error.kind : void 0;
        options.registry?.update(promptId, {
          state: "failed",
          finishedAt: Date.now(),
          queuePosition: void 0,
          error: { code, message, ...kind === void 0 ? {} : { kind } }
        });
        try {
          options.logger?.warn?.(`[notify] ${promptId} \u7B49\u5F85\u5931\u8D25\uFF1A${message}`);
        } catch {
        }
        settled = true;
        emit({ ok: false, text: `\u5DE5\u4F5C\u6D41\u6267\u884C\u5931\u8D25\uFF08promptId ${promptId}\uFF09\uFF1A${message}` });
      } finally {
        inflight = false;
      }
    })();
  }, intervalMs);
  timer.unref?.();
  watchers.set(promptId, { timer, startedAt });
  return stop;
}
function sweepRun(options) {
  const { client, promptId, outputDir, workflowId } = options;
  const intervalMs = Math.max(50, options.intervalMs ?? 1e3);
  const maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1e3;
  const startedAt = Date.now();
  let transientFailures = 0;
  const stop = () => {
    const current = watchers.get(promptId);
    if (current !== void 0) {
      clearInterval(current.timer);
      watchers.delete(promptId);
    }
  };
  stop();
  let inflight = false;
  let settled = false;
  const finish = (patch) => {
    settled = true;
    stop();
    options.registry?.update(promptId, patch);
  };
  const timer = setInterval(() => {
    void (async () => {
      if (settled || inflight) return;
      if (options.registry !== void 0 && options.registry.get(promptId) === void 0) {
        settled = true;
        stop();
        return;
      }
      inflight = true;
      try {
        const state = await checkRun(client, promptId);
        if (state.done && state.entry !== void 0) {
          const context = recallRun(promptId) ?? {
            workflowId,
            workflowHash: "",
            outputDir,
            effective: {},
            writeMetadata: true,
            submittedAt: startedAt
          };
          const outcome = await collectArtifacts(client, promptId, state.entry, context);
          if (settled) return;
          finish({
            state: "done",
            finishedAt: Date.now(),
            queuePosition: void 0,
            artifacts: outcome.artifacts.map((artifact) => ({
              path: artifact.path,
              bytes: artifact.bytes,
              ...artifact.width === void 0 ? {} : { width: artifact.width },
              ...artifact.height === void 0 ? {} : { height: artifact.height }
            }))
          });
          return;
        }
        transientFailures = 0;
        if (Date.now() - startedAt > maxWaitMs) {
          finish({
            state: "unknown",
            finishedAt: Date.now(),
            queuePosition: void 0,
            error: {
              code: "wait_timeout",
              message: maxWaitMs >= 6e4 ? `\u7B49\u4E86 ${Math.round(maxWaitMs / 6e4)} \u5206\u949F\u4ECD\u672A\u51FA\u56FE\u3002` : `\u7B49\u4E86 ${Math.round(maxWaitMs / 1e3)} \u79D2\u4ECD\u672A\u51FA\u56FE\u3002`
            }
          });
        }
      } catch (error) {
        const code = codeOf(error) === "" ? "wait_failed" : codeOf(error);
        if (isFatalRunError(error)) {
          finish({
            state: "failed",
            finishedAt: Date.now(),
            queuePosition: void 0,
            error: {
              code,
              message: error instanceof Error ? error.message : String(error),
              ...typeof error.kind === "string" ? { kind: error.kind } : {}
            }
          });
          return;
        }
        transientFailures += 1;
        if (transientFailures >= TRANSIENT_LIMIT) {
          finish({
            state: finalStateOf(error),
            finishedAt: Date.now(),
            queuePosition: void 0,
            error: {
              code,
              message: error instanceof Error ? error.message : String(error),
              ...typeof error.kind === "string" ? { kind: error.kind } : {}
            }
          });
        } else {
          try {
            const detail = error instanceof Error ? error.message : String(error);
            options.logger?.warn?.(`[sweep] ${promptId} \u7B2C ${transientFailures} \u6B21\u67E5\u8BE2\u5931\u8D25\uFF0C\u7EE7\u7EED\u7B49\uFF1A${detail}`);
          } catch {
          }
        }
      } finally {
        inflight = false;
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

// src/shared/run/batch-notify.ts
var BatchCollector = class {
  total;
  deliver;
  startedAt;
  maxWaitMs;
  logger;
  settled = /* @__PURE__ */ new Map();
  delivered = false;
  timer;
  /**
   * @param options - 批大小、投递函数与超时。
   */
  constructor(options) {
    this.total = Math.max(1, options.total);
    this.deliver = options.deliver;
    this.startedAt = options.startedAt ?? Date.now();
    this.maxWaitMs = options.maxWaitMs ?? 30 * 60 * 1e3;
    this.logger = options.logger;
    this.timer = setTimeout(() => {
      this.flush("timeout");
    }, this.maxWaitMs);
    this.timer.unref?.();
  }
  /** 还差几条。 */
  get pending() {
    return this.total - this.settled.size;
  }
  /** 已经收到几条。 */
  get received() {
    return this.settled.size;
  }
  /**
   * 回报一条运行的结果。
   *
   * @param run - 结果。
   */
  settle(run) {
    if (this.delivered) return;
    if (this.settled.has(run.promptId)) return;
    this.settled.set(run.promptId, run);
    if (this.settled.size >= this.total) this.flush("complete");
  }
  /** 立即汇总（测试与超时用）。 */
  flush(reason) {
    if (this.delivered) return;
    this.delivered = true;
    if (this.timer !== void 0) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
    const all = [...this.settled.values()];
    const ok = all.filter((item) => item.ok);
    const failed = all.filter((item) => !item.ok);
    const seconds = Math.round((Date.now() - this.startedAt) / 1e3);
    const duration = seconds >= 60 ? `${Math.floor(seconds / 60)} \u5206 ${seconds % 60} \u79D2` : `${seconds} \u79D2`;
    const lines = [];
    if (this.pending > 0) {
      lines.push(`\u672C\u6279 ${this.total} \u6761\u91CC\u5DF2\u7ED3\u675F ${all.length} \u6761\uFF08${ok.length} \u6210\u529F\uFF0C${failed.length} \u5931\u8D25\uFF09\uFF0C\u8FD8\u6709 ${this.pending} \u6761\u5728\u8DD1\u3002\u7A0D\u540E\u7528 comfyui_runs \u67E5\u3002`);
    } else {
      lines.push(`\u672C\u6279 ${this.total} \u6761\u5168\u90E8\u7ED3\u675F\uFF08${ok.length} \u6210\u529F\uFF0C${failed.length} \u5931\u8D25\uFF09\uFF0C\u7528\u65F6 ${duration}\u3002`);
    }
    const artifacts = [];
    for (const item of ok) {
      for (const line of this.artifactsOf(item)) artifacts.push(line);
    }
    if (artifacts.length > 0) {
      lines.push("");
      for (const artifact of artifacts) {
        const size = artifact.width !== void 0 && artifact.height !== void 0 ? ` \xB7 ${artifact.width}\xD7${artifact.height}` : "";
        const bytes = artifact.bytes === void 0 ? "" : ` \xB7 ${Math.round(artifact.bytes / 1024)} KB`;
        lines.push(`- ${artifact.path}${size}${bytes}`);
      }
    }
    if (failed.length > 0) {
      lines.push("");
      for (const item of failed) {
        const label = item.index === void 0 ? item.promptId : `\u7B2C ${item.index + 1} \u6761`;
        lines.push(`\u5931\u8D25\uFF1A${label}\uFF08${item.text}\uFF09`);
      }
    }
    try {
      this.deliver(lines.join("\n"));
    } catch (error) {
      try {
        this.logger?.warn?.(`[batch] \u6C47\u603B\u901A\u77E5\u672A\u9001\u8FBE\uFF1A${error instanceof Error ? error.message : String(error)}`);
      } catch {
      }
    }
  }
  /** 从一条结果里取出产物行。`text` 里没有结构化信息时退回空数组。 */
  artifactsOf(run) {
    if (run.artifactDetails !== void 0 && run.artifactDetails.length > 0) return run.artifactDetails;
    if (run.artifacts === void 0) return [];
    return run.artifacts.map((path5) => ({ path: path5 }));
  }
  /** 停掉超时定时器（插件卸载或调用方取消）。 */
  dispose() {
    if (this.timer !== void 0) {
      clearTimeout(this.timer);
      this.timer = void 0;
    }
  }
};

// src/shared/run/overrides.ts
function applyOverrides(workflow, surface, vars, patches) {
  const merged = { ...vars };
  if (patches === void 0 || patches.length === 0) {
    return { vars: merged, internal: 0, viaVars: 0 };
  }
  let internal = 0;
  let viaVars = 0;
  for (const patch of patches) {
    const slot = surface.inputs.find((candidate) => candidate.bind === `${patch.nodeId}.inputs.${patch.input}`);
    if (slot !== void 0) {
      merged[slot.name] = patch.value;
      viaVars += 1;
      continue;
    }
    const node = workflow[patch.nodeId];
    if (node !== void 0 && node.inputs !== null && typeof node.inputs === "object") {
      node.inputs[patch.input] = patch.value;
      internal += 1;
    }
  }
  return { vars: merged, internal, viaVars };
}
function overrideNotes(outcome) {
  if (outcome.viaVars === 0 && outcome.internal === 0) return [];
  const parts = [];
  if (outcome.viaVars > 0) parts.push(`${outcome.viaVars} \u5904\u53C2\u6570\u69FD\u4F4D`);
  if (outcome.internal > 0) parts.push(`${outcome.internal} \u5904\u5185\u90E8\u53C2\u6570`);
  return [`\u5DF2\u5E94\u7528 ${parts.join(" + ")}\u7684\u4E00\u6B21\u6027\u8986\u76D6\uFF08\u672A\u5199\u5165\u6A21\u677F\uFF09\u3002`];
}
export {
  BatchCollector,
  TRANSIENT_FINAL_STATE,
  TRANSIENT_LIMIT,
  applyOverrides,
  checkRun,
  codeOf,
  codeOrDefault,
  collectArtifacts,
  finalStateOf,
  forgetRun,
  giveUpMessage,
  isFatalRunError,
  isRetryable,
  overrideNotes,
  recallRun,
  rememberRun,
  resumeRun,
  runWorkflow,
  stopAllWatchers,
  submitWorkflow,
  sweepRun,
  waitForRun,
  watchRun
};
