var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

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
var init_paths = __esm({
  "src/shared/host/paths.ts"() {
    "use strict";
  }
});

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
var init_types = __esm({
  "src/shared/tools/types.ts"() {
    "use strict";
  }
});

// src/shared/media/constants.ts
var SIDECAR_MAX_BYTES, PNG_META_READ_BYTES;
var init_constants = __esm({
  "src/shared/media/constants.ts"() {
    "use strict";
    SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
    PNG_META_READ_BYTES = 64 * 1024;
  }
});

// src/shared/media/png-text.ts
import fs5 from "node:fs";
import zlib from "node:zlib";
function readPngTextChunks(imagePath, size) {
  if (size < 16) return void 0;
  const length = Math.min(size, PNG_META_READ_BYTES);
  let fd;
  try {
    fd = fs5.openSync(imagePath, "r");
    const buffer = Buffer.alloc(length);
    const read = fs5.readSync(fd, buffer, 0, length, 0);
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
    if (fd !== void 0) fs5.closeSync(fd);
  }
}
var init_png_text = __esm({
  "src/shared/media/png-text.ts"() {
    "use strict";
    init_constants();
  }
});

// src/shared/run/policy.ts
function sweepBudgetOf(timeoutMs2) {
  if (typeof timeoutMs2 !== "number" || !Number.isFinite(timeoutMs2) || timeoutMs2 <= 0) return SWEEP_MIN_BUDGET_MS;
  return Math.max(SWEEP_MIN_BUDGET_MS, Math.round(timeoutMs2));
}
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
    return `\u5DE5\u4F5C\u6D41\u6267\u884C\u5B8C\u6210\u4E86\uFF0C\u4F46\u6CA1\u6709\u62FF\u5230\u4EFB\u4F55\u4EA7\u7269\u6587\u4EF6\uFF08promptId ${promptId}\uFF09\u3002\u4E24\u79CD\u6210\u56E0\uFF1A\u2460 \u540E\u7AEF\u6CA1\u6709\u56DE\u4F20\u4EFB\u4F55\u5E26 filename \u7684\u4EA7\u7269\u5F15\u7528\uFF08\u5E38\u89C1\u662F\u672B\u7AEF\u53EA\u8FDE\u4E86\u7EAF\u6587\u672C/\u7EAF\u6570\u636E\u8282\u70B9\uFF0C\u800C\u4E0D\u662F SaveImage / PreviewImage \u8FD9\u7C7B\u5199\u6587\u4EF6\u7684\u8282\u70B9\uFF1B\u81EA\u5B9A\u4E49\u8282\u70B9\u628A\u6587\u4EF6\u5199\u5230 ComfyUI \u76EE\u5F55\u5916\u4E5F\u4F1A\u8FD9\u6837\uFF09\uFF1B\u2461 \u539F\u672C\u8981\u5199\u6587\u4EF6\u7684\u90A3\u6761\u8F93\u51FA\u94FE\u53C2\u6570\u88AB\u5224\u4E3A\u975E\u6CD5\uFF08validate \u5931\u8D25\u53EA\u8BA9\u90A3\u6761\u94FE\u88AB\u5FFD\u7565\uFF09\uFF0C\u5269\u4E0B\u80FD\u8DD1\u5B8C\u7684\u94FE\u90FD\u4E0D\u5199\u6587\u4EF6\uFF0C\u6240\u4EE5\u6574\u4F53\u4ECD\u7B97"\u6210\u529F" \u2014\u2014 \u5728\u7EC8\u7AEF\u9762\u677F\u641C "Failed to validate prompt" \u5C31\u80FD\u786E\u8BA4\u662F\u54EA\u4E00\u79CD\uFF08\u5916\u90E8\u542F\u52A8\u7684 ComfyUI \u8BFB\u4E0D\u5230\u65E5\u5FD7\u65F6\uFF0C\u53BB\u5B83\u81EA\u5DF1\u7684\u63A7\u5236\u53F0\u641C\uFF09\u3002`;
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
var TRANSIENT_LIMIT, SWEEP_MIN_BUDGET_MS, TRANSIENT_FINAL_STATE;
var init_policy = __esm({
  "src/shared/run/policy.ts"() {
    "use strict";
    TRANSIENT_LIMIT = 6;
    SWEEP_MIN_BUDGET_MS = 30 * 6e4;
    TRANSIENT_FINAL_STATE = "unknown";
  }
});

// src/shared/comfy/failure-kind.ts
function classifyFailure(ctx) {
  for (const rule of RULES) {
    if (rule.test(ctx)) return rule.kind;
  }
  return "unknown";
}
function modelNameIn(text3) {
  const rejected = text3.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`]/i);
  if (rejected?.[1] !== void 0 && /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)x?$/i.test(rejected[1])) {
    return rejected[1];
  }
  const match = text3.match(/[\w./\\-]+\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i);
  return match?.[0]?.trim();
}
function rejectedValueAndOptions(text3) {
  const match = text3.match(/value not in list[\s\S]{0,80}?['"`]([^'"`]+)['"`][\s\S]{0,40}?\[([^\]]*)\]/i);
  if (match === null) return void 0;
  const value = match[1]?.trim();
  if (value === void 0 || value === "") return void 0;
  const options = (match[2] ?? "").split(",").map((item) => item.trim().replace(/^['"`]|['"`]$/g, "")).filter((item) => item !== "");
  return { value, options };
}
function dimensionsIn(text3) {
  const match = text3.match(/(\d{3,5})\s*[x×]\s*(\d{3,5})/i);
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
      const name2 = modelNameIn(ctx.text);
      const target = name2 === void 0 ? "\u7F3A\u7684\u90A3\u4E2A\u6A21\u578B\u6587\u4EF6" : `${name2}`;
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
var MODEL_EXT, RULES;
var init_failure_kind = __esm({
  "src/shared/comfy/failure-kind.ts"() {
    "use strict";
    MODEL_EXT = /\.(safetensors|ckpt|pt|pth|bin|gguf|onnx)\b/i;
    RULES = [
      {
        kind: "oom",
        test: ({ text: text3 }) => (
          // 英文各种写法：CUDA 的 out of memory、PyTorch 的 "OOM when allocating tensor"、
          // 系统的 "Cannot allocate memory"（Errno 12）
          /out of memory|cuda oom|allocation on device|not enough memory|outofmemoryerror|memory allocation|cannot allocate memory|oom when allocating|errno 12/i.test(text3) || /显存不足|显存不够|内存不足|内存不够|分配失败/.test(text3)
        )
      },
      {
        kind: "missing_node",
        test: ({ text: text3 }) => /cannot execute because node|node type not found|class_type.*not found|does not exist.*node|missing node/i.test(text3) || /the following node types were not found/i.test(text3) || /node ['"`].+['"`] not found/i.test(text3) || /节点.*(不存在|未安装|找不到)/.test(text3)
      },
      {
        kind: "missing_model",
        // 只有"文件不存在" + 模型扩展名才算缺模型。
        // "Value not in list" 不归这里 —— 那个值可能只是拼写错了，候选里本来就有正确的，
        // 交给下面 bad_param 并点名"你写的是 X，候选里是 Y"。
        test: ({ text: text3 }) => /(no such file|not found|does not exist|cannot find|unable to locate)/i.test(text3) && MODEL_EXT.test(text3)
      },
      {
        kind: "bad_input",
        test: ({ text: text3 }) => /cannot identify image file|invalid image|image must be|failed to open image|unsupported image/i.test(text3)
      },
      {
        kind: "bad_param",
        // 判据里的 `value not in list` 在实际链路上很少走到，别把它当成"参数写错"的万能解释：
        // 这个串由 `execution.py:1085` 的 `validate_inputs` 产生，而本分类器只吃
        // `execution_error`（来自 `/history` 的 `status.messages`）。validate 阶段的值非法
        // **不会**写成 execution_error —— ComfyUI 只拒掉那条输出链，其余链照跑，整体仍是
        // `status_str: 'success'`。那条路径的出口是 `no_output`，不是这里。
        test: ({ text: text3 }) => /value not in list|out of range|must be (a |an )?(int|float|bool|number|string)|expected .* got|invalid (value|argument|parameter)/i.test(text3) || /参数.*(不合法|越界|不在|无效)/.test(text3)
      }
    ];
  }
});

// src/shared/comfy/errors.ts
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
  const bag = body !== null && typeof body === "object" ? body : {};
  const type = typeof bag.error?.type === "string" ? bag.error.type : "";
  const first = formatNodeErrors(bag.node_errors);
  const hint = type === "prompt_no_outputs" ? "\u8FD9\u4EFD\u5DE5\u4F5C\u6D41\u6CA1\u6709\u8F93\u51FA\u8282\u70B9\uFF08ComfyUI \u7684 prompt_no_outputs\uFF09\uFF0C\u8DD1\u5B8C\u4E0D\u4F1A\u4EA7\u751F\u4EFB\u4F55\u4EA7\u7269\u3002\u63A5\u4E00\u4E2A SaveImage / PreviewImage \u4E4B\u7C7B\u7684\u8F93\u51FA\u8282\u70B9\u518D\u63D0\u4EA4\u3002" : type === "prompt_outputs_failed_validation" ? "\u6240\u6709\u8F93\u51FA\u94FE\u7684\u53C2\u6570\u90FD\u88AB\u5224\u4E3A\u975E\u6CD5\u3002\u6309\u88AB\u70B9\u540D\u7684\u8282\u70B9\u9010\u4E2A\u6539\uFF0C\u6216\u5148\u7528 comfyui_workflow_inspect \u5BF9\u4E00\u904D\u69FD\u4F4D\u3002" : "\u68C0\u67E5\u88AB\u70B9\u540D\u7684\u8282\u70B9\u53C2\u6570\uFF08\u7C7B\u578B\u3001\u53D6\u503C\u8303\u56F4\uFF09\uFF0C\u6216\u5148\u7528 inspect \u770B\u8BE5\u8282\u70B9\u7684\u8F93\u5165\u3002";
  return new RunError(
    "submit_rejected",
    `ComfyUI \u62D2\u7EDD\u4E86\u8FD9\u6B21\u63D0\u4EA4${first === "" ? "" : `\uFF1A${first}`}`,
    hint,
    body
  );
}
function renderReceived(value) {
  if (value === void 0) return "";
  if (value === null) return "\uFF0C\u6536\u5230 null";
  if (typeof value === "string") return value === "" ? "\uFF0C\u6536\u5230\u7A7A\u5B57\u7B26\u4E32" : `\uFF0C\u6536\u5230 ${value.length > 80 ? `${value.slice(0, 80)}\u2026` : value}`;
  if (typeof value === "number" || typeof value === "boolean") return `\uFF0C\u6536\u5230 ${String(value)}`;
  try {
    const text3 = JSON.stringify(value);
    return `\uFF0C\u6536\u5230 ${text3.length > 80 ? `${text3.slice(0, 80)}\u2026` : text3}`;
  } catch {
    return "\uFF0C\u6536\u5230\u4E00\u4E2A\u65E0\u6CD5\u5E8F\u5217\u5316\u7684\u503C";
  }
}
function describeNodeErrors(nodeErrors) {
  if (nodeErrors === null || typeof nodeErrors !== "object" || Array.isArray(nodeErrors)) return [];
  const details = [];
  for (const [nodeId, value] of Object.entries(nodeErrors)) {
    const bag = value !== null && typeof value === "object" ? value : {};
    const errors = bag.errors;
    if (!Array.isArray(errors) || errors.length === 0) continue;
    const classType = typeof bag.class_type === "string" ? bag.class_type : "";
    for (const item of errors) {
      const error = item !== null && typeof item === "object" ? item : {};
      const message = typeof error.message === "string" ? error.message : "";
      const text3 = typeof error.details === "string" ? error.details : "";
      const extra = error.extra_info !== null && typeof error.extra_info === "object" ? error.extra_info : {};
      const input = typeof extra.input_name === "string" ? `\u53C2\u6570 ${extra.input_name}` : "";
      const receivedType = typeof extra.received_type === "string" ? `\u7C7B\u578B ${extra.received_type}` : "";
      const head = [classType, input, receivedType].filter((part) => part !== "").join("\uFF0C");
      const body = [message, text3].filter((part) => part !== "").join("\uFF0C");
      details.push(
        `\u8282\u70B9 ${nodeId}${head === "" ? "" : `\uFF08${head}\uFF09`}\uFF1A${body === "" ? "\u53C2\u6570\u88AB\u5224\u975E\u6CD5" : body}${renderReceived(extra.received_value)}\u3002\u8FD9\u6761\u8F93\u51FA\u94FE\u4E0D\u4F1A\u4EA7\u51FA\u6587\u4EF6\u3002`
      );
    }
  }
  if (details.length === 0) return [];
  if (details.length === 1) return details;
  const shown = details.slice(0, MAX_WARNINGS);
  const rest = details.length - shown.length;
  return [
    `\u63D0\u4EA4\u5DF2\u88AB\u63A5\u53D7\uFF0C\u5176\u4F59\u8F93\u51FA\u94FE\u7167\u5E38\u6267\u884C\uFF1B\u4EE5\u4E0B ${details.length} \u5904\u53C2\u6570\u88AB\u5224\u975E\u6CD5\uFF1A`,
    ...shown,
    ...rest > 0 ? [`\u53E6\u6709 ${rest} \u6761\u540C\u7C7B\u8B66\u544A\u5DF2\u7701\u7565\u3002`] : []
  ];
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
      const text3 = typeof bag.exception_message === "string" ? bag.exception_message : "";
      const node = bag.node_id === void 0 ? "" : `\u8282\u70B9 ${String(bag.node_id)}`;
      const type = typeof bag.node_type === "string" ? bag.node_type : "";
      const head = [node, type].filter((part) => part !== "").join(" ");
      const detail = `${head}${head === "" ? "" : "\uFF1A"}${text3}`;
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
function noOutput() {
  return new RunError(
    "no_output",
    "\u6267\u884C\u5B8C\u6210\u4E86\uFF0C\u4F46\u6CA1\u6709\u62FF\u5230\u4EFB\u4F55\u4EA7\u7269\u6587\u4EF6\u3002",
    '\u4E24\u79CD\u6210\u56E0\uFF1A\u2460 \u540E\u7AEF\u6CA1\u6709\u56DE\u4F20\u4EFB\u4F55\u5E26 filename \u7684\u4EA7\u7269\u5F15\u7528 \u2014\u2014 \u5E38\u89C1\u662F\u672B\u7AEF\u53EA\u8FDE\u4E86\u7EAF\u6587\u672C/\u7EAF\u6570\u636E\u8282\u70B9\uFF0C\u800C\u4E0D\u662F SaveImage / PreviewImage \u8FD9\u7C7B\u5199\u6587\u4EF6\u7684\u8282\u70B9\uFF08\u81EA\u5B9A\u4E49\u8282\u70B9\u628A\u6587\u4EF6\u5199\u5230 ComfyUI \u76EE\u5F55\u5916\u3001\u4E0D\u56DE\u4F20 filename \u4E5F\u4F1A\u8FD9\u6837\uFF09\uFF1B\u2461 \u539F\u672C\u8981\u5199\u6587\u4EF6\u7684\u90A3\u6761\u8F93\u51FA\u94FE\u53C2\u6570\u88AB\u5224\u4E3A\u975E\u6CD5\uFF08validate \u5931\u8D25\u53EA\u8BA9\u90A3\u6761\u94FE\u88AB\u5FFD\u7565\uFF09\uFF0C\u5269\u4E0B\u80FD\u8DD1\u5B8C\u7684\u94FE\u90FD\u4E0D\u5199\u6587\u4EF6\uFF0C\u6240\u4EE5\u6574\u4F53\u4ECD\u7B97"\u6210\u529F" \u2014\u2014 \u5728\u7EC8\u7AEF\u9762\u677F\u641C "Failed to validate prompt" \u53EF\u786E\u8BA4\u662F\u54EA\u4E00\u79CD\uFF08\u5916\u90E8\u542F\u52A8\u7684 ComfyUI \u8BFB\u4E0D\u5230\u65E5\u5FD7\u65F6\uFF0C\u53BB\u5B83\u81EA\u5DF1\u7684\u63A7\u5236\u53F0\u641C\uFF09\u3002'
  );
}
function outputUnreadable(filename, cause) {
  const detail = cause instanceof Error ? `\uFF08${cause.message}\uFF09` : "";
  return new RunError("output_unreadable", `\u53D6\u4E0D\u56DE\u4EA7\u7269\u5B57\u8282\uFF1A${filename}${detail}`, "\u91CD\u8BD5\u4E00\u6B21\uFF1B\u6301\u7EED\u5931\u8D25\u5C31\u7528 GET /view \u624B\u5DE5\u4E0B\u8F7D\u9A8C\u8BC1\u3002");
}
var RunError, MAX_WARNINGS;
var init_errors = __esm({
  "src/shared/comfy/errors.ts"() {
    "use strict";
    init_failure_kind();
    RunError = class extends Error {
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
    MAX_WARNINGS = 3;
  }
});

// src/shared/comfy/queue.ts
function bagOf(body) {
  if (body === null || typeof body !== "object" || Array.isArray(body)) return void 0;
  return body;
}
function firstArray(bag, keys) {
  for (const key of keys) {
    const value = bag[key];
    if (Array.isArray(value)) return value;
  }
  return void 0;
}
function parseQueue(body) {
  const bag = bagOf(body);
  if (bag === void 0) return { running: [], pending: [] };
  const pick = (keys) => {
    const value = firstArray(bag, keys);
    if (value === void 0) return [];
    const out = [];
    for (const item of value) {
      if (Array.isArray(item) && typeof item[1] === "string") out.push(item[1]);
      else if (item !== null && typeof item === "object" && typeof item.prompt_id === "string") {
        out.push(item.prompt_id);
      }
    }
    return out;
  };
  return { running: pick(RUNNING_KEYS), pending: pick(PENDING_KEYS) };
}
function isQueueBusy(body) {
  const bag = bagOf(body);
  if (bag === void 0) return false;
  const running = firstArray(bag, RUNNING_KEYS);
  const pending2 = firstArray(bag, PENDING_KEYS);
  return (running?.length ?? 0) > 0 || (pending2?.length ?? 0) > 0;
}
var RUNNING_KEYS, PENDING_KEYS;
var init_queue = __esm({
  "src/shared/comfy/queue.ts"() {
    "use strict";
    RUNNING_KEYS = ["queue_running", "running"];
    PENDING_KEYS = ["queue_pending", "pending"];
  }
});

// src/shared/comfy/client.ts
import crypto from "node:crypto";
var DEFAULT_REQUEST_TIMEOUT, ComfyClient;
var init_client = __esm({
  "src/shared/comfy/client.ts"() {
    "use strict";
    init_errors();
    init_queue();
    DEFAULT_REQUEST_TIMEOUT = 12e4;
    ComfyClient = class {
      baseUrl;
      headers;
      requestTimeoutMs;
      ensure;
      /** `/object_info` 缓存：响应可能好几 MB，同一进程不必反复拉。 */
      /** `/queue` 的短缓存：同一 tick 里多条任务共用一次查询。 */
      queueCache;
      /**
       * 正在飞的那次 `/queue` 请求。
       *
       * 只靠 `queueCache` 挡不住并发：缓存要等结果回来才写，20 个任务在冷启动那一瞬间
       * 看到的是同一个空缓存，于是同时发 20 个请求。共享 in-flight promise 才是真去重。
       */
      queueInflight;
      infoCache = null;
      /**
       * 提交时带的 client_id（ComfyUI 用它区分来源），也是订阅 `/ws` 进度时必须复用的那个。
       *
       * 机制（对照本机 ComfyUI 源码核实）：
       * - `progress` 事件带 sid 发出（`main.py:475` 的 `send_sync("progress", progress, client_id)`）；
       * - 那个 `server.client_id` 在**开始执行**时由 `extra_data["client_id"]` 赋值
       *   （`execution.py:740`），所以是"本任务的提交方"，不是"最后提交的那个"；
       * - 自己另造一个随机 id 去订阅，握手会成功、`status` 能收到，但永远收不到
       *   `progress`（真机实测：20 步跑完，相关事件 0 条）。
       *
       * 注意 `server.py:341-345`：同 sid 再连会 `self.sockets.pop(sid, None)`（旧连接
       * 被摘出字典、不会被 close），所以**同一个 client_id 只能有一条活着的订阅**——
       * 并发两条运行同时开进度时，先建的那条会静默收不到。
       */
      clientId = crypto.randomUUID();
      constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.headers = options.headers ?? {};
        this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
        this.ensure = options.ensure;
      }
      /** 发一个请求；网络层失败统一归成 comfy_unreachable。 */
      async request(path38, init = {}, timeoutMs2 = this.requestTimeoutMs, skipEnsure = false) {
        if (this.ensure !== void 0 && !skipEnsure) {
          const ready = await this.ensure();
          if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
        }
        const url = `${this.baseUrl}${path38}`;
        try {
          return await fetch(url, {
            ...init,
            headers: { ...this.headers, ...init.headers ?? {} },
            signal: AbortSignal.timeout(timeoutMs2)
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
      /**
       * 查队列：哪些在跑、哪些在排。
       *
       * ComfyUI 的 `/queue` 响应是 `{ queue_running: [...], queue_pending: [...] }`，
       * 每项形如 `[number, prompt_id, {...}, extra, outputs]`。这个结构的字段在
       * 0.3 前后调整过（曾经叫 `queue_running` / 也出现过 `running`），所以按
       * "取到就用、取不到当空"写，不假定某一种精确形状 —— 与 `/object_info` 的处理一致。
       *
       * @returns 运行中与排队中的 promptId（顺序即队列顺序）。
       */
      async queue() {
        const now = Date.now();
        if (this.queueCache !== void 0 && now - this.queueCache.at < 1e3) return this.queueCache.value;
        if (this.queueInflight !== void 0) return this.queueInflight;
        const inflight = this.fetchQueue().then((value) => {
          this.queueCache = { at: Date.now(), value };
          this.queueInflight = void 0;
          return value;
        }).catch((error) => {
          this.queueInflight = void 0;
          throw error;
        });
        this.queueInflight = inflight;
        return inflight;
      }
      /** 真正去拉一次队列。 */
      async fetchQueue() {
        let body;
        try {
          const res = await this.request("/queue", { method: "GET" }, this.requestTimeoutMs, true);
          if (!res.ok) return { running: [], pending: [] };
          body = await res.json();
        } catch {
          return { running: [], pending: [] };
        }
        if (body === null || typeof body !== "object") return { running: [], pending: [] };
        return parseQueue(body);
      }
      /**
       * 提交一份工作流，返回 prompt_id 与**提交时就能看到的警告**。
       *
       * `POST /prompt` 的 **200** 响应里可能带 `node_errors`：ComfyUI 接受了这次提交
       * （有 `prompt_id`、会执行），但某些输出链的参数被判非法，那部分不会产出文件。
       * 早期版本把整个 `node_errors` 扔了，于是只能等十几秒后从"没有产物"倒推原因 ——
       * 现在当场就能说出「节点 6 的 sampler_name 不在候选里」。
       */
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
        const bag = parsed !== null && typeof parsed === "object" ? parsed : {};
        const promptId = bag.prompt_id;
        if (typeof promptId !== "string" || promptId === "") {
          throw new RunError("submit_rejected", "ComfyUI \u6CA1\u6709\u8FD4\u56DE prompt_id\u3002", "\u786E\u8BA4 ComfyUI \u7248\u672C\u652F\u6301 POST /prompt\u3002");
        }
        const warnings = describeNodeErrors(bag.node_errors);
        return { promptId, warnings };
      }
      /** 查一次 history：没完成时返回 undefined。 */
      async history(promptId) {
        const res = await this.request(`/history/${encodeURIComponent(promptId)}`, { method: "GET" }, 3e4);
        if (res.status === 404) return void 0;
        if (res.status === 401 || res.status === 403) throw authFailed(this.baseUrl, res.status);
        if (!res.ok) {
          throw new RunError(
            "comfy_unreachable",
            `ComfyUI \u67E5\u8BE2\u5931\u8D25\uFF1A/history \u8FD4\u56DE ${res.status}`,
            "\u670D\u52A1\u53EF\u80FD\u6B63\u5728\u91CD\u542F\u6216\u540E\u7AEF\u5F02\u5E38\u3002\u7A0D\u540E\u91CD\u8BD5\uFF1B\u6301\u7EED\u5931\u8D25\u8BF7\u770B ComfyUI \u63A7\u5236\u53F0\u65E5\u5FD7\u3002"
          );
        }
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
  }
});

// src/shared/comfy/supervisor.ts
import { spawn } from "node:child_process";
import fs6 from "node:fs";
import path5 from "node:path";
async function probe(baseUrl, timeoutMs2 = 3e3) {
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(timeoutMs2) });
    return res.ok;
  } catch {
    return false;
  }
}
async function queueBusy(baseUrl, timeoutMs2 = 2e3) {
  try {
    const res = await fetch(`${baseUrl}/queue`, { signal: AbortSignal.timeout(timeoutMs2) });
    if (!res.ok) return false;
    return isQueueBusy(await res.json());
  } catch {
    return false;
  }
}
function shouldReclaim(input) {
  if (input.idleShutdownMs <= 0) return false;
  if (input.idledMs < input.idleShutdownMs) return false;
  return !input.busy;
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
    if (!fs6.statSync(path5.join(dir, "main.py")).isFile()) return false;
    return fs6.statSync(path5.join(dir, "models")).isDirectory();
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
    candidates.push(path5.join(home, "ComfyUI"));
    candidates.push(path5.join(home, "comfyui"));
    candidates.push(path5.join(home, ".dsh-comfyui-workbench", "ComfyUI"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData !== "") {
    candidates.push(path5.join(localAppData, "ComfyUI"));
    candidates.push(path5.join(localAppData, "Programs", "ComfyUI"));
  }
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    candidates.push(path5.join(`${drive}${path5.sep}`, "ComfyUI"));
    candidates.push(path5.join(`${drive}${path5.sep}`, "comfyui"));
    candidates.push(path5.join(`${drive}${path5.sep}`, "ComfyUI_windows_portable", "ComfyUI"));
    candidates.push(...desktopCandidates(`${drive}${path5.sep}`));
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
  const installs = path5.join(root, "Comfy-Desktop", "ComfyUI-Installs");
  let names;
  try {
    names = fs6.readdirSync(installs);
  } catch {
    return [];
  }
  return names.map((name2) => path5.join(installs, name2, "ComfyUI"));
}
function interpreterOf(dir) {
  const parent = path5.dirname(dir);
  const candidates = [
    path5.join(dir, "venv", "Scripts", "python.exe"),
    path5.join(dir, "venv", "bin", "python"),
    path5.join(dir, "python_embeded", "python.exe"),
    path5.join(dir, ".venv", "Scripts", "python.exe"),
    // Desktop 版：解释器在 ComfyUI 的上一级（ComfyUI-Installs/<实例>/standalone-env）
    path5.join(parent, "standalone-env", "python.exe"),
    path5.join(parent, "standalone-env", "bin", "python")
  ];
  for (const candidate of candidates) {
    try {
      if (fs6.statSync(candidate).isFile()) return candidate;
    } catch {
    }
  }
  return process.platform === "win32" ? "python" : "python3";
}
var ComfySupervisor;
var init_supervisor = __esm({
  "src/shared/comfy/supervisor.ts"() {
    "use strict";
    init_paths();
    init_queue();
    ComfySupervisor = class {
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
            const text3 = typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
            if (text3 !== "") sink?.(stream, text3);
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
          void this.reclaimIdle();
        }, Math.min(6e4, Math.max(5e3, Math.floor(this.options.idleShutdownMs / 4))));
        this.idleTimer.unref?.();
      }
      /**
      * 到点看一眼，真空闲才回收。
       *
       * 判"空闲"不能只看 `lastUsedAt`：异步提交之后模型不再发任何调用，正在跑图的实例
       * 会被当成空闲。所以先问队列，有活就把计时往后推。
       *
       * **`await` 之后必须复查**：探测要花最多 2 秒，这期间别的工具可能已经调了
       * `ensureReady` 刷新 `lastUsedAt`，旧进程也可能退出、`ensureReady` 又拉起了一个新的。
       * 不复查就会杀掉"刚被用过"或"刚拉起来"的实例 —— 与用户抱怨的症状一模一样。
       */
      async reclaimIdle() {
        const child = this.child;
        if (child === null) {
          this.clearIdleTimer();
          return;
        }
        const idled = Date.now() - this.lastUsedAt;
        if (!shouldReclaim({ idledMs: idled, idleShutdownMs: this.options.idleShutdownMs, busy: false })) return;
        const busy = await queueBusy(this.options.baseUrl);
        if (busy) {
          this.lastUsedAt = Date.now();
          return;
        }
        if (this.child !== child) return;
        if (!shouldReclaim({
          idledMs: Date.now() - this.lastUsedAt,
          idleShutdownMs: this.options.idleShutdownMs,
          busy: false
        })) return;
        this.stop();
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
  }
});

// src/shared/comfy/upload.ts
import fs7 from "node:fs";
import path6 from "node:path";
async function ensureComfyImage(client, value) {
  const looksLocal = /[\\/]/.test(value) || path6.isAbsolute(value);
  if (!looksLocal) return value;
  let bytes;
  try {
    bytes = fs7.readFileSync(value);
  } catch (error) {
    throw new RunError(
      "variable_type",
      `\u8BFB\u4E0D\u5230\u8FD9\u5F20\u56FE\uFF1A${value}`,
      "\u786E\u8BA4\u6587\u4EF6\u8FD8\u5728\uFF1B\u4E0A\u4F20\u5668\u7ED9\u7684\u8DEF\u5F84\u4F1A\u843D\u5728\u63D2\u4EF6\u7684 uploads \u76EE\u5F55\u91CC\u3002",
      error
    );
  }
  const form = new FormData();
  form.append("image", new Blob([new Uint8Array(bytes)], { type: "image/png" }), path6.basename(value));
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
var init_upload = __esm({
  "src/shared/comfy/upload.ts"() {
    "use strict";
    init_errors();
  }
});

// src/shared/comfy/models.ts
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
var MODEL_FIELD;
var init_models = __esm({
  "src/shared/comfy/models.ts"() {
    "use strict";
    MODEL_FIELD = /(ckpt|checkpoint|unet|model|lora|vae).*name$/i;
  }
});

// src/shared/comfy/index.ts
var init_comfy = __esm({
  "src/shared/comfy/index.ts"() {
    "use strict";
    init_client();
    init_errors();
    init_errors();
    init_supervisor();
    init_queue();
    init_upload();
    init_models();
  }
});

// src/shared/workflow/variables.ts
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
var VariableError;
var init_variables = __esm({
  "src/shared/workflow/variables.ts"() {
    "use strict";
    VariableError = class extends Error {
      code;
      detail;
      constructor(code, message, detail = {}) {
        super(message);
        this.name = "VariableError";
        this.code = code;
        this.detail = detail;
      }
    };
  }
});

// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs8 from "node:fs";
import path7 from "node:path";
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
function isSavingNode(classType) {
  if (/^preview\s*bridge$/i.test(classType)) return false;
  return /^(save|preview|image\s*comparer)/i.test(classType);
}
function intermediateSaves(workflow) {
  const out = /* @__PURE__ */ new Set();
  if (workflow === void 0) return out;
  const consumers = /* @__PURE__ */ new Map();
  for (const [id, node] of Object.entries(workflow)) {
    for (const value of Object.values(node.inputs ?? {})) {
      if (!Array.isArray(value) || typeof value[0] !== "string") continue;
      const list = consumers.get(value[0]) ?? [];
      list.push(id);
      consumers.set(value[0], list);
    }
  }
  for (const [id, node] of Object.entries(workflow)) {
    if (!isSavingNode(String(node.class_type ?? ""))) continue;
    const images = node.inputs?.images;
    if (!Array.isArray(images) || typeof images[0] !== "string") continue;
    const source = images[0];
    const downstream = (consumers.get(source) ?? []).filter((other) => {
      const otherType = String(workflow[other]?.class_type ?? "");
      return !isSavingNode(otherType);
    });
    if (downstream.length > 0) out.add(id);
  }
  return out;
}
function fileRefsOf(outputs, workflow) {
  const found = [];
  if (outputs === void 0) return found;
  const intermediate = intermediateSaves(workflow);
  for (const [nodeId, bag] of Object.entries(outputs)) {
    const classType = String(workflow?.[nodeId]?.class_type ?? "");
    const kind = intermediate.has(nodeId) ? "intermediate" : outputKindOf(classType);
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
  return table[path7.extname(file).toLowerCase()] ?? "application/octet-stream";
}
function targetFor(outputDir, filename) {
  const safe = path7.basename(filename);
  const first = path7.join(outputDir, safe);
  if (!fs8.existsSync(first)) return first;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T.]/g, "").slice(0, 17);
  return path7.join(outputDir, `${stamp}-${safe}`);
}
function collectedBefore(outputDir, filename, promptId) {
  const safe = path7.basename(filename);
  let candidates;
  try {
    candidates = fs8.readdirSync(outputDir).filter((name2) => name2 === safe || name2.endsWith(`-${safe}`)).map((name2) => path7.join(outputDir, name2));
  } catch {
    return void 0;
  }
  for (const target of candidates) {
    let recorded;
    try {
      const meta = JSON.parse(fs8.readFileSync(`${target}.json`, "utf8"));
      recorded = meta !== null && typeof meta === "object" ? meta.comfy?.promptId : void 0;
    } catch {
      continue;
    }
    if (recorded !== promptId) continue;
    try {
      const bytes = fs8.readFileSync(target);
      const artifact = { path: target, digest: digestOf(bytes), mime: mimeOf(target), bytes: bytes.length };
      if (path7.extname(target).toLowerCase() === ".png") {
        const parsed = readPngTextChunks(target, bytes.length);
        if (parsed !== void 0 && parsed.width > 0 && parsed.height > 0) {
          artifact.width = parsed.width;
          artifact.height = parsed.height;
        }
      }
      return artifact;
    } catch {
      continue;
    }
  }
  return void 0;
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
  const submitted = await client.queuePrompt(applied.workflow);
  const promptId = submitted.promptId;
  notes.push(...submitted.warnings);
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
function pickArtifacts(all) {
  const durable = all.filter((ref) => ref.kind === "save" && ref.type !== "temp");
  const durableWithTemp = all.filter((ref) => ref.kind === "save");
  const intermediateOnly = all.filter((ref) => ref.kind === "intermediate" && ref.type !== "temp");
  const refs = durable.length > 0 ? durable : durableWithTemp.length > 0 ? durableWithTemp : intermediateOnly.length > 0 ? intermediateOnly : [...all];
  const chosen = new Set(refs);
  const dropped = all.filter((ref) => ref.kind === "intermediate" && !chosen.has(ref));
  const skippedPreview = all.length - refs.length - dropped.length;
  return { refs, dropped, skippedPreview };
}
async function collectArtifacts(client, promptId, entry, context) {
  const inflight = collecting.get(promptId);
  if (inflight !== void 0) return inflight;
  const task = collectArtifactsOnce(client, promptId, entry, context);
  collecting.set(promptId, task);
  try {
    return await task;
  } finally {
    if (collecting.get(promptId) === task) collecting.delete(promptId);
  }
}
async function collectArtifactsOnce(client, promptId, entry, context) {
  const all = fileRefsOf(entry.outputs, context.workflow);
  const { refs, dropped: droppedIntermediate, skippedPreview } = pickArtifacts(all);
  const notes = [];
  if (droppedIntermediate.length > 0) {
    const names = droppedIntermediate.slice(0, 3).map((ref) => ref.filename).join("\u3001");
    notes.push(
      `\u8DF3\u8FC7\u4E86 ${droppedIntermediate.length} \u5F20\u4E2D\u95F4\u4EA7\u7269\uFF08${names}${droppedIntermediate.length > 3 ? "\u2026" : ""}\uFF09\uFF1A\u5B83\u4EEC\u7684\u6765\u6E90\u8FD8\u88AB\u522B\u7684\u8282\u70B9\u7EE7\u7EED\u8BA1\u7B97\uFF0C\u6309"\u5B58\u7684\u662F\u6D41\u7A0B\u4E2D\u95F4\u7ED3\u679C"\u5904\u7406\u3002\u82E5\u90A3\u5F20\u5176\u5B9E\u662F\u4F60\u8981\u7684\uFF08\u4F8B\u5982\u4E24\u6BB5\u5F0F\u653E\u5927/\u7CBE\u4FEE\u7684\u524D\u4E00\u6BB5\uFF09\uFF0C\u53BB ComfyUI \u81EA\u5DF1\u7684\u8F93\u51FA\u76EE\u5F55\u53D6\uFF0C\u6216\u628A\u90A3\u4E2A\u76EE\u5F55\u52A0\u8FDB assetRoots\u3002`
    );
  }
  if (refs.length === 0) throw noOutput();
  ensureDir(context.outputDir);
  const artifacts = [];
  const unreadable = [];
  const fresh = /* @__PURE__ */ new Set();
  for (const ref of refs) {
    const reused = collectedBefore(context.outputDir, ref.filename, promptId);
    if (reused !== void 0) {
      artifacts.push(reused);
      continue;
    }
    let bytes;
    try {
      bytes = await client.view({ filename: ref.filename, subfolder: ref.subfolder, type: ref.type });
    } catch (error) {
      unreadable.push(`${ref.filename}\uFF08${error instanceof Error ? error.message : String(error)}\uFF09`);
      continue;
    }
    const target = targetFor(context.outputDir, ref.filename);
    fs8.writeFileSync(target, bytes);
    fresh.add(target);
    const artifact = { path: target, digest: digestOf(bytes), mime: mimeOf(target), bytes: bytes.length };
    if (path7.extname(target).toLowerCase() === ".png") {
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
  if (context.writeMetadata && primary !== void 0 && fresh.has(primary.path)) {
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
      fs8.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}
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
      ...skippedPreview > 0 ? [`\u5DF2\u8DF3\u8FC7 ${skippedPreview} \u5F20\u9884\u89C8\u56FE\uFF1A\u5B83\u4EEC\u6765\u81EA PreviewImage \u4E4B\u7C7B\u7684\u8282\u70B9\uFF0C\u662F ComfyUI \u7684\u4E34\u65F6\u8F93\u51FA\uFF0C\u4E0D\u662F\u4EA7\u7269\u3002`] : [],
      ...notes,
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
var pending, collecting;
var init_runner = __esm({
  "src/shared/run/runner.ts"() {
    "use strict";
    init_paths();
    init_png_text();
    init_policy();
    init_comfy();
    init_variables();
    pending = /* @__PURE__ */ new Map();
    collecting = /* @__PURE__ */ new Map();
  }
});

// src/shared/comfy/progress.ts
function watchProgress(baseUrl, promptId, onTick, options = {}) {
  const Ctor = globalThis.WebSocket;
  if (Ctor === void 0) {
    safeInfo(options.logger, `[progress] \u5F53\u524D\u8FD0\u884C\u65F6\u6CA1\u6709\u5168\u5C40 WebSocket\uFF0C\u8FDB\u5EA6\u8BA2\u9605\u4E0D\u751F\u6548`);
    return () => {
    };
  }
  const clientId = options.clientId ?? `comfyui-workbench-${Math.random().toString(36).slice(2)}`;
  const url = `${baseUrl.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`;
  let socket;
  let closed = false;
  try {
    socket = new Ctor(url);
  } catch (error) {
    safeInfo(options.logger, `[progress] \u5EFA\u4E0D\u4E86\u8FDE\u63A5\uFF1A${error instanceof Error ? error.message : String(error)}`);
    return () => {
    };
  }
  const timer = setTimeout(() => {
    if (!closed) {
      closed = true;
      try {
        socket?.close();
      } catch {
      }
    }
  }, options.connectTimeoutMs ?? 3e3);
  timer.unref?.();
  socket.addEventListener("message", (event) => {
    if (closed) return;
    let parsed;
    try {
      parsed = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (parsed.type !== "progress") return;
    const id = parsed.data?.prompt_id;
    if (id !== promptId) return;
    const value = typeof parsed.data?.value === "number" ? parsed.data.value : void 0;
    const max = typeof parsed.data?.max === "number" ? parsed.data.max : void 0;
    if (value === void 0) return;
    try {
      onTick({ value, max: max ?? 0 });
    } catch {
    }
  });
  socket.addEventListener("open", () => {
    clearTimeout(timer);
  });
  socket.addEventListener("error", () => {
    safeInfo(options.logger, `[progress] ${url} \u8FDE\u63A5\u5931\u8D25\uFF0C\u672C\u6B21\u8FD0\u884C\u6CA1\u6709\u767E\u5206\u6BD4`);
    closed = true;
    clearTimeout(timer);
    try {
      socket?.close();
    } catch {
    }
  });
  return () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    try {
      socket?.close();
    } catch {
    }
  };
}
function safeInfo(logger, message) {
  try {
    logger?.info?.(message);
  } catch {
  }
}
var init_progress = __esm({
  "src/shared/comfy/progress.ts"() {
    "use strict";
  }
});

// src/shared/run/notify.ts
import crypto3 from "node:crypto";
function noticeMessage(text3) {
  return {
    id: crypto3.randomUUID(),
    role: "user",
    content: [{ type: "text", text: text3 }],
    source: { kind: NOTICE_SOURCE_KIND }
  };
}
function deliver(target, text3, logger) {
  try {
    target.followup(noticeMessage(text3));
  } catch (error) {
    try {
      logger?.warn?.(`[notify] \u901A\u77E5\u672A\u9001\u8FBE\uFF1A${error instanceof Error ? error.message : String(error)}`);
    } catch {
    }
  }
}
async function syncQueueState(client, promptId, registry) {
  if (registry === void 0) return;
  try {
    const queue = await client.queue();
    const runningAt = queue.running.indexOf(promptId);
    const pendingAt = queue.pending.indexOf(promptId);
    if (runningAt >= 0) {
      registry.update(promptId, {
        state: "running",
        startedAt: registry.get(promptId)?.startedAt ?? Date.now(),
        queuePosition: 0
      });
    } else if (pendingAt >= 0) {
      registry.update(promptId, { state: "queued", queuePosition: pendingAt + 1 });
    }
  } catch {
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
        await syncQueueState(client, promptId, options.registry);
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
  let stopProgress = () => {
  };
  const stop = () => {
    try {
      stopProgress();
    } catch {
    }
    const current = watchers.get(promptId);
    if (current !== void 0) {
      clearInterval(current.timer);
      watchers.delete(promptId);
    }
  };
  stop();
  if (options.progressStream === true) {
    stopProgress = watchProgress(client.baseUrl, promptId, (tick) => {
      try {
        options.registry?.update(promptId, { progress: { value: tick.value, max: tick.max } });
      } catch {
      }
    }, {
      // 必须复用提交时的 client_id：`progress` 带 sid 发出（`main.py:475`），
      // 而 sid 是执行开始时由 `extra_data["client_id"]` 赋的（`execution.py:740`）。
      // 自己另造一个 id 连上去，握手成功、status 能收，但永远收不到本任务的 progress。
      // 注意同 sid 再连会互踢（`server.py:341-345`），同一 client 只能有一条订阅活着。
      clientId: client.clientId,
      ...options.logger === void 0 ? {} : { logger: options.logger }
    });
    progressStops.add(stopProgress);
  }
  let inflight = false;
  let settled = false;
  const finish = (patch) => {
    settled = true;
    stop();
    options.registry?.update(promptId, { ...patch, progress: void 0 });
    progressStops.delete(stopProgress);
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
        await syncQueueState(client, promptId, options.registry);
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
  for (const stopProgress of progressStops) {
    try {
      stopProgress();
    } catch {
    }
  }
  progressStops.clear();
}
var NOTICE_SOURCE_KIND, watchers, progressStops;
var init_notify = __esm({
  "src/shared/run/notify.ts"() {
    "use strict";
    init_progress();
    init_policy();
    init_runner();
    NOTICE_SOURCE_KIND = "plugin:dsh-comfyui-workbench";
    watchers = /* @__PURE__ */ new Map();
    progressStops = /* @__PURE__ */ new Set();
  }
});

// src/shared/run/batch-notify.ts
var BatchCollector;
var init_batch_notify = __esm({
  "src/shared/run/batch-notify.ts"() {
    "use strict";
    BatchCollector = class {
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
        return run.artifacts.map((path38) => ({ path: path38 }));
      }
      /** 停掉超时定时器（插件卸载或调用方取消）。 */
      dispose() {
        if (this.timer !== void 0) {
          clearTimeout(this.timer);
          this.timer = void 0;
        }
      }
    };
  }
});

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
var init_overrides = __esm({
  "src/shared/run/overrides.ts"() {
    "use strict";
  }
});

// src/shared/run/index.ts
var init_run = __esm({
  "src/shared/run/index.ts"() {
    "use strict";
    init_runner();
    init_notify();
    init_batch_notify();
    init_overrides();
    init_policy();
  }
});

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
function formatHint(format) {
  if (format === "ui") {
    return "\u8FD9\u662F ComfyUI \u754C\u9762\u7684\u5DE5\u7A0B\u6587\u4EF6\uFF08UI \u683C\u5F0F\uFF09\uFF0C\u4E0D\u80FD\u76F4\u63A5\u63D0\u4EA4\u3002\u8BF7\u5728 ComfyUI \u91CC\u7528\u300CExport (API)\u300D\u91CD\u65B0\u5BFC\u51FA\u540E\u518D\u5BFC\u5165\u3002";
  }
  return '\u8FD9\u4E0D\u662F\u53EF\u8BC6\u522B\u7684 API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF1A\u9700\u8981\u5F62\u5982 {"3": {"class_type": "KSampler", "inputs": {...}}} \u7684 JSON\u3002';
}
var init_detect = __esm({
  "src/shared/workflow/detect.ts"() {
    "use strict";
  }
});

// src/shared/workflow/from-ui.ts
var init_from_ui = __esm({
  "src/shared/workflow/from-ui.ts"() {
    "use strict";
  }
});

// src/shared/workflow/infer.ts
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
function typeOf2(key, value) {
  const image = imageKindOf(key, value);
  if (image !== void 0) return image;
  if (typeof value === "string") return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return void 0;
}
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
      if (/(ckpt|checkpoint|unet|model|lora|vae).*name$/i.test(key) && typeof value === "string" && MODEL_EXT2.test(value)) {
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
    notes.push('\u6CA1\u6709\u8BC6\u522B\u51FA\u672B\u7AEF\u8F93\u51FA\u8282\u70B9\uFF08\u6309\u7C7B\u540D\u5224\u65AD\uFF09\uFF1A\u6A21\u677F\u53EF\u80FD\u7F3A\u5C11 SaveImage / PreviewImage \u8FD9\u7C7B\u8F93\u51FA\u8282\u70B9\u3002\u82E5\u786E\u5B9E\u4E00\u4E2A\u8F93\u51FA\u8282\u70B9\u90FD\u6CA1\u6709\uFF0C\u63D0\u4EA4\u65F6\u4F1A\u88AB ComfyUI \u4EE5 "Prompt has no outputs" \u62D2\u6389\uFF1B\u7528\u7684\u662F\u81EA\u5B9A\u4E49\u8F93\u51FA\u8282\u70B9\u7684\u8BDD\u53EF\u4EE5\u5FFD\u7565\u8FD9\u6761\u3002');
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
      const type = typeOf2(key, value);
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
var INTERNAL_INPUT, MODEL_RULES, MODEL_EXT2, MAX_EXPOSED_SLOTS, PRIORITY;
var init_infer = __esm({
  "src/shared/workflow/infer.ts"() {
    "use strict";
    INTERNAL_INPUT = [
      /^(ckpt_name|unet_name|model_name|lora_name|vae_name|control_net_name|clip_name|style_model_name)$/i,
      /^(vae|clip|batch_size|filename_prefix|sampler_state|widgets_values|noise_seed_offset)$/i,
      /^(save_prefix|save_to_comfyui|output_dir)$/i
    ];
    MODEL_RULES = [
      { pattern: /checkpoint/i, fields: ["ckpt_name"], kind: "checkpoint" },
      { pattern: /(unet|diffusion)/i, fields: ["unet_name", "model_name"], kind: "diffusion" },
      { pattern: /lora/i, fields: ["lora_name"], kind: "lora" },
      { pattern: /vae/i, fields: ["vae_name"], kind: "vae" },
      { pattern: /upscale/i, fields: ["model_name"], kind: "upscale" }
    ];
    MODEL_EXT2 = /\.(safetensors|ckpt|pt|pth|gguf|bin)$/i;
    MAX_EXPOSED_SLOTS = 24;
    PRIORITY = [
      /^(prompt|negative_prompt|text|text_g|text_l|caption|character|action|wildcard)$/i,
      /^(seed|noise_seed|steps|cfg|denoise|strength|width|height|batch_size|guidance)$/i,
      /^(sampler_name|scheduler|checkpoint|model|lora_name)$/i
    ];
  }
});

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
var init_surface = __esm({
  "src/shared/workflow/surface.ts"() {
    "use strict";
    init_infer();
  }
});

// src/shared/workflow/store.ts
import fs9 from "node:fs";
import path8 from "node:path";
function sanitizeId(name2) {
  const base = path8.basename(name2, path8.extname(name2));
  const cleaned = base.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return cleaned === "" ? "workflow" : [...cleaned].slice(0, 64).join("").replace(/-+$/g, "");
}
function pathsOf(dir, id) {
  return {
    workflow: path8.join(dir, `${id}.json`),
    schema: path8.join(dir, `${id}.schema.json`),
    meta: path8.join(dir, `${id}.meta.json`)
  };
}
function readJson(file) {
  try {
    const parsed = JSON.parse(fs9.readFileSync(file, "utf8"));
    return parsed !== null && typeof parsed === "object" ? parsed : void 0;
  } catch {
    return void 0;
  }
}
function listWorkflowIds(dir) {
  let names;
  try {
    names = fs9.readdirSync(dir);
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
  fs9.writeFileSync(pathsOf(dir, id).workflow, `${JSON.stringify(workflow, null, 2)}
`, "utf8");
}
function writeMeta(dir, id, meta) {
  ensureDir(dir);
  const merged = {
    ...meta,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  fs9.writeFileSync(pathsOf(dir, id).meta, `${JSON.stringify(merged, null, 2)}
`, "utf8");
}
function importWorkflowValue(dir, raw, nameHint, options = {}) {
  const format = detectFormat(raw);
  if (format !== "api") throw new WorkflowFormatError(formatHint(format));
  const id = sanitizeId(nameHint);
  const target = pathsOf(dir, id).workflow;
  const replaced = fs9.existsSync(target);
  if (replaced && options.overwrite !== true) throw new WorkflowExistsError(id);
  if (replaced) {
    try {
      fs9.copyFileSync(target, `${target}.bak`);
    } catch {
    }
  }
  writeWorkflow(dir, id, raw);
  const entry = readEntry(dir, id);
  if (entry === void 0) throw new WorkflowFormatError("\u5BFC\u5165\u540E\u8BFB\u4E0D\u56DE\u8FD9\u4EFD\u5DE5\u4F5C\u6D41\uFF0C\u8BF7\u68C0\u67E5\u6587\u4EF6\u6743\u9650\u3002");
  return { id, surface: entry.surface, replaced };
}
var WorkflowFormatError, WorkflowExistsError;
var init_store = __esm({
  "src/shared/workflow/store.ts"() {
    "use strict";
    init_paths();
    init_detect();
    init_surface();
    WorkflowFormatError = class extends Error {
      constructor(message) {
        super(message);
        this.name = "WorkflowFormatError";
      }
    };
    WorkflowExistsError = class extends Error {
      id;
      constructor(id) {
        super(`\u5DF2\u5B58\u5728\u540C\u540D\u5DE5\u4F5C\u6D41\uFF1A${id}\u3002\u8986\u76D6\u4F1A\u66FF\u6362\u6A21\u677F\uFF08\u4FDD\u7559\u5907\u6CE8\u4E0E schema\uFF09\uFF0C\u9700\u8981\u663E\u5F0F\u786E\u8BA4\u3002`);
        this.name = "WorkflowExistsError";
        this.id = id;
      }
    };
  }
});

// src/shared/workflow/index.ts
var init_workflow = __esm({
  "src/shared/workflow/index.ts"() {
    "use strict";
    init_detect();
    init_from_ui();
    init_infer();
    init_surface();
    init_store();
    init_variables();
  }
});

// src/components/tool-generate/tools/run.ts
var run_exports = {};
__export(run_exports, {
  loadWorkflowForBatch: () => loadWorkflowForBatch,
  runTool: () => runTool
});
import fs10 from "node:fs";
import path9 from "node:path";
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
    raw = JSON.parse(fs10.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`\u8BFB\u4E0D\u4E86\u5DE5\u4F5C\u6D41\u6587\u4EF6\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("\u5DE5\u4F5C\u6D41\u6587\u4EF6\u4E0D\u662F JSON \u5BF9\u8C61\u3002");
  const format = detectFormat(raw);
  if (format !== "api") throw new Error(formatHint(format));
  const workflow = raw;
  const workflowId = path9.basename(filePath, path9.extname(filePath));
  return { workflowId, workflow, surface: buildSurface({ workflowId, workflow }) };
}
function sweepFallback(deps, promptId, workflowId, outputDir) {
  sweepRun({
    client: deps.client,
    promptId,
    workflowId,
    outputDir,
    intervalMs: deps.pollIntervalMs,
    registry: deps.runs,
    ...deps.logger === void 0 ? {} : { logger: deps.logger }
  });
}
function loadWorkflowForBatch(deps, args) {
  return loadWorkflow(deps, args);
}
function runTool(deps) {
  return {
    name: "comfyui_run",
    description: "\u6267\u884C\u4E00\u4E2A ComfyUI \u5DE5\u4F5C\u6D41\u3002**\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u4F1A\u81EA\u52A8\u62C9\u8D77**\uFF1A\u63D0\u4EA4\u4F1A\u7B49\u5230\u670D\u52A1\u5C31\u7EEA\u518D\u53D1\u51FA\u53BB\uFF08\u9ED8\u8BA4\u6700\u591A\u7B49 3 \u5206\u949F\uFF09\uFF0C\u6240\u4EE5\u4E0D\u7528\u5148\u624B\u52A8\u542F\u52A8 ComfyUI\uFF1B\u4E5F**\u4E0D\u8981**\u53BB kill \u6216\u91CD\u542F\u5B83 \u2014\u2014 \u5B83\u53EF\u80FD\u6B63\u5728\u4E0B\u8F7D/\u52A0\u8F7D\u6A21\u578B\uFF0C\u6253\u65AD\u4F1A\u8BA9\u5B83\u5361\u5728\u81EA\u5DF1\u7684\u4E0B\u8F7D\u72B6\u6001\u91CC\u3002\u53C2\u6570\u7528 vars \u4F20\uFF08\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u58F0\u660E\u8FC7\u7684\u8F93\u5165\u540D\uFF0C\u53EF\u7528 comfyui_workflow_list / inspect \u67E5\uFF09\u3002**\u6539\u53C2\u6570\u4E00\u5F8B\u7528 vars\uFF0C\u4E0D\u8981\u4E3A\u4E86\u6539\u53C2\u6570\u53BB\u590D\u5236\u6216\u6539\u5199\u5DE5\u4F5C\u6D41 JSON** \u2014\u2014 \u6A21\u677F + \u53D8\u91CF\u5C31\u662F\u4E3A\u6B64\u5B58\u5728\u7684\uFF0C\u6539\u6587\u4EF6\u4F1A\u8BA9\u8FD9\u6B21\u8FD0\u884C\u65E0\u6CD5\u8FFD\u6EAF\uFF0C\u4E5F\u8BA9\u5DE5\u4F5C\u6D41\u76EE\u5F55\u8D8A\u5806\u8D8A\u4E71\uFF1B\u53EA\u6709\u8981\u6539**\u7ED3\u6784**\uFF08\u589E\u5220\u8282\u70B9\u3001\u6362\u8FDE\u7EBF\uFF09\u65F6\u624D\u78B0\u6587\u4EF6\u3002\u8FD4\u56DE\u503C\u5305\u542B\u4EA7\u7269\u8DEF\u5F84\u4E0E\u539F\u59CB\u50CF\u7D20\u5C3A\u5BF8\uFF1B\u5BBF\u4E3B\u4E0D\u56DE\u4F20\u56FE\u7247\u672C\u8EAB\uFF0C\u9700\u8981\u770B\u56FE\u65F6\u6309\u8FD4\u56DE\u7684\u8DEF\u5F84\u8BFB\u53D6\u539F\u56FE\u3002",
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
          description: '\u5DE5\u4F5C\u6D41\u6807\u8BC6\u3002**\u4F18\u5148\u7528 {"id":"sdxl"}** \u2014\u2014 \u6307\u5411\u5DE5\u4F5C\u6D41\u76EE\u5F55\u91CC\u7684\u6A21\u677F\uFF0C\u914D\u5408 vars \u6539\u53C2\u6570\uFF0C\u8FD9\u662F\u5E38\u89C4\u8DEF\u5F84\u3002{"path":"D:/\u67D0\u5904/workflow.json"} \u53EA\u7528\u4E8E\u76EE\u5F55\u4E4B\u5916\u7684\u4E34\u65F6\u6587\u4EF6\uFF0C\u4E14\u5FC5\u987B\u662F **API \u683C\u5F0F**\uFF1BUI \u683C\u5F0F\uFF08\u5E26 nodes + links \u7684\u754C\u9762\u5DE5\u7A0B\u6587\u4EF6\uFF09\u4E0D\u80FD\u76F4\u63A5\u63D0\u4EA4\uFF0C\u8981\u5148\u5728 ComfyUI \u91CC\u300CExport (API)\u300D\u3002',
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
        wait: {
          type: "boolean",
          description: "\u662F\u5426\u540C\u6B65\u7B49\u5230\u51FA\u56FE\u3002\u9ED8\u8BA4 false\uFF1A\u63D0\u4EA4\u540E\u7ACB\u523B\u8FD4\u56DE promptId\uFF0C\u51FA\u5B8C\u56FE\u63D2\u4EF6\u4F1A\u4E3B\u52A8\u901A\u77E5\u5BF9\u8BDD\uFF1B\u4F20 true \u5219\u672C\u6B21\u8C03\u7528\u7B49\u5230\u4EA7\u7269\u843D\u76D8\u6216\u8D85\u65F6\u3002"
        },
        waitMs: { type: "integer", description: "wait=true \u65F6\u7684\u7B49\u5F85\u4E0A\u9650\uFF08\u6BEB\u79D2\uFF09\uFF0C\u9ED8\u8BA4\u53D6\u914D\u7F6E\u7684 timeoutMs" },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "\u4EA7\u7269\u6807\u7B7E\uFF0C\u767B\u8BB0\u8FDB\u8D44\u4EA7\u7D22\u5F15\u4FBF\u4E8E\u4E4B\u540E\u7B5B\u9009\u3002\u6CE8\u610F\u53EA\u6709 wait:true \u540C\u6B65\u53D6\u56DE\u4EA7\u7269\u65F6\u624D\u4F1A\u767B\u8BB0\uFF1B\u9ED8\u8BA4\u5F02\u6B65\u8DEF\u5F84\u7531\u540E\u53F0\u901A\u77E5\u843D\u76D8\uFF0C\u4E0D\u5199\u7D22\u5F15\u3002"
        },
        timeoutMs: { type: "integer", description: "\u5DF2\u5F03\u7528\uFF1A\u8BF7\u7528 waitMs" },
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
          if (Array.isArray(bag.notes) && bag.notes.length > 0) lines.push(`\u5907\u6CE8\uFF1A${bag.notes.join("\uFF1B")}`);
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
          const resumeOutputDir = deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir;
          const outcome = await resumeRun(deps.client, resumeId, { outputDir: resumeOutputDir });
          if ("pending" in outcome) {
            deps.runs.update(resumeId, { state: "unknown", queuePosition: void 0 });
          } else {
            deps.runs.update(resumeId, {
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
          }
          return formatOutcome(outcome, deps);
        } catch (error) {
          const code = codeOrDefault(error, "wait_failed");
          const definite = finalStateOf(error) === "failed";
          deps.runs.update(resumeId, {
            state: definite ? "failed" : "unknown",
            finishedAt: definite ? Date.now() : void 0,
            queuePosition: void 0,
            error: { code, message: error instanceof Error ? error.message : String(error) }
          });
          return failureOf(error);
        }
      }
      const loaded = loadWorkflow(deps, args);
      const outputDir = asString(args.outputPath).trim() !== "" ? asString(args.outputPath).trim() : deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir;
      const timeoutMs2 = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
      try {
        deps.assertWritable(outputDir, exec?.agent);
      } catch (error) {
        return { ok: false, code: "forbidden_output", message: error instanceof Error ? error.message : String(error) };
      }
      const pending2 = deps.overrides.get(loaded.workflowId);
      const applied = applyOverrides(
        loaded.workflow,
        loaded.surface,
        asRecord(args.vars),
        pending2
      );
      const preNotes = [...overrideNotes(applied)];
      try {
        const submitted = await submitWorkflow({
          client: deps.client,
          workflow: loaded.workflow,
          slots: loaded.surface.inputs,
          vars: applied.vars,
          outputDir,
          timeoutMs: timeoutMs2,
          pollIntervalMs: deps.pollIntervalMs,
          workflowId: loaded.workflowId,
          workflowHash: loaded.surface.workflowHash
        });
        deps.runs.submit(submitted.promptId, loaded.workflowId);
        if (pending2 !== void 0 && pending2.length > 0) deps.overrides.delete(loaded.workflowId);
        if (args.wait !== true) {
          const agent = exec?.agent;
          const canNotify = agent !== void 0 && typeof agent.followup === "function";
          if (!canNotify) sweepFallback(deps, submitted.promptId, loaded.workflowId, outputDir);
          if (canNotify) {
            watchRun({
              client: deps.client,
              target: agent,
              promptId: submitted.promptId,
              outputDir,
              intervalMs: deps.pollIntervalMs,
              registry: deps.runs,
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
            notes: [...preNotes, ...submitted.notes]
          };
        }
        let outcome;
        try {
          outcome = await waitForRun(deps.client, submitted.promptId, {
            timeoutMs: asInt(args.waitMs, deps.timeoutMs, 1e3, 18e5),
            pollIntervalMs: deps.pollIntervalMs,
            fallback: {
              outputDir,
              workflowId: loaded.workflowId,
              workflowHash: loaded.surface.workflowHash,
              effective: submitted.effective
            }
          });
        } catch (error) {
          const code = codeOrDefault(error, "wait_failed");
          const definite = finalStateOf(error) === "failed";
          const kind = error.kind;
          deps.runs.update(submitted.promptId, {
            state: definite ? "failed" : "unknown",
            finishedAt: definite ? Date.now() : void 0,
            queuePosition: void 0,
            error: {
              code,
              message: error instanceof Error ? error.message : String(error),
              ...typeof kind === "string" ? { kind } : {}
            }
          });
          if (!definite) {
            deps.runs.update(submitted.promptId, { finishedAt: Date.now() });
            return {
              ok: true,
              pending: true,
              promptId: submitted.promptId,
              message: `\u63D0\u4EA4\u6210\u529F\uFF0C\u4F46\u67E5\u8BE2\u72B6\u6001\u65F6\u51FA\u9519\uFF08${code}\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`,
              hint: "\u4EFB\u52A1\u53EF\u80FD\u8FD8\u5728 ComfyUI \u90A3\u8FB9\u8DD1\u3002\u7A0D\u540E\u7528 comfyui_run \u4F20\u8FD9\u4E2A promptId \u7EED\u67E5\u3002",
              notes: [...preNotes, ...submitted.notes]
            };
          }
          throw error;
        }
        if ("pending" in outcome) {
          deps.runs.update(submitted.promptId, {
            state: "unknown",
            finishedAt: Date.now(),
            queuePosition: void 0,
            error: {
              code: "wait_timeout",
              message: `\u7B49\u4E86 ${Math.round(outcome.waitedMs / 1e3)} \u79D2\u4ECD\u672A\u51FA\u56FE\u3002`
            }
          });
          return {
            ...formatOutcome(outcome, deps),
            ...preNotes.length + submitted.notes.length > 0 ? { notes: [...preNotes, ...submitted.notes] } : {}
          };
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
        deps.runs.update(submitted.promptId, {
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
        const notes = [...preNotes, ...submitted.notes, ...outcome.notes];
        return {
          ok: true,
          workflowId: outcome.workflowId !== "" ? outcome.workflowId : loaded.workflowId,
          promptId: outcome.promptId,
          durationMs: outcome.durationMs,
          artifacts: outcome.artifacts,
          effectiveVars: outcome.effective,
          notes
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
var init_run2 = __esm({
  "src/components/tool-generate/tools/run.ts"() {
    "use strict";
    init_run();
    init_workflow();
    init_detect();
    init_types();
  }
});

// src/components/tool-danbooru/server/api.ts
var MIRRORS = ["https://danbooru.donmai.us", "https://safebooru.donmai.us"];
var UA = "dsh-comfyui-workbench (+https://github.com/YuChenLiao/dsh-comfyui-workbench)";
var timeoutMs = 8e3;
function useTimeout(ms) {
  timeoutMs = ms > 0 ? ms : 8e3;
}
var preferred = 0;
var mirrors = [...MIRRORS];
function useMirrors(hosts) {
  mirrors = hosts.length === 0 ? [...MIRRORS] : [...hosts];
  preferred = 0;
}
function currentMirrors() {
  return mirrors;
}
async function fetchJson(path38, init) {
  let lastError;
  const total = mirrors.length;
  for (let step = 0; step < total; step += 1) {
    const index = (preferred + step) % total;
    const host = mirrors[index];
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal === void 0 || init.signal === null ? timeout : AbortSignal.any([init.signal, timeout]);
    try {
      const res = await fetch(host + path38, {
        ...init,
        signal,
        headers: { "User-Agent": UA, ...init?.headers ?? {} }
      });
      if (res.ok) {
        preferred = index;
        return res;
      }
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const error = new Error(`Danbooru \u8FD4\u56DE ${res.status}\uFF1A${path38}`);
      error.status = res.status;
      if (retryAfter > 0) error.retryAfterMs = retryAfter * 1e3;
      lastError = error;
      if (res.status === 404 || res.status === 429 || res.status >= 500) continue;
      throw error;
    } catch (caught) {
      const failure = caught;
      if (typeof failure.status === "number" && failure.status !== 404 && failure.status !== 429 && failure.status < 500) {
        throw failure;
      }
      lastError = failure instanceof Error ? failure : new Error(String(caught));
    }
  }
  throw lastError ?? new Error(`Danbooru \u8BF7\u6C42\u5931\u8D25\uFF1A${path38}`);
}
async function getJson(path38, init) {
  const res = await fetchJson(path38, init);
  return res.json();
}

// src/components/tool-danbooru/server/store.ts
init_paths();
import fs2 from "node:fs";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
var CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
function worthKeeping(name2, tag) {
  const value = name2.trim();
  if (value === "" || value.length > 16) return false;
  if (value.toLowerCase() === tag.toLowerCase()) return false;
  if (!CJK.test(value)) return false;
  if (/(19|20)\d{2}$/.test(value)) return false;
  if (/[×✕✖&+＋/~～]/.test(value)) return false;
  if (/(cp|攻|受|cross)/i.test(value)) return false;
  if (/^(兄|妹|姉|弟|父|母|親|子|友|敵|相方|コンビ)$/.test(value)) return false;
  return true;
}
function pickNames(tag, otherNames) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  for (const raw of otherNames ?? []) {
    if (typeof raw !== "string") continue;
    if (!worthKeeping(raw, tag)) continue;
    const key = raw.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw.trim());
  }
  const isChinese = (value) => /[一-鿿]/.test(value) && !/[぀-ヿ가-힯]/.test(value);
  return out.sort((a, b) => Number(isChinese(b)) - Number(isChinese(a)));
}
function danbooruDir(dataDir) {
  return path2.join(dataDir, "danbooru");
}
function bundledDir() {
  const start = path2.dirname(fileURLToPath(import.meta.url));
  let dir = start;
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = path2.join(dir, "data", "danbooru");
    if (fs2.existsSync(candidate)) return candidate;
    const parent = path2.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path2.join(start, "data", "danbooru");
}
var FILE_OF_KIND = {
  character: "characters.jsonl",
  artist: "artists.jsonl",
  general: "general.jsonl",
  copyright: "copyrights.jsonl"
};
var TAG_KINDS = ["character", "artist", "copyright", "general"];
function ownStorePath(dataDir, kind) {
  return path2.join(danbooruDir(dataDir), FILE_OF_KIND[kind]);
}
function storePath(dataDir, kind) {
  const own = ownStorePath(dataDir, kind);
  if (fs2.existsSync(own)) return own;
  const bundled = path2.join(bundledDir(), FILE_OF_KIND[kind]);
  return fs2.existsSync(bundled) ? bundled : own;
}
var storeCache = /* @__PURE__ */ new Map();
function readStore(file) {
  if (!fs2.existsSync(file)) return [];
  try {
    const stat = fs2.statSync(file);
    const hit = storeCache.get(file);
    if (hit !== void 0 && hit.mtimeMs === stat.mtimeMs && hit.size === stat.size) return hit.records;
    const parsed = parseStore(file);
    storeCache.set(file, { mtimeMs: stat.mtimeMs, size: stat.size, records: parsed });
    return parsed;
  } catch {
    return [];
  }
}
function parseStore(file) {
  const out = [];
  for (const line of fs2.readFileSync(file, "utf8").split("\n")) {
    const text3 = line.trim();
    if (text3 === "") continue;
    try {
      const record = JSON.parse(text3);
      if (typeof record.tag !== "string" || record.tag === "") continue;
      if (!Array.isArray(record.names)) record.names = [];
      record.names = record.names.filter((name2) => typeof name2 === "string");
      out.push(record);
    } catch {
    }
  }
  return out;
}
function writeStore(file, records) {
  const guard = foldPathCase(path2.resolve(path2.dirname(file)));
  const bundled = foldPathCase(path2.resolve(bundledDir()));
  if (guard === bundled || guard.startsWith(bundled + path2.sep)) {
    throw new Error(`\u62D2\u7EDD\u5199\u5165\u968F\u5305\u6570\u636E\u76EE\u5F55\uFF1A${file}\uFF08\u5199\u5165\u8BF7\u7528 ownStorePath\uFF09`);
  }
  fs2.mkdirSync(path2.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs2.writeFileSync(tmp, body === "" ? "" : `${body}
`, "utf8");
  fs2.renameSync(tmp, file);
}
function searchTags(records, query, limit = 10) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const loose = needle.replace(/[\s_]+/g, "_");
  const spaced = needle.replace(/[_\s]+/g, " ");
  const matches = [];
  for (const record of records) {
    const tagName = record.tag.toLowerCase();
    const tagNormalized = tagName.replace(/[\s_]+/g, "_");
    let best;
    if (tagName === needle || tagNormalized === loose) best = "tag";
    else if (tagName.startsWith(needle) || tagNormalized.startsWith(loose)) best = "prefix";
    else if (tagName.includes(needle) || tagNormalized.includes(loose)) best = "contains";
    if (best === void 0 || best === "prefix" || best === "contains") {
      for (const name2 of record.names) {
        const candidate = name2.toLowerCase();
        const normalized = candidate.replace(/[\s_]+/g, "_");
        if (candidate === needle || normalized === loose) {
          best = "exact";
          break;
        }
        if (candidate.startsWith(needle) || normalized.startsWith(loose)) {
          if (best === void 0) best = "prefix";
          continue;
        }
        if (candidate.includes(needle) || candidate.includes(spaced)) {
          if (best === void 0) best = "contains";
        }
      }
    }
    if (best !== void 0) matches.push({ record, how: best });
  }
  const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 };
  matches.sort((a, b) => rank[a.how] - rank[b.how] || b.record.postCount - a.record.postCount);
  return matches.slice(0, limit);
}
function pruneSharedAliases(records) {
  const owners = /* @__PURE__ */ new Map();
  for (const record of records) {
    for (const name2 of record.names) {
      const key = name2.toLowerCase();
      const list = owners.get(key);
      if (list === void 0) owners.set(key, [record]);
      else list.push(record);
    }
  }
  let removed = 0;
  for (const [name2, list] of owners) {
    if (list.length < 2) continue;
    const keeper = list.reduce((best, record) => record.postCount > best.postCount ? record : best, list[0]);
    for (const record of list) {
      if (record === keeper) continue;
      const before = record.names.length;
      record.names = record.names.filter((item) => item.toLowerCase() !== name2);
      removed += before - record.names.length;
    }
  }
  return removed;
}

// src/components/tool-danbooru/server/groups.ts
import fs3 from "node:fs";
import path3 from "node:path";
init_paths();
var GROUP_INDEX_TITLE = "tag_groups";
function parseGroupIndex(body) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of body.matchAll(/\[\[(Tag group:[^\]|]+?)\s*(?:\|[^\]]*)?\]\]/gi)) {
    const name2 = (match[1] ?? "").trim();
    const key = name2.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name2);
  }
  return out;
}
function parseGroupPage(body) {
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of body.matchAll(/\[\[([^\]|]+?)\s*(?:\|[^\]]*)?\]\]/g)) {
    const raw = (match[1] ?? "").trim();
    if (/^tag[ _]groups?$/i.test(raw) || /^tag[ _]group:/i.test(raw)) continue;
    const tag = normalizeTag(raw);
    if (tag === "") continue;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}
function normalizeTag(raw) {
  const cleaned = raw.trim().toLowerCase().replace(/\s+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z0-9_\-.()!'&+/^~<>@#*]+$/.test(cleaned) ? cleaned : "";
}
function mergeFailedGroups(records, failed, file) {
  let text3;
  try {
    text3 = fs3.readFileSync(file, "utf8");
  } catch {
    return 0;
  }
  const keep = new Set(failed);
  const index = /* @__PURE__ */ new Map();
  records.forEach((record, i) => index.set(record.tag, i));
  let added = 0;
  for (const line of text3.split("\n")) {
    if (line.trim() === "") continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof record.tag !== "string" || !Array.isArray(record.groups)) continue;
    const carried = record.groups.filter((group) => typeof group === "string" && keep.has(group));
    if (carried.length === 0) continue;
    const at = index.get(record.tag);
    if (at === void 0) {
      index.set(record.tag, records.length);
      records.push({ tag: record.tag, groups: [...carried].sort() });
      added += 1;
    } else {
      const target = records[at];
      target.groups = [.../* @__PURE__ */ new Set([...target.groups, ...carried])].sort();
      added += 1;
    }
  }
  return added;
}
async function syncGroups(options) {
  const started = Date.now();
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs2 = options.timeoutMs ?? 6e4;
  const delayMs = options.delayMs ?? 1200;
  const file = groupsPath(options.dataDir);
  const target = foldPathCase(path3.resolve(path3.dirname(file)));
  const bundled = foldPathCase(path3.resolve(bundledDir()));
  if (options.allowBundled !== true && (target === bundled || target.startsWith(bundled + path3.sep))) {
    throw new Error(`\u62D2\u7EDD\u5199\u5165\u968F\u5305\u6570\u636E\u76EE\u5F55\uFF1A${file}\uFF08\u8981\u66F4\u65B0\u968F\u5305\u5206\u7EC4\u8BF7\u663E\u5F0F\u4F20 allowBundled: true\uFF09`);
  }
  const getPage = async (title) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const res = await doFetch(
          `https://danbooru.donmai.us/wiki_pages.json?search%5Btitle%5D=${encodeURIComponent(title)}`,
          { headers: { "User-Agent": "dsh-comfyui-workbench" }, signal: AbortSignal.timeout(timeoutMs2) }
        );
        if (res.ok) {
          const arr = await res.json();
          if (Array.isArray(arr) && arr.length > 0) return String(arr[0].body ?? "");
          return null;
        }
      } catch {
      }
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 2e3));
    }
    return null;
  };
  const indexBody = await getPage(GROUP_INDEX_TITLE);
  if (indexBody === null) throw new Error("\u6293\u4E0D\u5230 tag_groups \u7D22\u5F15\u9875\uFF0C\u65E0\u6CD5\u786E\u5B9A\u5206\u7EC4\u5217\u8868\u3002");
  const names = parseGroupIndex(indexBody);
  if (names.length === 0) throw new Error("\u7D22\u5F15\u9875\u91CC\u6CA1\u6709\u89E3\u6790\u51FA\u4EFB\u4F55\u7EC4\u540D\uFF0C\u9875\u9762\u7ED3\u6784\u53EF\u80FD\u53D8\u4E86\u3002");
  options.log?.(`\u7D22\u5F15\u9875\u7ED9\u51FA ${names.length} \u4E2A\u7EC4`);
  const byTag = /* @__PURE__ */ new Map();
  const failed = [];
  for (const [i, name2] of names.entries()) {
    const body = await getPage(name2);
    const group = name2.replace(/^Tag group:/i, "").trim();
    if (body === null) {
      failed.push(group);
    } else {
      for (const tag of parseGroupPage(body)) {
        const set = byTag.get(tag) ?? /* @__PURE__ */ new Set();
        set.add(group);
        byTag.set(tag, set);
      }
    }
    if ((i + 1) % 20 === 0 || i + 1 === names.length) {
      options.log?.(`  \u6293\u53D6 ${i + 1}/${names.length}\uFF08\u5931\u8D25 ${failed.length}\uFF0C\u7D2F\u8BA1 tag ${byTag.size}\uFF09`);
    }
    if (i + 1 < names.length && delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  if (failed.length === names.length) {
    options.log?.("\u5168\u90E8\u7EC4\u6293\u53D6\u5931\u8D25\uFF0C\u4FDD\u7559\u4E0A\u4E00\u6B21\u7684\u5FEB\u7167\u3002");
    return { groups: 0, failed, tags: 0, shared: 0, file, seconds: 0, fromCache: true };
  }
  const records = [...byTag].map(([tag, groups]) => ({ tag, groups: [...groups].sort() }));
  if (failed.length > 0) {
    const merged = mergeFailedGroups(records, failed, file);
    if (merged > 0) options.log?.(`\u4ECE\u4E0A\u4E00\u4EFD\u5FEB\u7167\u8865\u56DE ${failed.length} \u4E2A\u5931\u8D25\u7EC4\uFF08${merged} \u6761\u8BB0\u5F55\uFF09`);
  }
  records.sort((a, b) => a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0);
  fs3.mkdirSync(path3.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs3.writeFileSync(tmp, records.map((record) => JSON.stringify(record)).join("\n") + "\n", "utf8");
  fs3.renameSync(tmp, file);
  const result = {
    groups: names.length - failed.length,
    failed,
    tags: records.length,
    shared: records.filter((record) => record.groups.length > 1).length,
    file,
    seconds: Number(((Date.now() - started) / 1e3).toFixed(1)),
    fromCache: false
  };
  options.log?.(`\u5206\u7EC4\u843D\u76D8\uFF1A${result.groups} \u7EC4 / ${result.tags} \u4E2A tag\uFF08\u8DE8\u7EC4 ${result.shared}\uFF09\uFF0C${result.seconds}s`);
  return result;
}
function groupsPath(dataDir) {
  return dataDir === void 0 ? path3.join(bundledDir(), "groups.jsonl") : ownStorePath(dataDir, "general").replace(/[^\\/]+$/, "groups.jsonl");
}
function readGroups(dataDir) {
  const candidates = dataDir === void 0 ? [groupsPath()] : [groupsPath(dataDir), groupsPath()];
  for (const file of candidates) {
    try {
      const text3 = fs3.readFileSync(file, "utf8");
      const out = /* @__PURE__ */ new Map();
      for (const line of text3.split("\n")) {
        if (line.trim() === "") continue;
        try {
          const record = JSON.parse(line);
          if (typeof record.tag !== "string" || !Array.isArray(record.groups)) continue;
          out.set(record.tag, record.groups.filter((g) => typeof g === "string"));
        } catch {
        }
      }
      if (out.size > 0) return out;
    } catch {
    }
  }
  return /* @__PURE__ */ new Map();
}
function categoryMapPath(dataDir) {
  return groupsPath(dataDir).replace(/[^\\/]+$/, "category-map.json");
}
function readCategoryMap(dataDir, log) {
  const empty = { labels: {}, groups: {}, priority: [] };
  const candidates = dataDir === void 0 ? [categoryMapPath()] : [categoryMapPath(dataDir), categoryMapPath()];
  for (const file of candidates) {
    try {
      const raw = JSON.parse(fs3.readFileSync(file, "utf8"));
      const labels = raw.categories !== null && typeof raw.categories === "object" ? Object.fromEntries(Object.entries(raw.categories).filter(([, v]) => typeof v === "string")) : {};
      const groups = raw.groups !== null && typeof raw.groups === "object" ? Object.fromEntries(Object.entries(raw.groups).filter(([, v]) => typeof v === "string")) : {};
      if (Object.keys(groups).length === 0) continue;
      const priority = Array.isArray(raw.priority) ? raw.priority.filter((key) => typeof key === "string") : [];
      return { labels, groups, priority };
    } catch {
    }
  }
  return empty;
}
var DEFAULT_PRIORITY = ["explicit", "clothing", "appearance", "action", "object", "composition", "theme"];
function categoryOf(groups, map) {
  const priority = map.priority.length > 0 ? map.priority : DEFAULT_PRIORITY;
  const rank = new Map(priority.map((key, i) => [key, i]));
  let best;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const group of groups) {
    const category = map.groups[group];
    if (category === void 0) continue;
    const at = rank.get(category) ?? priority.length;
    if (at < bestRank) {
      best = category;
      bestRank = at;
    }
  }
  return best ?? "other";
}

// src/components/tool-danbooru/server/tag-index.ts
var RANK = { tag: 0, exact: 1, prefix: 2, contains: 3 };
function gramsOf(text3) {
  if (text3.length < 2) return [];
  const out = [];
  for (let i = 0; i + 2 <= text3.length; i += 1) out.push(text3.slice(i, i + 2));
  return out;
}
function normalize(value) {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "_");
}
var TagIndex = class {
  prepared;
  /** 2-gram → 记录下标。 */
  grams;
  constructor(records) {
    this.prepared = records.map((record) => {
      const tagL = record.tag.trim().toLowerCase();
      return {
        record,
        tagL,
        tagN: tagL.replace(/[\s_]+/g, "_"),
        namesL: record.names.map((name2) => ({
          raw: name2.trim().toLowerCase(),
          normalized: name2.trim().toLowerCase().replace(/[\s_]+/g, "_")
        }))
      };
    });
    const grams = /* @__PURE__ */ new Map();
    const add = (text3, index) => {
      for (const gram of gramsOf(text3)) {
        let bucket = grams.get(gram);
        if (bucket === void 0) {
          bucket = [];
          grams.set(gram, bucket);
        }
        if (bucket[bucket.length - 1] !== index) bucket.push(index);
      }
    };
    this.prepared.forEach((item, index) => {
      add(item.tagN, index);
      for (const name2 of item.namesL) add(name2.normalized, index);
    });
    this.grams = grams;
  }
  /** 记录条数。 */
  get size() {
    return this.prepared.length;
  }
  /**
   * 搜索。
   *
   * @param query - 查询串（中文、日文、tag 都行；空格与下划线等价）。
   * @param limit - 最多返回几条。
   */
  search(query, limit = 10) {
    const needle = normalize(query);
    if (needle === "") return [];
    const original = query.trim().toLowerCase();
    const spaced = needle.replace(/_+/g, " ");
    const candidates = needle.length < 2 ? this.prepared.map((_, index) => index) : this.grams.get(needle.slice(0, 2)) ?? [];
    const matches = [];
    for (const index of candidates) {
      const item = this.prepared[index];
      let best;
      if (item.tagL === needle || item.tagN === needle) best = "tag";
      else if (item.tagL.startsWith(needle) || item.tagN.startsWith(needle)) best = "prefix";
      else if (item.tagL.includes(needle) || item.tagN.includes(needle)) best = "contains";
      if (best === void 0 || best === "prefix" || best === "contains") {
        for (const name2 of item.namesL) {
          if (name2.raw === needle || name2.normalized === needle) {
            best = "exact";
            break;
          }
          if (name2.raw.startsWith(needle) || name2.normalized.startsWith(needle)) {
            if (best === void 0) best = "prefix";
            continue;
          }
          if (name2.raw.includes(original) || name2.raw.includes(spaced)) {
            if (best === void 0) best = "contains";
          }
        }
      }
      if (best !== void 0) matches.push({ item, how: best });
    }
    matches.sort((a, b) => RANK[a.how] - RANK[b.how] || b.item.record.postCount - a.item.record.postCount);
    return matches.slice(0, limit).map((match) => ({ record: match.item.record, how: match.how }));
  }
};
function searchTagsLinear(records, query, limit = 10) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const loose = needle.replace(/[\s_]+/g, "_");
  const spaced = needle.replace(/[_\s]+/g, " ");
  const matches = [];
  for (const record of records) {
    const tagName = record.tag.toLowerCase();
    const tagNormalized = tagName.replace(/[\s_]+/g, "_");
    let best;
    if (tagName === needle || tagNormalized === loose) best = "tag";
    else if (tagName.startsWith(needle) || tagNormalized.startsWith(loose)) best = "prefix";
    else if (tagName.includes(needle) || tagNormalized.includes(loose)) best = "contains";
    if (best === void 0 || best === "prefix" || best === "contains") {
      for (const name2 of record.names) {
        const candidate = name2.toLowerCase();
        const normalized = candidate.replace(/[\s_]+/g, "_");
        if (candidate === needle || normalized === loose) {
          best = "exact";
          break;
        }
        if (candidate.startsWith(needle) || normalized.startsWith(loose)) {
          if (best === void 0) best = "prefix";
          continue;
        }
        if (candidate.includes(needle) || candidate.includes(spaced)) {
          if (best === void 0) best = "contains";
        }
      }
    }
    if (best !== void 0) matches.push({ record, how: best });
  }
  matches.sort((a, b) => RANK[a.how] - RANK[b.how] || b.record.postCount - a.record.postCount);
  return matches.slice(0, limit);
}

// src/components/tool-danbooru/tools/lookup.ts
init_types();
function createTagCache(dataDir) {
  const cache = /* @__PURE__ */ new Map();
  let groupCache = null;
  let mapCache = null;
  const load = (kind) => {
    const hit = cache.get(kind);
    if (hit !== void 0) return hit;
    const records = readStore(storePath(dataDir, kind));
    const entry = { records, index: new TagIndex(records) };
    cache.set(kind, entry);
    return entry;
  };
  return {
    read: (kind) => load(kind).records,
    search: (kind, query, limit = 10) => load(kind).index.search(query, limit).map((match) => ({ record: match.record, how: match.how })),
    invalidate: (kind) => {
      if (kind === void 0) cache.clear();
      else cache.delete(kind);
      groupCache = null;
      mapCache = null;
    },
    groups: () => {
      groupCache ??= readGroups(dataDir);
      return groupCache;
    },
    categoryMap: () => {
      mapCache ??= readCategoryMap(dataDir);
      return mapCache;
    }
  };
}
var CJK2 = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
var CATEGORY = { character: 4, artist: 1, copyright: 3, general: 0 };
async function searchOnline(query, limit, kind) {
  return (await searchOnlineDetailed(query, limit, kind)).tags;
}
async function searchOnlineDetailed(query, limit, kind) {
  const trimmed = query.trim();
  if (trimmed === "") return { tags: [], throttled: false };
  const kinds = kind === void 0 ? TAG_KINDS : [kind];
  const out = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (name2) => {
    if (typeof name2 !== "string" || name2 === "" || seen.has(name2)) return;
    seen.add(name2);
    out.push(name2);
  };
  let throttled = false;
  for (const one of kinds) {
    try {
      if (CJK2.test(trimmed)) {
        const res = await fetchJson(`/wiki_pages.json?search[other_names_match]=${encodeURIComponent(trimmed)}&limit=5`);
        if (res.status === 429) throttled = true;
        if (res.ok) {
          const body = await res.json();
          const titles = (Array.isArray(body) ? body : []).map((page) => page.title).filter((title) => typeof title === "string" && title !== "");
          const ranked = [];
          for (const title of titles.slice(0, 5)) {
            try {
              const check = await fetchJson(`/tags.json?search[name]=${encodeURIComponent(title)}&limit=1`);
              if (check.status === 429) throttled = true;
              if (!check.ok) continue;
              const rows = await check.json();
              const row = Array.isArray(rows) ? rows[0] : void 0;
              if (row === void 0) continue;
              ranked.push({ title, postCount: typeof row.post_count === "number" ? row.post_count : 0, category: row.category });
            } catch {
            }
          }
          ranked.sort((a, b) => b.postCount - a.postCount);
          const best = ranked.find((row) => kind === void 0 || row.category === CATEGORY[one]);
          if (best !== void 0) push(best.title);
        }
      } else {
        const res = await fetchJson(
          `/tags.json?search[name_matches]=*${encodeURIComponent(trimmed)}*&search[category]=${CATEGORY[one]}&search[order]=count&limit=${limit}`
        );
        if (res.status === 429) throttled = true;
        if (res.ok) {
          const body = await res.json();
          if (Array.isArray(body)) for (const tag of body) push(tag.name);
        } else if (res.status === 404) {
          const exact = await fetchJson(`/tags.json?search[name]=${encodeURIComponent(trimmed)}&limit=${limit}`);
          if (exact.ok) {
            const body = await exact.json();
            if (Array.isArray(body)) for (const tag of body) push(tag.name);
          }
        }
      }
    } catch (error) {
      if (error.status === 429) throttled = true;
    }
  }
  const norm = (value) => value.trim().toLowerCase().replace(/[\s_]+/g, "_");
  const target = norm(trimmed);
  out.sort((a, b) => Number(norm(b) === target) - Number(norm(a) === target));
  return { tags: out.slice(0, limit), throttled };
}
function danbooruLookupTool(deps) {
  return {
    name: "danbooru_lookup",
    description: "\u628A\u89D2\u8272 / \u753B\u5E08\u7684\u540D\u5B57\u8F6C\u6210 Danbooru \u80FD\u8BA4\u7684 tag\u3002\u7ED9\u4E2D\u6587\u540D\uFF08\u7518\u96E8\u3001\u521D\u97F3\u672A\u6765\uFF09\u3001\u65E5\u6587\u540D\uFF08\u521D\u97F3\u30DF\u30AF\uFF09\u6216 tag \u672C\u8EAB\u90FD\u884C\uFF0C\u8FD4\u56DE\u53EF\u76F4\u63A5\u5199\u8FDB\u63D0\u793A\u8BCD\u7684 tag \u5217\u8868\u3002\u5199\u63D0\u793A\u8BCD\u524D\u7528\u5B83\u5BF9\u9F50\u540D\u5B57\uFF0C\u80FD\u663E\u8457\u51CF\u5C11\u751F\u56FE\u65F6\u89D2\u8272\u8DD1\u504F\u3002",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "\u8981\u67E5\u7684\u540D\u5B57\uFF1A\u4E2D\u6587\u540D\u3001\u65E5\u6587\u540D\u6216 Danbooru tag\uFF0C\u5982\u300C\u7518\u96E8\u300D\u300C\u521D\u97F3\u30DF\u30AF\u300D\u300Chatsune_miku\u300D\u3002"
        },
        kind: {
          type: "string",
          enum: ["character", "artist", "copyright", "general", "all"],
          description: "\u9650\u5B9A\u7C7B\u522B\uFF1A\u89D2\u8272 / \u753B\u5E08 / \u4F5C\u54C1 / \u901A\u7528\uFF08\u52A8\u4F5C\u3001\u670D\u88C5\u3001\u5916\u8C8C\u7B49\uFF09\u3002\u9ED8\u8BA4 all \u67E5\u5168\u90E8\u56DB\u7C7B\u3002"
        },
        category: {
          type: "string",
          enum: ["action", "clothing", "appearance", "composition", "object", "theme", "explicit", "other"],
          description: "\u6309\u8BED\u4E49\u5927\u7C7B\u7B5B\uFF08\u53EA\u5BF9 general \u6709\u6548\uFF09\uFF1Aaction \u52A8\u4F5C / clothing \u670D\u88C5 / appearance \u5916\u8C8C / composition \u6784\u56FE / object \u7269\u4EF6 / theme \u4E3B\u9898 / explicit \u6027\u76F8\u5173 / other \u5176\u5B83\u3002\u5206\u7C7B\u6765\u81EA Danbooru \u7684 tag group\uFF0C\u8986\u76D6 30693 \u4E2A\u901A\u7528\u6807\u7B7E\u91CC\u7684\u7EA6 26.9%\uFF088261 \u6761\uFF09\uFF0C\u7B5B\u4E0D\u5230\u65F6\u53BB\u6389\u8FD9\u4E2A\u53C2\u6570\u91CD\u8BD5\u3002"
        },
        limit: { type: "integer", description: "\u6700\u591A\u8FD4\u56DE\u51E0\u4E2A tag\uFF0C\u9ED8\u8BA4 5\uFF0C\u4E0A\u9650 20\u3002" }
      },
      required: ["query"],
      additionalProperties: false
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    execute: async (args) => {
      const query = asString(args.query);
      const kindArg = asString(args.kind, "all");
      const categoryArg = asString(args.category, "").trim();
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20);
      if (query === "") return { ok: false, error: "query \u4E0D\u80FD\u4E3A\u7A7A" };
      const kinds = TAG_KINDS.includes(kindArg) ? [kindArg] : TAG_KINDS;
      const knownCategories = Object.keys(deps.cache.categoryMap().labels);
      if (categoryArg !== "" && knownCategories.length > 0 && !knownCategories.includes(categoryArg)) {
        return {
          ok: false,
          error: `category \u53EA\u80FD\u662F ${knownCategories.join(" / ")}\uFF0C\u6536\u5230\u300C${categoryArg}\u300D\u3002`
        };
      }
      const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 };
      const hits = [];
      const searchLimit = categoryArg === "" ? limit : Math.max(limit * 10, 100);
      for (const kind of kinds) {
        for (const match of deps.cache.search(kind, query, searchLimit)) {
          hits.push({ tag: match.record.tag, how: match.how, postCount: match.record.postCount });
        }
      }
      hits.sort((a, b) => {
        const byHow = (rank[a.how] ?? 4) - (rank[b.how] ?? 4);
        return byHow !== 0 ? byHow : b.postCount - a.postCount;
      });
      let kept = hits;
      if (categoryArg !== "") {
        const groupMap = deps.cache.groups();
        const categoryMap = deps.cache.categoryMap();
        const label = categoryMap.labels[categoryArg] ?? categoryArg;
        kept = hits.filter((hit) => categoryOf(groupMap.get(hit.tag) ?? [], categoryMap) === categoryArg);
        if (kept.length === 0) {
          const generalOnly = !kinds.includes("general");
          return {
            ok: false,
            error: generalOnly ? `\u300C${label}\u300D\u8FD9\u4E2A\u5206\u7C7B\u53EA\u4F5C\u7528\u4E8E\u901A\u7528\uFF08general\uFF09\u6807\u7B7E\uFF0C\u800C\u8FD9\u6B21\u67E5\u7684\u662F\u89D2\u8272 / \u753B\u5E08 / \u4F5C\u54C1 \u2014\u2014 \u5B83\u4EEC\u672C\u8EAB\u5DF2\u7ECF\u662F\u5206\u7C7B\uFF0C\u6CA1\u6709\u66F4\u7EC6\u7684\u7EC4\u3002\u53BB\u6389 category \u6216\u52A0 kind:'general' \u518D\u8BD5\u3002` : `\u300C${query.trim()}\u300D\u5728\u300C${label}\u300D\u7C7B\u91CC\u6CA1\u6709\u5339\u914D\u3002\u5206\u7C7B\u6765\u81EA Danbooru \u7684 tag group\uFF0C\u53EA\u8986\u76D6 30693 \u4E2A\u901A\u7528\u6807\u7B7E\u91CC\u7684\u7EA6 26.9%\uFF08ponytail\u3001braid \u8FD9\u79CD\u6700\u5E38\u89C1\u7684\u8BCD\u90FD\u4E0D\u5728 wiki \u5206\u7EC4\u91CC\uFF09\uFF1B\u53BB\u6389 category \u53C2\u6570\u518D\u67E5\u4E00\u6B21\u901A\u5E38\u5C31\u6709\u4E86\u3002`
          };
        }
      }
      const found = kept.map((hit) => hit.tag);
      let source = "local";
      let throttled = false;
      if (found.length === 0 && categoryArg === "") {
        source = "online";
        const only = TAG_KINDS.includes(kindArg) ? kindArg : void 0;
        const online = await searchOnlineDetailed(query, limit, only);
        throttled = online.throttled;
        found.push(...online.tags);
      }
      if (found.length === 0 && categoryArg !== "") {
        return {
          ok: false,
          error: `\u672C\u5730\u5E93\u91CC\u6CA1\u6709\u300C${query.trim()}\u300D\uFF0C\u800C\u5E26 category \u65F6\u4E0D\u4F1A\u53BB\u95EE\u5728\u7EBF\u63A5\u53E3\uFF08\u5B83\u6CA1\u6709\u5206\u7EC4\u7EF4\u5EA6\uFF09\u3002\u8981\u4E48\u53BB\u6389 category\uFF0C\u8981\u4E48\u5148\u8DD1\u4E00\u6B21 npm run danbooru:zh \u628A\u6807\u7B7E\u5E93\u66F4\u65B0\u5230\u6700\u65B0\u3002`
        };
      }
      const tags = [...new Set(found)].slice(0, limit);
      if (tags.length === 0) {
        return {
          ok: false,
          error: throttled ? `Danbooru \u6B63\u5728\u9650\u6D41\uFF0C\u8FD9\u6B21\u6CA1\u67E5\u6210\uFF08\u4E0D\u662F\u540D\u5B57\u7684\u95EE\u9898\uFF09\u3002\u7A0D\u540E\u518D\u8BD5\uFF0C\u6216\u5148\u8DD1\u4E00\u6B21 danbooru_sync \u628A\u5E38\u7528\u6807\u7B7E\u843D\u5230\u672C\u5730\u3002` : `\u6CA1\u627E\u5230\u300C${query.trim()}\u300D\u3002\u8BD5\u8BD5\u65E5\u6587\u539F\u540D\u6216\u53EA\u7528\u4E00\u90E8\u5206\u540D\u5B57\u3002`
        };
      }
      return { ok: true, tags, source };
    }
  };
}

// src/components/tool-danbooru/tools/lookup-batch.ts
init_types();
var MAX_QUERIES = 50;
function danbooruLookupBatchTool(deps) {
  return {
    name: "danbooru_lookup_batch",
    description: `\u4E00\u6B21\u67E5\u591A\u4E2A\u89D2\u8272 / \u753B\u5E08\u540D\u5B57\uFF0C\u8FD4\u56DE\u6BCF\u4E2A\u540D\u5B57\u5BF9\u5E94\u7684 Danbooru tag\u3002\u9002\u5408\u5199\u63D0\u793A\u8BCD\u524D\u6279\u91CF\u5BF9\u9F50\u540D\u5B57\uFF08\u4E00\u6B21 5~20 \u4E2A\uFF09\u3002**\u53EA\u67E5\u672C\u5730\u5E93\uFF0C\u4E0D\u8054\u7F51\u515C\u5E95** \u2014\u2014 \u7F3A\u54EA\u4E2A\u518D\u7528\u5355\u6761\u7684 danbooru_lookup \u8865\uFF08\u90A3\u4E2A\u4F1A\u81EA\u52A8\u8D70\u5728\u7EBF\uFF09\u3002\u6BCF\u6B21\u6700\u591A ${MAX_QUERIES} \u4E2A\u540D\u5B57\u3002`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["queries"],
      properties: {
        queries: {
          type: "array",
          items: { type: "string" },
          description: `\u8981\u67E5\u7684\u540D\u5B57\u5217\u8868\uFF08\u4E2D\u6587\u540D / \u65E5\u6587\u540D / tag \u90FD\u884C\uFF09\uFF0C\u6700\u591A ${MAX_QUERIES} \u4E2A\u3002`
        },
        kind: {
          type: "string",
          enum: ["character", "artist", "copyright", "general", "all"],
          description: "\u9650\u5B9A\u7C7B\u522B\uFF1A\u89D2\u8272 / \u753B\u5E08 / \u4F5C\u54C1 / \u901A\u7528\u3002\u9ED8\u8BA4 all \u67E5\u5168\u90E8\u56DB\u7C7B\u3002"
        },
        limit: { type: "integer", description: "\u6BCF\u4E2A\u540D\u5B57\u6700\u591A\u8FD4\u56DE\u51E0\u4E2A tag\uFF0C\u9ED8\u8BA4 3\uFF0C\u4E0A\u9650 10\u3002" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args) {
      const raw = Array.isArray(args.queries) ? args.queries : [];
      const queries = raw.map((item) => asString(item).trim()).filter((query) => query !== "").filter((query, index, all) => all.indexOf(query) === index);
      if (queries.length === 0) return { ok: false, error: "queries \u4E0D\u80FD\u4E3A\u7A7A\uFF0C\u81F3\u5C11\u8981\u7ED9\u4E00\u4E2A\u540D\u5B57\u3002" };
      if (queries.length > MAX_QUERIES) {
        return { ok: false, error: `\u4E00\u6B21\u6700\u591A\u67E5 ${MAX_QUERIES} \u4E2A\u540D\u5B57\uFF0C\u6536\u5230 ${queries.length} \u4E2A\u3002\u8BF7\u5206\u6279\u3002` };
      }
      const kindArg = asString(args.kind, "all");
      const kinds = TAG_KINDS.includes(kindArg) ? [kindArg] : TAG_KINDS;
      const limit = Math.min(Math.max(Number(args.limit ?? 3) || 3, 1), 10);
      const rank = { tag: 0, exact: 1, prefix: 2, contains: 3 };
      const results = [];
      for (const query of queries) {
        const hits = [];
        for (const kind of kinds) {
          for (const match of deps.cache.search(kind, query, limit)) {
            hits.push({ tag: match.record.tag, how: match.how, postCount: match.record.postCount });
          }
        }
        hits.sort((a, b) => {
          const byHow = (rank[a.how] ?? 4) - (rank[b.how] ?? 4);
          return byHow !== 0 ? byHow : b.postCount - a.postCount;
        });
        const seen = /* @__PURE__ */ new Set();
        const tags = [];
        for (const hit of hits) {
          if (seen.has(hit.tag)) continue;
          seen.add(hit.tag);
          tags.push(hit.tag);
          if (tags.length >= limit) break;
        }
        results.push({
          query,
          tags,
          ...hits[0] === void 0 ? {} : { how: hits[0].how },
          found: tags.length > 0
        });
      }
      const missing = results.filter((item) => !item.found).map((item) => item.query);
      return {
        ok: true,
        count: results.length,
        found: results.length - missing.length,
        results,
        ...missing.length === 0 ? {} : {
          missing,
          hint: `\u8FD9 ${missing.length} \u4E2A\u540D\u5B57\u672C\u5730\u5E93\u91CC\u6CA1\u6709\u3002\u7528\u5355\u6761 danbooru_lookup \u67E5\u4F1A\u81EA\u52A8\u8D70\u5728\u7EBF\uFF0C\u6216\u5148\u8DD1 danbooru_sync\u3002`
        }
      };
    }
  };
}

// src/components/tool-danbooru/server/sync.ts
import fs4 from "node:fs";
var CATEGORY2 = { character: 4, artist: 1 };
async function getJson2(path38, signal) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await getJson(path38, signal === void 0 ? void 0 : { signal });
    } catch (error) {
      const failure = error;
      const status = failure.status;
      if (typeof status === "number" && status !== 404 && status !== 429 && status < 500) throw error;
      if (attempt === 3 || signal?.aborted === true) throw error;
      const hinted = typeof failure.retryAfterMs === "number" ? Math.min(failure.retryAfterMs, 3e4) : 0;
      await new Promise((resolve) => setTimeout(resolve, hinted > 0 ? hinted : 800 * (attempt + 1)));
    }
  }
  throw new Error(`Danbooru \u8BF7\u6C42\u5931\u8D25\uFF1A${path38}`);
}
async function fetchTagNames(kind, options) {
  const out = [];
  const pageSize = Math.min(Math.max(options.pageSize, 1), 1e3);
  for (let page = 1; ; page += 1) {
    if (options.signal?.aborted === true) break;
    const query = `/tags.json?search[category]=${CATEGORY2[kind]}&search[post_count]=${encodeURIComponent(`>=${options.minPostCount}`)}&search[order]=count&limit=${pageSize}&page=${page}`;
    const raw = await getJson2(query, options.signal);
    if (!Array.isArray(raw) || raw.length === 0) break;
    for (const item of raw) {
      if (typeof item.name !== "string" || item.name === "") continue;
      out.push({ tag: item.name, postCount: typeof item.post_count === "number" ? item.post_count : 0 });
      if (options.maxTags > 0 && out.length >= options.maxTags) break;
    }
    if (options.maxTags > 0 && out.length >= options.maxTags) break;
    if (raw.length < pageSize) break;
  }
  return out;
}
async function fetchOtherNames(tag, signal) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const raw = await getJson2(`/wiki_pages.json?search[title]=${encodeURIComponent(tag)}&limit=1`, signal);
      if (!Array.isArray(raw) || raw.length === 0) return [];
      const page = raw[0];
      if (!Array.isArray(page.other_names)) return [];
      return page.other_names.filter((name2) => typeof name2 === "string");
    } catch (error) {
      const status = error.status;
      if (status === 404) return [];
      if (attempt === 2 || signal?.aborted === true) return void 0;
      await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
    }
  }
  return void 0;
}
async function syncKind(kind, options) {
  const log = options.log ?? (() => {
  });
  log(`\u5F00\u59CB\u540C\u6B65${kind === "character" ? "\u89D2\u8272" : "\u753B\u5E08"}\uFF1A\u70ED\u5EA6 \u2265 ${options.minPostCount}`);
  const tags = await fetchTagNames(kind, options);
  log(`\u62FF\u5230 ${tags.length} \u4E2A tag\uFF0C\u5F00\u59CB\u8865\u4E2D\u6587\u540D\uFF08\u5E76\u53D1 ${options.concurrency}\uFF09`);
  const records = [];
  const updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  let done = 0;
  let withNames = 0;
  let failed = 0;
  for (let i = 0; i < tags.length; i += options.concurrency) {
    if (options.signal?.aborted === true) break;
    const slice = tags.slice(i, i + options.concurrency);
    const names = await Promise.all(slice.map((item) => fetchOtherNames(item.tag, options.signal)));
    for (let j = 0; j < slice.length; j += 1) {
      const item = slice[j];
      const raw = names[j];
      if (raw === void 0) {
        failed += 1;
        records.push({ tag: item.tag, kind, postCount: item.postCount, names: [], updatedAt });
        done += 1;
        continue;
      }
      const picked = pickNames(item.tag, raw);
      if (picked.length > 0) withNames += 1;
      records.push({ tag: item.tag, kind, postCount: item.postCount, names: picked, updatedAt });
      done += 1;
    }
    options.onProgress?.({ kind, done, total: tags.length, withNames, written: records.length, failed });
    if (done % 200 === 0) log(`  \u8FDB\u5EA6 ${done}/${tags.length}\uFF0C\u5176\u4E2D\u6709\u4E2D\u6587\u540D ${withNames}`);
  }
  const pruned = pruneSharedAliases(records);
  if (pruned > 0) log(`\u53BB\u6389 ${pruned} \u4E2A\u88AB\u591A\u4E2A tag \u5171\u7528\u7684\u522B\u540D\uFF08CP \u540D/\u7EC4\u5408\u540D\uFF09`);
  const file = ownStorePath(options.dataDir, kind);
  const existing = readStore(file);
  if (records.length === 0) {
    log(`\u62FF\u5230 0 \u6761\uFF0C\u4FDD\u7559\u65E7\u5E93\uFF08${existing.length} \u6761\uFF09\u4E0D\u52A8`);
    return existing;
  }
  if (existing.length > 0 && records.length < existing.length * 0.5) {
    try {
      fs4.copyFileSync(file, `${file}.bak`);
      log(`\u65B0\u7ED3\u679C\u53EA\u6709 ${records.length} \u6761\uFF08\u65E7\u5E93 ${existing.length} \u6761\uFF09\uFF0C\u5DF2\u5907\u4EFD\u65E7\u5E93\u5230 ${file}.bak`);
    } catch {
    }
  }
  writeStore(file, records);
  const kept = records.filter((record) => record.names.length > 0).length;
  log(`\u540C\u6B65\u5B8C\u6210\uFF1A${records.length} \u6761\uFF0C${kept} \u6761\u6709\u522B\u540D${failed > 0 ? `\uFF0C**${failed} \u6761\u67E5\u8BE2\u5931\u8D25**\uFF08\u8FD9\u4E9B\u6761\u76EE\u7684\u522B\u540D\u7F3A\u5931\uFF0C\u91CD\u8DD1\u4E00\u6B21\u53EF\u8865\uFF09` : ""}`);
  return records;
}

// src/components/tool-danbooru/tools/sync-tool.ts
init_types();
async function runSync(deps, defaults, kinds, overrides) {
  const result = {};
  for (const kind of kinds) {
    let failed = 0;
    const options = {
      dataDir: deps.dataDir,
      minPostCount: overrides.minPostCount ?? defaults.minPostCount,
      pageSize: defaults.pageSize,
      maxTags: overrides.maxTags ?? defaults.maxTags,
      concurrency: defaults.concurrency,
      log: (message) => deps.logger?.info?.(`[danbooru] ${message}`),
      onProgress: (progress) => {
        failed = progress.failed;
      }
    };
    const records = await syncKind(kind, options);
    result[kind] = {
      total: records.length,
      withNames: records.filter((record) => record.names.length > 0).length,
      // 真实失败数（wiki 查询没成功）。不要用"没有别名的条数"代替 —— 画师类
      // 天生没有别名，那样报出来会让模型以为"全量查询失败"并重跑一次。
      failed,
      top: records.slice(0, 3).map((record) => record.tag)
    };
    deps.cache?.invalidate(kind);
  }
  return result;
}
function danbooruSyncTool(deps, defaults) {
  return {
    name: "danbooru_sync",
    description: "\u4ECE Danbooru \u540C\u6B65\u89D2\u8272 / \u753B\u5E08\u6807\u7B7E\u4E0E\u5B83\u4EEC\u7684\u5176\u5B83\u5199\u6CD5\uFF08\u542B\u4E2D\u6587\u540D\uFF09\u5230\u672C\u5730\u5E93\uFF0C\u8BA9 danbooru_lookup \u66F4\u5FEB\u3001\u66F4\u51C6\u3002\u8FD9\u662F\u4E00\u6B21\u51E0\u5343\u6761\u7F51\u7EDC\u8BF7\u6C42\u7684\u8017\u65F6\u64CD\u4F5C\uFF0C**\u53EA\u5728\u7528\u6237\u660E\u786E\u8981\u6C42\u6216\u9700\u8981\u6279\u91CF\u67E5\u8BE2\u65F6\u8C03\u7528**\u3002\u6CE8\u610F\uFF1A\u4E0D\u540C\u6B65 danbooru_lookup \u4E5F\u80FD\u7528\uFF08\u5B83\u4F1A\u81EA\u52A8\u8D70\u5728\u7EBF\u67E5\u8BE2\uFF09\uFF0C\u53EA\u662F\u6BCF\u6B21\u90FD\u8981\u8054\u7F51\u3001\u6162\u4E00\u4E9B\u3002",
    parameters: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["character", "artist", "all"],
          description: "\u540C\u6B65\u54EA\u4E00\u7C7B\uFF0C\u9ED8\u8BA4 all\u3002"
        },
        minPostCount: {
          type: "integer",
          description: `\u70ED\u5EA6\u4E0B\u9650\uFF0C\u4F4E\u4E8E\u5B83\u7684 tag \u4E0D\u6536\u5F55\uFF08\u8D8A\u5C11\u8D8A\u5FEB\uFF09\u3002\u9ED8\u8BA4 ${defaults.minPostCount}\u3002`
        },
        maxTags: { type: "integer", description: `\u5355\u7C7B\u6700\u591A\u6536\u5F55\u591A\u5C11\u6761\uFF0C\u9ED8\u8BA4 ${defaults.maxTags}\uFF0C0 \u8868\u793A\u4E0D\u9650\u3002` }
      },
      additionalProperties: false
    },
    output: jsonOutput(),
    execute: async (args) => {
      const kindArg = asString(args.kind, "all");
      const kinds = kindArg === "character" ? ["character"] : kindArg === "artist" ? ["artist"] : ["character", "artist"];
      const rawMin = typeof args.minPostCount === "number" ? args.minPostCount : defaults.minPostCount;
      const minPostCount = Number.isFinite(rawMin) ? Math.max(rawMin, 0) : defaults.minPostCount;
      const rawMax = typeof args.maxTags === "number" ? args.maxTags : defaults.maxTags;
      const maxTags = Number.isFinite(rawMax) ? Math.max(rawMax, 0) : defaults.maxTags;
      try {
        const synced = await runSync(deps, defaults, kinds, { minPostCount, maxTags });
        return { ok: true, minPostCount, synced };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { ok: false, error: `\u540C\u6B65\u5931\u8D25\uFF1A${message}` };
      }
    }
  };
}

// src/components/tool-danbooru/server/upstream.ts
import path4 from "node:path";
var UPSTREAM_BASE = "https://raw.githubusercontent.com/amenorira/danbooru-tags-data-zh/main/tags";
var UPSTREAM_FILES = {
  character: "character.csv",
  artist: "artist.csv",
  general: "general.csv",
  copyright: "copyright.csv"
};
var KIND_OF_CATEGORY = {
  0: "general",
  1: "artist",
  3: "copyright",
  4: "character"
};
function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else quoted = false;
      } else current += char;
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      fields.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current);
  if (fields.length < 6) return void 0;
  return {
    tag: (fields[0] ?? "").trim(),
    category: Number(fields[1]),
    aliases: fields[2] ?? "",
    zh: (fields[3] ?? "").trim(),
    count: Number(fields[4] || 0),
    // notes 里若还有逗号，全部算注释
    notes: fields.slice(5).join(",").trim()
  };
}
function rowToRecord(row, kind) {
  const names = [];
  const seen = /* @__PURE__ */ new Set();
  const push = (name2) => {
    const value = String(name2).trim();
    if (value === "" || value.toLowerCase() === row.tag.toLowerCase()) return;
    const key = value.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    names.push(value);
  };
  if (row.zh !== "") push(row.zh);
  for (const alias of row.aliases.split("|")) push(alias);
  return {
    tag: row.tag,
    kind,
    postCount: row.count,
    names,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    ...row.notes === "" ? {} : { note: row.notes }
  };
}
async function importUpstream(kind, options) {
  const started = Date.now();
  const file = UPSTREAM_FILES[kind];
  const doFetch = options.fetchImpl ?? fetch;
  const res = await doFetch(`${UPSTREAM_BASE}/${file}`, {
    headers: { "User-Agent": "dsh-comfyui-workbench" },
    signal: AbortSignal.timeout(options.timeoutMs ?? 18e4)
  });
  if (!res.ok) throw new Error(`\u4E0B\u8F7D ${file} \u5931\u8D25\uFF1AHTTP ${res.status}`);
  const text3 = await res.text();
  const lines = text3.replace(/^\uFEFF/, "").split("\n");
  const header = lines[0];
  if (header === void 0 || !header.startsWith("tag,")) {
    throw new Error(`${file} \u8868\u5934\u4E0D\u7B26\u5408\u9884\u671F\uFF1A${String(header).slice(0, 40)}`);
  }
  const records = [];
  let skipped = 0;
  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const row = parseCsvLine(line);
    if (row === void 0) {
      skipped += 1;
      continue;
    }
    if (KIND_OF_CATEGORY[row.category] !== kind) continue;
    if (row.tag === "") {
      skipped += 1;
      continue;
    }
    records.push(rowToRecord(row, kind));
  }
  const prunedAliases = pruneSharedAliases(records);
  const target = ownStorePath(options.dataDir, kind);
  writeStore(target, records);
  const result = {
    kind,
    records: records.length,
    withNames: records.filter((record) => record.names.length > 0).length,
    bytes: Buffer.byteLength(text3, "utf8"),
    prunedAliases,
    skipped,
    file: target,
    seconds: Number(((Date.now() - started) / 1e3).toFixed(1))
  };
  options.log?.(`${kind}: ${result.records} \u6761\u5165 ${path4.basename(target)}\uFF08${result.seconds}s\uFF0C\u53BB\u6389 ${prunedAliases} \u4E2A\u5171\u7528\u522B\u540D\uFF09`);
  return result;
}

// src/components/tool-danbooru/index.ts
var DANBOORU_COMPONENT = "tool.danbooru";
var DEFAULT_SYNC = {
  minPostCount: 100,
  pageSize: 1e3,
  maxTags: 3e3,
  concurrency: 8
};

// src/shared/host/config.ts
var DEFAULT_CACHE_MS = 4e3;
var DEFAULT_BASE_URL = "http://127.0.0.1:8188";
var DEFAULT_POSES_ORIGIN = "https://ai-pose-gallery.anhao.app";
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

// src/entries/danbooru.ts
init_paths();
function apply(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has(DANBOORU_COMPONENT)) {
    console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${DANBOORU_COMPONENT} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
    return;
  }
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    console.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0CDanbooru \u5DE5\u5177\u672A\u6CE8\u518C\u3002");
    return;
  }
  const dataDir = pluginDataDir();
  const cache = createTagCache(dataDir);
  const logger = {
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args)
  };
  const deps = { dataDir, logger, cache };
  let registered = 0;
  for (const spec of [
    danbooruLookupBatchTool({ cache, logger }),
    danbooruLookupTool(deps),
    danbooruSyncTool(deps, DEFAULT_SYNC)
  ]) {
    try {
      const dispose = tools.register(spec);
      if (typeof dispose === "function" && typeof ctx.effect === "function") {
        ctx.effect(() => () => dispose(), `danbooru: tool ${spec.name}`);
      }
      registered += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[comfyui-workbench] \u5DE5\u5177 ${spec.name} \u672A\u6CE8\u518C\uFF1A${message}`);
    }
  }
  console.log(`[comfyui-workbench] Danbooru \u5DE5\u5177\u5DF2\u6CE8\u518C ${registered} \u4E2A\uFF08\u6570\u636E\u76EE\u5F55 ${dataDir}\uFF09`);
}

// src/shared/comfy/node-index.ts
function typeOf(spec) {
  if (Array.isArray(spec) && spec.length > 0) {
    const head = spec[0];
    if (typeof head === "string") return head;
    if (Array.isArray(head)) return "COMBO";
    return "unknown";
  }
  if (typeof spec === "string") return spec;
  return "unknown";
}
var OPTION_PREVIEW = 8;
var INPUT_PREVIEW = 40;
function optionPreviewOf(spec) {
  const all = optionsOf(spec);
  if (all === void 0) return void 0;
  return { shown: all.slice(0, OPTION_PREVIEW), total: all.length };
}
function optionsOf(spec) {
  if (!Array.isArray(spec) || spec.length === 0) return void 0;
  const head = spec[0];
  if (!Array.isArray(head)) return void 0;
  return head.filter((item) => typeof item === "string");
}
function packOf(module) {
  if (typeof module !== "string" || module === "") return "unknown";
  if (module === "nodes" || module.startsWith("comfy_extras.")) return "core";
  const parts = module.split(".");
  if (parts[0] === "custom_nodes") return parts[1] ?? module;
  if (parts[0] === "comfy_api_nodes") return "core";
  return parts[0] ?? module;
}
var NodeIndex = class {
  entries;
  constructor(objectInfo) {
    const entries = [];
    for (const [classType, value] of Object.entries(objectInfo)) {
      if (value === null || typeof value !== "object") continue;
      const raw = value;
      const description = typeof raw.description === "string" ? raw.description : "";
      const displayName = typeof raw.display_name === "string" && raw.display_name !== "" ? raw.display_name : classType;
      entries.push({
        classType,
        displayName,
        category: typeof raw.category === "string" ? raw.category : "",
        pack: packOf(raw.python_module),
        summary: description.replace(/\s+/g, " ").trim().slice(0, 160),
        outputNode: raw.output_node === true,
        classL: classType.toLowerCase(),
        displayL: displayName.toLowerCase(),
        categoryL: (typeof raw.category === "string" ? raw.category : "").toLowerCase(),
        summaryL: description.toLowerCase(),
        aliasesL: Array.isArray(raw.search_aliases) ? raw.search_aliases.filter((a) => typeof a === "string").map((a) => a.toLowerCase()) : [],
        outputs: Array.isArray(raw.output) ? raw.output.map((item) => String(item)) : [],
        raw
      });
    }
    this.entries = entries;
  }
  /** 节点总数。 */
  get size() {
    return this.entries.length;
  }
  /** 可用的分类（去重、排序），供模型先看一眼有哪些维度可筛。 */
  categories() {
    const set = /* @__PURE__ */ new Set();
    for (const entry of this.entries) {
      if (entry.category === "") continue;
      const top = entry.category.split("/")[0];
      if (top !== void 0 && top !== "") set.add(top);
    }
    return [...set].sort();
  }
  /**
   * 搜索。
   *
   * 排序四档：类名精确 > 类名前缀 > 显示名/别名命中 > 描述命中。同档按
   * 「终端节点优先、类名字典序」——终端节点通常是用户真正想找的产出环节。
   *
   * @param query - 查询条件。
   */
  search(query) {
    const hasCondition = query.query !== void 0 || query.category !== void 0 || query.produces !== void 0 || query.accepts !== void 0 || query.pack !== void 0 || query.hasModel !== void 0 || query.customOnly === true;
    if (!hasCondition) {
      return { total: 0, shown: 0, nodes: [] };
    }
    const needle = (query.query ?? "").trim().toLowerCase();
    const loose = needle.replace(/[\s_]+/g, "_");
    const compact = needle.replace(/[\s_]+/g, "");
    const categoryFilter = (query.category ?? "").trim().toLowerCase();
    const produceFilter = (query.produces ?? "").trim().toUpperCase();
    const acceptsFilter = (query.accepts ?? "").trim().toUpperCase();
    const packFilter = (query.pack ?? "").trim().toLowerCase();
    const modelFilter = (query.hasModel ?? "").trim().toLowerCase();
    const rankOf2 = (entry, how) => {
      if (how === "name") {
        if (entry.classL === needle || entry.classL === compact || entry.classL === loose) return 0;
        return 1;
      }
      if (how === "display" || how === "alias") return 2;
      return 3;
    };
    const hits = [];
    for (const entry of this.entries) {
      if (query.customOnly === true && entry.pack === "core") continue;
      if (categoryFilter !== "" && !(entry.categoryL === categoryFilter || entry.categoryL.startsWith(`${categoryFilter}/`))) continue;
      if (packFilter !== "" && entry.pack.toLowerCase() !== packFilter) continue;
      if (produceFilter !== "" && !entry.outputs.includes(produceFilter)) continue;
      if (acceptsFilter !== "") {
        const inputs = {
          ...entry.raw.input?.required ?? {},
          ...entry.raw.input?.optional ?? {}
        };
        const has = Object.values(inputs).some((spec) => typeOf(spec).toUpperCase().split("|").includes(acceptsFilter));
        if (!has) continue;
      }
      if (modelFilter !== "") {
        const inputs = {
          ...entry.raw.input?.required ?? {},
          ...entry.raw.input?.optional ?? {}
        };
        const hit = Object.values(inputs).some(
          (spec) => (optionsOf(spec) ?? []).some((option) => option.toLowerCase().includes(modelFilter))
        );
        if (!hit) continue;
      }
      if (needle !== "") {
        let how;
        if (entry.classL === needle || entry.classL === compact || entry.classL === loose || entry.classL.startsWith(needle) || entry.classL.startsWith(compact) || entry.classL.startsWith(loose)) how = "name";
        else if (entry.displayL.includes(needle) || entry.displayL.includes(loose) || entry.displayL.replace(/[\s_]+/g, "").includes(compact)) how = "display";
        else if (entry.aliasesL.some((alias) => alias.includes(needle) || alias.includes(loose))) how = "alias";
        else if (entry.categoryL.includes(needle)) how = "type";
        else if (entry.summaryL.includes(needle)) how = "description";
        if (how === void 0) continue;
        hits.push({ entry, rank: rankOf2(entry, how), how });
      } else {
        hits.push({ entry, rank: 4, how: "type" });
      }
    }
    hits.sort((a, b) => a.rank - b.rank || Number(b.entry.outputNode) - Number(a.entry.outputNode) || a.entry.classType.localeCompare(b.entry.classType));
    const limit = Math.max(1, Math.min(30, Math.floor(query.limit ?? 8)));
    const page = hits.slice(0, limit);
    const nodes = page.map(({ entry, how }) => ({
      classType: entry.classType,
      displayName: entry.displayName,
      category: entry.category,
      pack: entry.pack,
      summary: entry.summary,
      matches: how,
      outputNode: entry.outputNode
    }));
    if (query.detail !== true) return { total: hits.length, shown: nodes.length, nodes };
    const details = {};
    for (const { entry } of page) {
      const describe = ([name2, spec]) => {
        const options = optionPreviewOf(spec);
        return options === void 0 ? { name: name2, type: typeOf(spec) } : { name: name2, type: typeOf(spec), options: options.shown, optionCount: options.total };
      };
      const allRequired = Object.entries(entry.raw.input?.required ?? {});
      const allOptional = Object.entries(entry.raw.input?.optional ?? {});
      const inputCount = allRequired.length + allOptional.length;
      const requiredRaw = allRequired.slice(0, INPUT_PREVIEW);
      const optionalRaw = allOptional.slice(0, Math.max(0, INPUT_PREVIEW - requiredRaw.length));
      const required = requiredRaw.map(describe);
      const optional = optionalRaw.map(describe);
      const truncated = inputCount > required.length + optional.length;
      const outputs = entry.outputs.map((type, index) => {
        const named = Array.isArray(entry.raw.output_name) ? entry.raw.output_name[index] : void 0;
        return { name: typeof named === "string" ? named : type, type };
      });
      details[entry.classType] = {
        inputs: {
          required,
          optional,
          ...truncated ? { truncated: true, inputCount } : {}
        },
        outputs
      };
    }
    return { total: hits.length, shown: nodes.length, nodes, details };
  }
};

// src/components/tool-generate/tools/node-search.ts
init_types();
var cached;
var TTL_MS = 6e4;
async function indexOf(deps) {
  const now = Date.now();
  if (cached !== void 0 && cached.baseUrl === deps.client.baseUrl && now - cached.at < TTL_MS) {
    return cached.index;
  }
  const raw = await deps.client.objectInfo(false, { timeoutMs: 2e4, skipEnsure: true });
  const index = new NodeIndex(raw);
  cached = { index, at: now, baseUrl: deps.client.baseUrl };
  return index;
}
function resetNodeIndexCache() {
  cached = void 0;
}
function nodeSearchTool(deps) {
  return {
    name: "comfyui_node_search",
    description: '\u6309\u8282\u70B9\u7684\u5404\u9879\u4FE1\u606F\u641C\u7D22\u672C\u673A ComfyUI \u5DF2\u5B89\u88C5\u7684\u8282\u70B9\u3002\u7528\u4E8E\uFF1A\u60F3\u77E5\u9053"\u6709\u54EA\u4E9B\u8282\u70B9\u80FD\u505A\u653E\u5927/\u53BB\u80CC\u666F/\u6362\u8138"\uFF1B\u9047\u5230\u4E0D\u8BA4\u8BC6\u7684\u81EA\u5B9A\u4E49\u8282\u70B9\u65F6\u67E5\u5B83\u7684\u7528\u9014\uFF1B\u67D0\u4E2A\u6A21\u578B\u6587\u4EF6\u80FD\u88AB\u54EA\u4E9B\u8282\u70B9\u52A0\u8F7D\u3002\u8FD4\u56DE\u7CBE\u7B80\u5217\u8868\uFF08\u7C7B\u540D\u3001\u663E\u793A\u540D\u3001\u5206\u7C7B\u3001\u6240\u5C5E\u5305\u3001\u4E00\u53E5\u8BDD\u8BF4\u660E\u4E0E\u547D\u4E2D\u539F\u56E0\uFF09\uFF1Bdetail=true \u624D\u7ED9\u8F93\u5165\u8F93\u51FA\u3002\u81F3\u5C11\u8981\u7ED9\u4E00\u4E2A\u6761\u4EF6 \u2014\u2014 \u4E0D\u52A0\u7B5B\u9009\u5730\u5217\u51FA\u5168\u90E8\u8282\u70B9\u6CA1\u6709\u610F\u4E49\uFF0C\u4E5F\u4E0D\u4F1A\u88AB\u63A5\u53D7\u3002**\u5B83\u4E0D\u4F1A\u62C9\u8D77 ComfyUI**\uFF1A\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u53EA\u4F1A\u7B49 20 \u79D2\u7136\u540E\u62A5"\u641C\u4E0D\u5230"\uFF08\u8FDE\u4E0D\u4E0A\u901A\u5E38\u7ACB\u523B\u5931\u8D25\uFF09\uFF0C\u6240\u4EE5\u8981\u628A\u670D\u52A1\u62C9\u8D77\u6765\u5F97\u7528 comfyui_run\uFF08\u6216 comfyui_workflow_list\uFF09\u89E6\u53D1\u4E00\u6B21\u3002\u6CE8\u610F\uFF1A\u8282\u70B9\u7684\u5143\u6570\u636E\uFF08display_name / description / search_aliases\uFF09\u90FD\u662F\u82F1\u6587\uFF0C\u7528\u4E2D\u6587\u67E5\u4E0D\u5230\u7ED3\u679C\uFF1BhasModel \u8981\u7ED9\u6A21\u578B\u6587\u4EF6\u540D\u7684\u4E00\u6BB5\uFF08\u5982 "waiNSFWIllustrious"\uFF09\uFF0C\u4E0D\u8981\u7ED9 "upscale" \u8FD9\u7C7B\u666E\u901A\u8BCD\u3002',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        query: { type: "string", description: '\u81EA\u7531\u6587\u672C\uFF1A\u5339\u914D\u7C7B\u540D\u3001\u663E\u793A\u540D\u3001ComfyUI \u81EA\u5E26\u7684\u641C\u7D22\u522B\u540D\u3001\u5206\u7C7B\u4E0E\u63CF\u8FF0\u3002\u5982 "upscale"\u3001"mask"\u3001"switch"\u3002\u5143\u6570\u636E\u662F\u82F1\u6587\uFF0C\u4E2D\u6587\u67E5\u4E0D\u5230' },
        category: { type: "string", description: '\u5206\u7C7B\u8FC7\u6EE4\uFF08\u524D\u7F00\u5339\u914D\uFF09\uFF0C\u5982 "image"\u3001"image/upscale"\u3001"model"\u3002\u4E0D\u4F20\u5219\u4E0D\u9650' },
        produces: { type: "string", description: '\u8F93\u51FA\u7C7B\u578B\u8FC7\u6EE4\uFF0C\u5982 "IMAGE"\u3001"LATENT"\u3001"MASK"\u3001"MODEL"' },
        accepts: { type: "string", description: '\u8F93\u5165\u7C7B\u578B\u8FC7\u6EE4\uFF1A\u627E"\u80FD\u5403 IMAGE \u7684\u8282\u70B9"\u5C31\u4F20 IMAGE' },
        pack: { type: "string", description: '\u9650\u5B9A\u6269\u5C55\u5305\uFF0C\u5982 "comfyui-impact-pack"\uFF1B"core" \u8868\u793A\u53EA\u8981\u5185\u7F6E\u8282\u70B9' },
        hasModel: { type: "string", description: '\u6A21\u578B\u6587\u4EF6\u540D\u7684\u4E00\u6BB5\uFF08\u5982 "waiNSFWIllustrious"\uFF09\uFF0C\u627E\u51FA\u54EA\u4E2A\u8282\u70B9\u7684\u53EF\u9009\u503C\u91CC\u6709\u5B83\u3002\u7ED9\u666E\u901A\u8BCD\u4F1A\u8BEF\u547D\u4E2D\u65E0\u5173\u679A\u4E3E' },
        customOnly: { type: "boolean", description: "\u53EA\u8981\u81EA\u5B9A\u4E49\u8282\u70B9\uFF0C\u4E0D\u8981\u5185\u7F6E\u7684" },
        limit: { type: "integer", description: "\u6700\u591A\u51E0\u6761\uFF0C\u9ED8\u8BA4 8\uFF0C\u4E0A\u9650 30" },
        detail: { type: "boolean", description: "true \u65F6\u9644\u5E26\u8F93\u5165\u8F93\u51FA\u7ED3\u6784\uFF08\u9ED8\u8BA4\u53EA\u7ED9\u4E00\u884C\u6458\u8981\uFF09" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args) {
      const query = {
        query: asString(args.query).trim() === "" ? void 0 : asString(args.query).trim(),
        category: asString(args.category).trim() === "" ? void 0 : asString(args.category).trim(),
        produces: asString(args.produces).trim() === "" ? void 0 : asString(args.produces).trim(),
        accepts: asString(args.accepts).trim() === "" ? void 0 : asString(args.accepts).trim(),
        pack: asString(args.pack).trim() === "" ? void 0 : asString(args.pack).trim(),
        hasModel: asString(args.hasModel).trim() === "" ? void 0 : asString(args.hasModel).trim(),
        customOnly: args.customOnly === true,
        limit: asInt(args.limit, 8, 1, 30),
        detail: args.detail === true
      };
      let index;
      try {
        index = await indexOf(deps);
      } catch (error) {
        return {
          ok: false,
          error: `\u8BFB\u4E0D\u5230\u8282\u70B9\u6E05\u5355\uFF08ComfyUI \u53EF\u80FD\u6CA1\u5728\u8DD1\uFF09\uFF1A${error instanceof Error ? error.message : String(error)}`,
          hint: "\u8282\u70B9\u641C\u7D22\u9700\u8981 ComfyUI \u5728\u7EBF\uFF08\u8981\u8BFB\u5B83\u7684 /object_info\uFF09\u3002"
        };
      }
      if (query.query === void 0 && query.category === void 0 && query.produces === void 0 && query.accepts === void 0 && query.pack === void 0 && query.hasModel === void 0 && query.customOnly !== true) {
        return {
          ok: false,
          error: "\u81F3\u5C11\u8981\u7ED9\u4E00\u4E2A\u67E5\u8BE2\u6761\u4EF6\uFF08query / category / produces / accepts / pack / hasModel / customOnly\uFF09\u3002",
          hint: `\u4E0D\u52A0\u7B5B\u9009\u5730\u5217\u51FA\u5168\u90E8 ${index.size} \u4E2A\u8282\u70B9\u4F1A\u6324\u7206\u4E0A\u4E0B\u6587\uFF0C\u6240\u4EE5\u4E0D\u505A\u3002\u53EF\u4EE5\u5148\u7528 category \u6216 produces \u6536\u7A84\u3002`,
          categories: index.categories()
        };
      }
      const result = index.search(query);
      if (result.total === 0) {
        return {
          ok: true,
          total: 0,
          shown: 0,
          nodes: [],
          hint: `\u672C\u673A ${index.size} \u4E2A\u8282\u70B9\u91CC\u6CA1\u6709\u5339\u914D\u7684\u3002\u8BD5\u8BD5\u653E\u5BBD\u6761\u4EF6\uFF0C\u6216\u5148\u770B\u6709\u54EA\u4E9B\u5206\u7C7B\uFF1A${index.categories().slice(0, 8).join(", ")}`
        };
      }
      const truncatedNames = result.details === void 0 ? [] : Object.entries(result.details).filter(([, detail]) => detail.inputs.truncated === true).map(([name2]) => name2);
      return {
        ok: true,
        total: index.size,
        matched: result.total,
        shown: result.shown,
        ...result.details === void 0 ? {} : { details: result.details },
        nodes: result.nodes,
        ...truncatedNames.length === 0 ? {} : { truncationHint: `\u8FD9\u4E9B\u8282\u70B9\u7684\u8F93\u5165\u8D85\u8FC7 40 \u4E2A\uFF0C\u53EA\u5217\u4E86\u524D 40 \u4E2A\uFF1A${truncatedNames.join("\u3001")}` },
        ...result.total > result.shown ? { hint: `\u53EA\u663E\u793A\u524D ${result.shown} \u6761\uFF0C\u5171 ${result.total} \u6761\u5339\u914D\u3002\u7F29\u5C0F\u6761\u4EF6\u6216\u63D0\u9AD8 limit\u3002` } : {}
      };
    }
  };
}

// src/components/tool-generate/tools/rerun.ts
init_runner();
init_types();
init_run();
init_run2();
import fs11 from "node:fs";
import path10 from "node:path";
var MAX_COUNT = 20;
function locateSidecar(input) {
  const resolved = path10.resolve(input);
  if (resolved.toLowerCase().endsWith(".json")) {
    return { sidecarPath: resolved };
  }
  const guess = `${resolved}.json`;
  if (fs11.existsSync(guess)) return { sidecarPath: guess, imagePath: resolved };
  const dir = path10.dirname(resolved);
  const base = path10.basename(resolved);
  if (fs11.existsSync(dir)) {
    const candidates = fs11.readdirSync(dir).filter((name2) => name2.startsWith(base) && name2.toLowerCase().endsWith(".json"));
    if (candidates.length > 0) return { sidecarPath: path10.join(dir, candidates.sort()[0]), imagePath: resolved };
  }
  return { sidecarPath: guess, imagePath: resolved };
}
function readSidecar(sidecarPath) {
  if (!fs11.existsSync(sidecarPath)) {
    throw new Error(`\u627E\u4E0D\u5230 sidecar\uFF1A${sidecarPath}\u3002\u8FD9\u4E2A\u5DE5\u5177\u8981\u4ECE\u4EA7\u7269\u65C1\u7684 <\u6587\u4EF6>.json \u8BFB\u53D6\u8FD0\u884C\u53C2\u6570\uFF0C\u8BF7\u7ED9\u4EA7\u7269\u8DEF\u5F84\u6216 sidecar \u8DEF\u5F84\u672C\u8EAB\u3002`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs11.readFileSync(sidecarPath, "utf8"));
  } catch (error) {
    throw new Error(`sidecar \u4E0D\u662F\u5408\u6CD5 JSON\uFF1A${error instanceof Error ? error.message : String(error)}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("sidecar \u5185\u5BB9\u4E0D\u662F\u4E00\u4E2A\u5BF9\u8C61\u3002");
  }
  return parsed;
}
function rerunTool(deps) {
  return {
    name: "comfyui_rerun",
    description: `\u7528\u67D0\u4E2A\u4EA7\u7269\u5F53\u65F6\u7684\u53C2\u6570\u518D\u8DD1\u4E00\u6B21\uFF08\u6216\u505A\u51E0\u5F20\u53D8\u4F53\uFF09\u3002\u53C2\u6570\u4ECE\u4EA7\u7269\u65C1\u7684 sidecar \u8BFB\u53D6\uFF0C\u4E0D\u5FC5\u624B\u5DE5\u6284 seed / prompt\u3002\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u4F1A\u81EA\u52A8\u62C9\u8D77\uFF0C\u4E0D\u7528\u5148\u624B\u52A8\u542F\u52A8\uFF0C\u4E5F\u4E0D\u8981 kill / \u91CD\u542F ComfyUI \u8FDB\u7A0B\u3002\u53EA\u8986\u76D6\u4F60\u60F3\u6539\u7684\uFF1A\u7ED9 vars \u6216 seed \u5373\u53EF\uFF0C\u5176\u4F59\u6CBF\u7528\u539F\u503C\u3002count > 1 \u65F6\u6309 seed \u751F\u6210\u53D8\u4F53\uFF08\u4E0A\u9650 ${MAX_COUNT}\uFF09\u3002`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["from"],
      properties: {
        from: { type: "string", description: "\u4EA7\u7269\u8DEF\u5F84\uFF08\u81EA\u52A8\u627E <\u8DEF\u5F84>.json\uFF09\u6216\u76F4\u63A5\u7ED9 sidecar \u8DEF\u5F84\u3002" },
        vars: { type: "object", description: "\u53EA\u8986\u76D6\u60F3\u6539\u7684\u53C2\u6570\uFF1B\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u58F0\u660E\u8FC7\u7684\u8F93\u5165\u540D\u3002", additionalProperties: true },
        seed: {
          type: ["integer", "string"],
          description: "\u6362 seed\u3002\u7ED9\u6570\u5B57\u5219\u7528\u5B83\uFF08count>1 \u65F6\u4F9D\u6B21 +1\uFF09\uFF1B\u7ED9 'random' \u5219\u6BCF\u5F20\u72EC\u7ACB\u968F\u673A\uFF1B\u4E0D\u7ED9\u5219\u6CBF\u7528\u539F\u503C\u9012\u589E\u3002"
        },
        count: { type: "integer", description: `\u51FA\u51E0\u5F20\uFF0C\u9ED8\u8BA4 1\uFF0C\u4E0A\u9650 ${MAX_COUNT}\u3002` },
        outputPath: { type: "string", description: "\u4EA7\u7269\u76EE\u5F55\uFF1B\u4E0D\u4F20\u7528\u4F1A\u8BDD\u76EE\u5F55\u3002" },
        wait: { type: "boolean", description: "\u662F\u5426\u540C\u6B65\u7B49\u51FA\u56FE\u3002\u9ED8\u8BA4 false\uFF08\u5F02\u6B65 + \u5B8C\u6210\u540E\u901A\u77E5\uFF09\u3002wait \u4E3A\u771F\u65F6\u4F1A\u5E26\u56DE\u4EA7\u7269\u8DEF\u5F84\u5E76\u767B\u8BB0\u8D44\u4EA7\u7D22\u5F15\u3002" },
        waitMs: { type: "integer", description: "wait=true \u65F6\u7684\u7B49\u5F85\u4E0A\u9650\uFF08\u6BEB\u79D2\uFF09\u3002" },
        tags: { type: "array", items: { type: "string" }, description: "\u7ED9\u4EA7\u7269\u6253\u7684\u6807\u7B7E\uFF0C\u8FDB\u8D44\u4EA7\u7D22\u5F15\u3002" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args, exec) {
      const from = asString(args.from).trim();
      if (from === "") return { ok: false, code: "bad_input", error: "from \u4E0D\u80FD\u4E3A\u7A7A\uFF1A\u7ED9\u4EA7\u7269\u8DEF\u5F84\u6216 sidecar \u8DEF\u5F84\u3002" };
      const { sidecarPath } = locateSidecar(from);
      let sidecar;
      try {
        sidecar = readSidecar(sidecarPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = message.includes("\u4E0D\u662F\u5408\u6CD5 JSON") || message.includes("\u4E0D\u662F\u4E00\u4E2A\u5BF9\u8C61") ? "sidecar_invalid" : "sidecar_missing";
        return { ok: false, code, error: message };
      }
      const workflowId = asString(sidecar.workflowId).trim();
      if (workflowId === "") {
        return { ok: false, code: "sidecar_invalid", error: `sidecar \u91CC\u6CA1\u6709 workflowId\uFF1A${sidecarPath}` };
      }
      let loaded;
      try {
        loaded = await loadWorkflowForBatch(deps, { workflow: { id: workflowId } });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          code: "workflow_missing",
          error: message,
          // 只承诺真能做到的：`from` 只是定位 sidecar，仍按 sidecar 里的 workflowId 找模板，
          // 模板改了名它照样找不到 —— 别在这儿许诺一条走不通的路。
          hint: "\u7528 comfyui_workflow_list \u770B\u73B0\u6709\u5DE5\u4F5C\u6D41\uFF08\u6A21\u677F\u53EF\u80FD\u6539\u8FC7\u540D\uFF0C\u6216\u4E0D\u5728\u8FD9\u4E2A\u76EE\u5F55\uFF09\u3002\u4E0D\u8981\u53BB\u6539 sidecar \u2014\u2014 \u5B83\u662F\u8FD9\u5F20\u56FE\u7684\u590D\u73B0\u51ED\u636E\uFF0C\u6539\u4E86\u4F1A\u5931\u53BB\u8FFD\u6EAF\u3002"
        };
      }
      const stale = typeof sidecar.workflowHash === "string" && sidecar.workflowHash !== "" && sidecar.workflowHash !== loaded.surface.workflowHash;
      const baseVars = { ...sidecar.vars ?? {} };
      const overrides = asRecord(args.vars);
      const merged = { ...baseVars, ...overrides };
      const seedSlot = loaded.surface.inputs.find((slot) => /^(noise_)?seed$/i.test(slot.name))?.name;
      const seedArg = args.seed;
      const originalSeed = seedSlot !== void 0 && typeof merged[seedSlot] === "number" ? merged[seedSlot] : seedSlot === void 0 && typeof merged.seed === "number" ? merged.seed : typeof sidecar.seed === "number" ? sidecar.seed : void 0;
      const seedNumber = typeof seedArg === "number" && Number.isFinite(seedArg) ? seedArg : typeof seedArg === "string" && seedArg.trim() !== "" && Number.isFinite(Number(seedArg)) ? Number(seedArg) : void 0;
      let seedPlan;
      if (seedArg === "random" || String(seedArg).trim().toLowerCase() === "random") {
        seedPlan = [];
      } else if (seedNumber !== void 0) {
        seedPlan = [seedNumber];
      } else {
        seedPlan = originalSeed === void 0 ? [void 0] : [originalSeed];
      }
      const count = asInt(args.count, 1, 1, MAX_COUNT);
      const outputDir = asString(args.outputPath).trim() !== "" ? asString(args.outputPath).trim() : deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir;
      try {
        deps.assertWritable(outputDir, exec?.agent);
      } catch (error) {
        return { ok: false, code: "forbidden_output", message: error instanceof Error ? error.message : String(error) };
      }
      const agent = exec?.agent;
      const canNotify = agent !== void 0 && typeof agent.followup === "function";
      const tags = Array.isArray(args.tags) ? args.tags.filter((tag) => typeof tag === "string") : [];
      const wait = args.wait === true;
      const waitMs = asInt(args.waitMs, deps.timeoutMs, 1e3, 18e5);
      const waitStartedAt = Date.now();
      const waitBudgetMs = Math.min(waitMs * count, 30 * 6e4);
      const submitted = [];
      const failures = [];
      for (let index = 0; index < count; index += 1) {
        let activePromptId;
        const vars = { ...merged };
        const wantsRandom = seedArg === "random" || String(seedArg).trim().toLowerCase() === "random";
        if (seedSlot !== void 0) {
          vars[seedSlot] = wantsRandom || seedPlan[0] === void 0 ? Math.floor(Math.random() * 2147483647) : seedPlan[0] + index;
        }
        try {
          const result = await submitWorkflow({
            client: deps.client,
            workflow: loaded.workflow,
            slots: loaded.surface.inputs,
            vars,
            outputDir,
            timeoutMs: deps.timeoutMs,
            pollIntervalMs: deps.pollIntervalMs,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash
          });
          activePromptId = result.promptId;
          deps.runs.submit(result.promptId, loaded.workflowId);
          if (wait) {
            const remaining = Math.max(1e3, waitBudgetMs - (Date.now() - waitStartedAt));
            const outcome = await waitForRun(deps.client, result.promptId, {
              timeoutMs: Math.min(waitMs, remaining),
              pollIntervalMs: deps.pollIntervalMs,
              fallback: {
                outputDir,
                workflowId: loaded.workflowId,
                workflowHash: loaded.surface.workflowHash,
                effective: result.effective
              }
            });
            if ("pending" in outcome) {
              deps.runs.update(result.promptId, { state: "unknown", queuePosition: void 0 });
              submitted.push({
                promptId: result.promptId,
                pending: true,
                ...seedSlot !== void 0 && typeof vars[seedSlot] === "number" ? { seed: vars[seedSlot] } : {}
              });
              if (canNotify) {
                watchRun({
                  client: deps.client,
                  target: agent,
                  promptId: result.promptId,
                  outputDir,
                  intervalMs: deps.pollIntervalMs,
                  registry: deps.runs,
                  ...deps.logger === void 0 ? {} : { logger: deps.logger }
                });
              } else {
                sweepRun({
                  client: deps.client,
                  promptId: result.promptId,
                  workflowId: loaded.workflowId,
                  outputDir,
                  intervalMs: deps.pollIntervalMs,
                  registry: deps.runs,
                  ...deps.logger === void 0 ? {} : { logger: deps.logger }
                });
              }
            } else {
              deps.runs.update(result.promptId, {
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
              const createdAt = (/* @__PURE__ */ new Date()).toISOString();
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
              submitted.push({
                promptId: result.promptId,
                artifacts: outcome.artifacts.map((artifact) => artifact.path),
                ...seedSlot !== void 0 && typeof vars[seedSlot] === "number" ? { seed: vars[seedSlot] } : {}
              });
            }
            continue;
          }
          submitted.push({
            promptId: result.promptId,
            ...seedSlot !== void 0 && typeof vars[seedSlot] === "number" ? { seed: vars[seedSlot] } : {}
          });
          if (canNotify) {
            watchRun({
              client: deps.client,
              target: agent,
              promptId: result.promptId,
              outputDir,
              intervalMs: deps.pollIntervalMs,
              registry: deps.runs,
              ...deps.logger === void 0 ? {} : { logger: deps.logger }
            });
          } else {
            sweepRun({
              client: deps.client,
              promptId: result.promptId,
              workflowId: loaded.workflowId,
              outputDir,
              intervalMs: deps.pollIntervalMs,
              registry: deps.runs,
              ...deps.logger === void 0 ? {} : { logger: deps.logger }
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const code = typeof error.code === "string" ? error.code : "rerun_failed";
          failures.push({ index, error: message, code });
          if (activePromptId !== void 0) {
            deps.runs.update(activePromptId, {
              state: "failed",
              finishedAt: Date.now(),
              queuePosition: void 0,
              error: { code, message }
            });
          }
        }
      }
      if (submitted.length === 0) {
        const primary = failures.find((item) => item.code !== void 0)?.code;
        return {
          ok: false,
          code: primary ?? "rerun_failed",
          error: failures.map((item) => item.error).join("\uFF1B"),
          failures
        };
      }
      const seedIgnored = seedArg !== void 0 && seedSlot === void 0;
      return {
        ok: true,
        workflowId: loaded.workflowId,
        ...seedIgnored ? { note: "\u6CA1\u6709\u8BC6\u522B\u5230 seed / noise_seed \u69FD\u4F4D\uFF0Cseed \u53C2\u6570\u5DF2\u5FFD\u7565\uFF08\u82E5\u8BE5\u5DE5\u4F5C\u6D41\u7684\u79CD\u5B50\u69FD\u4F4D\u7528\u4E86\u522B\u7684\u540D\u5B57\uFF0C\u8BF7\u7528 vars \u76F4\u63A5\u4F20\uFF09\u3002" } : {},
        count: submitted.length,
        promptIds: submitted.map((item) => item.promptId),
        // 工作流没有 seed 槽位时 item.seed 是 undefined：数组里的 undefined 会让宿主的
        // 无损 JSON 校验整次拒掉（与 #2 同一条路径）。没有就干脆不放这个元素。
        seeds: submitted.flatMap((item) => item.seed === void 0 ? [] : [item.seed]),
        ...wait ? { results: submitted } : {},
        ...stale ? {
          staleWorkflow: true,
          hint: "\u8FD9\u4EFD sidecar \u8BB0\u5F55\u7684\u5DE5\u4F5C\u6D41\u7248\u672C\u4E0E\u5F53\u524D\u4E0D\u540C\uFF08workflowHash \u4E0D\u4E00\u81F4\uFF09\u3002\u53C2\u6570\u540D\u4ECD\u517C\u5BB9\u7684\u8BDD\u53EF\u4EE5\u7EE7\u7EED\uFF1B\u4E0D\u786E\u5B9A\u5C31\u5148\u7528 comfyui_workflow_inspect \u5BF9\u4E00\u4E0B\u69FD\u4F4D\u3002"
        } : {},
        ...failures.length > 0 ? { failures } : {},
        ...tags.length > 0 ? { tags } : {}
      };
    }
  };
}

// src/components/tool-generate/tools/runs.ts
init_types();
var STATES = ["queued", "running", "done", "failed", "unknown"];
function view(record) {
  const now = Date.now();
  const elapsedMs = (record.finishedAt ?? now) - record.submittedAt;
  return {
    promptId: record.promptId,
    workflowId: record.workflowId,
    state: record.state,
    ...record.batchId === void 0 ? {} : { batchId: record.batchId },
    elapsedMs,
    ...record.queuePosition === void 0 ? {} : { queuePosition: record.queuePosition },
    ...record.progress === void 0 ? {} : { progress: record.progress },
    ...record.artifacts === void 0 ? {} : { artifacts: record.artifacts.map((a) => a.path) },
    ...record.error === void 0 ? {} : { error: record.error },
    ...record.stale === true ? { stale: true, note: "\u63D2\u4EF6\u91CD\u542F\u524D\u5C31\u5728\u8DD1\uFF0C\u72B6\u6001\u5DF2\u4E0D\u53EF\u77E5" } : {}
  };
}
function runsTool(deps) {
  return {
    name: "comfyui_runs",
    description: '\u67E5 ComfyUI \u4EFB\u52A1\u7684\u8FD0\u884C\u72B6\u6001\uFF1A\u6B63\u5728\u8DD1\u3001\u6392\u961F\u4E2D\u3001\u6700\u8FD1\u5B8C\u6210\u6216\u5931\u8D25\u7684\u3002\u63D0\u4EA4\u4E4B\u540E\u51FA\u56FE\u8981\u51E0\u5206\u949F\uFF0C\u7528\u8FD9\u4E2A\u5DE5\u5177\u786E\u8BA4"\u90A3\u6279\u51FA\u5B8C\u4E86\u6CA1"\uFF0C\u800C\u4E0D\u662F\u9760\u5BF9\u8BDD\u91CC\u63D2\u8FDB\u6765\u7684\u901A\u77E5\u3002\u8BFB\u7684\u662F\u63D2\u4EF6\u81EA\u5DF1\u7684\u8FD0\u884C\u8BB0\u5F55\uFF0C**\u4E0D\u4F1A\u62C9\u8D77 ComfyUI**\u3001\u4E5F\u4E0D\u4F1A\u7B49\u5B83\u5C31\u7EEA \u2014\u2014 \u6240\u4EE5\u670D\u52A1\u6CA1\u8D77\u6765\u65F6\u5B83\u7167\u6837\u80FD\u7B54\uFF08\u90A3\u6B63\u662F\u67E5"\u4E3A\u4EC0\u4E48\u6CA1\u51FA\u56FE"\u7684\u573A\u666F\uFF09\u3002\u4E0D\u4F20 state \u65F6\u6309\u65F6\u95F4\u5012\u5E8F\u7ED9\u6700\u8FD1\u7684\u3002',
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        state: {
          type: "string",
          enum: ["queued", "running", "done", "failed", "unknown"],
          description: "\u53EA\u770B\u67D0\u4E2A\u72B6\u6001\u3002running \u662F\u6B63\u5728\u7B97\u7684\uFF0Cqueued \u662F\u6392\u961F\u4E2D\u7684\uFF08\u5E26 queuePosition\uFF09\u3002"
        },
        batchId: { type: "string", description: "\u53EA\u770B\u67D0\u4E00\u6279\uFF08comfyui_run_batch \u63D0\u4EA4\u65F6\u7ED9\u7684\u6279\u6B21 id\uFF09\u3002" },
        limit: { type: "integer", description: "\u6700\u591A\u51E0\u6761\uFF0C\u9ED8\u8BA4 10\uFF0C\u4E0A\u9650 50\u3002" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args) {
      const stateArg = asString(args.state).trim();
      if (stateArg !== "" && !STATES.includes(stateArg)) {
        return { ok: false, error: `state \u53EA\u80FD\u662F ${STATES.join(" / ")}\u3002` };
      }
      const batchId = asString(args.batchId).trim();
      const limit = asInt(args.limit, 10, 1, 50);
      const records = deps.runs.list({
        ...stateArg === "" ? {} : { state: stateArg },
        ...batchId === "" ? {} : { batchId },
        limit
      });
      return {
        ok: true,
        active: deps.runs.activeCount(),
        count: records.length,
        runs: records.map(view),
        ...records.length === 0 ? { hint: "\u6CA1\u6709\u7B26\u5408\u6761\u4EF6\u7684\u8BB0\u5F55\u3002\u63D0\u4EA4\u4EFB\u52A1\u540E\u7A0D\u7B49\u518D\u67E5\uFF0C\u6216\u53BB\u6389 state \u7B5B\u9009\u3002" } : {}
      };
    }
  };
}

// src/components/tool-generate/tools/compose.ts
init_types();
init_workflow();
import fs12 from "node:fs";
import path11 from "node:path";

// src/components/tool-generate/tools/compose-prompt.ts
function buildPrompt(parts) {
  const seen = /* @__PURE__ */ new Set();
  const out = [];
  const push = (raw) => {
    const text3 = raw.trim().replace(/^,+|,+$/g, "").trim();
    if (text3 === "") return;
    const key = text3.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(text3);
  };
  if (parts.keywords !== void 0) {
    for (const segment of parts.keywords.split(",")) push(segment);
  }
  for (const tag of parts.tags ?? []) push(tag);
  if (parts.prompt !== void 0) {
    for (const sentence of parts.prompt.split(/[，,]/)) push(sentence);
  }
  return out.join(", ");
}

// src/components/tool-generate/tools/compose-slots.ts
var ROLE_CN = {
  pose: "\u59FF\u52BF\u53C2\u8003",
  costume: "\u670D\u88C5\u53C2\u8003",
  base: "\u5F85\u5904\u7406\u7684\u5E95\u56FE",
  mask: "\u91CD\u7ED8\u8499\u7248"
};
var ROLE_WORDS = [
  ["pose", ["\u59FF\u52BF", "\u59FF\u6001", "\u9AA8\u67B6", "pose", "openpose", "skeleton"]],
  ["costume", ["\u670D\u88C5", "\u8863\u88C5", "\u8863\u670D", "costume", "cloth", "outfit", "dress"]],
  ["base", ["\u539F\u56FE", "\u5E95\u56FE", "\u539F\u7167", "source", "base", "photo"]],
  ["mask", ["\u8499\u7248", "\u906E\u7F69", "mask", "inpaint", "\u91CD\u7ED8"]]
];
function matchRole(text3) {
  const lower = text3.toLowerCase();
  for (const [role, words] of ROLE_WORDS) {
    if (words.some((word) => lower.includes(word.toLowerCase()))) return role;
  }
  return void 0;
}
function planSlots(slots, roles) {
  const assignments = [];
  const assumptions = [];
  const pending2 = roles.slice();
  const used = /* @__PURE__ */ new Set();
  const take = (slot, role, why) => {
    assignments.push({ slot: slot.name, role, why });
    used.add(slot.name);
    const at = pending2.indexOf(role);
    if (at >= 0) pending2.splice(at, 1);
  };
  for (const slot of slots) {
    if (slot.type !== "mask" || !pending2.includes("mask")) continue;
    take(slot, "mask", "\u69FD\u4F4D\u7C7B\u578B\u662F mask");
  }
  for (const slot of slots) {
    if (slot.label === void 0 || slot.label === "") continue;
    const role = matchRole(slot.label);
    if (role === void 0 || !pending2.includes(role)) continue;
    take(slot, role, `label\u300C${slot.label}\u300D\u6307\u5411${ROLE_CN[role]}`);
  }
  for (const slot of slots) {
    if (used.has(slot.name)) continue;
    const fallback = typeof slot.default === "string" ? slot.default : "";
    if (fallback === "") continue;
    const role = matchRole(fallback);
    if (role === void 0 || !pending2.includes(role)) continue;
    take(slot, role, `\u9ED8\u8BA4\u6587\u4EF6\u540D\u300C${fallback}\u300D\u6307\u5411${ROLE_CN[role]}`);
  }
  const freeSlots = slots.filter((slot) => !used.has(slot.name));
  for (const [index, role] of pending2.slice().entries()) {
    const slot = freeSlots[index];
    if (slot === void 0) break;
    take(slot, role, "\u6309\u69FD\u4F4D\u987A\u5E8F\u5206\u914D\uFF08\u6CA1\u6709 label \u6216\u9ED8\u8BA4\u6587\u4EF6\u540D\u7EBF\u7D22\uFF09");
    assumptions.push(`\u69FD\u4F4D\u300C${slot.name}\u300D\u6CA1\u6709\u8BED\u4E49\u7EBF\u7D22\uFF0C\u6309\u987A\u5E8F\u63A8\u65AD\u4E3A${ROLE_CN[role]} \u2014\u2014 \u4E0D\u5BF9\u5C31\u6539 vars \u8986\u76D6`);
  }
  return { assignments, dropped: pending2, assumptions };
}

// src/components/tool-generate/tools/compose.ts
function asStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === "string");
}
var IMAGE_SLOTS = /* @__PURE__ */ new Set(["image", "mask"]);
function requireList(dir) {
  try {
    return fs12.readdirSync(dir).filter((name2) => name2.endsWith(".json") && !name2.endsWith(".meta.json")).map((name2) => path11.basename(name2, ".json"));
  } catch {
    return void 0;
  }
}
function isByOrder(why) {
  return why.startsWith("\u6309\u69FD\u4F4D\u987A\u5E8F");
}
function imageSlotsOf(inputs) {
  return inputs.filter((slot) => IMAGE_SLOTS.has(String(slot.type)));
}
function pickWorkflow(deps, roles) {
  const names = requireList(deps.workflowsDir);
  if (names === void 0) return void 0;
  const candidates = [];
  for (const workflowId of names) {
    let entry;
    try {
      entry = readEntry(deps.workflowsDir, workflowId);
    } catch {
      continue;
    }
    if (entry === void 0 || !entry.surface.enabled) continue;
    const inputs = entry.surface.inputs;
    const imageCount = imageSlotsOf(inputs).length;
    const plan = planSlots(
      imageSlotsOf(inputs).map((slot) => ({ name: slot.name, label: slot.label, default: slot.default, required: slot.required, type: slot.type })),
      roles
    );
    const matched = plan.assignments.filter((assignment) => !isByOrder(assignment.why)).length;
    if (roles.length > 0 && matched === 0) continue;
    if (roles.length > 0 && imageCount === 0) continue;
    candidates.push({ workflowId, inputs, imageCount, matched });
  }
  if (candidates.length === 0) return void 0;
  candidates.sort((a, b) => {
    if (roles.length === 0) return a.imageCount - b.imageCount || a.workflowId.localeCompare(b.workflowId);
    if (a.matched !== b.matched) return b.matched - a.matched;
    return Math.abs(a.imageCount - roles.length) - Math.abs(b.imageCount - roles.length) || a.workflowId.localeCompare(b.workflowId);
  });
  const best = candidates[0];
  return best === void 0 ? void 0 : { workflowId: best.workflowId, inputs: best.inputs, matched: best.matched };
}
var NEGATIVE_WORDS = /negative|负向|反向|反面/i;
var PREFIX_WORDS = /prefix|文件名|前缀/i;
var POSITIVE_WORDS = /prompt|positive|正面|正向/i;
function pickPromptSlot(inputs) {
  const text3 = inputs.filter((slot) => slot.type === "string");
  const usable = text3.filter((slot) => {
    const words = `${slot.name} ${slot.label ?? ""}`;
    return !NEGATIVE_WORDS.test(words) && !PREFIX_WORDS.test(words);
  });
  const explicit = usable.find((slot) => POSITIVE_WORDS.test(`${slot.name} ${slot.label ?? ""}`));
  if (explicit !== void 0) return explicit;
  return usable.length === 1 ? usable[0] : void 0;
}
async function resolveMaterial(source, role, id, size) {
  const lookup = role === "pose" ? source.pose : source.costume;
  const fetch2 = role === "pose" ? source.fetchPose : source.fetchCostume;
  const label = ROLE_CN[role];
  if (lookup === void 0 || fetch2 === void 0) {
    throw new Error(`${label}\u5E93\u6CA1\u6709\u542F\u7528\uFF08\u6216\u88AB\u5173\u6389\u4E86\uFF09\uFF0C\u62FF\u4E0D\u5230 ${id}\u3002`);
  }
  const item = lookup(id);
  if (item === void 0) {
    throw new Error(
      `${label}\u5E93\u91CC\u6CA1\u6709 ${id}\u3002\u5148\u7528 ${role === "pose" ? "comfyui_pose" : "comfyui_costume"} \u641C\u4E00\u4E0B\uFF08\u7ED9 query\uFF0C\u4E0D\u662F id\uFF09\u3002`
    );
  }
  const file = await fetch2(id, size);
  return { item, file };
}
function composeTool(deps) {
  return {
    name: "comfyui_compose",
    description: "\u628A\u7D20\u6750\uFF08\u8863\u88C5 / \u59FF\u52BF / \u6807\u7B7E / \u81EA\u7531\u63CF\u8FF0\uFF09\u6574\u7406\u6210**\u4E00\u6B21\u53EF\u4EE5\u76F4\u63A5\u4EA4\u7ED9 comfyui_run \u7684\u8C03\u7528**\uFF1A\u9009\u597D\u5DE5\u4F5C\u6D41\u3001\u628A\u7D20\u6750\u56FE\u843D\u8FDB uploads\u3001\u6309\u69FD\u4F4D\u8BED\u4E49\u586B\u597D vars\u3001\u62FC\u597D\u63D0\u793A\u8BCD\u3002\u5B83**\u4E0D\u51FA\u56FE**\uFF0C\u53EA\u4EA7\u51FA\u53C2\u6570 \u2014\u2014 \u62FF\u5230\u8FD4\u56DE\u91CC\u7684 call \u539F\u6837\u5582 comfyui_run \u5C31\u884C\u3002\u5178\u578B\u573A\u666F\uFF1A\u300C\u7528\u8FD9\u5957\u8863\u670D + \u8FD9\u4E2A\u59FF\u52BF\u51FA\u4E00\u5F20\u300D\u3002\u8FD4\u56DE\u91CC\u7684 assumptions \u662F\u69FD\u4F4D\u6620\u5C04\u7684\u63A8\u65AD\u4F9D\u636E\uFF0C**\u8BF7\u8BFB\u4E00\u904D**\uFF1A\u4E0D\u5BF9\u5C31\u7528 extraVars \u8986\u76D6\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: [],
      properties: {
        costumeId: { type: "string", description: "\u8863\u88C5\u5E93\u7684 id\uFF08\u5982 SPR-0001\uFF09\uFF0C\u6765\u81EA comfyui_costume \u7684\u641C\u7D22\u7ED3\u679C\u3002" },
        poseId: {
          type: "string",
          description: "\u59FF\u52BF\u7684 id \u6216\u89C6\u89D2 id\uFF08\u5982 full_single_P012 \u6216 full_single_P012_side\uFF09\uFF0C\u6765\u81EA comfyui_pose \u7684\u641C\u7D22\u7ED3\u679C\u3002"
        },
        size: { type: "string", enum: ["full", "thumb"], description: "\u53D6\u56FE\u5C3A\u5BF8\uFF0C\u9ED8\u8BA4 full\uFF08\u5F53\u53C2\u8003\u56FE\u7528 thumb \u5C31\u591F\uFF09\u3002" },
        tags: { type: "array", items: { type: "string" }, description: "\u5DF2\u8F6C\u597D\u7684 Danbooru tag\uFF08\u7531 danbooru_lookup \u5F97\u5230\uFF09\u3002" },
        prompt: { type: "string", description: "\u7528\u6237\u7684\u81EA\u7531\u63CF\u8FF0\uFF0C\u4E2D\u6587\u4E5F\u884C\u3002" },
        workflowId: { type: "string", description: "\u6307\u5B9A\u5DE5\u4F5C\u6D41\uFF1B\u4E0D\u7ED9\u5C31\u6309\u7D20\u6750\u6311\u4E00\u4E2A\u6709\u5BF9\u5E94\u56FE\u69FD\u7684\u3002" },
        baseImage: { type: "string", description: "\u8981\u5904\u7406\u7684\u5E95\u56FE\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5C40\u90E8\u91CD\u7ED8\u8FD9\u7C7B\u5DE5\u4F5C\u6D41\u7528\uFF09\u3002" },
        maskImage: { type: "string", description: "\u91CD\u7ED8\u8499\u7248\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5DE5\u4F5C\u6D41\u5F97\u6709 type=mask \u7684\u69FD\uFF09\u3002" },
        extraVars: { type: "object", additionalProperties: true, description: "\u539F\u6837\u5E76\u5165 vars\uFF0C\u4F18\u5148\u7EA7\u6700\u9AD8\uFF08\u7528\u5B83\u8986\u76D6\u4EFB\u4F55\u63A8\u65AD\uFF09\u3002" }
      }
    },
    output: jsonOutput(),
    execute: async (args) => {
      const materials = deps.getMaterials?.();
      const size = asString(args.size) === "thumb" ? "thumb" : "full";
      const wanted = [];
      const assumptions = [];
      const costumeId = asString(args.costumeId).trim();
      const poseId = asString(args.poseId).trim();
      const baseImage = asString(args.baseImage).trim();
      const maskImage = asString(args.maskImage).trim();
      if (poseId !== "") {
        if (materials === void 0) return { ok: false, error: "\u59FF\u52BF\u5E93\u8FD8\u6CA1\u5C31\u7EEA\uFF08\u6216\u88AB\u5173\u6389\u4E86\uFF09\uFF0C\u62FF\u4E0D\u5230\u7D20\u6750\u3002" };
        const { item, file } = await resolveMaterial(materials, "pose", poseId, size);
        wanted.push({ role: "pose", file, item });
      }
      if (costumeId !== "") {
        if (materials === void 0) return { ok: false, error: "\u8863\u88C5\u5E93\u8FD8\u6CA1\u5C31\u7EEA\uFF08\u6216\u88AB\u5173\u6389\u4E86\uFF09\uFF0C\u62FF\u4E0D\u5230\u7D20\u6750\u3002" };
        const { item, file } = await resolveMaterial(materials, "costume", costumeId, size);
        wanted.push({ role: "costume", file, item });
      }
      if (baseImage !== "") wanted.push({ role: "base", file: baseImage });
      if (maskImage !== "") wanted.push({ role: "mask", file: maskImage });
      const workflowIdArg = asString(args.workflowId).trim();
      let workflowId = workflowIdArg;
      let inputs;
      if (workflowId !== "") {
        const entry = readEntry(deps.workflowsDir, workflowId);
        if (entry === void 0) {
          return { ok: false, error: `\u6CA1\u6709\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF1A${workflowId}\u3002\u5148\u7528 comfyui_workflow_list \u770B\u6709\u54EA\u4E9B\u3002` };
        }
        if (!entry.surface.enabled) return { ok: false, error: `\u5DE5\u4F5C\u6D41 ${workflowId} \u5DF2\u88AB\u505C\u7528\u3002` };
        inputs = entry.surface.inputs;
      } else {
        if (wanted.length === 0 && asString(args.prompt).trim() === "" && asStringArray(args.tags).length === 0) {
          return {
            ok: false,
            error: "\u4EC0\u4E48\u90FD\u6CA1\u7ED9\uFF1A\u81F3\u5C11\u7ED9\u4E00\u4E2A\u7D20\u6750\uFF08costumeId / poseId / baseImage\uFF09\u3001\u4E00\u6BB5 prompt\uFF0C\u6216\u6307\u5B9A workflowId\u3002"
          };
        }
        const picked = pickWorkflow(deps, wanted.map((item) => item.role));
        if (picked === void 0) {
          return {
            ok: false,
            error: wanted.length === 0 ? `\u5DE5\u4F5C\u6D41\u76EE\u5F55\u8BFB\u4E0D\u5230\u6216\u6CA1\u6709\u53EF\u7528\u6A21\u677F\uFF1A${deps.workflowsDir}` : `\u6CA1\u6709\u627E\u5230\u80FD\u653E\u8FD9\u4E9B\u7D20\u6750\u7684\u5DE5\u4F5C\u6D41\uFF08${wanted.map((item) => ROLE_CN[item.role]).join("\u3001")}\uFF09\u3002\u53EA\u6309\u56FE\u69FD\u6570\u91CF\u786C\u585E\u4F1A\u628A\u53C2\u8003\u56FE\u653E\u8FDB"\u5F85\u91CD\u7ED8\u7684\u5E95\u56FE"\uFF0C\u6240\u4EE5\u8FD9\u79CD\u60C5\u51B5\u5B81\u53EF\u62A5\u9519\u3002\u7528 comfyui_workflow_list { inputs: "image" } \u770B\u770B\u54EA\u4E9B\u5E26\u56FE\u69FD\uFF0C\u6216\u76F4\u63A5\u6307\u5B9A workflowId\u3002`
          };
        }
        workflowId = picked.workflowId;
        inputs = picked.inputs;
        assumptions.push(
          `\u6CA1\u6307\u5B9A\u5DE5\u4F5C\u6D41\uFF0C\u6309\u69FD\u4F4D\u8BED\u4E49\u5339\u914D\u6311\u4E86 ${workflowId}\uFF08${picked.matched} \u4E2A\u69FD\u4F4D\u6709\u8BED\u4E49\u4F9D\u636E\uFF09`
        );
      }
      const imageSlots = imageSlotsOf(inputs);
      const plan = planSlots(
        imageSlots.map((slot) => ({ name: slot.name, label: slot.label, default: slot.default, required: slot.required, type: slot.type })),
        wanted.map((item) => item.role)
      );
      assumptions.push(...plan.assumptions);
      const vars = {};
      const filled = [];
      for (const assignment of plan.assignments) {
        const material = wanted.find((item) => item.role === assignment.role);
        if (material === void 0) continue;
        vars[assignment.slot] = material.file;
        filled.push({
          slot: assignment.slot,
          from: material.item === void 0 ? assignment.role : `${assignment.role}:${material.item.id}`,
          why: assignment.why
        });
      }
      const costume = wanted.find((item) => item.role === "costume")?.item;
      const prompt = buildPrompt({
        keywords: costume?.keywords,
        tags: asStringArray(args.tags),
        prompt: asString(args.prompt)
      });
      const promptSlot = pickPromptSlot(inputs);
      if (prompt !== "") {
        if (promptSlot !== void 0) vars[promptSlot.name] = prompt;
        else assumptions.push("\u6CA1\u6709\u8BC6\u522B\u5230\u660E\u786E\u7684\u6B63\u5411\u63D0\u793A\u8BCD\u69FD\uFF08\u6015\u5199\u8FDB negative \u6216\u6587\u4EF6\u540D\u524D\u7F00\uFF09\uFF0Cprompt \u6CA1\u6709\u5199\u8FDB vars");
      }
      Object.assign(vars, asRecord(args.extraVars));
      const unfilled = inputs.filter((slot) => slot.required === true && vars[slot.name] === void 0).map((slot) => slot.name);
      return {
        ok: true,
        call: { workflow: { id: workflowId }, vars },
        filled,
        dropped: plan.dropped.map((role) => ({ role, why: "\u5DE5\u4F5C\u6D41\u6CA1\u6709\u591A\u4F59\u7684\u56FE\u69FD\u653E\u5B83" })),
        assumptions,
        unfilled,
        next: "\u628A call \u539F\u6837\u4EA4\u7ED9 comfyui_run"
      };
    }
  };
}

// src/components/tool-generate/tools/run-batch.ts
init_runner();
init_run();
init_overrides();
init_batch_notify();
init_policy();
init_types();
init_notify();
import path12 from "node:path";
var MAX_RUNS = 20;
var BATCH_WAIT_BUDGET_MS = 30 * 6e4;
function mergeWorkflow(outer, inner) {
  if (inner !== void 0 && inner !== null) return inner;
  return outer;
}
function runBatchTool(deps) {
  return {
    name: "comfyui_run_batch",
    description: `\u4E00\u6B21\u63D0\u4EA4\u591A\u4E2A ComfyUI \u4EFB\u52A1\uFF08\u540C\u4E00\u5DE5\u4F5C\u6D41\u8DD1\u591A\u7EC4\u53C2\u6570\uFF0C\u6216\u4E0D\u540C\u5DE5\u4F5C\u6D41\u5404\u8DD1\u4E00\u6B21\uFF09\u3002\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u4F1A\u81EA\u52A8\u62C9\u8D77\uFF0C\u4E0D\u7528\u5148\u624B\u52A8\u542F\u52A8\uFF0C\u4E5F\u4E0D\u8981 kill / \u91CD\u542F ComfyUI \u8FDB\u7A0B\u3002\u8FD4\u56DE\u6BCF\u6761\u7684 promptId \u6216\u9519\u8BEF\uFF1B**\u90E8\u5206\u5931\u8D25\u4E0D\u5F71\u54CD\u5176\u5B83\u6761\u76EE**\u3002\u9ED8\u8BA4\u5F02\u6B65\uFF1A\u63D0\u4EA4\u5B8C\u7ACB\u523B\u8FD4\u56DE\uFF0C\u51FA\u56FE\u540E\u5404\u81EA\u63A8\u56DE\u5BF9\u8BDD\u3002\u4E00\u6B21\u6700\u591A ${MAX_RUNS} \u6761\u3002\u6CE8\u610F\uFF1A\u4E00\u6B21\u6027\u53C2\u6570\u8986\u76D6\uFF08comfyui_workflow_edit persist=false\uFF09\u7528\u5B8C\u5373\u6E05\uFF0C\u6240\u4EE5\u901A\u5E38\u53EA\u6709**\u7B2C\u4E00\u6761**\u4F1A\u5E26\u4E0A\u5B83\uFF08\u82E5\u7B2C\u4E00\u6761\u63D0\u4EA4\u5931\u8D25\uFF0C\u4F1A\u987A\u5EF6\u7ED9\u4E0B\u4E00\u6761\uFF09\uFF1B\u60F3\u8BA9\u6BCF\u6761\u90FD\u53D8\uFF0C\u8BF7\u76F4\u63A5\u5199\u8FDB vars \u6216\u843D\u76D8\u6A21\u677F\u3002`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["runs"],
      properties: {
        workflow: {
          type: "object",
          description: '\u5171\u7528\u5DE5\u4F5C\u6D41\uFF0C**\u4F18\u5148\u7528 {"id":"sdxl"}** \u2014\u2014 \u914D\u5408\u5404\u6761\u7684 vars \u6539\u53C2\u6570\u3002{"path":"\u2026"} \u53EA\u7528\u4E8E\u76EE\u5F55\u4E4B\u5916\u7684\u4E34\u65F6\u6587\u4EF6\u4E14\u5FC5\u987B\u662F API \u683C\u5F0F\uFF08UI \u683C\u5F0F\u8981\u5148\u5728 ComfyUI \u91CC\u300CExport (API)\u300D\uFF09\u3002\u5404\u6761\u53EF\u5404\u81EA\u8986\u76D6\u3002',
          properties: { id: { type: "string" }, path: { type: "string" } }
        },
        runs: {
          type: "array",
          description: `\u63D0\u4EA4\u6E05\u5355\uFF0C\u6BCF\u6761\u542B vars\uFF08\u53EF\u9009 workflow / outputPath\uFF09\uFF0C\u6700\u591A ${MAX_RUNS} \u6761\u3002`,
          items: {
            type: "object",
            properties: {
              workflow: {
                type: "object",
                description: "\u8FD9\u4E00\u6761\u5355\u72EC\u6307\u5B9A\u7684\u5DE5\u4F5C\u6D41\uFF0C\u8986\u76D6\u5916\u5C42\u3002",
                properties: { id: { type: "string" }, path: { type: "string" } }
              },
              vars: { type: "object", description: "\u53D8\u91CF\u7ED1\u5B9A\uFF0C\u952E\u5FC5\u987B\u662F\u8BE5\u5DE5\u4F5C\u6D41\u58F0\u660E\u8FC7\u7684\u8F93\u5165\u540D\u3002", additionalProperties: true },
              outputPath: { type: "string", description: "\u8FD9\u4E00\u6761\u7684\u4EA7\u7269\u76EE\u5F55\uFF0C\u4E0D\u586B\u7528\u4F1A\u8BDD\u76EE\u5F55\u3002" }
            }
          }
        },
        wait: {
          type: "boolean",
          description: "\u662F\u5426\u540C\u6B65\u7B49\u5168\u90E8\u51FA\u56FE\u3002\u9ED8\u8BA4 false\uFF08\u5168\u90E8\u5F02\u6B65\uFF09\u3002\u6279\u91CF\u540C\u6B65\u7B49\u5F85\u5F88\u5BB9\u6613\u649E\u8D85\u65F6\uFF0C\u4E00\u822C\u4E0D\u8981\u5F00\u3002"
        },
        timeoutMs: { type: "integer", description: "wait=true \u65F6\u5355\u6761\u7B49\u5F85\u4E0A\u9650\uFF08\u6BEB\u79D2\uFF09\u3002" }
      }
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    async execute(args, exec) {
      const raw = Array.isArray(args.runs) ? args.runs : [];
      if (raw.length === 0) return { ok: false, error: "runs \u4E0D\u80FD\u4E3A\u7A7A\u3002" };
      if (raw.length > MAX_RUNS) {
        return { ok: false, error: `\u4E00\u6B21\u6700\u591A\u63D0\u4EA4 ${MAX_RUNS} \u6761\uFF0C\u6536\u5230 ${raw.length} \u6761\u3002\u8BF7\u5206\u6279\u3002` };
      }
      const sessionDir = deps.resolveOutputDirFor?.(exec?.agent) ?? deps.outputDir;
      const timeoutMs2 = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
      const agent = exec?.agent;
      const canNotify = agent !== void 0 && typeof agent.followup === "function";
      const batchId = `batch-${Date.now().toString(36)}`;
      const items = [];
      const collector = canNotify ? new BatchCollector({
        total: raw.length,
        deliver: (text3) => {
          try {
            agent.followup({
              id: batchId,
              role: "user",
              content: [{ type: "text", text: text3 }],
              source: { kind: "plugin:dsh-comfyui-workbench" }
            });
          } catch (error) {
            deps.logger?.warn?.(`[batch] \u6C47\u603B\u672A\u9001\u8FBE\uFF1A${error instanceof Error ? error.message : String(error)}`);
          }
        },
        ...deps.logger === void 0 ? {} : { logger: deps.logger }
      }) : void 0;
      const submittedIds = [];
      const startedAt = Date.now();
      const totalBudgetMs = Math.min(timeoutMs2 * raw.length, BATCH_WAIT_BUDGET_MS);
      const sequence = planOrder(raw, args.workflow);
      for (const index of sequence) {
        let activePromptId;
        const entry = raw[index];
        const item = entry ?? {};
        try {
          const outputDir = asString(item.outputPath).trim() !== "" ? asString(item.outputPath).trim() : sessionDir;
          try {
            deps.assertWritable(outputDir, exec?.agent);
          } catch (error) {
            const denied = new Error(error instanceof Error ? error.message : String(error));
            denied.code = "forbidden_output";
            throw denied;
          }
          const workflowArg = mergeWorkflow(args.workflow, item.workflow);
          const loaded = await loadForBatch(deps, workflowArg);
          const pending2 = deps.overrides.get(loaded.workflowId);
          const applied = applyOverrides(
            loaded.workflow,
            loaded.surface,
            item.vars ?? {},
            pending2
          );
          const batchVars = applied.vars;
          const batchNotes = overrideNotes(applied);
          const submitted = await submitWorkflow({
            client: deps.client,
            workflow: loaded.workflow,
            slots: loaded.surface.inputs,
            vars: batchVars,
            outputDir,
            timeoutMs: timeoutMs2,
            pollIntervalMs: deps.pollIntervalMs,
            workflowId: loaded.workflowId,
            workflowHash: loaded.surface.workflowHash
          });
          activePromptId = submitted.promptId;
          deps.runs.submit(submitted.promptId, loaded.workflowId, batchId);
          if (pending2 !== void 0 && pending2.length > 0) deps.overrides.delete(loaded.workflowId);
          submittedIds.push(submitted.promptId);
          if (args.wait !== true) {
            items.push({
              index,
              ok: true,
              promptId: submitted.promptId,
              workflowId: loaded.workflowId,
              ...submitted.notes.length === 0 && batchNotes.length === 0 ? {} : { notes: [...submitted.notes, ...batchNotes] }
            });
            if (canNotify) watchOne(deps, agent, submitted.promptId, outputDir, collector, index);
            else sweepOne(deps, submitted.promptId, loaded.workflowId, outputDir);
          } else {
            const remaining = Math.max(1e3, totalBudgetMs - (Date.now() - startedAt));
            const outcome = await waitForRun(deps.client, submitted.promptId, {
              timeoutMs: Math.min(timeoutMs2, remaining),
              pollIntervalMs: deps.pollIntervalMs,
              fallback: {
                outputDir,
                workflowId: loaded.workflowId,
                workflowHash: loaded.surface.workflowHash,
                effective: submitted.effective
              }
            });
            if ("pending" in outcome) {
              items.push({
                index,
                ok: true,
                promptId: submitted.promptId,
                workflowId: loaded.workflowId,
                pending: true,
                ...submitted.notes.length === 0 && batchNotes.length === 0 ? {} : { notes: [...submitted.notes, ...batchNotes] },
                ...canNotify ? {} : { hint: "\u8FD9\u6761\u8FD8\u6CA1\u51FA\u56FE\uFF0C\u4E14\u6CA1\u6709\u4F1A\u8BDD\u901A\u9053\u63A8\u9001\u7ED3\u679C \u2014\u2014 \u7A0D\u540E\u7528 comfyui_run \u4F20 promptId \u67E5\u3002" }
              });
              deps.runs.update(submitted.promptId, { state: "unknown", queuePosition: void 0 });
              if (canNotify) watchOne(deps, agent, submitted.promptId, outputDir, collector, index);
              else sweepOne(deps, submitted.promptId, loaded.workflowId, outputDir);
            } else {
              const createdAt = (/* @__PURE__ */ new Date()).toISOString();
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
                    tags: [],
                    status: "present"
                  });
                } catch {
                  deps.logger?.warn?.("\u8D44\u4EA7\u7D22\u5F15\u767B\u8BB0\u5931\u8D25\uFF08\u4EA7\u7269\u5DF2\u843D\u76D8\uFF09");
                }
              }
              deps.runs.update(submitted.promptId, {
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
              collector?.settle({
                promptId: submitted.promptId,
                index,
                ok: true,
                text: `\u5DE5\u4F5C\u6D41 ${loaded.workflowId} \u51FA\u56FE\u5B8C\u6210\u3002`,
                artifacts: outcome.artifacts.map((artifact) => artifact.path),
                artifactDetails: outcome.artifacts.map((artifact) => ({
                  path: artifact.path,
                  ...artifact.width === void 0 ? {} : { width: artifact.width },
                  ...artifact.height === void 0 ? {} : { height: artifact.height },
                  ...artifact.bytes === void 0 ? {} : { bytes: artifact.bytes }
                }))
              });
              items.push({
                index,
                ok: true,
                promptId: submitted.promptId,
                workflowId: loaded.workflowId,
                artifacts: outcome.artifacts.map((artifact) => artifact.path),
                ...submitted.notes.length === 0 && batchNotes.length === 0 ? {} : { notes: [...submitted.notes, ...batchNotes] }
              });
            }
          }
        } catch (error) {
          const code = codeOf(error) === "" ? "run_failed" : codeOf(error);
          const message = error instanceof Error ? error.message : String(error);
          items.push({ index, ok: false, code, error: message });
          collector?.settle({ promptId: activePromptId ?? `failed-${index}`, index, ok: false, text: message });
          if (activePromptId !== void 0) {
            const definite = finalStateOf(error) === "failed";
            deps.runs.update(activePromptId, {
              state: definite ? "failed" : "unknown",
              finishedAt: Date.now(),
              queuePosition: void 0,
              error: { code, message }
            });
          }
        }
      }
      items.sort((a, b) => a.index - b.index);
      const okCount = items.filter((item) => item.ok).length;
      return {
        ok: okCount > 0,
        submitted: okCount,
        failed: items.length - okCount,
        promptIds: submittedIds,
        results: items,
        ...canNotify ? {} : { hint: "\u6CA1\u6709\u53EF\u7528\u7684\u4F1A\u8BDD\u901A\u9053\uFF0C\u51FA\u56FE\u7ED3\u679C\u4E0D\u4F1A\u4E3B\u52A8\u63A8\u56DE\u5BF9\u8BDD \u2014\u2014 \u7528 comfyui_run \u5E26 promptId \u56DE\u6765\u67E5\u3002" }
      };
    }
  };
}
function planOrder(raw, shared3) {
  const buckets = /* @__PURE__ */ new Map();
  const order = [];
  raw.forEach((entry, index) => {
    const item = entry ?? {};
    const declared = mergeWorkflow(shared3, item.workflow);
    const id = typeof declared?.id === "string" ? declared.id.trim() : "";
    const file = typeof declared?.path === "string" ? declared.path.trim() : "";
    const key = id !== "" ? `id:${id}` : file !== "" ? `path:${path12.resolve(file)}` : "default";
    let bucket = buckets.get(key);
    if (bucket === void 0) {
      bucket = [];
      buckets.set(key, bucket);
      order.push(key);
    }
    bucket.push(index);
  });
  const sequence = [];
  for (const key of order) sequence.push(...buckets.get(key));
  return sequence;
}
function sweepOne(deps, promptId, workflowId, outputDir) {
  sweepRun({
    client: deps.client,
    promptId,
    workflowId,
    outputDir,
    intervalMs: deps.pollIntervalMs,
    registry: deps.runs,
    ...deps.logger === void 0 ? {} : { logger: deps.logger }
  });
}
function watchOne(deps, agent, promptId, outputDir, collector, index) {
  watchRun({
    client: deps.client,
    target: agent,
    promptId,
    outputDir,
    intervalMs: deps.pollIntervalMs,
    registry: deps.runs,
    // 交给批次收集器 -> 凑齐后一条汇总；没有收集器就退回逐条投递
    ...collector === void 0 ? {} : {
      onSettled: (run) => collector.settle({
        promptId,
        ...index === void 0 ? {} : { index },
        ok: run.ok,
        text: run.text,
        ...run.artifacts === void 0 ? {} : { artifacts: run.artifacts },
        ...run.artifactDetails === void 0 ? {} : { artifactDetails: run.artifactDetails }
      })
    },
    ...deps.logger === void 0 ? {} : { logger: deps.logger }
  });
}
async function loadForBatch(deps, workflowArg) {
  const { loadWorkflowForBatch: loadWorkflowForBatch2 } = await Promise.resolve().then(() => (init_run2(), run_exports));
  return loadWorkflowForBatch2(deps, { workflow: workflowArg });
}

// src/components/tool-generate/tools/registry.ts
init_run2();

// src/components/tool-workflow-edit/tools/workflow-edit.ts
init_workflow();
init_variables();
init_types();
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
    description: "\u4FEE\u6539\u5DE5\u4F5C\u6D41\u7684\u7528\u9014\u5907\u6CE8\uFF0C\u6216\u8C03\u6574\u67D0\u4E2A\u8282\u70B9\u7684\u53C2\u6570\u3002patches \u9ED8\u8BA4\u53EA\u5F71\u54CD\u4E0B\u4E00\u6B21\u8FD0\u884C\uFF08\u4E0D\u5199\u6A21\u677F\uFF09\uFF1B\u8981\u5199\u56DE\u6A21\u677F\u5FC5\u987B\u5E26 persist=true \u4E0E expectHash\u3002**\u4E00\u6B21\u6027\u7684\u53C2\u6570\u4E0D\u8981\u7528\u8FD9\u4E2A** \u2014\u2014 \u76F4\u63A5\u7528 `comfyui_run` \u7684 vars\uFF1B\u8FD9\u91CC\u53EA\u5728\u4E24\u79CD\u60C5\u51B5\u7528\uFF1A\u628A\u65B0\u503C\u56FA\u5B9A\u8FDB\u6A21\u677F\uFF08persist=true\uFF09\uFF0C\u6216\u6539\u5DE5\u4F5C\u6D41\u7684\u5907\u6CE8\u3002\u88AB\u53D8\u91CF\u63A7\u5236\uFF08bind\uFF09\u7684\u53C2\u6570\u4E0D\u80FD\u76F4\u63A5 patch\uFF0C\u5E94\u5148\u6539\u90A3\u4E2A\u53D8\u91CF\u3002",
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
init_comfy();
init_workflow();
init_types();
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
    description: "\u67E5\u770B\u5DE5\u4F5C\u6D41\u7EC6\u8282\u3002\u4E0D\u4F20 nodeId\uFF1A\u8FD4\u56DE\u8F93\u5165\u8F93\u51FA\u9762 + \u8282\u70B9\u6E05\u5355\uFF08id/classType/title\uFF09+ \u7F3A\u5931\u8282\u70B9\u9884\u68C0\u3002\u4F20 nodeId\uFF1A\u8FD4\u56DE\u8BE5\u8282\u70B9\u7684\u5B8C\u6574\u914D\u7F6E\uFF08\u542B\u8FDE\u7EBF\u6765\u6E90\uFF09\u3002\u6539\u53C2\u6570\u524D\u5148\u7528\u5B83\u786E\u8BA4\u73B0\u72B6\u3002\u5B83\u8981\u8BFB ComfyUI \u7684\u8282\u70B9\u6E05\u5355\uFF0C\u6240\u4EE5**\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u4E5F\u4F1A\u5148\u81EA\u52A8\u62C9\u8D77**\uFF08\u6700\u591A 3 \u5206\u949F\uFF09\uFF0C\u6162\u662F\u6B63\u5E38\u7684\u3002",
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
init_comfy();
init_workflow();
init_types();
function toModelItem(surface) {
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
    description: "\u5217\u51FA\u672C\u673A\u53EF\u7528\u7684 ComfyUI \u5DE5\u4F5C\u6D41\u3002\u6BCF\u9879\u542B id\u3001\u6807\u9898\u3001\u4F5C\u7528\u5907\u6CE8\u3001\u5E95\u6A21\u540D\u3001\u8F93\u5165\u79CD\u7C7B\uFF08text/image/mask\uFF09\u4E0E\u8F93\u51FA\u5F62\u72B6\u3002\u7528\u6237\u6CA1\u6709\u6307\u5B9A\u5DE5\u4F5C\u6D41\u65F6\u7528\u5B83\u5728\u5176\u4E2D\u6311\u9009\uFF1B\u7528\u6237\u5DF2\u6307\u5B9A\u65F6\u4E0D\u5FC5\u8C03\u7528\u3002**\u670D\u52A1\u6CA1\u5728\u8DD1\u65F6\u5B83\u4F1A\u5148\u81EA\u52A8\u62C9\u8D77\u518D\u5217**\uFF08\u6700\u591A\u7B49\u5230 3 \u5206\u949F\uFF09\uFF0C\u6240\u4EE5\u7B2C\u4E00\u6B21\u8C03\u7528\u6162\u662F\u6B63\u5E38\u7684\uFF0C\u4E0D\u8981\u56E0\u4E3A\u6162\u5C31\u4EE5\u4E3A\u5361\u4F4F\u4E86\u3001\u66F4\u4E0D\u8981\u624B\u52A8\u53BB\u542F\u52A8\u6216 kill ComfyUI\u3002",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        q: { type: "string", description: "\u6309\u6807\u9898 / \u5907\u6CE8 / \u6A21\u578B\u540D\u8FC7\u6EE4\uFF08\u4E0D\u533A\u5206\u5927\u5C0F\u5199\uFF09" },
        inputs: {
          type: "string",
          enum: ["image", "mask"],
          description: "\u53EA\u770B\u9700\u8981\u8FD9\u7C7B\u8F93\u5165\u7684\u5DE5\u4F5C\u6D41\uFF08\u627E'\u80FD\u5403\u56FE\u7684\u5DE5\u4F5C\u6D41'\u5C31\u7528 image\uFF09\u3002\u7ED3\u679C\u91CC\u4F1A\u6807 needsImage \u4E0E\u5BF9\u5E94\u69FD\u4F4D\u540D\u3002"
        },
        includeDisabled: { type: "boolean", description: "\u8FDE\u88AB\u7BA1\u7406\u5458\u505C\u7528\u7684\u5DE5\u4F5C\u6D41\u4E00\u8D77\u5217\u51FA\uFF08\u9ED8\u8BA4\u53EA\u770B\u53EF\u7528\u7684\uFF09" }
      }
    },
    output: jsonOutput(),
    async execute(args) {
      const query = asString(args.q).trim().toLowerCase();
      const wantInput = asString(args.inputs).trim().toLowerCase();
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
        const item = toModelItem(entry.surface);
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
        if (wantInput !== "") {
          const slots = Array.isArray(item.inputs) ? item.inputs : [];
          const matched = slots.filter((slot) => String(slot.type ?? "").toLowerCase() === wantInput);
          if (matched.length === 0) return false;
          item.imageSlots = matched.map((slot) => String(slot.name ?? ""));
          item.needsImage = wantInput === "image";
        }
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
        ...items.length === 0 && broken.length === 0 ? {
          // 按输入类型筛空时要专门说 —— 通用那句会让人以为"一个工作流都没有"
          hint: wantInput === "" ? "\u6CA1\u6709\u53EF\u7528\u7684\u5DE5\u4F5C\u6D41\u3002\u7528\u9762\u677F\u542F\u7528\u4E00\u4E2A\uFF0C\u6216\u5BFC\u5165\u4E00\u4EFD API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF08ComfyUI \u91CC Export (API)\uFF09\u3002" : `\u672C\u673A\u6CA1\u6709\u9700\u8981 ${wantInput} \u8F93\u5165\u7684\u5DE5\u4F5C\u6D41\u3002\u53BB\u6389 inputs \u53C2\u6570\u53EF\u4EE5\u770B\u5168\u90E8\u3002`
        } : {}
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
    name: "compose",
    component: "tool.generate",
    title: "\u628A\u7D20\u6750\u6574\u7406\u6210\u4E00\u6B21\u8FD0\u884C\u8C03\u7528",
    build: (deps) => composeTool(deps)
  },
  {
    name: "rerun",
    component: "tool.generate",
    title: "\u4ECE\u4EA7\u7269\u91CD\u8DD1 / \u505A\u53D8\u4F53",
    build: (deps) => rerunTool(deps)
  },
  {
    name: "runs",
    component: "tool.generate",
    title: "\u67E5\u4EFB\u52A1\u8FD0\u884C\u72B6\u6001",
    build: (deps) => runsTool(deps)
  },
  {
    name: "run-batch",
    component: "tool.generate",
    title: "\u6279\u91CF\u63D0\u4EA4\u5DE5\u4F5C\u6D41\u4EFB\u52A1",
    build: (deps) => runBatchTool(deps)
  },
  {
    name: "node-search",
    component: "tool.generate",
    title: "\u6309\u5404\u9879\u4FE1\u606F\u641C\u7D22\u672C\u673A\u8282\u70B9",
    build: (deps) => nodeSearchTool(deps)
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

// src/runtime.ts
init_comfy();
import path25 from "node:path";

// src/shared/comfy/output-buffer.ts
var DEFAULT_CAPACITY = 2e3;
var ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007]*\u0007|\u001b[()][A-Z0-9]/g;
function stripAnsi(text3) {
  return text3.replace(ANSI, "");
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
      const text3 = parts[i];
      if (i === parts.length - 1 && text3 === "") continue;
      const line = { seq: this.nextSeq, stream, text: text3, at: Date.now() };
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

// src/shared/run/registry.ts
import fs13 from "node:fs";
import path13 from "node:path";
var MAX_RECORDS = 200;
var FILE_NAME = "runs.json";
var RunRegistry = class {
  records = /* @__PURE__ */ new Map();
  /** 下一个登记序号；从盘上读回时取最大值 +1，重启后仍单调。 */
  nextSeq = 1;
  /** 落盘路径；为空则只在内存里。 */
  filePath;
  writeTimer;
  dirty = false;
  /**
   * @param outputDir - 会话产物目录（写 `<dir>/runs.json`）。不传则纯内存。
   */
  constructor(outputDir) {
    this.filePath = outputDir === void 0 ? void 0 : path13.join(outputDir, FILE_NAME);
    if (this.filePath !== void 0) this.load();
  }
  /** 从盘上读回历史。进程重启时还在跑的，标成 stale。 */
  load() {
    if (this.filePath === void 0) return;
    let parsed;
    try {
      if (!fs13.existsSync(this.filePath)) return;
      parsed = JSON.parse(fs13.readFileSync(this.filePath, "utf8"));
    } catch {
      return;
    }
    if (!Array.isArray(parsed)) return;
    for (const raw of parsed) {
      if (raw === null || typeof raw !== "object") continue;
      const record = raw;
      if (typeof record.promptId !== "string" || record.promptId === "") continue;
      if (record.state === "queued" || record.state === "running") {
        record.state = "unknown";
        record.stale = true;
      }
      this.records.set(record.promptId, record);
      if (typeof record.seq === "number" && record.seq >= this.nextSeq) this.nextSeq = record.seq + 1;
    }
  }
  /**
   * 内存裁剪。
   *
   * **先淘汰终态**（done / failed / unknown），只有全是 active 时才退回按 seq 淘汰 ——
   * 否则 200 条都在跑的时候，新提交一条会把最老的 running 删掉：面板上那条正在跑的
   * 任务凭空消失，之后的 update 也变成静默空操作。
   */
  trim() {
    if (this.records.size < MAX_RECORDS) return;
    const all = [...this.records.values()];
    const finished = all.filter((record) => record.state !== "queued" && record.state !== "running").sort((a, b) => a.seq - b.seq);
    const active = all.filter((record) => record.state === "queued" || record.state === "running").sort((a, b) => a.seq - b.seq);
    const need = this.records.size - MAX_RECORDS + 1;
    for (const record of [...finished, ...active].slice(0, Math.max(0, need))) {
      this.records.delete(record.promptId);
    }
  }
  /** 攒一下再写：进度更新很频繁，每次落盘会拖慢轮询。 */
  scheduleFlush() {
    if (this.filePath === void 0) return;
    this.dirty = true;
    if (this.writeTimer !== void 0) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = void 0;
      this.flush();
    }, 1e3);
    this.writeTimer.unref?.();
  }
  /** 立即落盘（插件卸载时用）。 */
  flush() {
    if (this.filePath === void 0 || !this.dirty) return;
    this.dirty = false;
    try {
      fs13.mkdirSync(path13.dirname(this.filePath), { recursive: true });
      const all = [...this.records.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_RECORDS);
      const tmp = `${this.filePath}.tmp`;
      fs13.writeFileSync(tmp, `${JSON.stringify(all, null, 1)}
`, "utf8");
      fs13.renameSync(tmp, this.filePath);
    } catch {
    }
  }
  /**
   * 登记一次提交。
   *
   * @param promptId - ComfyUI 给的 id。
   * @param workflowId - 工作流 id。
   * @param batchId - 批量提交时的批次标识。
   */
  submit(promptId, workflowId, batchId) {
    this.trim();
    this.records.set(promptId, {
      promptId,
      workflowId,
      seq: this.nextSeq++,
      state: "queued",
      submittedAt: Date.now(),
      ...batchId === void 0 ? {} : { batchId }
    });
    this.scheduleFlush();
  }
  /**
   * 更新状态。只合并传入的字段。
   *
   * @param promptId - 运行 id。
   * @param patch - 要改的字段。
   */
  update(promptId, patch) {
    const current = this.records.get(promptId);
    if (current === void 0) return;
    Object.assign(current, patch);
    this.scheduleFlush();
  }
  /** 查询一条。 */
  get(promptId) {
    return this.records.get(promptId);
  }
  /**
   * 列出记录。
   *
   * @param filter - 按状态筛；不传则全部。
   * @param limit - 最多几条，默认 20。
   */
  list(filter) {
    let all = [...this.records.values()];
    if (filter?.state !== void 0) all = all.filter((record) => record.state === filter.state);
    if (filter?.batchId !== void 0) all = all.filter((record) => record.batchId === filter.batchId);
    all.sort((a, b) => b.seq - a.seq);
    return all.slice(0, Math.max(1, Math.min(200, filter?.limit ?? 20)));
  }
  /** 还有几条在跑/排队。 */
  activeCount() {
    let count = 0;
    for (const record of this.records.values()) {
      if (record.state === "queued" || record.state === "running") count += 1;
    }
    return count;
  }
  /** 清空（测试用）。 */
  clear() {
    this.records.clear();
  }
};

// src/shared/comfy/log-tail.ts
import fs14 from "node:fs";
import path14 from "node:path";
var TAIL_LINES = 200;
function readTail(file, lines = TAIL_LINES) {
  let fd;
  try {
    fd = fs14.openSync(file, "r");
    const size = fs14.fstatSync(fd).size;
    if (size === 0) return "";
    const chunk = 64 * 1024;
    let pos = size;
    let found = 0;
    const pieces = [];
    while (pos > 0 && found <= lines) {
      const readSize = Math.min(chunk, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs14.readSync(fd, buf, 0, readSize, pos);
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
        fs14.closeSync(fd);
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
  /** 上次看到的 inode。轮转后文件会被换成新的，只比大小会漏（新文件可能比旧 offset 大）。 */
  lastIno = -1;
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
      stat = fs14.statSync(this.file);
    } catch {
      this.started = false;
      this.offset = 0;
      this.lastSize = -1;
      this.lastIno = -1;
      return "";
    }
    const rotated = this.started && (stat.size < this.lastSize || this.lastIno > 0 && stat.ino > 0 && stat.ino !== this.lastIno);
    if (rotated) {
      this.started = false;
      this.offset = 0;
    }
    this.lastSize = stat.size;
    if (stat.ino > 0) this.lastIno = stat.ino;
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
      fd = fs14.openSync(this.file, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs14.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      return buf.toString("utf8");
    } catch {
      return "";
    } finally {
      if (fd !== void 0) {
        try {
          fs14.closeSync(fd);
        } catch {
        }
      }
    }
  }
  /** 探测 ComfyUI 安装目录下的日志文件路径；找不到返回 undefined。 */
  static locate(installDir) {
    if (installDir === void 0 || installDir === "") return void 0;
    const candidate = path14.join(installDir, "user", "comfyui.log");
    try {
      if (fs14.existsSync(candidate)) return candidate;
    } catch {
    }
    return void 0;
  }
};

// src/shared/authz/authorize.ts
init_paths();
import path16 from "node:path";

// src/shared/authz/legacy-paths.ts
init_paths();
init_paths();
import fs15 from "node:fs";
import path15 from "node:path";
function comfyImageOutputDir() {
  const file = path15.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs15.readFileSync(file, "utf8"));
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
    return abs === base || abs.startsWith(base.endsWith(path16.sep) ? base : base + path16.sep);
  });
}

// src/shared/authz/roots.ts
init_paths();
import fs16 from "node:fs";
import path17 from "node:path";
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
    path: settings.uploadsDir ?? path17.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path17.join(pluginDataDir(), "outputs"), kind: "output" });
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
      exists = fs16.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path17.basename(abs) || abs, kind: candidate.kind });
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

// src/runtime.ts
init_paths();

// src/shared/host/workspace.ts
init_paths();
import fs17 from "node:fs";
import path18 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs17.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
}
function cwdCandidate() {
  const cwd = process.cwd();
  if (cwd === "" || looksInternal(cwd)) return void 0;
  return cwd;
}
function workspaceDirOf(ctx) {
  return probeWorkspace(ctx).guess;
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
    return { guess: { dir: path18.resolve(explicit.trim()), source: "env" }, probe: probe2 };
  }
  try {
    const wd = ctx.get?.("workingDirectory");
    const dir = wd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") probe2.workingDirectory = dir;
    if (typeof dir === "string" && dir !== "" && !looksInternal(dir)) {
      return { guess: { dir: path18.resolve(dir), source: "workingDirectory" }, probe: probe2 };
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
    return result !== "" && !looksInternal(result) ? path18.resolve(result) : void 0;
  }
  if (result !== null && typeof result === "object") {
    const candidate = result.path ?? result.directory;
    if (typeof candidate === "string" && candidate !== "" && !looksInternal(candidate)) return path18.resolve(candidate);
  }
  return void 0;
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path18.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path18.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
init_paths();
import fs18 from "node:fs";
import path19 from "node:path";
function indexPath() {
  return path19.join(pluginDataDir(), "assets.jsonl");
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
    let text3 = "";
    try {
      text3 = fs18.readFileSync(this.file, "utf8");
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
    ensureDir(path19.dirname(this.file));
    fs18.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path19.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs18.writeFileSync(this.file, body === "" ? "" : `${body}
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
import fs23 from "node:fs";
import path24 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
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
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;
var MIME_BY_EXT = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp"
};

// src/components/panel-gallery/server/scan/collect.ts
import fs21 from "node:fs";
import path21 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs20 from "node:fs";
import path20 from "node:path";

// src/components/panel-gallery/server/scan/graph.ts
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

// src/components/panel-gallery/server/scan/png-text.ts
import fs19 from "node:fs";
import zlib2 from "node:zlib";
function readPngTextChunks2(imagePath, size) {
  if (size < 16) return void 0;
  const length = Math.min(size, PNG_META_READ_BYTES2);
  let fd;
  try {
    fd = fs19.openSync(imagePath, "r");
    const buffer = Buffer.alloc(length);
    const read = fs19.readSync(fd, buffer, 0, length, 0);
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
              value = zlib2.inflateSync(data.subarray(zero + 2)).toString("utf8");
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
    if (fd !== void 0) fs19.closeSync(fd);
  }
}

// src/components/panel-gallery/server/scan/embedded.ts
function readEmbeddedMeta(imagePath, stat) {
  if (path20.extname(imagePath).toLowerCase() !== ".png") return void 0;
  const parsed = readPngTextChunks2(imagePath, stat.size);
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
  if (path20.extname(imagePath).toLowerCase() !== ".png") return false;
  let fd;
  try {
    fd = fs20.openSync(imagePath, "r");
    const buffer = Buffer.alloc(256);
    const read = fs20.readSync(fd, buffer, 0, 256, 0);
    if (read < 64 || buffer[0] !== 137) return false;
    const head = buffer.toString("latin1", 0, read);
    return head.includes("tEXt") && head.includes("prompt");
  } catch {
    return false;
  } finally {
    if (fd !== void 0) fs20.closeSync(fd);
  }
}

// src/components/panel-gallery/server/scan/collect.ts
function collectImages(root, options) {
  const generated = [];
  const bare = [];
  let truncatedGenerated = false;
  let truncatedBare = false;
  const walk = (dir, depth) => {
    let entries;
    try {
      entries = fs21.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name2 = entry.name;
      if (!options.includeHidden && name2.startsWith(".")) continue;
      const full = path21.join(dir, name2);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name2)) continue;
        if (depth + 1 > options.maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTS.has(path21.extname(name2).toLowerCase())) continue;
      let stat;
      try {
        stat = fs21.statSync(full);
      } catch {
        continue;
      }
      const generatedFlag = fs21.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full);
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

// src/components/panel-gallery/server/scan/sidecar.ts
import fs22 from "node:fs";
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
    sidecarStat = fs22.statSync(metaPath);
  } catch {
    sidecarStat = void 0;
  }
  try {
    imageStat = fs22.statSync(imagePath);
  } catch {
    imageStat = void 0;
  }
  const sidecarKey = sidecarStat !== void 0 && sidecarStat.isFile() ? sidecarStat.mtimeMs : -1;
  const imageKey = imageStat !== void 0 ? imageStat.mtimeMs : -1;
  const cached2 = metaCache.get(imagePath);
  if (cached2 !== void 0 && cached2.sidecarMtimeMs === sidecarKey && cached2.imageMtimeMs === imageKey) {
    return cached2.meta;
  }
  let meta;
  if (sidecarStat !== void 0 && sidecarStat.isFile() && sidecarStat.size > 0 && sidecarStat.size <= SIDECAR_MAX_BYTES2) {
    try {
      const parsed = JSON.parse(fs22.readFileSync(metaPath, "utf8"));
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

// src/components/panel-gallery/server/scan/summary.ts
var PROMPT_CLIP = 1200;
var NEGATIVE_CLIP = 800;
var text2 = (value) => typeof value === "string" && value.trim() !== "" ? value : void 0;
function clip(value, max) {
  if (value === void 0) return void 0;
  return value.length > max ? `${value.slice(0, max)}\u2026` : value;
}
var num2 = (value) => typeof value === "number" && Number.isFinite(value) ? value : void 0;
function promptIdOf(meta) {
  const comfy = meta.comfy;
  if (comfy === null || typeof comfy !== "object") return void 0;
  return text2(comfy.promptId);
}
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
    promptId: promptIdOf(meta),
    workflow: meta.workflow !== void 0 && meta.workflow !== null
  };
}

// src/components/panel-gallery/server/scan/list-item.ts
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

// src/components/panel-gallery/server/scan/mime.ts
import path23 from "node:path";
function mimeOf2(filePath) {
  return MIME_BY_EXT[path23.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

// src/components/panel-gallery/server/store/rebuild.ts
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
        bytes = fs23.statSync(file.path).size;
      } catch {
      }
      out.push({
        digest: typeof meta.digest === "string" ? meta.digest : "",
        path: file.path,
        bytes,
        mime: mimeOfExt(path24.extname(file.path)),
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

// src/runtime.ts
init_run();

// src/http/router.ts
var router_exports = {};
__export(router_exports, {
  PREFIX: () => PREFIX,
  createDispatch: () => createDispatch
});

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
function pathsFromBody(body, limit) {
  const raw = body.paths;
  if (!Array.isArray(raw)) return void 0;
  const paths = raw.filter((item) => typeof item === "string" && item !== "");
  if (paths.length === 0 || paths.length > limit) return void 0;
  return paths;
}

// src/http/router.ts
var PREFIX = "/comfyui-workbench/api";
var WRITABLE = /* @__PURE__ */ new Set(["/delete", "/delete-many", "/assets/rebuild", "/run", "/service/stop", "/upload"]);
var POST_ONLY = /* @__PURE__ */ new Set(["/run", "/rerun", "/free"]);
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
      const selfManaged = sub === "/workflows" || sub.startsWith("/workflows/") || sub === "/terminal" || sub === "/config" || sub.startsWith("/tags/") || sub.startsWith("/poses/") || sub.startsWith("/costumes/");
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
    "panel.tags": !disabled.has("panel.tags"),
    "panel.poses": !disabled.has("panel.poses"),
    "panel.costumes": !disabled.has("panel.costumes"),
    "panel.terminal": !disabled.has("panel.terminal"),
    "tool.generate": !disabled.has("tool.generate"),
    "tool.workflow-edit": !disabled.has("tool.workflow-edit"),
    "tool.danbooru": !disabled.has("tool.danbooru")
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
  const shared3 = sharedOf(ctx);
  if (shared3.httpMounted) return;
  const server = ctx.get?.("webServer");
  if (server === void 0 || typeof server.register !== "function") {
    rt.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 webServer \u670D\u52A1\uFF0C\u9762\u677F\u63A5\u53E3\u672A\u6CE8\u518C\u3002");
    return;
  }
  const { createDispatch: createDispatch2, PREFIX: PREFIX3 } = router_exports;
  try {
    const dispose = server.register({ kind: "prefix", path: PREFIX3, handler: createDispatch2(ctx) });
    shared3.httpMounted = true;
    if (typeof dispose === "function" && typeof ctx.effect === "function") {
      ctx.effect(() => () => {
        shared3.httpMounted = false;
        dispose();
      }, "comfyui-workbench: http prefix");
    }
    rt.info(`[comfyui-workbench] API \u5C31\u7EEA\uFF1A${PREFIX3}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("duplicate prefix route")) throw error;
    rt.info("[comfyui-workbench] HTTP \u524D\u7F00\u5DF2\u5B58\u5728\uFF08\u91CD\u8F7D\uFF09\uFF0C\u6CBF\u7528\u73B0\u6709\u5B9E\u4F8B");
  }
}
function acquire(ctx, config) {
  const shared3 = sharedOf(ctx);
  shared3.refs += 1;
  shared3.currentCaller = ctx;
  if (shared3.current !== void 0) return shared3.current;
  shared3.httpMounted = false;
  shared3.current = create(ctx, config);
  return shared3.current;
}
function release(ctx) {
  const shared3 = sharedOf(ctx);
  shared3.current?.runs.flush();
  shared3.refs -= 1;
  if (shared3.refs > 0 || shared3.current === void 0) return;
  shared3.current.supervisor.dispose();
  stopAllWatchers();
  shared3.tables.clear();
  shared3.current = void 0;
  shared3.refs = 0;
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
    const dir = path25.join(sessionDir, "comfyui-output");
    ensureDir(dir);
    sessionOutputDirs.add(canonical(dir));
    return dir;
  };
  const terminal = new TerminalBuffer(2e3);
  const runs = new RunRegistry(outputDir);
  const supervisor = new ComfySupervisor({
    baseUrl: settings.baseUrl,
    autoDetect: settings.autoDetect,
    autoStart: settings.autoStart,
    ...settings.startCommand.length === 0 ? {} : { startCommand: settings.startCommand },
    readyTimeoutMs: settings.readyTimeoutMs,
    idleShutdownMs: settings.idleShutdownMs,
    logger,
    onOutput: (stream, text3) => terminal.push(stream, text3)
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
      const sessionOutput = canonical(path25.join(sessionDir, "comfyui-output"));
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
    runs,
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

// src/entries/edit.ts
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
function apply2(ctx, config) {
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
    runs: rt.runs,
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

// src/components/panel-gallery/server/routes.ts
import fs27 from "node:fs";
import path29 from "node:path";
init_paths();

// src/components/panel-gallery/server/assets/scan-cache.ts
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

// src/components/panel-gallery/server/assets/service.ts
import fs25 from "node:fs";
import path27 from "node:path";
init_paths();

// src/components/panel-gallery/server/assets/dedupe.ts
function looseKey(item) {
  if (typeof item.seed !== "number") return void 0;
  const prompt = typeof item.prompt === "string" ? item.prompt.trim() : "";
  if (prompt === "") return void 0;
  return `${item.seed}|${item.width ?? 0}x${item.height ?? 0}|${prompt}`;
}
function promptIdOf2(item) {
  return typeof item.promptId === "string" && item.promptId !== "" ? item.promptId : void 0;
}
function mergeGroup(members) {
  const sorted = members.slice().sort((a, b) => {
    const bySource = (a.metaSource === "sidecar" ? 0 : 1) - (b.metaSource === "sidecar" ? 0 : 1);
    if (bySource !== 0) return bySource;
    const byDepth = a.path.length - b.path.length;
    if (byDepth !== 0) return byDepth;
    return b.mtime - a.mtime;
  });
  const first = sorted[0];
  const primary = { ...first };
  if (sorted.length > 1) {
    primary.duplicateCount = sorted.length;
    primary.duplicates = sorted.slice(1, 21).map((other) => other.path);
  }
  return primary;
}
function dedupeItems(items) {
  const buckets = /* @__PURE__ */ new Map();
  const order = [];
  for (const item of items) {
    const key = looseKey(item);
    if (key === void 0) {
      order.push({ kind: "single", item });
      continue;
    }
    let bucket = buckets.get(key);
    if (bucket === void 0) {
      bucket = { key, members: [] };
      buckets.set(key, bucket);
      order.push({ kind: "bucket", bucket });
    }
    bucket.members.push(item);
  }
  const result = [];
  const emitted = /* @__PURE__ */ new Set();
  for (const entry of order) {
    if (entry.kind === "single") {
      result.push(entry.item);
      continue;
    }
    const { bucket } = entry;
    const pids = /* @__PURE__ */ new Set();
    for (const member of bucket.members) {
      const pid = promptIdOf2(member);
      if (pid !== void 0) pids.add(pid);
    }
    if (pids.size <= 1) {
      if (emitted.has(bucket.key)) continue;
      emitted.add(bucket.key);
      result.push(mergeGroup(bucket.members));
      continue;
    }
    const byPid = /* @__PURE__ */ new Map();
    for (const member of bucket.members) {
      const pid = promptIdOf2(member);
      if (pid === void 0) continue;
      const list = byPid.get(pid) ?? [];
      list.push(member);
      byPid.set(pid, list);
    }
    for (const member of bucket.members) {
      const pid = promptIdOf2(member);
      if (pid === void 0) {
        result.push(member);
        continue;
      }
      if (emitted.has(pid)) continue;
      emitted.add(pid);
      result.push(mergeGroup(byPid.get(pid) ?? [member]));
    }
  }
  return result;
}

// src/components/panel-gallery/server/assets/thumbs.ts
init_paths();
import crypto5 from "node:crypto";
import fs24 from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path26 from "node:path";
import { pathToFileURL } from "node:url";

// src/components/panel-gallery/server/assets/paths.ts
init_paths();

// src/components/panel-gallery/server/assets/thumbs.ts
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
    if (home !== "") bases.push(path26.join(home, ".dsh", "profiles"));
    bases.push(path26.join(path26.dirname(process.execPath), "node_modules", "@deepseek-ai", "dsh"));
    for (const base of bases) {
      try {
        const req = createRequire(path26.join(base, "package.json"));
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
  return path26.join(os.tmpdir(), "dsh-comfyui-workbench-thumbs");
}
function thumbPathFor(target, stat) {
  const key = crypto5.createHash("sha1").update(`${foldPathCase(target)}|${stat.mtimeMs}|${stat.size}|${THUMB_EDGE}`).digest("hex");
  return path26.join(thumbDir(), `${key}.webp`);
}
async function ensureThumb(target, stat) {
  const sharp = await loadSharp();
  if (sharp === null) return void 0;
  const dir = thumbDir();
  const file = thumbPathFor(target, stat);
  try {
    if (fs24.statSync(file).size > 0) return file;
  } catch {
  }
  try {
    fs24.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await sharp(target, { animated: false, limitInputPixels: 268435456 }).rotate().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(temp);
    fs24.renameSync(temp, file);
    return file;
  } catch {
    return void 0;
  }
}

// src/components/panel-gallery/server/assets/service.ts
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
  const seenPaths = /* @__PURE__ */ new Set();
  for (const root of targets) {
    const scanned = scanRoot(root.path, settings, query.refresh);
    truncated = truncated || scanned.truncated;
    for (const file of scanned.files) {
      const key = foldPathCase(file.path);
      if (seenPaths.has(key)) continue;
      seenPaths.add(key);
      merged.push({ file, label: root.label });
    }
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
  if (!IMAGE_EXTS.has(path27.extname(target).toLowerCase())) {
    return { target, removed: [], error: "\u53EA\u80FD\u5220\u9664\u56FE\u7247\uFF0C\u8DEF\u5F84\u770B\u8D77\u6765\u4E0D\u662F\u56FE\u7247\u3002", code: "not-an-image" };
  }
  let stat;
  try {
    stat = fs25.statSync(target);
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
    fs25.unlinkSync(target);
    removed.push(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { target, removed, error: `\u5220\u9664\u5931\u8D25\uFF1A${message}`, code: "delete-failed" };
  }
  try {
    if (fs25.existsSync(sidecar)) {
      fs25.unlinkSync(sidecar);
      removed.push(sidecar);
    }
  } catch {
  }
  try {
    fs25.unlinkSync(thumb);
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
    const base = path27.basename(one, path27.extname(one));
    let name2 = `${base}.workflow.json`;
    for (let i = 2; used.has(name2); i += 1) name2 = `${base}-${i}.workflow.json`;
    used.add(name2);
    entries.push({ name: name2, data: Buffer.from(`${JSON.stringify(workflow, null, 2)}
`, "utf8") });
  }
  return { entries, skipped };
}

// src/components/panel-gallery/server/assets/zip.ts
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

// src/components/panel-gallery/server/upload-api.ts
init_paths();
import crypto6 from "node:crypto";
import fs26 from "node:fs";
import path28 from "node:path";
var MAX_UPLOAD_BYTES = 16 * 1024 * 1024;
var MIME_BY_EXT2 = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".avif": "image/avif",
  ".bmp": "image/bmp"
};
async function readRawBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) throw new Error(`\u6587\u4EF6\u8D85\u8FC7 ${Math.round(limit / 1024 / 1024)} MB`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}
function safeName(filename, ext) {
  const base = path28.basename(filename, path28.extname(filename));
  const cleaned = base.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `${cleaned === "" ? "image" : cleaned}${ext}`;
}
function createUploadHandler(uploadsDir) {
  return async (url, res, req) => {
    const filename = url.searchParams.get("filename") ?? "";
    const ext = path28.extname(filename).toLowerCase() || ".png";
    const mime = MIME_BY_EXT2[ext];
    if (mime === void 0) {
      sendJson(res, 400, {
        ok: false,
        error: "unsupported-type",
        message: `\u4E0D\u652F\u6301\u7684\u56FE\u7247\u683C\u5F0F\uFF1A${ext || "(\u65E0\u6269\u5C55\u540D)"}\u3002\u652F\u6301 ${Object.keys(MIME_BY_EXT2).join(" / ")}`
      });
      return;
    }
    let bytes;
    try {
      bytes = await readRawBody(req, MAX_UPLOAD_BYTES);
    } catch (error) {
      sendJson(res, 413, { ok: false, error: "too-large", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    if (bytes.length === 0) {
      sendJson(res, 400, { ok: false, error: "empty", message: "\u6587\u4EF6\u662F\u7A7A\u7684\u3002" });
      return;
    }
    const looksImage = bytes[0] === 137 && bytes[1] === 80 || // PNG
    bytes[0] === 255 && bytes[1] === 216 || // JPEG
    bytes.toString("ascii", 0, 4) === "RIFF" || // WEBP
    bytes.toString("ascii", 0, 3) === "GIF" || // GIF
    bytes.toString("ascii", 4, 8) === "ftyp";
    if (!looksImage) {
      sendJson(res, 400, { ok: false, error: "not-an-image", message: "\u6587\u4EF6\u5185\u5BB9\u4E0D\u50CF\u56FE\u7247\u3002" });
      return;
    }
    ensureDir(uploadsDir);
    const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const digest = crypto6.createHash("sha1").update(bytes).digest("hex").slice(0, 8);
    const target = path28.join(uploadsDir, `${stamp}-${digest}-${safeName(filename, ext)}`);
    try {
      fs26.writeFileSync(target, bytes);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: "write-failed", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const result = { ok: true, path: target, bytes: bytes.length, mime, name: path28.basename(target) };
    if (ext === ".png") {
      const parsed = readPngTextChunks2(target, bytes.length);
      if (parsed !== void 0 && parsed.width > 0 && parsed.height > 0) {
        result.width = parsed.width;
        result.height = parsed.height;
      }
    }
    sendJson(res, 200, result);
  };
}

// src/components/panel-gallery/server/routes.ts
function createGalleryRoutes(deps) {
  const { ctx, settings, index, uploadsDir, defaultOutputDir } = deps;
  const roots = () => {
    const base = rootsOf(ctx, { ...settings, resolvedOutputDir: defaultOutputDir });
    const extras = deps.extraRoots?.() ?? [];
    const seen = new Set(base.map((root) => foldPathCase(root.path)));
    const merged = [...base];
    for (const dir of extras) {
      if (dir === "") continue;
      const key = foldPathCase(dir);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({ path: dir, label: "session-output", kind: "workspace" });
    }
    return merged;
  };
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
    const filename = `${path29.basename(target, path29.extname(target))}.workflow.json`;
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
      stat = fs27.statSync(target);
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
          const thumbStat = fs27.statSync(thumb);
          res.writeHead(200, {
            "Content-Type": "image/webp",
            "Content-Length": thumbStat.size,
            "Cache-Control": "private, max-age=86400"
          });
          const thumbStream = fs27.createReadStream(thumb);
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
      "Content-Type": mimeOf2(target),
      "Content-Length": stat.size,
      "Cache-Control": "private, max-age=86400"
    });
    const stream = fs27.createReadStream(target);
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
  return {
    "/assets": handleAssets,
    "/assets/rebuild": handleRebuild,
    "/roots": handleRoots,
    "/items": handleItems,
    "/meta": handleMeta,
    "/workflow": handleWorkflow,
    "/file": handleFile,
    "/delete": handleDelete,
    "/delete-many": handleDeleteMany,
    "/upload": createUploadHandler(uploadsDir),
    // 导出的实现在相册这边（要读图、sidecar、打包），但**不挂在相册的路由表里**：
    // 同一路径的 GET（列表）属于工作流组件，两边都注册会互相覆盖。
    // 相册 entry 取出它交给 runtime，工作流组件的 POST /workflows 转发过来。
    "/workflows": handleWorkflows
  };
}

// src/entries/gallery.ts
function warnDisabled2(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
function apply3(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.gallery")) {
    warnDisabled2("panel.gallery");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "gallery: runtime");
  ensureHttp(ctx, rt);
  const table = createGalleryRoutes({
    ctx,
    settings: rt.settings,
    index: rt.index,
    uploadsDir: rt.uploadsDir,
    defaultOutputDir: rt.outputDir,
    extraRoots: () => [...rt.sessionOutputDirs]
  });
  const { ["/workflows"]: exporter, ...exact } = table;
  rt.exportWorkflows = exporter;
  if (typeof ctx.effect === "function") {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, "panel.gallery", { exact });
      return () => {
        rt.exportWorkflows = void 0;
        unmount();
      };
    }, "gallery: routes");
  } else {
    mountRoutes(ctx, "panel.gallery", { exact });
  }
  rt.info("[comfyui-workbench] \u76F8\u518C\u5DF2\u4E0A\u7EBF");
}

// src/entries/generate.ts
function warnDisabled3(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
function apply4(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("tool.generate")) {
    warnDisabled3("tool.generate");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "generate: runtime");
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    rt.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u751F\u56FE\u5DE5\u5177\u672A\u6CE8\u518C\u3002");
    return;
  }
  const report = registerTools(TOOL_GROUPS, {
    client: rt.client,
    workflowsDir: rt.flowDir,
    outputDir: rt.outputDir,
    resolveOutputDirFor: rt.resolveOutputDirFor,
    timeoutMs: rt.settings.timeoutMs,
    pollIntervalMs: rt.settings.pollIntervalMs,
    overrides: /* @__PURE__ */ new Map(),
    runs: rt.runs,
    index: rt.index,
    assertWritable: rt.assertWritable,
    // 惰性取：姿势库/衣装库的 apply 可能晚于本 entry
    getMaterials: () => rt.materials,
    logger: rt.logger
  }, {
    enabled: TOOL_GROUPS.filter((group) => group.component === "tool.generate").map((group) => group.name),
    register: (spec) => rt.track(tools.register(spec)),
    warn: rt.warn
  });
  rt.tools.registered.push(...report.registered);
  rt.tools.failed.push(...report.failed);
  rt.tools.skipped.push(...report.skipped);
  for (const failure of report.failed) rt.warn(`[comfyui-workbench] \u5DE5\u5177 ${failure.name} \u672A\u6CE8\u518C\uFF1A${failure.message}`);
  rt.info(`[comfyui-workbench] \u751F\u56FE\u5DE5\u5177\u5DF2\u6CE8\u518C ${report.registered.length} \u4E2A`);
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

// src/entries/terminal.ts
function warnDisabled4(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
function apply5(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.terminal")) {
    warnDisabled4("panel.terminal");
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

// src/entries/tags.ts
import fs29 from "node:fs";
import path30 from "node:path";

// src/components/panel-tags/server/api.ts
import fs28 from "node:fs";
var MAX_LIMIT = 100;
var DEFAULT_LIMIT = 50;
function createTagsIndex(dataDir) {
  let records = null;
  let index = null;
  let groups = null;
  let map = null;
  let stats = null;
  let stamp = "";
  const stampOf = () => {
    const files = [
      ...TAG_KINDS.map((kind) => storePath(dataDir, kind)),
      groupsPath(dataDir),
      categoryMapPath(dataDir)
    ];
    return files.map((file) => {
      try {
        const stat = fs28.statSync(file);
        return `${stat.mtimeMs}:${stat.size}`;
      } catch {
        return "-";
      }
    }).join("|");
  };
  const reset = () => {
    records = null;
    index = null;
    groups = null;
    map = null;
    stats = null;
  };
  const ensure = () => {
    const now = stampOf();
    if (now !== stamp) {
      stamp = now;
      reset();
    }
    if (records === null || index === null || groups === null || map === null) {
      const loaded = [];
      for (const kind of TAG_KINDS) loaded.push(...readStore(storePath(dataDir, kind)));
      records = loaded;
      index = new TagIndex(loaded);
      groups = readGroups(dataDir);
      map = readCategoryMap(dataDir);
    }
    return { records, index, groups, map };
  };
  const categoryOfTag = (tag, groups2, map2) => categoryOf(groups2.get(tag) ?? [], map2);
  return {
    search: (options) => {
      const { index: idx, groups: groupMap, map: categoryMap } = ensure();
      const query = (options.query ?? "").trim();
      const kind = options.kind ?? "";
      const category = options.category ?? "";
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0);
      const candidates = query === "" ? ensure().records : idx.search(query, Number.MAX_SAFE_INTEGER).map((match) => match.record);
      const filtered = candidates.filter((record) => {
        if (kind !== "" && record.kind !== kind) return false;
        if (category !== "") return categoryOfTag(record.tag, groupMap, categoryMap) === category;
        return true;
      });
      if (query === "") filtered.sort((a, b) => b.postCount - a.postCount);
      return {
        total: filtered.length,
        items: filtered.slice(offset, offset + limit).map((record) => toHit(record, groupMap, categoryMap))
      };
    },
    stats: () => {
      const { records: all, groups: groupMap, map: categoryMap } = ensure();
      if (stats !== null) return stats;
      const kinds = {};
      const categories = {};
      for (const record of all) {
        kinds[record.kind] = (kinds[record.kind] ?? 0) + 1;
        const category = categoryOfTag(record.tag, groupMap, categoryMap);
        categories[category] = (categories[category] ?? 0) + 1;
      }
      stats = { kinds, categories, labels: categoryMap.labels, total: all.length };
      return stats;
    },
    invalidate: () => {
      reset();
      stamp = "";
    }
  };
}
function toHit(record, groups, map) {
  const groupList = groups.get(record.tag) ?? [];
  return {
    tag: record.tag,
    kind: record.kind,
    postCount: record.postCount,
    zh: record.names[0] ?? "",
    aliases: record.names.slice(1, 4),
    category: categoryOf(groupList, map),
    groups: groupList
  };
}

// src/components/panel-tags/server/routes.ts
function createTagsRoutes(index, job) {
  return {
    exact: {
      // 「更新标签」：POST 开跑、GET 轮进度。两分多钟的活不能同步等。
      ...job === void 0 ? {} : {
        "/tags/sync": (_url, res, req) => {
          if (req.method === "POST") {
            sendJson(res, 200, { ok: true, ...job.start() });
            return;
          }
          if (req.method === "GET" || req.method === "HEAD") {
            sendJson(res, 200, { ok: true, ...job.status() });
            return;
          }
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 POST\uFF08\u5F00\u59CB\uFF09\u4E0E GET\uFF08\u67E5\u8FDB\u5EA6\uFF09\u3002" });
        }
      },
      "/tags": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u6807\u7B7E\u9762\u677F\u662F\u53EA\u8BFB\u7684\uFF0C\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const params = url.searchParams;
        try {
          const result = index.search({
            query: params.get("q") ?? "",
            kind: params.get("kind") ?? "",
            category: params.get("category") ?? "",
            ...params.get("offset") === null ? {} : { offset: Number(params.get("offset")) },
            ...params.get("limit") === null ? {} : { limit: Number(params.get("limit")) }
          });
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: "index-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      },
      "/tags/stats": (_url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u6807\u7B7E\u9762\u677F\u662F\u53EA\u8BFB\u7684\uFF0C\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        try {
          sendJson(res, 200, { ok: true, ...index.stats() });
        } catch (error) {
          sendJson(res, 500, {
            ok: false,
            error: "index-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
  };
}

// src/components/panel-tags/server/sync-job.ts
function idle() {
  return {
    state: "idle",
    stage: "",
    done: 0,
    total: 0,
    message: "",
    startedAt: 0,
    finishedAt: 0,
    lastSuccessAt: 0,
    results: [],
    groups: null
  };
}
function createSyncJob(options) {
  let current = idle();
  const runCsv = options.runCsv ?? ((kind, log) => importUpstream(kind, { dataDir: options.dataDir, log }));
  const runGroups = options.runGroups ?? ((log) => syncGroups({ dataDir: options.dataDir, log }));
  const start = () => {
    if (current.state === "running") return current;
    current = { ...idle(), state: "running", stage: "\u51C6\u5907\u4E2D\u2026", startedAt: Date.now() };
    void (async () => {
      const results = [];
      try {
        for (const [index, kind] of TAG_KINDS.entries()) {
          current = {
            ...current,
            stage: `\u4E0B\u8F7D ${UPSTREAM_FILES[kind]}`,
            // `done` 是"已完成几个"，不是"正在下第几个"——用 index 的话四类永远到不了 4/4
            done: index,
            total: TAG_KINDS.length
          };
          const result = await runCsv(kind, (message) => {
            current = { ...current, stage: message };
          });
          results.push({ kind, records: result.records, withNames: result.withNames });
          current = { ...current, done: index + 1 };
        }
        current = { ...current, stage: "\u6293\u53D6\u8BED\u4E49\u5206\u7EC4\uFF08wiki\uFF09", done: 0, total: 0 };
        const groups = await runGroups((message) => {
          current = { ...current, stage: message };
        });
        const failed = groups.failed;
        if (groups.fromCache) {
          current = {
            ...current,
            state: "failed",
            stage: "\u5206\u7EC4\u6293\u53D6\u5168\u90E8\u5931\u8D25",
            message: "\u5206\u7EC4\u9875\u9762\u4E00\u4E2A\u90FD\u6CA1\u6293\u5230\uFF0C\u5DF2\u4FDD\u7559\u65E7\u5FEB\u7167 \u2014\u2014 \u6570\u636E\u6CA1\u6709\u4EFB\u4F55\u53D8\u5316\u3002",
            finishedAt: Date.now(),
            results,
            groups: { groups: groups.groups, tags: groups.tags, failed, fromCache: true }
          };
        } else {
          current = {
            ...current,
            state: failed.length === 0 ? "done" : "failed",
            stage: failed.length === 0 ? "\u5B8C\u6210" : "\u5206\u7EC4\u6709\u9875\u9762\u6293\u53D6\u5931\u8D25\uFF08\u5DF2\u7528\u65E7\u5FEB\u7167\u8865\u56DE\uFF09",
            message: failed.length === 0 ? "" : `\u8FD9\u4E9B\u7EC4\u6CA1\u6293\u5230\uFF1A${failed.join(" / ")}`,
            finishedAt: Date.now(),
            lastSuccessAt: Date.now(),
            results,
            groups: { groups: groups.groups, tags: groups.tags, failed, fromCache: false }
          };
        }
      } catch (error) {
        const done = results.map((item) => `${item.kind} ${item.records}`).join(" / ");
        current = {
          ...current,
          state: "failed",
          stage: "\u5931\u8D25",
          message: `${error instanceof Error ? error.message : String(error)}` + (done === "" ? "\uFF08\u4E00\u4E2A\u6587\u4EF6\u90FD\u6CA1\u5199\uFF09" : `\uFF08\u5DF2\u5199\u5165\uFF1A${done}\uFF1B\u5176\u4F59\u4ECD\u662F\u65E7\u6570\u636E\uFF09`),
          finishedAt: Date.now(),
          results
        };
      } finally {
        options.onSettled?.();
      }
    })();
    return current;
  };
  return { start, status: () => current };
}

// src/entries/tags.ts
init_paths();
var singleton = null;
function sharedJob(dataDir, onSettled) {
  if (singleton !== null && singleton.dataDir === dataDir) return singleton.job;
  const job = createSyncJob({ dataDir, onSettled });
  singleton = { dataDir, job };
  return job;
}
function recordFailure(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = pluginDataDir();
    fs29.mkdirSync(dir, { recursive: true });
    fs29.writeFileSync(path30.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] tags entry
${message}
`, "utf8");
  } catch {
  }
}
function apply6(ctx, config) {
  try {
    applyInner(ctx, config);
  } catch (error) {
    recordFailure(error);
    throw error;
  }
}
function applyInner(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.tags")) {
    console.warn("[comfyui-workbench] \u7EC4\u4EF6 panel.tags \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002");
    return;
  }
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "tags: runtime");
  ensureHttp(ctx, rt);
  const dataDir = pluginDataDir();
  const index = createTagsIndex(dataDir);
  const job = sharedJob(dataDir, () => index.invalidate());
  const routes = createTagsRoutes(index, job);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => mountRoutes(ctx, "panel.tags", { exact: routes.exact }), "tags: routes");
  } else {
    mountRoutes(ctx, "panel.tags", { exact: routes.exact });
  }
  rt.info("[comfyui-workbench] \u6807\u7B7E\u5E93\u9762\u677F\u5DF2\u4E0A\u7EBF");
}

// src/entries/poses.ts
import fs32 from "node:fs";
import path33 from "node:path";

// src/components/panel-poses/server/catalog.ts
import fs30 from "node:fs";
import path31 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var MAX_LIMIT2 = 100;
var DEFAULT_LIMIT2 = 40;
function bundledCatalogPath(fromUrl = import.meta.url) {
  let dir = path31.dirname(fileURLToPath2(fromUrl));
  for (let i = 0; i < 8; i += 1) {
    if (fs30.existsSync(path31.join(dir, "package.json")) && fs30.existsSync(path31.join(dir, "data"))) {
      return path31.join(dir, "data", "poses", "catalog.json");
    }
    const parent = path31.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path31.join(path31.dirname(fileURLToPath2(fromUrl)), "..", "..", "..", "data", "poses", "catalog.json");
}
function readCatalog(file) {
  const raw = fs30.readFileSync(file, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed.poses) || parsed.poses.length === 0) throw new Error(`\u59FF\u52BF\u76EE\u5F55\u4E3A\u7A7A\u6216\u683C\u5F0F\u4E0D\u5BF9\uFF1A${file}`);
  return parsed;
}
function createPosesIndex(dataDir, bundledFile) {
  const bundled = bundledFile ?? bundledCatalogPath();
  let catalog = null;
  let byPose = /* @__PURE__ */ new Map();
  let byView = /* @__PURE__ */ new Map();
  let stats = null;
  let stamp = "";
  const fileOf2 = () => {
    const own = path31.join(dataDir, "poses", "catalog.json");
    return fs30.existsSync(own) ? own : bundled;
  };
  const stampOf = () => {
    try {
      const stat = fs30.statSync(fileOf2());
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "-";
    }
  };
  const reset = () => {
    catalog = null;
    byPose = /* @__PURE__ */ new Map();
    byView = /* @__PURE__ */ new Map();
    stats = null;
  };
  const ensure = () => {
    const now = stampOf();
    if (now !== stamp) {
      stamp = now;
      reset();
    }
    if (catalog === null) {
      const loaded = readCatalog(fileOf2());
      catalog = loaded;
      for (const pose of loaded.poses) {
        byPose.set(pose.id, pose);
        for (const view2 of pose.views) byView.set(view2.id, { pose, view: view2 });
      }
    }
    return catalog;
  };
  const hitOf = (pose) => {
    const cover = pose.views.find((view2) => view2.angleId === "front") ?? pose.views[0];
    if (cover === void 0) throw new Error(`\u59FF\u52BF ${pose.id} \u6CA1\u6709\u4EFB\u4F55\u89D2\u5EA6\uFF0C\u76EE\u5F55\u6570\u636E\u574F\u4E86`);
    return {
      id: pose.id,
      name: pose.name,
      system: pose.system,
      systemId: pose.systemId,
      code: pose.code,
      category: pose.category,
      adult: pose.adult,
      viewCount: pose.views.length,
      angleIds: pose.views.map((view2) => view2.angleId),
      cover: { viewId: cover.id, thumb: cover.thumb, full: cover.full, angle: cover.angle }
    };
  };
  const matches = (pose, parts) => {
    if (parts.length === 0) return true;
    const hay = `${pose.name} ${pose.code} ${pose.category} ${pose.system} ${pose.id}`.toLowerCase();
    return parts.every((part) => hay.includes(part));
  };
  return {
    search: (options) => {
      const loaded = ensure();
      const query = (options.query ?? "").trim().toLowerCase();
      const parts = query === "" ? [] : query.split(/\s+/).filter(Boolean);
      const systemId = options.systemId ?? "";
      const category = options.category ?? "";
      const onlySafe = options.onlySafe === true;
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT2) || DEFAULT_LIMIT2, 1), MAX_LIMIT2);
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0);
      const filtered = [];
      for (const pose of loaded.poses) {
        if (onlySafe && pose.adult) continue;
        if (systemId !== "" && pose.systemId !== systemId) continue;
        if (category !== "" && pose.category !== category) continue;
        if (!matches(pose, parts)) continue;
        filtered.push(pose);
      }
      return {
        total: filtered.length,
        items: filtered.slice(offset, offset + limit).map(hitOf)
      };
    },
    stats: () => {
      const loaded = ensure();
      if (stats !== null) return stats;
      stats = {
        systems: loaded.systems,
        categories: loaded.categories,
        poseCount: loaded.poseCount,
        viewCount: loaded.viewCount,
        adultPoseCount: loaded.adultPoseCount,
        safePoseCount: loaded.poses.filter((pose) => !pose.adult).length,
        attribution: loaded.attribution,
        source: loaded.source,
        origin: loaded.origin
      };
      return stats;
    },
    get: (id) => {
      ensure();
      return byPose.get(id);
    },
    findView: (id) => {
      ensure();
      const direct = byView.get(id);
      if (direct !== void 0) return direct;
      const pose = byPose.get(id);
      if (pose === void 0) return void 0;
      const view2 = pose.views.find((item) => item.angleId === "front") ?? pose.views[0];
      return view2 === void 0 ? void 0 : { pose, view: view2 };
    },
    invalidate: () => {
      reset();
      stamp = "";
    }
  };
}

// src/components/panel-poses/server/images.ts
import fs31 from "node:fs";
import path32 from "node:path";
var SAFE_PATH = /^(thumbs|img)\/[A-Za-z0-9_]+\.(jpg|png)$/;
var MIN_BYTES = 32;
var MAX_BYTES = 8e6;
var MEMORY_LIMIT = 32;
var DISK_LIMIT_BYTES = 256 * 1024 * 1024;
var FAIL_THRESHOLD = 3;
var COOLDOWN_MS = 3e4;
function mediaTypeOf(buffer) {
  if (buffer.length >= 8 && buffer[0] === 137 && buffer[1] === 80 && buffer[2] === 78 && buffer[3] === 71) return "image/png";
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length >= 12 && buffer[0] === 82 && buffer[1] === 73 && buffer[2] === 70 && buffer[3] === 70 && buffer[8] === 87 && buffer[9] === 69 && buffer[10] === 66 && buffer[11] === 80) return "image/webp";
  return void 0;
}
function createImageCache(options) {
  const { cacheDir, origin, fetchImpl = fetch, now = Date.now } = options;
  const memoryLimit = options.memoryLimit ?? MEMORY_LIMIT;
  const diskLimitBytes = options.diskLimitBytes ?? DISK_LIMIT_BYTES;
  const pathPattern = options.pathPattern ?? SAFE_PATH;
  const cacheSubdirs = options.cacheSubdirs ?? ["thumbs", "img"];
  if (!/^https:\/\//.test(origin)) throw new Error(`\u56FE\u5E8A\u5730\u5740\u5FC5\u987B\u662F https\uFF1A${origin}`);
  const memory = /* @__PURE__ */ new Map();
  const inflight = /* @__PURE__ */ new Map();
  let failures = 0;
  let lastFailureAt = 0;
  let cooldownUntil = 0;
  const diskPathOf = (relativePath) => path32.join(cacheDir, relativePath);
  const remember = (key, value) => {
    if (memory.has(key)) memory.delete(key);
    memory.set(key, value);
    while (memory.size > memoryLimit) {
      const oldest = memory.keys().next().value;
      if (oldest === void 0) break;
      memory.delete(oldest);
    }
  };
  const readDisk = (relativePath) => {
    try {
      const file = diskPathOf(relativePath);
      const buffer = fs31.readFileSync(file);
      const mediaType = mediaTypeOf(buffer);
      if (mediaType === void 0 || buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return void 0;
      const stamp = /* @__PURE__ */ new Date();
      try {
        fs31.utimesSync(file, stamp, stamp);
      } catch {
      }
      return { mediaType, buffer, from: "disk" };
    } catch {
      return void 0;
    }
  };
  const pruneDisk = () => {
    const files = [];
    for (const sub of cacheSubdirs) {
      const dir = path32.join(cacheDir, sub);
      let names = [];
      try {
        names = fs31.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name2 of names) {
        const file = path32.join(dir, name2);
        try {
          const stat = fs31.statSync(file);
          if (stat.isFile()) files.push({ file, size: stat.size, at: stat.atimeMs });
        } catch {
        }
      }
    }
    const total = files.reduce((sum, item) => sum + item.size, 0);
    if (total <= diskLimitBytes) return;
    files.sort((a, b) => a.at - b.at);
    let left = total;
    for (const item of files) {
      if (left <= diskLimitBytes) break;
      try {
        fs31.unlinkSync(item.file);
        left -= item.size;
      } catch {
      }
    }
  };
  const download = async (relativePath) => {
    if (!pathPattern.test(relativePath)) throw new Error("\u56FE\u7247\u8DEF\u5F84\u65E0\u6548");
    const cached2 = readDisk(relativePath);
    if (cached2 !== void 0) {
      remember(relativePath, cached2);
      return cached2;
    }
    const stampNow = now();
    if (cooldownUntil > stampNow) {
      throw new Error(`\u56FE\u5E8A\u6682\u65F6\u8BFB\u4E0D\u5230\uFF08\u51B7\u5374 ${Math.ceil((cooldownUntil - stampNow) / 1e3)} \u79D2\uFF09`);
    }
    const noteFailure = () => {
      const at = now();
      failures = at - lastFailureAt > COOLDOWN_MS ? 1 : failures + 1;
      lastFailureAt = at;
      if (failures >= FAIL_THRESHOLD) cooldownUntil = at + COOLDOWN_MS;
    };
    let response;
    try {
      response = await fetchImpl(`${origin}/${relativePath}`, {
        signal: AbortSignal.timeout(2e4),
        redirect: "error"
      });
    } catch (error) {
      noteFailure();
      throw error;
    }
    if (!response.ok) {
      noteFailure();
      throw new Error(`\u56FE\u7247\u6682\u65F6\u8BFB\u4E0D\u5230\uFF08${response.status}\uFF09`);
    }
    const declared = Number(response.headers.get("content-length") ?? "");
    if (Number.isFinite(declared) && declared > MAX_BYTES) {
      noteFailure();
      throw new Error(`\u56FE\u7247\u5927\u5C0F\u5F02\u5E38\uFF08\u58F0\u660E ${declared} \u5B57\u8282\uFF09`);
    }
    const buffer = await (async () => {
      const body = response.body;
      if (body === null) return Buffer.from(await response.arrayBuffer());
      const reader = body.getReader();
      const chunks = [];
      let total = 0;
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done === true) break;
        if (value !== void 0) {
          total += value.byteLength;
          if (total > MAX_BYTES) {
            await reader.cancel();
            throw new Error("\u56FE\u7247\u5927\u5C0F\u5F02\u5E38");
          }
          chunks.push(Buffer.from(value));
        }
      }
      return Buffer.concat(chunks);
    })();
    if (buffer.length < MIN_BYTES) {
      noteFailure();
      throw new Error("\u56FE\u7247\u5927\u5C0F\u5F02\u5E38");
    }
    const mediaType = mediaTypeOf(buffer);
    if (mediaType === void 0) throw new Error("\u56FE\u7247\u4E0D\u662F PNG/JPEG/WebP");
    failures = 0;
    lastFailureAt = 0;
    cooldownUntil = 0;
    try {
      const file = diskPathOf(relativePath);
      fs31.mkdirSync(path32.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs31.writeFileSync(temp, buffer);
      fs31.renameSync(temp, file);
      setImmediate(pruneDisk);
    } catch {
    }
    return { mediaType, buffer, from: "network" };
  };
  const fetchImage = async (relativePath) => {
    const hit = memory.get(relativePath);
    if (hit !== void 0) {
      remember(relativePath, hit);
      return hit;
    }
    const running = inflight.get(relativePath);
    if (running !== void 0) return running;
    const task = download(relativePath).then((value) => {
      remember(relativePath, value);
      return value;
    }).finally(() => {
      inflight.delete(relativePath);
    });
    inflight.set(relativePath, task);
    return task;
  };
  return {
    fetch: fetchImage,
    materialize: async (relativePath, dir) => {
      const image = await fetchImage(relativePath);
      const file = path32.join(dir, path32.basename(relativePath));
      fs31.mkdirSync(dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs31.writeFileSync(temp, image.buffer);
      fs31.renameSync(temp, file);
      return { file, mediaType: image.mediaType };
    },
    stats: () => {
      let diskFiles = 0;
      let diskBytes = 0;
      for (const sub of cacheSubdirs) {
        const dir = path32.join(cacheDir, sub);
        let names = [];
        try {
          names = fs31.readdirSync(dir);
        } catch {
          continue;
        }
        for (const name2 of names) {
          try {
            const stat = fs31.statSync(path32.join(dir, name2));
            if (stat.isFile()) {
              diskFiles += 1;
              diskBytes += stat.size;
            }
          } catch {
          }
        }
      }
      return {
        memoryEntries: memory.size,
        diskFiles,
        diskBytes,
        cooldownRemainingMs: Math.max(0, cooldownUntil - now())
      };
    }
  };
}
var createPoseImages = createImageCache;

// src/components/panel-poses/server/routes.ts
var MAX_BODY = 4 * 1024;
async function readJson2(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY) throw new Error("\u8BF7\u6C42\u8FC7\u5927");
    chunks.push(buffer);
  }
  const text3 = Buffer.concat(chunks).toString("utf8");
  if (text3.trim() === "") return {};
  const parsed = JSON.parse(text3);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("\u8BF7\u6C42\u4F53\u8981\u662F JSON \u5BF9\u8C61");
  return parsed;
}
function createPosesRoutes(deps) {
  const { index, images, uploadsDir } = deps;
  return {
    exact: {
      "/poses": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u59FF\u52BF\u5E93\u662F\u53EA\u8BFB\u7684\uFF0C\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const params = url.searchParams;
        try {
          const result = index.search({
            query: params.get("q") ?? "",
            systemId: params.get("system") ?? "",
            category: params.get("category") ?? "",
            // 默认全给；`safe=1` 才收窄到常规。筛选是使用者的选择，不是插件的默认动作。
            onlySafe: params.get("safe") === "1" || params.get("safe") === "true",
            limit: Number(params.get("limit") ?? "") || void 0,
            offset: Number(params.get("offset") ?? "") || void 0
          });
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "index-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/poses/stats": (_url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        try {
          sendJson(res, 200, { ok: true, ...index.stats() });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "index-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/poses/image": async (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const found = index.findView(url.searchParams.get("id") ?? "");
        if (found === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-pose", message: "\u6CA1\u6709\u8FD9\u4E2A\u59FF\u52BF\u89C6\u89D2\u3002" });
          return;
        }
        const size = url.searchParams.get("size") === "full" ? "full" : "thumb";
        const relativePath = size === "full" ? found.view.full : found.view.thumb;
        try {
          const image = await images.fetch(relativePath);
          res.writeHead(200, {
            "Content-Type": image.mediaType,
            // 图是内容稳定的（文件名带姿势编号与角度），缓存一天足够
            "Cache-Control": "public, max-age=86400",
            "Content-Length": String(image.buffer.length)
          });
          res.end(image.buffer);
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: "upstream-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      },
      "/poses/fetch": async (_url, res, req) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 POST\u3002" });
          return;
        }
        let body;
        try {
          body = await readJson2(req);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
          return;
        }
        const found = index.findView(typeof body.id === "string" ? body.id : "");
        if (found === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-pose", message: "\u6CA1\u6709\u8FD9\u4E2A\u59FF\u52BF\u89C6\u89D2\u3002" });
          return;
        }
        const size = body.size === "full" ? "full" : "thumb";
        const relativePath = size === "full" ? found.view.full : found.view.thumb;
        try {
          const { file, mediaType } = await images.materialize(relativePath, uploadsDir());
          sendJson(res, 200, {
            ok: true,
            file,
            mediaType,
            pose: { id: found.pose.id, name: found.pose.name, angle: found.view.angle, viewId: found.view.id }
          });
        } catch (error) {
          sendJson(res, 502, {
            ok: false,
            error: "upstream-failed",
            message: error instanceof Error ? error.message : String(error)
          });
        }
      },
      "/poses/cache": (_url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        sendJson(res, 200, { ok: true, ...images.stats() });
      }
    }
  };
}

// src/components/panel-poses/server/tools.ts
init_types();
function brief(hit) {
  return {
    id: hit.id,
    name: hit.name,
    category: hit.category,
    system: hit.system,
    views: hit.viewCount,
    adult: hit.adult
  };
}
function search(deps, args) {
  const query = asString(args.query).trim();
  const system = asString(args.system).trim();
  const category = asString(args.category).trim();
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30);
  const onlySafe = args.onlySafe === true;
  const known = deps.index.stats().systems.map((item) => item.id);
  if (system !== "" && !known.includes(system)) {
    return { ok: false, error: `system \u53EA\u80FD\u662F ${known.join(" / ")}\uFF0C\u6536\u5230\u300C${system}\u300D\u3002` };
  }
  const result = deps.index.search({ query, systemId: system, category, onlySafe, limit });
  if (result.items.length === 0) {
    const all = deps.index.search({ query, limit: 1 });
    const unfiltered = all.total;
    return {
      ok: true,
      mode: "search",
      poses: [],
      total: 0,
      note: unfiltered === 0 ? "\u6CA1\u6709\u5339\u914D\u7684\u59FF\u52BF\u3002\u6362\u4E2A\u8BCD\u8BD5\u8BD5\uFF0C\u6216\u8005\u53BB\u6389 system / category\u3002" : `\u6709 ${unfiltered} \u7EC4\u7B26\u5408\u5173\u952E\u8BCD\uFF0C\u4F46\u88AB system / category / onlySafe \u8FC7\u6EE4\u6389\u4E86\u3002\u53BB\u6389\u6761\u4EF6\u518D\u67E5\u3002`
    };
  }
  return {
    ok: true,
    mode: "search",
    total: result.total,
    poses: result.items.map(brief),
    hint: "\u8981\u54EA\u7EC4\u7684\u56FE\u5C31\u628A\u5B83\u7684 id \u4F20\u7ED9\u540C\u4E00\u4E2A\u5DE5\u5177\uFF08\u4E0D\u5E26 query\uFF09\u3002"
  };
}
async function fetchView(deps, id, sizeArg) {
  const found = deps.index.findView(id);
  if (found === void 0) {
    return { ok: false, error: `\u6CA1\u6709\u8FD9\u4E2A\u59FF\u52BF\u89C6\u89D2\uFF1A${id}\u3002\u5148\u4E0D\u5E26 id \u641C\u4E00\u4E0B\u62FF\u5230\u6B63\u786E\u7684 id\u3002` };
  }
  const size = asString(sizeArg, "full") === "thumb" ? "thumb" : "full";
  const relativePath = size === "full" ? found.view.full : found.view.thumb;
  try {
    const { file, mediaType } = await deps.images.materialize(relativePath, deps.uploadsDir());
    return {
      ok: true,
      mode: "fetch",
      file,
      mediaType,
      size,
      pose: {
        id: found.pose.id,
        name: found.pose.name,
        system: found.pose.system,
        category: found.pose.category,
        angle: found.view.angle,
        viewId: found.view.id
      },
      next: "\u628A file \u4F5C\u4E3A\u5DE5\u4F5C\u6D41\u7684\u56FE\u7247\u8F93\u5165\uFF08comfyui_run \u7684 vars \u91CC\u5BF9\u5E94\u90A3\u4E2A image \u69FD\u4F4D\uFF09\u3002"
    };
  } catch (error) {
    return {
      ok: false,
      error: `\u59FF\u52BF\u7EBF\u7A3F\u53D6\u4E0D\u5230\uFF1A${error instanceof Error ? error.message : String(error)}`,
      hint: "\u56FE\u6765\u81EA\u7B2C\u4E09\u65B9\u56FE\u5E8A\uFF08ai-pose-gallery.anhao.app\uFF09\uFF0C\u5B83\u4E0D\u53EF\u7528\u65F6\u8FD9\u6761\u5C31\u53D6\u4E0D\u5230\uFF1B\u59FF\u52BF\u68C0\u7D22\u672C\u8EAB\u4E0D\u53D7\u5F71\u54CD\u3002"
    };
  }
}
function poseTool(deps) {
  return {
    name: "comfyui_pose",
    description: '\u59FF\u52BF\u53C2\u8003\u5E93\uFF08288 \u7EC4\u30011439 \u4E2A\u89D2\u5EA6\uFF0C\u6765\u81EA Danbooru \u793E\u533A\u7684\u4EBA\u4F53\u53C2\u8003\u56FE\u5E93\uFF09\u3002**\u7ED9 query \u662F\u641C**\uFF1A\u8FD4\u56DE\u59FF\u52BF id\u3001\u4E2D\u6587\u540D\u3001\u5206\u7C7B\u4E0E\u89D2\u5EA6\u6570\uFF0C\u4E0D\u542B\u56FE\u7247\uFF1B**\u7ED9 id \u662F\u53D6\u56FE**\uFF1A\u628A\u90A3\u4E2A\u59FF\u52BF\u7684\u4EBA\u4F53\u7EBF\u7A3F\u843D\u5230\u672C\u673A uploads\uFF0C\u8FD4\u56DE\u8DEF\u5F84\uFF0C\u53EF\u5F53\u5DE5\u4F5C\u6D41\u7684\u8F93\u5165\u56FE\uFF08ControlNet / \u56FE\u751F\u56FE\uFF09\u3002\u4F20\u59FF\u52BF id \u7ED9\u6B63\u9762\uFF0C\u4F20\u89C6\u89D2 id\uFF08\u5982 full_single_P001_side\uFF09\u7ED9\u90A3\u4E2A\u89D2\u5EA6\u3002\u4E24\u4EF6\u4E8B\u5408\u5728\u4E00\u4E2A\u5DE5\u5177\u91CC\uFF0C\u56E0\u4E3A\u6CA1\u6709"\u5148\u53D6\u56FE\u518D\u641C"\u8FD9\u79CD\u987A\u5E8F \u2014\u2014 \u4E00\u5B9A\u662F\u5148\u641C\u5230 id \u518D\u53D6\u3002',
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF1A\u4E2D\u6587\u59FF\u52BF\u540D\u3001\u7F16\u53F7\uFF08P001\uFF09\u6216\u5206\u7C7B\uFF08\u5750\u59FF\uFF09\u3002\u7A7A\u683C\u5206\u9694\u591A\u4E2A\u8BCD\u505A AND\u3002\u7ED9 id \u65F6\u5FFD\u7565\u3002" },
        system: {
          type: "string",
          enum: ["full", "sexy", "bust", "pair"],
          description: "\u641C\u7D22\u7ED3\u679C\u6309\u4F53\u7CFB\u7B5B\uFF1Afull \u5168\u8EAB\u6807\u51C6 / sexy \u5168\u8EAB\u6027\u611F / bust \u4E0A\u534A\u8EAB / pair \u53CC\u4EBA\u3002\u4E0D\u4F20\u5219\u5168\u90E8\u3002"
        },
        category: { type: "string", description: "\u641C\u7D22\u7ED3\u679C\u6309\u52A8\u4F5C\u5206\u7C7B\u7B5B\uFF0C\u5982\u300C\u5750\u59FF\u300D\u300C\u7AD9\u59FF\u300D\u300C\u8DB4\u5367\u300D\u300C\u8DEA\u7ACB\u300D\u3002\u4E0D\u4F20\u5219\u5168\u90E8\u3002" },
        onlySafe: { type: "boolean", description: "\u641C\u7D22\u7ED3\u679C\u53EA\u770B\u5E38\u89C4\u59FF\u52BF\uFF08\u9ED8\u8BA4 false\uFF0C\u5373\u5168\u90E8\uFF09\u3002" },
        limit: { type: "integer", description: "\u641C\u7D22\u6700\u591A\u8FD4\u56DE\u51E0\u7EC4\uFF0C\u9ED8\u8BA4 10\uFF0C\u4E0A\u9650 30\u3002" },
        id: { type: "string", description: "\u59FF\u52BF id\uFF08full_single_P001\uFF09\u6216\u89C6\u89D2 id\uFF08full_single_P001_side\uFF09\u3002**\u7ED9\u4E86\u5B83\u5C31\u53D6\u56FE\uFF0C\u4E0D\u662F\u641C\u7D22\u3002**" },
        size: {
          type: "string",
          enum: ["thumb", "full"],
          description: "\u53D6\u56FE\u5C3A\u5BF8\uFF1Athumb \u662F 300\xD7400 \u7F29\u7565\u56FE\uFF08\u5FEB\u3001\u591F\u505A\u59FF\u52BF\u53C2\u8003\uFF09\uFF0Cfull \u662F\u539F\u5C3A\u5BF8 PNG\u3002\u9ED8\u8BA4 full\u3002"
        }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    execute: async (args) => {
      const id = asString(args.id).trim();
      if (id !== "") return fetchView(deps, id, args.size);
      return search(deps, args);
    }
  };
}

// src/entries/poses.ts
init_paths();
var COMPONENT = "panel.poses";
var singleton2 = null;
function shared(dataDir, origin) {
  const key = `${dataDir}|${origin}`;
  if (singleton2 !== null && singleton2.key === key) return singleton2;
  const index = createPosesIndex(dataDir);
  const images = createPoseImages({ cacheDir: path33.join(dataDir, "cache", "poses"), origin });
  singleton2 = { key, index, images };
  return singleton2;
}
function recordFailure2(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = pluginDataDir();
    fs32.mkdirSync(dir, { recursive: true });
    fs32.writeFileSync(path33.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] poses entry
${message}
`, "utf8");
  } catch {
  }
}
function apply7(ctx, config) {
  try {
    applyInner2(ctx, config);
  } catch (error) {
    recordFailure2(error);
    throw error;
  }
}
function applyInner2(ctx, config) {
  const settings = resolveSettings(config, process.env);
  if (new Set(settings.disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${COMPONENT} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
    return;
  }
  const dataDir = pluginDataDir();
  const { index, images } = shared(dataDir, settings.posesOrigin);
  const uploadsDir = () => settings.uploadsDir ?? path33.join(dataDir, "uploads");
  const routes = createPosesRoutes({ index, images, uploadsDir });
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "poses: runtime");
  rt.materials = {
    ...rt.materials,
    pose: (id) => {
      const found = index.findView(id);
      return found === void 0 ? void 0 : { id: found.view.id, name: found.pose.name };
    },
    fetchPose: async (id, size) => {
      const found = index.findView(id);
      if (found === void 0) throw new Error(`\u6CA1\u6709\u8FD9\u4E2A\u59FF\u52BF\u89C6\u89D2\uFF1A${id}`);
      const { file } = await images.materialize(size === "thumb" ? found.view.thumb : found.view.full, uploadsDir());
      return file;
    }
  };
  ensureHttp(ctx, rt);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => mountRoutes(ctx, COMPONENT, { exact: routes.exact }), "poses: routes");
  } else {
    mountRoutes(ctx, COMPONENT, { exact: routes.exact });
  }
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    console.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u59FF\u52BF\u5DE5\u5177\u672A\u6CE8\u518C\u3002");
  } else {
    const deps = { index, images, uploadsDir };
    for (const spec of [poseTool(deps)]) {
      try {
        const dispose = tools.register(spec);
        if (typeof dispose === "function" && typeof ctx.effect === "function") {
          ctx.effect(() => () => dispose(), `poses: tool ${spec.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[comfyui-workbench] \u5DE5\u5177 ${spec.name} \u672A\u6CE8\u518C\uFF1A${message}`);
      }
    }
  }
  const stats = index.stats();
  rt.info(`[comfyui-workbench] \u59FF\u52BF\u5E93\u5DF2\u4E0A\u7EBF\uFF1A${stats.poseCount} \u7EC4 / ${stats.viewCount} \u4E2A\u89D2\u5EA6`);
}

// src/entries/costumes.ts
import fs34 from "node:fs";
import path35 from "node:path";

// src/components/panel-costumes/server/routes.ts
var MAX_BODY2 = 4 * 1024;
function fileOf(item, size) {
  if (size === "thumb") return item.thumb;
  if (size === "preview") return item.preview;
  return item.full;
}
function sizeOf(value) {
  return value === "full" ? "full" : value === "preview" ? "preview" : "thumb";
}
async function readJson3(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY2) throw new Error("\u8BF7\u6C42\u8FC7\u5927");
    chunks.push(buffer);
  }
  const text3 = Buffer.concat(chunks).toString("utf8");
  if (text3.trim() === "") return {};
  const parsed = JSON.parse(text3);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("\u8BF7\u6C42\u4F53\u8981\u662F JSON \u5BF9\u8C61");
  return parsed;
}
function createCostumeRoutes(deps) {
  const { index, images, uploadsDir } = deps;
  return {
    exact: {
      "/costumes": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u670D\u88C5\u5E93\u662F\u53EA\u8BFB\u7684\uFF0C\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const params = url.searchParams;
        try {
          const result = index.search({
            query: params.get("q") ?? "",
            category: params.get("category") ?? "",
            // 默认全给；`safe=1` 才收窄。筛选是使用者的选择。
            onlySafe: params.get("safe") === "1" || params.get("safe") === "true",
            limit: Number(params.get("limit") ?? "") || void 0,
            offset: Number(params.get("offset") ?? "") || void 0
          });
          sendJson(res, 200, { ok: true, ...result });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "index-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/costumes/stats": (_url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        try {
          sendJson(res, 200, { ok: true, ...index.stats() });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "index-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/costumes/image": async (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const item = index.get(url.searchParams.get("id") ?? "");
        if (item === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-costume", message: "\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\u3002" });
          return;
        }
        const size = sizeOf(url.searchParams.get("size"));
        try {
          const image = await images.fetch(fileOf(item, size));
          res.writeHead(200, {
            "Content-Type": image.mediaType,
            "Cache-Control": "public, max-age=86400",
            "Content-Length": String(image.buffer.length)
          });
          res.end(image.buffer);
        } catch (error) {
          sendJson(res, 502, { ok: false, error: "upstream-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/costumes/fetch": async (_url, res, req) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 POST\u3002" });
          return;
        }
        let body;
        try {
          body = await readJson3(req);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
          return;
        }
        const item = index.get(typeof body.id === "string" ? body.id : "");
        if (item === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-costume", message: "\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\u3002" });
          return;
        }
        const size = sizeOf(typeof body.size === "string" ? body.size : void 0);
        try {
          const { file, mediaType } = await images.materialize(fileOf(item, size), uploadsDir());
          sendJson(res, 200, {
            ok: true,
            file,
            mediaType,
            costume: { id: item.id, name: item.name, category: item.category, keywords: item.keywords }
          });
        } catch (error) {
          sendJson(res, 502, { ok: false, error: "upstream-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/costumes/cache": (_url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        sendJson(res, 200, { ok: true, ...images.stats() });
      }
    }
  };
}

// src/components/panel-costumes/server/catalog.ts
import fs33 from "node:fs";
import path34 from "node:path";
import { fileURLToPath as fileURLToPath3 } from "node:url";
var MAX_LIMIT3 = 100;
var DEFAULT_LIMIT3 = 40;
function bundledCostumePath(fromUrl = import.meta.url) {
  let dir = path34.dirname(fileURLToPath3(fromUrl));
  for (let i = 0; i < 8; i += 1) {
    if (fs33.existsSync(path34.join(dir, "package.json")) && fs33.existsSync(path34.join(dir, "data"))) {
      return path34.join(dir, "data", "costumes", "catalog.json");
    }
    const parent = path34.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path34.join(path34.dirname(fileURLToPath3(fromUrl)), "..", "..", "..", "data", "costumes", "catalog.json");
}
function readCatalog2(file) {
  const parsed = JSON.parse(fs33.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error(`\u670D\u88C5\u76EE\u5F55\u4E3A\u7A7A\u6216\u683C\u5F0F\u4E0D\u5BF9\uFF1A${file}`);
  return parsed;
}
function createCostumesIndex(dataDir, bundledFile) {
  const bundled = bundledFile ?? bundledCostumePath();
  let catalog = null;
  let byId = /* @__PURE__ */ new Map();
  let stats = null;
  let stamp = "";
  const fileOf2 = () => {
    const own = path34.join(dataDir, "costumes", "catalog.json");
    return fs33.existsSync(own) ? own : bundled;
  };
  const stampOf = () => {
    try {
      const stat = fs33.statSync(fileOf2());
      return `${stat.mtimeMs}:${stat.size}`;
    } catch {
      return "-";
    }
  };
  const reset = () => {
    catalog = null;
    byId = /* @__PURE__ */ new Map();
    stats = null;
  };
  const ensure = () => {
    const now = stampOf();
    if (now !== stamp) {
      stamp = now;
      reset();
    }
    if (catalog === null) {
      const loaded = readCatalog2(fileOf2());
      catalog = loaded;
      for (const item of loaded.items) byId.set(item.id, item);
    }
    return catalog;
  };
  const haystack = (item) => `${item.id} ${item.category} ${item.name} ${item.tags.join(" ")} ${item.keywords}`.toLowerCase();
  return {
    search: (options) => {
      const loaded = ensure();
      const query = (options.query ?? "").trim().toLowerCase();
      const parts = query === "" ? [] : query.split(/\s+/).filter(Boolean);
      const category = options.category ?? "";
      const onlySafe = options.onlySafe === true;
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT3) || DEFAULT_LIMIT3, 1), MAX_LIMIT3);
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0);
      const filtered = [];
      for (const item of loaded.items) {
        if (onlySafe && item.adult) continue;
        if (category !== "" && item.category !== category) continue;
        if (parts.length > 0) {
          const hay = haystack(item);
          if (!parts.every((part) => hay.includes(part))) continue;
        }
        filtered.push(item);
      }
      return { total: filtered.length, items: filtered.slice(offset, offset + limit) };
    },
    stats: () => {
      const loaded = ensure();
      if (stats !== null) return stats;
      stats = {
        total: loaded.total,
        adultCount: loaded.adultCount,
        safeCount: loaded.items.filter((item) => !item.adult).length,
        categories: loaded.categories,
        attribution: loaded.attribution,
        source: loaded.source,
        origin: loaded.origin
      };
      return stats;
    },
    get: (id) => {
      ensure();
      return byId.get(id);
    },
    invalidate: () => {
      reset();
      stamp = "";
    }
  };
}

// src/components/panel-costumes/server/tools.ts
init_types();
function brief2(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    keywords: item.keywords,
    adult: item.adult
  };
}
function search2(deps, args) {
  const query = asString(args.query).trim();
  const category = asString(args.category).trim();
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30);
  const onlySafe = args.onlySafe === true;
  const known = Object.keys(deps.index.stats().categories);
  if (category !== "" && !known.includes(category)) {
    return { ok: false, error: `category \u53EA\u80FD\u662F ${known.join(" / ")}\uFF0C\u6536\u5230\u300C${category}\u300D\u3002` };
  }
  const result = deps.index.search({ query, category, onlySafe, limit });
  if (result.items.length === 0) {
    const all = deps.index.search({ query, limit: 1 });
    return {
      ok: true,
      mode: "search",
      costumes: [],
      total: 0,
      note: all.total === 0 ? "\u6CA1\u6709\u5339\u914D\u7684\u670D\u88C5\u3002\u6362\u4E2A\u8BCD\u8BD5\u8BD5\uFF08\u4E2D\u6587\u63CF\u8FF0\u6216\u82F1\u6587\u5173\u952E\u8BCD\u90FD\u884C\uFF09\uFF0C\u6216\u8005\u53BB\u6389 category / onlySafe\u3002" : `\u6709 ${all.total} \u5957\u7B26\u5408\u5173\u952E\u8BCD\uFF0C\u4F46\u88AB category / onlySafe \u8FC7\u6EE4\u6389\u4E86\u3002\u53BB\u6389\u6761\u4EF6\u518D\u67E5\u3002`
    };
  }
  return {
    ok: true,
    mode: "search",
    total: result.total,
    costumes: result.items.map(brief2),
    hint: "\u8981\u54EA\u5957\u7684\u56FE\u5C31\u628A\u5B83\u7684 id \u4F20\u7ED9\u540C\u4E00\u4E2A\u5DE5\u5177\uFF08\u4E0D\u5E26 query\uFF09\u3002keywords \u53EF\u4EE5\u76F4\u63A5\u62FC\u8FDB\u63D0\u793A\u8BCD\u3002"
  };
}
async function fetchOne(deps, id, sizeArg) {
  const item = deps.index.get(id);
  if (item === void 0) {
    return { ok: false, error: `\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\uFF1A${id}\u3002\u5148\u4E0D\u5E26 id \u641C\u4E00\u4E0B\u62FF\u5230\u6B63\u786E\u7684\u7F16\u53F7\u3002` };
  }
  const size = asString(sizeArg, "full");
  const relative = size === "thumb" ? item.thumb : size === "preview" ? item.preview : item.full;
  try {
    const { file, mediaType } = await deps.images.materialize(relative, deps.uploadsDir());
    return {
      ok: true,
      mode: "fetch",
      file,
      mediaType,
      size,
      costume: {
        id: item.id,
        name: item.name,
        category: item.category,
        keywords: item.keywords,
        // 前 8 个分类标签：比 keywords 更细，模型拼提示词时能直接挑（HEAD 就有，合并时别丢）
        tags: item.tags.slice(0, 8)
      },
      next: "\u56FE\u91CC\u53EA\u6709\u8863\u670D\u3001\u6CA1\u6709\u4EBA\u7269\uFF0C\u9002\u5408\u5F53\u670D\u88C5\u53C2\u8003\uFF08IPAdapter / \u53C2\u8003\u56FE\u63A7\u5236\uFF09\uFF1Bkeywords \u62FC\u8FDB\u63D0\u793A\u8BCD\u63CF\u8FF0\u8FD9\u4EF6\u8863\u670D\u3002"
    };
  } catch (error) {
    return {
      ok: false,
      error: `\u670D\u88C5\u53C2\u8003\u56FE\u53D6\u4E0D\u5230\uFF1A${error instanceof Error ? error.message : String(error)}`,
      hint: "\u56FE\u6765\u81EA\u7B2C\u4E09\u65B9\u56FE\u5E8A\uFF0C\u5B83\u4E0D\u53EF\u7528\u65F6\u8FD9\u6761\u5C31\u53D6\u4E0D\u5230\uFF1B\u8863\u88C5\u68C0\u7D22\u672C\u8EAB\u4E0D\u53D7\u5F71\u54CD\u3002"
    };
  }
}
function costumeTool(deps) {
  return {
    name: "comfyui_costume",
    description: "\u8863\u88C5\u53C2\u8003\u5E93\uFF081407 \u5957\uFF0C\u73B0\u5B9E\u98CE\u683C\uFF0C\u56FE\u4E2D\u6CA1\u6709\u4EBA\u7269\uFF09\u3002**\u7ED9 query \u662F\u641C**\uFF1A\u8FD4\u56DE\u7F16\u53F7\u3001\u4E2D\u6587\u63CF\u8FF0\u3001\u5206\u7C7B\u4E0E**\u82F1\u6587\u5173\u952E\u8BCD**\uFF08\u5173\u952E\u8BCD\u53EF\u4EE5\u76F4\u63A5\u62FC\u8FDB\u63D0\u793A\u8BCD\uFF0C\u8FD9\u662F\u5B83\u6700\u6709\u7528\u7684\u5730\u65B9\uFF09\uFF1B**\u7ED9 id \u662F\u53D6\u56FE**\uFF1A\u628A\u90A3\u5F20\u56FE\u843D\u5230\u672C\u673A uploads\uFF0C\u8FD4\u56DE\u8DEF\u5F84\uFF0C\u5F53\u5DE5\u4F5C\u6D41\u7684\u670D\u88C5\u53C2\u8003\u56FE\uFF08\u914D\u5408 IPAdapter \u4E4B\u7C7B\uFF09\u3002\u4E24\u4EF6\u4E8B\u5408\u5728\u4E00\u4E2A\u5DE5\u5177\u91CC\uFF1A\u4E00\u5B9A\u662F\u5148\u641C\u5230\u7F16\u53F7\u518D\u53D6\u56FE\u3002",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF1A\u4E2D\u6587\u63CF\u8FF0\uFF08\u725B\u4ED4\u88D9\uFF09\u3001\u4E2D\u6587\u6807\u7B7E\uFF08\u8377\u53F6\u8FB9\uFF09\u6216\u82F1\u6587\u8BCD\uFF08denim knit\uFF09\u3002\u7A7A\u683C\u5206\u9694\u591A\u4E2A\u8BCD\u505A AND\u3002\u7ED9 id \u65F6\u5FFD\u7565\u3002"
        },
        category: {
          type: "string",
          description: "\u641C\u7D22\u7ED3\u679C\u6309\u5206\u7C7B\u7B5B\uFF1A\u6625\u5B63\u7A7F\u642D / \u590F\u5B63\u7A7F\u642D / \u79CB\u5B63\u7A7F\u642D / \u51AC\u5B63\u7A7F\u642D / \u5185\u8863\u30FB\u7761\u8863 / \u6027\u611F\u7A7F\u642D / \u6CF3\u88C5\u30FB\u5EA6\u5047 / \u6D3E\u5BF9\u30FB\u793C\u670D\u3002\u4E0D\u4F20\u5219\u5168\u90E8\u3002"
        },
        onlySafe: { type: "boolean", description: "\u641C\u7D22\u7ED3\u679C\u53EA\u770B\u5E38\u89C4\u7A7F\u642D\uFF08\u9ED8\u8BA4 false\uFF0C\u5373\u5168\u90E8\uFF09\u3002" },
        limit: { type: "integer", description: "\u641C\u7D22\u6700\u591A\u8FD4\u56DE\u51E0\u5957\uFF0C\u9ED8\u8BA4 10\uFF0C\u4E0A\u9650 30\u3002" },
        id: { type: "string", description: "\u670D\u88C5\u7F16\u53F7\uFF0C\u5982 SPR-0001\u3002**\u7ED9\u4E86\u5B83\u5C31\u53D6\u56FE\uFF0C\u4E0D\u662F\u641C\u7D22\u3002**" },
        size: {
          type: "string",
          enum: ["thumb", "preview", "full"],
          description: "\u53D6\u56FE\u5C3A\u5BF8\uFF1Athumb \u7F29\u7565\u56FE\u3001preview \u4E2D\u7B49\u3001full \u539F\u56FE\uFF08webp\uFF09\u3002\u9ED8\u8BA4 full\u3002"
        }
      },
      additionalProperties: false
    },
    output: {
      schema: { type: "object", additionalProperties: true },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
    },
    execute: async (args) => {
      const id = asString(args.id).trim();
      if (id !== "") return fetchOne(deps, id, args.size);
      return search2(deps, args);
    }
  };
}

// src/entries/costumes.ts
init_paths();
var COMPONENT2 = "panel.costumes";
var COSTUME_PATH = /^(thumbs|img)\/costume\/[A-Za-z0-9_-]+\.webp$/;
var singleton3 = null;
function shared2(dataDir, origin) {
  const key = `${dataDir}|${origin}`;
  if (singleton3 !== null && singleton3.key === key) return singleton3;
  const index = createCostumesIndex(dataDir);
  const images = createImageCache({
    cacheDir: path35.join(dataDir, "cache", "costumes"),
    origin,
    pathPattern: COSTUME_PATH,
    // 服装图是两级目录；不传这个，磁盘上限与 /costumes/cache 统计都会失效
    cacheSubdirs: ["thumbs/costume", "img/costume"]
  });
  singleton3 = { key, index, images };
  return singleton3;
}
function recordFailure3(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = pluginDataDir();
    fs34.mkdirSync(dir, { recursive: true });
    fs34.writeFileSync(path35.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] costumes entry
${message}
`, "utf8");
  } catch {
  }
}
function apply8(ctx, config) {
  try {
    applyInner3(ctx, config);
  } catch (error) {
    recordFailure3(error);
    throw error;
  }
}
function applyInner3(ctx, config) {
  const settings = resolveSettings(config, process.env);
  if (new Set(settings.disabledComponents).has(COMPONENT2)) {
    console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${COMPONENT2} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
    return;
  }
  const dataDir = pluginDataDir();
  const { index, images } = shared2(dataDir, settings.posesOrigin);
  const uploadsDir = () => settings.uploadsDir ?? path35.join(dataDir, "uploads");
  const routes = createCostumeRoutes({ index, images, uploadsDir });
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "costumes: runtime");
  rt.materials = {
    ...rt.materials,
    costume: (id) => {
      const item = index.get(id);
      return item === void 0 ? void 0 : { id: item.id, name: item.name, keywords: item.keywords };
    },
    fetchCostume: async (id, size) => {
      const item = index.get(id);
      if (item === void 0) throw new Error(`\u6CA1\u6709\u8FD9\u5957\u8863\u88C5\uFF1A${id}`);
      const relative = size === "thumb" ? item.thumb : item.full;
      const { file } = await images.materialize(relative, uploadsDir());
      return file;
    }
  };
  ensureHttp(ctx, rt);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => mountRoutes(ctx, COMPONENT2, { exact: routes.exact }), "costumes: routes");
  } else {
    mountRoutes(ctx, COMPONENT2, { exact: routes.exact });
  }
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    console.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u670D\u88C5\u5DE5\u5177\u672A\u6CE8\u518C\u3002");
  } else {
    const deps = { index, images, uploadsDir };
    for (const spec of [costumeTool(deps)]) {
      try {
        const dispose = tools.register(spec);
        if (typeof dispose === "function" && typeof ctx.effect === "function") {
          ctx.effect(() => () => dispose(), `costumes: tool ${spec.name}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[comfyui-workbench] \u5DE5\u5177 ${spec.name} \u672A\u6CE8\u518C\uFF1A${message}`);
      }
    }
  }
  const stats = index.stats();
  rt.info(`[comfyui-workbench] \u670D\u88C5\u5E93\u5DF2\u4E0A\u7EBF\uFF1A${stats.total} \u5957 / ${Object.keys(stats.categories).length} \u7C7B`);
}

// src/entries/workflow.ts
import fs37 from "node:fs";
import os2 from "node:os";
import path37 from "node:path";

// src/components/panel-workflow/server/routes.ts
init_comfy();

// src/components/panel-workflow/server/run-api.ts
import fs36 from "node:fs";

// src/shared/host/toggles.ts
init_paths();
import fs35 from "node:fs";
import path36 from "node:path";
var FILE_NAME2 = "settings.json";
function togglesPath() {
  return path36.join(pluginDataDir(), FILE_NAME2);
}
function readRaw() {
  try {
    const parsed = JSON.parse(fs35.readFileSync(togglesPath(), "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return { ...parsed };
  } catch {
    return {};
  }
}
function normalize2(raw) {
  return typeof raw.progressStream === "boolean" ? { progressStream: raw.progressStream } : {};
}
function readToggles() {
  return normalize2(readRaw());
}
function writeToggles(patch) {
  const raw = readRaw();
  const next = patch.progressStream;
  if (next === null) delete raw.progressStream;
  else if (typeof next === "boolean") raw.progressStream = next;
  const target = togglesPath();
  ensureDir(path36.dirname(target));
  const tmp = `${target}.tmp`;
  fs35.writeFileSync(tmp, `${JSON.stringify(raw, null, 2)}
`, "utf8");
  fs35.renameSync(tmp, target);
  return normalize2(raw);
}
function resetToggleCache() {
}
function effectiveProgressStream(settings, toggles) {
  return toggles.progressStream ?? settings.progressStream;
}

// src/components/panel-workflow/server/run-api.ts
init_run();
init_workflow();
async function submitAndTrack(deps, options) {
  const submitted = await submitWorkflow({
    client: deps.client,
    workflow: options.workflow,
    slots: options.slots,
    vars: options.vars,
    outputDir: options.outputDir,
    timeoutMs: options.timeoutMs,
    pollIntervalMs: deps.settings.pollIntervalMs,
    workflowId: options.workflowId,
    workflowHash: options.workflowHash
  });
  try {
    deps.runs?.submit(submitted.promptId, options.workflowId);
  } catch {
  }
  const sweepOptions = {
    client: deps.client,
    promptId: submitted.promptId,
    workflowId: options.workflowId,
    outputDir: options.outputDir,
    intervalMs: deps.settings.pollIntervalMs,
    // 调用方的 `timeoutMs` 只放宽盯守时长，不收紧 —— 见 `sweepBudgetOf` 的说明。
    maxWaitMs: sweepBudgetOf(options.timeoutMs),
    // 进度默认关；面板开关覆盖配置默认值（改完下一次提交就生效）。
    progressStream: effectiveProgressStream(deps.settings, deps.toggles?.read() ?? {}),
    // 不传 logger 的话，订阅降级（Node 20 无全局 WebSocket）与连续失败都零日志 ——
    // 用户设了 `COMFYUI_PROGRESS_WS=1` 却永远 0 事件时无从发现。
    ...deps.logger === void 0 ? {} : { logger: deps.logger },
    ...deps.runs === void 0 ? {} : { registry: deps.runs }
  };
  try {
    sweepRun(sweepOptions);
  } catch {
  }
  const effectiveBudgetMs = sweepOptions.maxWaitMs ?? 0;
  return {
    promptId: submitted.promptId,
    effective: submitted.effective,
    // 把**实际生效**的盯守预算回给调用方：不然 `timeoutMs` 传 60000 与传 1800000
    // 行为完全一样，调用方无从知道自己的意愿被抬高了。
    notes: [
      ...submitted.notes,
      `\u540E\u53F0\u76EF\u5B88 ${Math.round(effectiveBudgetMs / 6e4)} \u5206\u949F${effectiveBudgetMs > options.timeoutMs ? "\uFF08timeoutMs \u53EA\u653E\u5BBD\u4E0D\u6536\u7D27\uFF09" : ""}`
    ]
  };
}
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
    const outputPath = typeof body.outputPath === "string" && body.outputPath.trim() !== "" ? body.outputPath.trim() : deps.settings.outputDir ?? deps.defaultOutputDir;
    const timeoutMs2 = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) ? Math.min(36e5, Math.max(1e3, Math.round(body.timeoutMs))) : deps.settings.timeoutMs;
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
      const submitted = await submitAndTrack(deps, {
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs: timeoutMs2,
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
function createRerunHandler(deps) {
  return async (_url, res, req) => {
    let body;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "bad-body", message: "\u8BFB\u4E0D\u4E86\u8BF7\u6C42\u4F53\u3002" });
      return;
    }
    const imagePath = typeof body.path === "string" ? body.path.trim() : "";
    if (imagePath === "") {
      sendJson(res, 400, { ok: false, error: "bad-body", message: "\u9700\u8981 path\u3002" });
      return;
    }
    const sidecarPath = `${imagePath}.json`;
    let sidecar;
    try {
      sidecar = JSON.parse(fs36.readFileSync(sidecarPath, "utf8"));
    } catch {
      sendJson(res, 200, {
        ok: false,
        error: "no-sidecar",
        message: `\u8FD9\u5F20\u56FE\u6CA1\u6709 sidecar\uFF08${sidecarPath}\uFF09\uFF0C\u8BFB\u4E0D\u5230\u5F53\u65F6\u7684\u53C2\u6570\u3002\u7528\u9762\u677F\u7684\u5DE5\u4F5C\u6D41\u9875\u624B\u52A8\u8DD1\u3002`
      });
      return;
    }
    const workflowId = typeof sidecar.workflowId === "string" ? sidecar.workflowId : "";
    const vars = sidecar.vars !== null && typeof sidecar.vars === "object" && !Array.isArray(sidecar.vars) ? { ...sidecar.vars } : void 0;
    if (workflowId === "" || vars === void 0) {
      sendJson(res, 200, {
        ok: false,
        error: "bad-sidecar",
        message: "sidecar \u91CC\u6CA1\u6709 workflowId \u6216 vars\uFF0C\u65E0\u6CD5\u6309\u539F\u53C2\u6570\u91CD\u8DD1\u3002"
      });
      return;
    }
    const entry = readEntry(deps.workflowDir, workflowId);
    if (entry === void 0) {
      sendJson(res, 200, {
        ok: false,
        error: "no-workflow",
        message: `\u8FD9\u5F20\u56FE\u6765\u81EA\u5DE5\u4F5C\u6D41 ${workflowId}\uFF0C\u4F46\u5B83\u5DF2\u7ECF\u4E0D\u5728\u672C\u673A\u4E86\u3002`
      });
      return;
    }
    let usedSeed;
    if (body.asInput === true) {
      const slot = entry.surface.inputs.find((input) => input.type === "image");
      if (slot === void 0) {
        sendJson(res, 200, {
          ok: false,
          error: "no-image-slot",
          message: `\u5DE5\u4F5C\u6D41 ${workflowId} \u4E0D\u5403\u56FE\u7247\u8F93\u5165\uFF0C\u6CA1\u6CD5\u628A\u5B83\u5F53\u8F93\u5165\u56FE\u3002\u7528\u666E\u901A\u91CD\u8DD1\uFF08asInput \u4E0D\u4F20\uFF09\u53EF\u4EE5\u7167\u539F\u53C2\u6570\u518D\u8DD1\u4E00\u904D\u3002`
        });
        return;
      }
      vars[slot.name] = imagePath;
      const seedSlot = entry.surface.inputs.find((input) => /^(noise_)?seed$/i.test(input.name))?.name;
      if (seedSlot !== void 0) {
        const raw = body.seed;
        const explicit = typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : typeof raw === "string" && raw.trim() !== "" && Number.isFinite(Number(raw)) ? Math.round(Number(raw)) : void 0;
        const next = explicit ?? Math.floor(Math.random() * 2147483647);
        vars[seedSlot] = next;
        usedSeed = next;
      }
    }
    const outputPath = deps.settings.outputDir ?? deps.defaultOutputDir;
    const timeoutMs2 = typeof body.timeoutMs === "number" && Number.isFinite(body.timeoutMs) ? Math.min(36e5, Math.max(1e3, Math.round(body.timeoutMs))) : deps.settings.timeoutMs;
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
      const submitted = await submitAndTrack(deps, {
        workflow: entry.workflow,
        slots: entry.surface.inputs,
        vars,
        outputDir: outputPath,
        timeoutMs: timeoutMs2,
        workflowId,
        workflowHash: entry.surface.workflowHash
      });
      sendJson(res, 200, {
        ok: true,
        pending: true,
        promptId: submitted.promptId,
        workflowId,
        // asInput 时换了新 seed，得把它回给调用方 —— 否则用户既不知道这次用的是哪个 seed，
        // 也没法拿它去复现
        ...usedSeed === void 0 ? {} : { seed: usedSeed },
        effectiveVars: submitted.effective,
        notes: submitted.notes
      });
    } catch (error) {
      const bag = error !== null && typeof error === "object" ? error : null;
      sendJson(res, 200, {
        ok: false,
        code: typeof bag?.code === "string" ? bag.code : "execution_failed",
        message: error instanceof Error ? error.message : String(error)
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
init_comfy();
init_workflow();
function toPanelItem(surface, available) {
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
    // 面板的"拿这张图去出图"要靠它知道往哪个键里传图。
    // 注意：工具侧那份 toListItem **不产出** imageSlots，它只在 `inputs=image`
    // 的过滤分支里临时挂上去；面板走的是这里，必须自带 —— 漏了就让面板永远列不出候选。
    imageSlots: surface.inputs.filter((slot) => slot.type === "image").map((slot) => slot.name),
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
async function handleWorkflowList(dir, url, res, available) {
  const { entries, broken } = listEntries(dir);
  const wantInput = (url.searchParams.get("inputs") ?? "").trim().toLowerCase();
  const filtered = wantInput === "" ? entries : entries.filter((entry) => entry.surface.inputs.some((slot) => slot.type.toLowerCase() === wantInput));
  sendJson(res, 200, {
    ok: true,
    count: filtered.length,
    workflows: filtered.map((entry) => toPanelItem(entry.surface, available)),
    ...broken.length > 0 ? { broken } : {},
    ...wantInput !== "" && filtered.length === 0 ? { hint: `\u672C\u673A\u6CA1\u6709\u9700\u8981 ${wantInput} \u8F93\u5165\u7684\u5DE5\u4F5C\u6D41\u3002` } : {}
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
async function handleWorkflowImport(dir, res, req) {
  let body;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
    return;
  }
  const workflow = body.workflow;
  if (workflow === null || workflow === void 0) {
    sendJson(res, 400, {
      ok: false,
      error: "bad-body",
      message: "\u9700\u8981 workflow\uFF1A\u628A API \u683C\u5F0F\u5DE5\u4F5C\u6D41\u7684 JSON \u5BF9\u8C61\u653E\u5728\u8FD9\u4E2A\u5B57\u6BB5\u91CC\u3002"
    });
    return;
  }
  const nameHint = typeof body.name === "string" && body.name.trim() !== "" ? body.name.trim() : `workflow-${Date.now().toString(36)}`;
  try {
    const result = importWorkflowValue(dir, workflow, nameHint, { overwrite: body.overwrite === true });
    sendJson(res, 200, {
      ok: true,
      workflowId: result.id,
      // 覆盖过就说明模板被换了（备注与 schema 保留），调用方需要知道这点
      replaced: result.replaced,
      surface: result.surface
    });
  } catch (error) {
    if (error instanceof WorkflowExistsError) {
      sendJson(res, 409, {
        ok: false,
        error: "already-exists",
        workflowId: error.id,
        message: error.message
      });
      return;
    }
    if (error instanceof WorkflowFormatError) {
      sendJson(res, 400, { ok: false, error: "bad-workflow", message: error.message });
      return;
    }
    sendJson(res, 500, {
      ok: false,
      error: "import-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

// src/components/panel-workflow/server/routes.ts
function createWorkflowRoutes(deps) {
  const { client, supervisor, workflowDir, settings, assertWritable, defaultOutputDir, runs, logger, toggles, getExporter } = deps;
  return {
    exact: {
      // 导入必须注册在 exact 里：否则 `/workflows/import` 会被前缀路由当成 id=`import`
      // 的工作流去读详情，返回 no-workflow 而不是导入结果。
      "/workflows/import": async (_url, res, req) => {
        if (req.method !== "POST") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u5BFC\u5165\u53EA\u63A5\u53D7 POST\u3002" });
          return;
        }
        await handleWorkflowImport(workflowDir, res, req);
      },
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
      // 单条运行的状态查询：面板提交完只能弹一句提示，之后看不见进度/结果。
      // 只读，所以独立成 new path 而不是给 `/run` 加 GET —— 后者是 POST_ONLY，
      // 改它的方法语义会牵到别处（WRITABLE 里也登记过 /run，历史遗留）。
      "/run-status": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const promptId = url.searchParams.get("promptId") ?? "";
        if (promptId === "") {
          sendJson(res, 400, { ok: false, error: "bad-request", message: "\u8981\u7ED9 promptId\u3002" });
          return;
        }
        const record = runs.get(promptId);
        if (record === void 0) {
          sendJson(res, 200, { ok: true, found: false, promptId });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          found: true,
          promptId,
          state: record.state,
          workflowId: record.workflowId,
          submittedAt: record.submittedAt,
          ...record.startedAt === void 0 ? {} : { startedAt: record.startedAt },
          ...record.finishedAt === void 0 ? {} : { finishedAt: record.finishedAt },
          ...record.queuePosition === void 0 ? {} : { queuePosition: record.queuePosition },
          ...record.progress === void 0 ? {} : { progress: record.progress },
          ...record.error === void 0 ? {} : { error: record.error },
          ...record.artifacts === void 0 ? {} : { artifacts: record.artifacts }
        });
      },
      "/run": createRunHandler({
        client,
        workflowDir,
        settings,
        assertWritable,
        defaultOutputDir,
        runs,
        ...logger === void 0 ? {} : { logger },
        ...toggles === void 0 ? {} : { toggles }
      }),
      // 以产物当时的参数重跑（可选把图当输入）：面板上"再用这张图跑一遍"
      "/rerun": createRerunHandler({
        client,
        workflowDir,
        settings,
        assertWritable,
        defaultOutputDir,
        runs,
        ...logger === void 0 ? {} : { logger },
        ...toggles === void 0 ? {} : { toggles }
      }),
      "/free": async (_url, res) => {
        try {
          await client.free();
          sendJson(res, 200, { ok: true });
        } catch (error) {
          sendJson(res, 200, { ok: false, message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/service": handleServiceStatus.bind(null, supervisor),
      "/service/stop": handleServiceStop.bind(null, supervisor)
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

// src/entries/workflow.ts
function warnDisabled5(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
function recordFailure4(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = path37.join(process.env.USERPROFILE ?? os2.homedir(), ".dsh-comfyui-workbench");
    fs37.mkdirSync(dir, { recursive: true });
    fs37.writeFileSync(path37.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] workflow entry
${message}
`, "utf8");
  } catch {
  }
}
function apply9(ctx, config) {
  try {
    applyInner4(ctx, config);
  } catch (error) {
    recordFailure4(error);
    throw error;
  }
}
function applyInner4(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.workflow")) {
    warnDisabled5("panel.workflow");
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
    runs: rt.runs,
    // 后台 sweep 与 /ws 进度订阅的降级都靠它留痕；漏了就只有"静默没有百分比"。
    logger: rt.logger,
    // 面板开关（progressStream）：每次提交时读，改完下一次就生效，不用重启。
    toggles: { read: readToggles },
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

// src/shared/host/workbench.skill.md
var workbench_skill_default = '# \u8FD9\u5957 ComfyUI \u5DE5\u4F5C\u53F0\u600E\u4E48\u7528\n\n\u63D2\u4EF6\u628A\u672C\u673A ComfyUI \u63A5\u8FDB\u5BF9\u8BDD\uFF1A\u516D\u4E2A\u9762\u677F\u7ED9\u4EBA\u770B\uFF0C\u5341\u56DB\u4E2A\u5DE5\u5177\u7ED9\u6A21\u578B\u7528\u3002\n\u56DB\u5C42\u4E1C\u897F\u5404\u7BA1\u5404\u7684\uFF0C\u6DF7\u4E86\u5C31\u51FA\u95EE\u9898 \u2014\u2014\n\n| \u5C42 | \u5728\u54EA | \u89C4\u77E9 |\n|---|---|---|\n| \u6A21\u677F | `workflows/` \u4E0B\u7684 **API \u683C\u5F0F** JSON | \u6539\u53C2\u6570\u7528 vars\uFF1B\u8981\u628A\u65B0\u503C**\u5B58\u56DE\u6A21\u677F**\u624D\u7528 `comfyui_workflow_edit` |\n| \u53D8\u91CF | \u6A21\u677F\u7684\u8F93\u5165\u9762 | `comfyui_run` \u7684 `vars`\uFF0C\u952E\u540D\u6765\u81EA `inputs` |\n| \u4EA7\u7269 | `outputDir` + \u540C\u540D `.json` sidecar | \u53EA\u8BFB\uFF0Csidecar \u662F\u590D\u73B0\u51ED\u636E |\n| \u7D20\u6750 | \u6807\u7B7E 99372 / \u59FF\u52BF 288 \u7EC4 / \u8863\u88C5 1407 \u5957 | \u53EA\u8BFB\uFF0C\u80FD\u641C\u3001\u80FD\u53D6\u56FE |\n\n## \u8DD1\u4E00\u6B21\u56FE\u7684\u6807\u51C6\u8DEF\u5F84\n\n1. `comfyui_workflow_list` \u6311\u6A21\u677F \u2014\u2014 \u770B `models.primary`\uFF08\u5E95\u6A21\uFF09\u4E0E `description`\uFF08\u7528\u9014\uFF09\u3002\u540C\u540D\u7684\u6A21\u677F\u9760\u8FD9\u4E24\u9879\u533A\u5206\uFF0C\u522B\u53EA\u770B id\u3002\n2. \u7B2C\u4E00\u6B21\u7528\u67D0\u4E2A\u6A21\u677F\uFF0C\u5148 `comfyui_workflow_inspect` \u770B `inputs`\uFF1A\u90A3\u5C31\u662F `vars` \u80FD\u7528\u7684\u952E\u540D\uFF0C\u8FDE\u540C\u7C7B\u578B\u3001\u9ED8\u8BA4\u503C\u3001\u53D6\u503C\u8303\u56F4\u3002\n3. `comfyui_run { workflow: { id }, vars: {...} }`\u3002\n4. \u6309\u8FD4\u56DE\u7684\u4EA7\u7269\u8DEF\u5F84\u8BFB\u539F\u56FE\uFF1B\u8981\u6539\u4E00\u70B9\u91CD\u8DD1\u7528 `comfyui_rerun` \u2014\u2014 sidecar \u91CC\u5B58\u7740 workflowId / hash / vars / seed\uFF0C\u4E0D\u7528\u624B\u6284\u3002\n\n## \u4E09\u79CD\u5E38\u89C1\u8BEF\u7528\n\n**\u4E3A\u4E86\u6539\u53C2\u6570\u53BB\u6539\u5199\u5DE5\u4F5C\u6D41 JSON\u3002** \u6A21\u677F + \u53D8\u91CF\u5C31\u662F\u4E3A\u6B64\u5B58\u5728\u7684\u3002\u6539\u6587\u4EF6\u4F1A\u8BA9\u8FD9\u6B21\u8FD0\u884C\u65E0\u6CD5\u8FFD\u6EAF\uFF08sidecar \u8BB0\u7684\u662F\u8FD9\u6B21\u63D0\u4EA4\u5185\u5BB9\u7684 hash\uFF0C\u8DDF\u4F60\u624B\u6539\u7684\u6587\u4EF6\u5BF9\u4E0D\u4E0A\uFF09\uFF0C\u4E5F\u8BA9 `workflows/` \u8D8A\u5806\u8D8A\u4E71\u3002\u4E00\u6B21\u6027\u6539\u52A8\u7528 vars\uFF1B\u8981\u628A\u65B0\u503C\u56FA\u5B9A\u4E0B\u6765\u7528 `comfyui_workflow_edit`\uFF08\u89C1\u4E0B\u4E00\u8282\uFF09\uFF1B\u53EA\u6709\u8981\u589E\u5220\u8282\u70B9\u3001\u6362\u8FDE\u7EBF\u65F6\u624D\u76F4\u63A5\u78B0\u6587\u4EF6\u3002\n\n**\u628A UI \u683C\u5F0F\u7684 JSON \u4F20\u7ED9 `workflow.path`\u3002** \u5E26 `nodes` + `links` \u7684\u662F ComfyUI \u754C\u9762\u5DE5\u7A0B\u6587\u4EF6\uFF0C\u5FC5\u987B\u5148\u300CExport (API)\u300D\u91CD\u65B0\u5BFC\u51FA\u3002\u5DE5\u4F5C\u6D41\u76EE\u5F55\u91CC\u7684\u6A21\u677F\u5168\u662F API \u683C\u5F0F\uFF0C\u7528 `{"id":"..."}` \u5C31\u80FD\u8DD1\uFF0C\u6839\u672C\u4E0D\u9700\u8981 path\u3002`path` \u53EA\u7528\u4E8E\u76EE\u5F55\u4E4B\u5916\u7684\u4E34\u65F6\u6587\u4EF6\u3002\n\n**\u6539\u4EA7\u7269\u7684 sidecar\u3002** \u5B83\u8BB0\u7740 workflowId / workflowHash / vars / seed\uFF0C\u662F"\u518D\u6765\u4E00\u5F20\u4E00\u6A21\u4E00\u6837\u7684"\u7684\u552F\u4E00\u51ED\u636E\uFF1B\u6539\u8FC7\u4E4B\u540E `comfyui_rerun` \u590D\u73B0\u4E0D\u51FA\u6765\u3002\n\n## \u628A\u6539\u52A8\u5B58\u56DE\u6A21\u677F\n\n\u4E00\u6B21\u6027\u7684\u53C2\u6570\u7528 `vars` \u5C31\u591F\u3002\u8981\u8BA9\u5B83**\u4E00\u76F4\u751F\u6548**\uFF08\u4EE5\u540E\u4E0D\u4F20\u4E5F\u662F\u65B0\u503C\uFF09\uFF0C\u7528 `comfyui_workflow_edit`\uFF1A\n\n1. `comfyui_workflow_inspect` \u62FF\u5230\u5F53\u524D\u7684 `workflowHash`\n2. `comfyui_workflow_edit` \u4F20 `patches`\uFF08\u8282\u70B9 id + \u8F93\u5165\u540D + \u503C\uFF09\u3001`persist: true`\u3001`expectHash`\n\n`expectHash` \u662F\u5E76\u53D1\u4FDD\u62A4\uFF1A\u6A21\u677F\u5728\u8FD9\u671F\u95F4\u88AB\u522B\u4EBA\u6539\u8FC7\u5C31\u4F1A\u62D2\u7EDD\uFF0C\u4E0D\u4F1A\u8986\u76D6\u6389\u3002**\u8FD9\u662F\u552F\u4E00\u8BE5\u5199\u6A21\u677F\u7684\u8DEF\u5F84** \u2014\u2014 \u5B83\u6539\u7684\u662F\u6A21\u677F\u672C\u8EAB\uFF0C\u5E26 hash \u6821\u9A8C\uFF0C\u4E5F\u4E0D\u4EA7\u751F\u526F\u672C\u3002\n\n## \u7D20\u6750\u4E09\u5E93\u7684\u7528\u6CD5\n\n- **\u6807\u7B7E\u5E93**\uFF0899372 \u6761\uFF09\uFF1A`danbooru_lookup` \u628A\u4E2D\u6587\u60F3\u6CD5\u8F6C\u6210 tag\u3002\u8BED\u4E49\u5206\u7C7B\u53EA\u8986\u76D6 `general` \u90A3 30693 \u6761\u7684 26.9%\uFF08\u4E0D\u662F 99372 \u7684\uFF09\uFF0C\u67E5\u4E0D\u5230\u65F6\u5148\u53BB\u6389 `category` \u518D\u8BD5\u3002\n- **\u59FF\u52BF\u5E93**\uFF08288 \u7EC4 / 1439 \u89D2\u5EA6\uFF09\uFF1A`comfyui_pose` \u7ED9 `query` \u627E\u4EBA\uFF0C\u7ED9 `id` \u5C31\u628A\u7EBF\u7A3F\u843D\u8FDB uploads \u2192 \u5F53 ControlNet / \u56FE\u751F\u56FE\u7684\u8F93\u5165\u56FE\u3002\n- **\u8863\u88C5\u5E93**\uFF081407 \u5957\uFF09\uFF1A`comfyui_costume` \u7ED9 `query` \u641C\uFF0C\u7ED3\u679C\u5E26 `keywords`\uFF08\u82F1\u6587\u4E32\uFF0C\u53EF\u76F4\u63A5\u62FC\u8FDB\u63D0\u793A\u8BCD\uFF09\uFF1B\u7ED9 `id` \u5C31\u53D6\u56FE\u5F53\u53C2\u8003\u3002\n\n\u7D20\u6750\u5DE5\u5177\u90FD\u662F**\u540C\u4E00\u4E2A\u5DE5\u5177\u4E24\u6761\u8DEF\u5F84**\uFF1A\u7ED9 `query` \u662F\u641C\uFF0C\u7ED9 `id` \u662F\u53D6\u56FE\u3002\u4E0D\u7528\u5148\u51B3\u5B9A"\u8BE5\u8C03\u54EA\u4E2A\u5DE5\u5177"\u3002\n\n\u8981\u627E"\u80FD\u5403\u56FE\u7684\u5DE5\u4F5C\u6D41"\uFF1A`comfyui_workflow_list { inputs: "image" }` \u4F1A\u7ED9\u51FA `imageSlots`\uFF0C\u544A\u8BC9\u4F60\u8BE5\u5F80\u54EA\u4E2A\u952E\u4F20\u56FE\u3002\n\n## \u7528\u7D20\u6750\u51FA\u56FE\n\n\u8981"\u8FD9\u5957\u8863\u670D + \u8FD9\u4E2A\u59FF\u52BF\u51FA\u4E00\u5F20"\uFF0C\u4E0D\u5FC5\u81EA\u5DF1\u62FC\u4E94\u6B65\uFF0C\u7528 `comfyui_compose`\uFF1A\n\n1. \u5148\u641C\u7D20\u6750\uFF1A`comfyui_costume` / `comfyui_pose` \u7ED9 `query` \u62FF\u5230 id\n2. `comfyui_compose { costumeId, poseId, tags, prompt }` \u2014\u2014 \u5B83\u628A\u56FE\u843D\u8FDB uploads\u3001\u6309\u69FD\u4F4D\u8BED\u4E49\u586B\u597D vars\u3001\u62FC\u597D\u63D0\u793A\u8BCD\n3. \u628A\u8FD4\u56DE\u7684 `call` \u539F\u6837\u4EA4\u7ED9 `comfyui_run`\n\n\u5B83**\u4E0D\u51FA\u56FE**\uFF0C\u53EA\u4EA7\u51FA\u53C2\u6570\u3002\u8FD4\u56DE\u91CC\u7684 `assumptions` \u662F\u69FD\u4F4D\u6620\u5C04\u7684\u63A8\u65AD\u4F9D\u636E\uFF1Alabel \u6709\u8BED\u4E49\u5C31\u7528 label\uFF0C\n\u5426\u5219\u770B\u9ED8\u8BA4\u6587\u4EF6\u540D\uFF08`pose_ref.png` \u8FD9\u79CD\uFF09\uFF0C\u518D\u4E0D\u884C\u624D\u6309\u987A\u5E8F\u3002\n**\u9760\u987A\u5E8F\u731C\u51FA\u6765\u7684\u69FD\u4F4D\u4F1A\u5199\u8FDB `assumptions`**\uFF08\u9760 label \u6216\u9ED8\u8BA4\u6587\u4EF6\u540D\u5BF9\u4E0A\u7684\u4E0D\u5199 \u2014\u2014 \u90A3\u662F\u8BC1\u636E\u4E0D\u662F\u731C\u6D4B\uFF09\uFF1B\n\u4E0D\u5BF9\u5C31\u7528 `extraVars` \u8986\u76D6\u3002`dropped` \u91CC\u7684\u89D2\u8272\u662F\u6CA1\u5730\u65B9\u653E\u7684\uFF0C\u4E0D\u4F1A\u9759\u9ED8\u4E22\u3002\n\n\u6B63\u5411\u63D0\u793A\u8BCD\u53EA\u5199\u8FDB**\u660E\u786E\u662F\u6B63\u5411**\u7684\u69FD\uFF1Aname/label \u542B prompt/positive/\u6B63\u9762 \u7684\u3002\u5E26 negative\u3001\n\u6216\u770B\u8D77\u6765\u662F\u6587\u4EF6\u540D\u524D\u7F00\u7684\u6587\u672C\u69FD\u4E00\u5F8B\u8DF3\u8FC7 \u2014\u2014 \u5B81\u53EF\u9000\u56DE\u6A21\u677F\u9ED8\u8BA4\uFF0C\u4E5F\u4E0D\u628A\u6B63\u5411\u5185\u5BB9\u5199\u8FDB\u8D1F\u5411\u3002\n\n## \u670D\u52A1\u4E0E\u7B49\u5F85\n\n- \u63D0\u4EA4\u65F6\u4F1A**\u81EA\u52A8\u62C9\u8D77** ComfyUI\uFF0C\u4E0D\u5FC5\u5148\u624B\u52A8\u542F\u52A8\uFF1B\u4E5F\u4E0D\u8981 kill \u5B83 \u2014\u2014 \u5B83\u53EF\u80FD\u6B63\u5728\u4E0B\u8F7D\u6216\u52A0\u8F7D\u6A21\u578B\uFF0C\u6253\u65AD\u4F1A\u8BA9\u5B83\u5361\u5728\u81EA\u5DF1\u7684\u4E0B\u8F7D\u72B6\u6001\u91CC\u3002\n- \u4E00\u6B21\u51FA\u56FE\u5B9E\u6D4B\u4E2D\u4F4D 115 \u79D2\u3001\u6700\u957F 336 \u79D2\u3002\u7528 `comfyui_runs` \u67E5\u72B6\u6001\u3002**\u5DE5\u5177\u63D0\u4EA4\u7684\u8FD0\u884C\u53EA\u6709\u6392\u961F\u4F4D\u7F6E\uFF0C\u6CA1\u6709\u767E\u5206\u6BD4** \u2014\u2014 \u7CBE\u786E\u8FDB\u5EA6\u53EA\u63A5\u5728\u9762\u677F\u90A3\u4E24\u6761\u8DEF\u5F84\u4E0A\u3002\n- \u4E2D\u95F4\u4EA7\u7269\uFF08\u4FDD\u5B58\u8282\u70B9\u7684\u6765\u6E90\u8FD8\u88AB\u522B\u7684\u8BA1\u7B97\u8282\u70B9\u7EE7\u7EED\u6D88\u8D39\uFF09**\u5728\u6709\u6B63\u5F0F\u4EA7\u7269\u65F6**\u4F1A\u88AB\u4E22\u6389\u3001\u4E0D\u8FDB\u8D44\u4EA7\u5E93\uFF1B\u5982\u679C\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\u4E00\u4E2A\u6B63\u5F0F\u4EA7\u7269\u90FD\u6CA1\u6709\uFF0C\u5C31\u4F1A\u9000\u800C\u6C42\u5176\u6B21\u628A\u4E2D\u95F4\u4EA7\u7269\u6536\u4E0B\u6765\u3002\n\n## \u4EC0\u4E48\u65F6\u5019\u7528\u54EA\u4E2A\n\n- \u4E0D\u77E5\u9053\u6709\u54EA\u4E9B\u6A21\u677F \u2192 `comfyui_workflow_list`\n- \u77E5\u9053\u6A21\u677F\u3001\u8981\u6539\u53C2\u6570 \u2192 `comfyui_workflow_inspect` \u67E5\u5B8C\u76F4\u63A5 `comfyui_run`\n- \u5DF2\u6709\u4EA7\u7269\u3001\u60F3\u518D\u6765\u4E00\u5F20\u6216\u505A\u53D8\u4F53 \u2192 `comfyui_rerun`\n- \u8981\u6279\u91CF \u2192 `comfyui_run_batch`\uFF08\u53EA\u6295\u4E00\u6761\u6C47\u603B\u901A\u77E5\uFF0C\u5E76\u6309\u5DE5\u4F5C\u6D41\u5206\u7EC4\u63D0\u4EA4\uFF0C\u907F\u514D\u53CD\u590D\u91CD\u8F7D\u5E95\u6A21\uFF09\n- \u8DD1\u5931\u8D25\u4E86 \u2192 \u770B\u8FD4\u56DE\u7684 `failureKind`\uFF0C\u4E94\u7C7B\u5404\u6709\u5BF9\u5E94\u6539\u6CD5\uFF1B\u8282\u70B9\u662F\u5426\u5B58\u5728\u7528 `comfyui_node_search` \u67E5\n';

// src/shared/host/skill.ts
var WORKBENCH_SKILL_NAME = "comfyui-workbench";
var WORKBENCH_SKILL_DESCRIPTION = "\u8FD9\u5957 ComfyUI \u5DE5\u4F5C\u53F0\u7684\u4F7F\u7528\u8BF4\u660E\uFF1A\u6A21\u677F / \u53D8\u91CF / \u4EA7\u7269 / \u7D20\u6750\u56DB\u5C42\u600E\u4E48\u5206\u5DE5\u3001\u8DD1\u56FE\u7684\u6807\u51C6\u8DEF\u5F84\u3001\u4EE5\u53CA\u4E09\u79CD\u5E38\u89C1\u8BEF\u7528\uFF08\u4E3A\u6539\u53C2\u6570\u53BB\u6539\u5199\u5DE5\u4F5C\u6D41 JSON\u3001\u628A UI \u683C\u5F0F\u4F20\u7ED9 workflow.path\u3001\u6539\u4EA7\u7269 sidecar\uFF09\u3002\u8981\u9A71\u52A8 ComfyUI \u51FA\u56FE\u3001\u7528\u59FF\u52BF\u6216\u8863\u88C5\u7D20\u6750\u62FC\u63D0\u793A\u8BCD\u3001\u6216\u6392\u67E5\u4EA7\u7269\u4E0E\u590D\u73B0\u95EE\u9898\u65F6\u52A0\u8F7D\u3002";
function mountWorkbenchSkill(ctx) {
  const skills = ctx.get?.("skills");
  if (skills?.register === void 0) return;
  try {
    skills.register({
      name: WORKBENCH_SKILL_NAME,
      description: WORKBENCH_SKILL_DESCRIPTION,
      content: workbench_skill_default,
      source: "plugin:dsh-comfyui-workbench"
    });
  } catch {
  }
}

// src/components/panel-workflow/server/config-api.ts
function createConfigHandler(deps) {
  const togglesView = () => {
    const stored = deps.toggles?.read() ?? {};
    return {
      progressStream: effectiveProgressStream(deps.settings, stored),
      progressStreamSource: stored.progressStream === void 0 ? "config" : "toggle"
    };
  };
  const snapshot = () => {
    const diagnostics = deps.getDiagnostics?.() ?? {};
    return {
      baseUrl: deps.settings.baseUrl,
      outputDir: deps.outputDir,
      outputSource: deps.outputSource ?? "config",
      workflowsDir: deps.workflowsDir,
      runMode: deps.settings.runMode,
      returnImages: deps.settings.returnImages,
      timeoutMs: deps.settings.timeoutMs,
      // 面板开关：`progressStreamSource` 让界面说清"这是面板改的还是配置来的"
      toggles: togglesView(),
      ...deps.workspaceProbe === void 0 ? {} : { workspaceProbe: deps.workspaceProbe },
      ...diagnostics.components === void 0 ? {} : { components: diagnostics.components },
      ...diagnostics.tools === void 0 ? {} : { tools: diagnostics.tools }
    };
  };
  return async (_url, res, req) => {
    const method = req.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && method !== "POST") {
      sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u4E2A\u63A5\u53E3\u53EA\u63A5\u53D7 GET / POST\u3002" });
      return;
    }
    if (method === "POST") {
      if (deps.toggles === void 0) {
        sendJson(res, 400, { ok: false, error: "no-toggles", message: "\u8FD9\u4E2A\u90E8\u7F72\u6CA1\u6709\u5F00\u9762\u677F\u5F00\u5173\u3002" });
        return;
      }
      let body;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, { ok: false, error: "bad-body", message: "\u8BFB\u4E0D\u4E86\u8BF7\u6C42\u4F53\u3002" });
        return;
      }
      const bag = body !== null && typeof body === "object" ? body : {};
      const patch = {};
      if (typeof bag.progressStream === "boolean") patch.progressStream = bag.progressStream;
      else if (bag.progressStream === null) patch.progressStream = null;
      else if (bag.progressStream !== void 0) {
        sendJson(res, 400, { ok: false, error: "bad-body", message: "progressStream \u53EA\u63A5\u53D7\u5E03\u5C14\u503C\u6216 null\u3002" });
        return;
      }
      if (patch.progressStream === void 0) {
        sendJson(res, 400, { ok: false, error: "bad-body", message: "\u6CA1\u6709\u8981\u6539\u7684\u5F00\u5173\u3002" });
        return;
      }
      try {
        deps.toggles.write(patch);
      } catch (error) {
        sendJson(res, 200, { ok: false, error: "write-failed", message: error instanceof Error ? error.message : String(error) });
        return;
      }
      sendJson(res, 200, { ok: true, toggles: togglesView() });
      return;
    }
    sendJson(res, 200, { ok: true, config: snapshot() });
  };
}

// src/index.ts
init_overrides();
init_runner();

// src/shared/host/prefs.ts
var PREFIX2 = "dsh-comfyui-workbench:";
function storage() {
  try {
    const view2 = globalThis.window;
    return view2?.localStorage;
  } catch {
    return void 0;
  }
}
function readPref(key, fallback) {
  try {
    const raw = storage()?.getItem(PREFIX2 + key);
    if (raw === "1") return true;
    if (raw === "0") return false;
    return fallback;
  } catch {
    return fallback;
  }
}
function writePref(key, value) {
  try {
    storage()?.setItem(PREFIX2 + key, value ? "1" : "0");
  } catch {
  }
}

// src/index.ts
init_failure_kind();
init_errors();
init_progress();
init_run2();
init_client();
init_notify();
init_batch_notify();
init_policy();
init_runner();

// src/shared/gallery/nsfw.ts
var STRONG = [
  "nsfw",
  "explicit",
  "hentai",
  "r18",
  "rule34",
  "ahegao",
  "pussy",
  "pussies",
  "penis",
  "vagina",
  "areola",
  "genital",
  "semen",
  "sexual",
  "bdsm",
  "erotic",
  "nudity",
  "cameltoe",
  "oppai",
  // 中文：这几个词不会出现在正常描述里
  "\u8272\u60C5",
  "\u88F8\u4F53",
  "\u5B8C\u5168\u88F8\u9732",
  "\u5B8C\u6574\u88F8\u9732",
  "\u8D64\u88F8",
  "\u5168\u88F8",
  "\u534A\u88F8",
  "\u6027\u4EA4",
  "\u9732\u70B9"
];
var MEDIUM = [
  "nude",
  "naked",
  "topless",
  "breast",
  "nipple",
  "lingerie",
  "bondage",
  "underwear",
  "panty",
  "cleavage",
  "seductive",
  "lewd",
  "ecchi",
  "booty",
  "cum",
  "sex",
  // 「裸露」单独出现太常见（“肩头裸露”“背部裸露”都是正常穿着描述），
  // 363 张真实语料里它单命中会误伤 4 张 SFW 插画。降级后要配一个别的才判。
  "\u88F8\u9732",
  // 「乳房」是明确指向，配上「赤裸」就能接住兔女郎那类描述。
  "\u4E73\u623F"
];
var MEDIUM_THRESHOLD = 2;
function nsfwVerdictOf(item) {
  const text3 = [
    item.name ?? "",
    item.prompt ?? "",
    item.checkpoint ?? "",
    item.workflowId ?? ""
  ].join(" ").toLowerCase();
  if (text3.trim() === "") return { nsfw: false, why: [] };
  const strong = STRONG.filter((word) => text3.includes(word));
  if (strong.length > 0) return { nsfw: true, why: strong };
  const medium = MEDIUM.filter((word) => text3.includes(word));
  if (medium.length >= MEDIUM_THRESHOLD) return { nsfw: true, why: medium };
  return { nsfw: false, why: medium };
}
function isNsfw(item) {
  return nsfwVerdictOf(item).nsfw;
}

// src/index.ts
init_supervisor();
init_run2();
init_paths();
var name = "dsh-comfyui-workbench";
var inject = ["webServer", "workspaceRegistry"];
function mountConfig(ctx, rt) {
  const table = {
    exact: {
      "/config": createConfigHandler({
        settings: rt.settings,
        outputDir: rt.outputDir,
        workflowsDir: rt.flowDir,
        outputSource: rt.outputSource,
        workspaceProbe: rt.outputProbe,
        // 缺了这两项，界面拿不到"哪些组件被关掉"，会退化成全开。
        getDiagnostics: () => ({
          components: componentStateOf(rt),
          tools: rt.tools
        }),
        // 面板开关：写在插件数据目录的 settings.json，改完下一次提交就生效，
        // 不用碰 profile 里的 cordis.patch.yml（那要重启）。
        toggles: { read: readToggles, write: writeToggles }
      })
    }
  };
  if (typeof ctx.effect === "function") {
    ctx.effect(() => {
      const unmount = mountRoutes(ctx, "core.config", table);
      return () => {
        unmount();
      };
    }, "core: config");
  } else {
    mountRoutes(ctx, "core.config", table);
  }
}
function apply10(ctx, config) {
  const rt = acquire(ctx, config);
  if (typeof ctx.effect === "function") ctx.effect(() => () => release(ctx), "core: runtime");
  ensureHttp(ctx, rt);
  mountConfig(ctx, rt);
  mountWorkbenchSkill(ctx);
}
function applyAll(ctx, config) {
  const rt = acquire(ctx, config);
  mountConfig(ctx, rt);
  mountWorkbenchSkill(ctx);
  apply3(ctx, config);
  apply9(ctx, config);
  apply6(ctx, config);
  apply7(ctx, config);
  apply8(ctx, config);
  apply4(ctx, config);
  apply2(ctx, config);
  apply(ctx, config);
  apply5(ctx, config);
  return rt;
}
export {
  BatchCollector,
  ComfyClient,
  ComfySupervisor,
  DANBOORU_COMPONENT,
  DEFAULT_SYNC,
  GROUP_INDEX_TITLE,
  KIND_OF_CATEGORY,
  LogTail,
  MIRRORS,
  NodeIndex,
  ROLE_CN,
  RunRegistry,
  SWEEP_MIN_BUDGET_MS,
  TAG_KINDS,
  TOOL_GROUPS,
  TRANSIENT_FINAL_STATE,
  TRANSIENT_LIMIT,
  TagIndex,
  TerminalBuffer,
  UPSTREAM_BASE,
  UPSTREAM_FILES,
  WORKBENCH_SKILL_DESCRIPTION,
  WORKBENCH_SKILL_NAME,
  acquire,
  adviceFor,
  apply10 as apply,
  applyAll,
  applyOverrides,
  buildPrompt,
  bundledCatalogPath,
  bundledCostumePath,
  bundledDir,
  categoryMapPath,
  categoryOf,
  classifyFailure,
  codeOf,
  codeOrDefault,
  componentStateOf,
  composeTool,
  costumeTool,
  createCostumeRoutes,
  createCostumesIndex,
  createGalleryRoutes,
  createImageCache,
  createPoseImages,
  createPosesIndex,
  createPosesRoutes,
  createRunHandler,
  createSyncJob,
  createTagCache,
  createTagsIndex,
  createTagsRoutes,
  createTerminalRoutes,
  createWorkflowRoutes,
  currentMirrors,
  danbooruLookupBatchTool,
  danbooruLookupTool,
  danbooruSyncTool,
  dedupeItems,
  describeNodeErrors,
  effectiveProgressStream,
  executionFailed,
  fetchJson,
  fileRefsOf,
  finalStateOf,
  foldPathCase,
  giveUpMessage,
  groupsPath,
  handleWorkflowList,
  importUpstream,
  inject,
  isAuthorized,
  isFatalRunError,
  isNsfw,
  isRetryable,
  loadWorkflowForBatch,
  looseKey,
  mergedRoutes,
  modelNameIn,
  mountWorkbenchSkill,
  name,
  nodeSearchTool,
  normalizeTag,
  nsfwVerdictOf,
  overrideNotes,
  ownStorePath,
  parseCsvLine,
  parseGroupIndex,
  parseGroupPage,
  pickArtifacts,
  pickNames,
  planOrder,
  planSlots,
  poseTool,
  probeWorkspace,
  pruneSharedAliases,
  readCategoryMap,
  readGroups,
  readPref,
  readStore,
  readTail,
  readToggles,
  registerTools,
  release,
  rerunTool,
  resetNodeIndexCache,
  resetToggleCache,
  resolveOutputDir,
  rowToRecord,
  runBatchTool,
  runSync,
  runTool,
  runsTool,
  searchOnline,
  searchOnlineDetailed,
  searchTags,
  searchTagsLinear,
  sessionWorkspaceDir,
  storePath,
  stripAnsi,
  sweepBudgetOf,
  sweepRun,
  syncGroups,
  syncKind,
  toModelItem,
  toPanelItem,
  togglesPath,
  useMirrors,
  useTimeout,
  waitForRun,
  watchProgress,
  watchRun,
  workflowListTool,
  workspaceDirOf,
  worthKeeping,
  writePref,
  writeStore,
  writeToggles
};
