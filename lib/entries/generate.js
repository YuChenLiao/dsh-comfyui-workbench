var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

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
import fs2 from "node:fs";
import zlib from "node:zlib";
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
var init_png_text = __esm({
  "src/shared/media/png-text.ts"() {
    "use strict";
    init_constants();
  }
});

// src/shared/run/policy.ts
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
var TRANSIENT_LIMIT, TRANSIENT_FINAL_STATE;
var init_policy = __esm({
  "src/shared/run/policy.ts"() {
    "use strict";
    TRANSIENT_LIMIT = 6;
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
        // 判据里的 `value not in list` 在实际链路上很少走到，别把它当成"参数写错"的万能解释：
        // 这个串由 `execution.py:1085` 的 `validate_inputs` 产生，而本分类器只吃
        // `execution_error`（来自 `/history` 的 `status.messages`）。validate 阶段的值非法
        // **不会**写成 execution_error —— ComfyUI 只拒掉那条输出链，其余链照跑，整体仍是
        // `status_str: 'success'`。那条路径的出口是 `no_output`，不是这里。
        test: ({ text }) => /value not in list|out of range|must be (a |an )?(int|float|bool|number|string)|expected .* got|invalid (value|argument|parameter)/i.test(text) || /参数.*(不合法|越界|不在|无效)/.test(text)
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
var RunError;
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
  }
});

// src/shared/comfy/client.ts
import crypto from "node:crypto";
var DEFAULT_REQUEST_TIMEOUT, ComfyClient;
var init_client = __esm({
  "src/shared/comfy/client.ts"() {
    "use strict";
    init_errors();
    DEFAULT_REQUEST_TIMEOUT = 12e4;
    ComfyClient = class {
      baseUrl;
      headers;
      requestTimeoutMs;
      ensure;
      /** `/object_info` 缓存：响应可能好几 MB，同一进程不必反复拉。 */
      /** `/queue` 的短缓存：同一 tick 里多条任务共用一次查询。 */
      queueCache;
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
      async request(path22, init = {}, timeoutMs = this.requestTimeoutMs, skipEnsure = false) {
        if (this.ensure !== void 0 && !skipEnsure) {
          const ready = await this.ensure();
          if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
        }
        const url = `${this.baseUrl}${path22}`;
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
        const value = await this.fetchQueue();
        this.queueCache = { at: now, value };
        return value;
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
        const bag = body;
        const pick = (keys) => {
          for (const key of keys) {
            const value = bag[key];
            if (!Array.isArray(value)) continue;
            const out = [];
            for (const item of value) {
              if (Array.isArray(item) && typeof item[1] === "string") out.push(item[1]);
              else if (item !== null && typeof item === "object" && typeof item.prompt_id === "string") {
                out.push(item.prompt_id);
              }
            }
            return out;
          }
          return [];
        };
        return {
          running: pick(["queue_running", "running"]),
          pending: pick(["queue_pending", "pending"])
        };
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
var ComfySupervisor;
var init_supervisor = __esm({
  "src/shared/comfy/supervisor.ts"() {
    "use strict";
    init_paths();
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
  }
});

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
    init_supervisor();
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
import fs5 from "node:fs";
import path4 from "node:path";
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
  if (refs.length === 0) throw noOutput();
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
var pending;
var init_runner = __esm({
  "src/shared/run/runner.ts"() {
    "use strict";
    init_paths();
    init_png_text();
    init_policy();
    init_comfy();
    init_variables();
    pending = /* @__PURE__ */ new Map();
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
  const url = `${baseUrl.replace(/^http/i, "ws")}/ws?clientId=comfyui-workbench-${Math.random().toString(36).slice(2)}`;
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
    }, { ...options.logger === void 0 ? {} : { logger: options.logger } });
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
        return run.artifacts.map((path22) => ({ path: path22 }));
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
var init_store = __esm({
  "src/shared/workflow/store.ts"() {
    "use strict";
    init_paths();
    init_detect();
    init_surface();
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
import fs7 from "node:fs";
import path6 from "node:path";
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
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
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
          timeoutMs,
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
              notes: preNotes
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
          return { ...formatOutcome(outcome, deps), ...preNotes.length > 0 ? { notes: preNotes } : {} };
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
        const notes = [...preNotes, ...outcome.notes];
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
    init_types();
  }
});

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
function nodeSearchTool(deps) {
  return {
    name: "comfyui_node_search",
    description: '\u6309\u8282\u70B9\u7684\u5404\u9879\u4FE1\u606F\u641C\u7D22\u672C\u673A ComfyUI \u5DF2\u5B89\u88C5\u7684\u8282\u70B9\u3002\u7528\u4E8E\uFF1A\u60F3\u77E5\u9053"\u6709\u54EA\u4E9B\u8282\u70B9\u80FD\u505A\u653E\u5927/\u53BB\u80CC\u666F/\u6362\u8138"\uFF1B\u9047\u5230\u4E0D\u8BA4\u8BC6\u7684\u81EA\u5B9A\u4E49\u8282\u70B9\u65F6\u67E5\u5B83\u7684\u7528\u9014\uFF1B\u67D0\u4E2A\u6A21\u578B\u6587\u4EF6\u80FD\u88AB\u54EA\u4E9B\u8282\u70B9\u52A0\u8F7D\u3002\u8FD4\u56DE\u7CBE\u7B80\u5217\u8868\uFF08\u7C7B\u540D\u3001\u663E\u793A\u540D\u3001\u5206\u7C7B\u3001\u6240\u5C5E\u5305\u3001\u4E00\u53E5\u8BDD\u8BF4\u660E\u4E0E\u547D\u4E2D\u539F\u56E0\uFF09\uFF1Bdetail=true \u624D\u7ED9\u8F93\u5165\u8F93\u51FA\u3002\u81F3\u5C11\u8981\u7ED9\u4E00\u4E2A\u6761\u4EF6 \u2014\u2014 \u4E0D\u52A0\u7B5B\u9009\u5730\u5217\u51FA\u5168\u90E8\u8282\u70B9\u6CA1\u6709\u610F\u4E49\uFF0C\u4E5F\u4E0D\u4F1A\u88AB\u63A5\u53D7\u3002\u6CE8\u610F\uFF1A\u8282\u70B9\u7684\u5143\u6570\u636E\uFF08display_name / description / search_aliases\uFF09\u90FD\u662F\u82F1\u6587\uFF0C\u7528\u4E2D\u6587\u67E5\u4E0D\u5230\u7ED3\u679C\uFF1BhasModel \u8981\u7ED9\u6A21\u578B\u6587\u4EF6\u540D\u7684\u4E00\u6BB5\uFF08\u5982 "waiNSFWIllustrious"\uFF09\uFF0C\u4E0D\u8981\u7ED9 "upscale" \u8FD9\u7C7B\u666E\u901A\u8BCD\u3002',
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
import fs8 from "node:fs";
import path7 from "node:path";
var MAX_COUNT = 20;
function locateSidecar(input) {
  const resolved = path7.resolve(input);
  if (resolved.toLowerCase().endsWith(".json")) {
    return { sidecarPath: resolved };
  }
  const guess = `${resolved}.json`;
  if (fs8.existsSync(guess)) return { sidecarPath: guess, imagePath: resolved };
  const dir = path7.dirname(resolved);
  const base = path7.basename(resolved);
  if (fs8.existsSync(dir)) {
    const candidates = fs8.readdirSync(dir).filter((name2) => name2.startsWith(base) && name2.toLowerCase().endsWith(".json"));
    if (candidates.length > 0) return { sidecarPath: path7.join(dir, candidates.sort()[0]), imagePath: resolved };
  }
  return { sidecarPath: guess, imagePath: resolved };
}
function readSidecar(sidecarPath) {
  if (!fs8.existsSync(sidecarPath)) {
    throw new Error(`\u627E\u4E0D\u5230 sidecar\uFF1A${sidecarPath}\u3002\u8FD9\u4E2A\u5DE5\u5177\u8981\u4ECE\u4EA7\u7269\u65C1\u7684 <\u6587\u4EF6>.json \u8BFB\u53D6\u8FD0\u884C\u53C2\u6570\uFF0C\u8BF7\u7ED9\u4EA7\u7269\u8DEF\u5F84\u6216 sidecar \u8DEF\u5F84\u672C\u8EAB\u3002`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs8.readFileSync(sidecarPath, "utf8"));
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
    description: `\u7528\u67D0\u4E2A\u4EA7\u7269\u5F53\u65F6\u7684\u53C2\u6570\u518D\u8DD1\u4E00\u6B21\uFF08\u6216\u505A\u51E0\u5F20\u53D8\u4F53\uFF09\u3002\u53C2\u6570\u4ECE\u4EA7\u7269\u65C1\u7684 sidecar \u8BFB\u53D6\uFF0C\u4E0D\u5FC5\u624B\u5DE5\u6284 seed / prompt\u3002\u53EA\u8986\u76D6\u4F60\u60F3\u6539\u7684\uFF1A\u7ED9 vars \u6216 seed \u5373\u53EF\uFF0C\u5176\u4F59\u6CBF\u7528\u539F\u503C\u3002count > 1 \u65F6\u6309 seed \u751F\u6210\u53D8\u4F53\uFF08\u4E0A\u9650 ${MAX_COUNT}\uFF09\u3002`,
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
          hint: "\u7528 comfyui_workflow_list \u770B\u73B0\u6709\u5DE5\u4F5C\u6D41\uFF0C\u6216\u6539 sidecar \u91CC\u7684 workflowId\u3002"
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
        seeds: submitted.map((item) => item.seed),
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
    description: '\u67E5 ComfyUI \u4EFB\u52A1\u7684\u8FD0\u884C\u72B6\u6001\uFF1A\u6B63\u5728\u8DD1\u3001\u6392\u961F\u4E2D\u3001\u6700\u8FD1\u5B8C\u6210\u6216\u5931\u8D25\u7684\u3002\u63D0\u4EA4\u4E4B\u540E\u51FA\u56FE\u8981\u51E0\u5206\u949F\uFF0C\u7528\u8FD9\u4E2A\u5DE5\u5177\u786E\u8BA4"\u90A3\u6279\u51FA\u5B8C\u4E86\u6CA1"\uFF0C\u800C\u4E0D\u662F\u9760\u5BF9\u8BDD\u91CC\u63D2\u8FDB\u6765\u7684\u901A\u77E5\u3002\u4E0D\u4F20 state \u65F6\u6309\u65F6\u95F4\u5012\u5E8F\u7ED9\u6700\u8FD1\u7684\u3002',
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

// src/components/tool-generate/tools/run-batch.ts
init_runner();
init_run();
init_overrides();
init_batch_notify();
init_policy();
init_types();
init_notify();
import path8 from "node:path";
var MAX_RUNS = 20;
var BATCH_WAIT_BUDGET_MS = 30 * 6e4;
function mergeWorkflow(outer, inner) {
  if (inner !== void 0 && inner !== null) return inner;
  return outer;
}
function runBatchTool(deps) {
  return {
    name: "comfyui_run_batch",
    description: `\u4E00\u6B21\u63D0\u4EA4\u591A\u4E2A ComfyUI \u4EFB\u52A1\uFF08\u540C\u4E00\u5DE5\u4F5C\u6D41\u8DD1\u591A\u7EC4\u53C2\u6570\uFF0C\u6216\u4E0D\u540C\u5DE5\u4F5C\u6D41\u5404\u8DD1\u4E00\u6B21\uFF09\u3002\u8FD4\u56DE\u6BCF\u6761\u7684 promptId \u6216\u9519\u8BEF\uFF1B**\u90E8\u5206\u5931\u8D25\u4E0D\u5F71\u54CD\u5176\u5B83\u6761\u76EE**\u3002\u9ED8\u8BA4\u5F02\u6B65\uFF1A\u63D0\u4EA4\u5B8C\u7ACB\u523B\u8FD4\u56DE\uFF0C\u51FA\u56FE\u540E\u5404\u81EA\u63A8\u56DE\u5BF9\u8BDD\u3002\u4E00\u6B21\u6700\u591A ${MAX_RUNS} \u6761\u3002\u6CE8\u610F\uFF1A\u4E00\u6B21\u6027\u53C2\u6570\u8986\u76D6\uFF08comfyui_workflow_edit persist=false\uFF09\u7528\u5B8C\u5373\u6E05\uFF0C\u6240\u4EE5\u901A\u5E38\u53EA\u6709**\u7B2C\u4E00\u6761**\u4F1A\u5E26\u4E0A\u5B83\uFF08\u82E5\u7B2C\u4E00\u6761\u63D0\u4EA4\u5931\u8D25\uFF0C\u4F1A\u987A\u5EF6\u7ED9\u4E0B\u4E00\u6761\uFF09\uFF1B\u60F3\u8BA9\u6BCF\u6761\u90FD\u53D8\uFF0C\u8BF7\u76F4\u63A5\u5199\u8FDB vars \u6216\u843D\u76D8\u6A21\u677F\u3002`,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["runs"],
      properties: {
        workflow: {
          type: "object",
          description: '\u5171\u7528\u5DE5\u4F5C\u6D41\uFF1A{"id":"sdxl"} \u6216 {"path":"D:/\u67D0\u5904/workflow.json"}\u3002\u5404\u6761\u53EF\u5404\u81EA\u8986\u76D6\u3002',
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
      const timeoutMs = asInt(args.timeoutMs, deps.timeoutMs, 1e3, 36e5);
      const agent = exec?.agent;
      const canNotify = agent !== void 0 && typeof agent.followup === "function";
      const batchId = `batch-${Date.now().toString(36)}`;
      const items = [];
      const collector = canNotify ? new BatchCollector({
        total: raw.length,
        deliver: (text) => {
          try {
            agent.followup({
              id: batchId,
              role: "user",
              content: [{ type: "text", text }],
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
      const totalBudgetMs = Math.min(timeoutMs * raw.length, BATCH_WAIT_BUDGET_MS);
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
            timeoutMs,
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
              timeoutMs: Math.min(timeoutMs, remaining),
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
function planOrder(raw, shared) {
  const buckets = /* @__PURE__ */ new Map();
  const order = [];
  raw.forEach((entry, index) => {
    const item = entry ?? {};
    const declared = mergeWorkflow(shared, item.workflow);
    const id = typeof declared?.id === "string" ? declared.id.trim() : "";
    const file = typeof declared?.path === "string" ? declared.path.trim() : "";
    const key = id !== "" ? `id:${id}` : file !== "" ? `path:${path8.resolve(file)}` : "default";
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
init_comfy();
init_workflow();
init_types();
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
init_comfy();
import path21 from "node:path";

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

// src/shared/run/registry.ts
import fs9 from "node:fs";
import path9 from "node:path";
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
    this.filePath = outputDir === void 0 ? void 0 : path9.join(outputDir, FILE_NAME);
    if (this.filePath !== void 0) this.load();
  }
  /** 从盘上读回历史。进程重启时还在跑的，标成 stale。 */
  load() {
    if (this.filePath === void 0) return;
    let parsed;
    try {
      if (!fs9.existsSync(this.filePath)) return;
      parsed = JSON.parse(fs9.readFileSync(this.filePath, "utf8"));
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
      fs9.mkdirSync(path9.dirname(this.filePath), { recursive: true });
      const all = [...this.records.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_RECORDS);
      const tmp = `${this.filePath}.tmp`;
      fs9.writeFileSync(tmp, `${JSON.stringify(all, null, 1)}
`, "utf8");
      fs9.renameSync(tmp, this.filePath);
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
import fs10 from "node:fs";
import path10 from "node:path";
var TAIL_LINES = 200;
function readTail(file, lines = TAIL_LINES) {
  let fd;
  try {
    fd = fs10.openSync(file, "r");
    const size = fs10.fstatSync(fd).size;
    if (size === 0) return "";
    const chunk = 64 * 1024;
    let pos = size;
    let found = 0;
    const pieces = [];
    while (pos > 0 && found <= lines) {
      const readSize = Math.min(chunk, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs10.readSync(fd, buf, 0, readSize, pos);
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
        fs10.closeSync(fd);
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
      stat = fs10.statSync(this.file);
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
      fd = fs10.openSync(this.file, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs10.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      return buf.toString("utf8");
    } catch {
      return "";
    } finally {
      if (fd !== void 0) {
        try {
          fs10.closeSync(fd);
        } catch {
        }
      }
    }
  }
  /** 探测 ComfyUI 安装目录下的日志文件路径；找不到返回 undefined。 */
  static locate(installDir) {
    if (installDir === void 0 || installDir === "") return void 0;
    const candidate = path10.join(installDir, "user", "comfyui.log");
    try {
      if (fs10.existsSync(candidate)) return candidate;
    } catch {
    }
    return void 0;
  }
};

// src/shared/authz/authorize.ts
init_paths();
import path12 from "node:path";

// src/shared/authz/legacy-paths.ts
init_paths();
init_paths();
import fs11 from "node:fs";
import path11 from "node:path";
function comfyImageOutputDir() {
  const file = path11.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs11.readFileSync(file, "utf8"));
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
    return abs === base || abs.startsWith(base.endsWith(path12.sep) ? base : base + path12.sep);
  });
}

// src/shared/authz/roots.ts
init_paths();
import fs12 from "node:fs";
import path13 from "node:path";
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
    path: settings.uploadsDir ?? path13.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path13.join(pluginDataDir(), "outputs"), kind: "output" });
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
      exists = fs12.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path13.basename(abs) || abs, kind: candidate.kind });
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
import fs13 from "node:fs";
import path14 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs13.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
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
    return { guess: { dir: path14.resolve(explicit.trim()), source: "env" }, probe: probe2 };
  }
  try {
    const wd = ctx.get?.("workingDirectory");
    const dir = wd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") probe2.workingDirectory = dir;
    if (typeof dir === "string" && dir !== "" && !looksInternal(dir)) {
      return { guess: { dir: path14.resolve(dir), source: "workingDirectory" }, probe: probe2 };
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
    return result !== "" && !looksInternal(result) ? path14.resolve(result) : void 0;
  }
  if (result !== null && typeof result === "object") {
    const candidate = result.path ?? result.directory;
    if (typeof candidate === "string" && candidate !== "" && !looksInternal(candidate)) return path14.resolve(candidate);
  }
  return void 0;
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path14.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path14.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
init_paths();
import fs14 from "node:fs";
import path15 from "node:path";
function indexPath() {
  return path15.join(pluginDataDir(), "assets.jsonl");
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
      text = fs14.readFileSync(this.file, "utf8");
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
    ensureDir(path15.dirname(this.file));
    fs14.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path15.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs14.writeFileSync(this.file, body === "" ? "" : `${body}
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
import fs19 from "node:fs";
import path20 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/components/panel-gallery/server/scan/collect.ts
import fs17 from "node:fs";
import path17 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs16 from "node:fs";
import path16 from "node:path";

// src/components/panel-gallery/server/scan/png-text.ts
import fs15 from "node:fs";
import zlib2 from "node:zlib";

// src/components/panel-gallery/server/scan/sidecar.ts
import fs18 from "node:fs";
import "node:path";

// src/components/panel-gallery/server/scan/mime.ts
import path19 from "node:path";

// src/runtime.ts
init_run();
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
  shared.current?.runs.flush();
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
    const dir = path21.join(sessionDir, "comfyui-output");
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
      const sessionOutput = canonical(path21.join(sessionDir, "comfyui-output"));
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

// src/entries/generate.ts
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
var name = "dsh-comfyui-workbench:generate";
var inject = ["tools", "workspaceRegistry"];
function apply(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("tool.generate")) {
    warnDisabled("tool.generate");
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
export {
  apply,
  inject,
  name
};
