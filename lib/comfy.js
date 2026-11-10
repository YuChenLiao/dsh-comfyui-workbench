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
    // 判据里的 `value not in list` 在实际链路上很少走到，别把它当成"参数写错"的万能解释：
    // 这个串由 `execution.py:1085` 的 `validate_inputs` 产生，而本分类器只吃
    // `execution_error`（来自 `/history` 的 `status.messages`）。validate 阶段的值非法
    // **不会**写成 execution_error —— ComfyUI 只拒掉那条输出链，其余链照跑，整体仍是
    // `status_str: 'success'`。那条路径的出口是 `no_output`，不是这里。
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
        return `${where === "" ? "\u67D0\u4E2A\u53C2\u6570" : where}\u7684\u53D6\u503C '${rejected.value}' \u4E0D\u5728\u5019\u9009\u5217\u8868\u91CC${nearHint}\u3002\u6539 vars \u91CC\u8FD9\u4E2A\u952E\u518D\u8BD5\uFF08\u5171 ${rejected.options.length} \u4E2A\u5019\u9009\uFF0C\u53EF\u7528 comfyui_workflow \u770B\u5168\uFF09\u3002`;
      }
      return `${where === "" ? "\u67D0\u4E2A\u53C2\u6570" : where}\u7684\u53D6\u503C\u4E0D\u5408\u6CD5\uFF08\u4E0D\u5728\u5019\u9009\u5217\u8868\u6216\u8D85\u51FA\u8303\u56F4\uFF09\u3002\u7528 comfyui_workflow \u52A0\u8BE5\u8282\u70B9\u7684 nodeId \u770B\u5B83\u7684\u53EF\u9009\u503C\u4E0E\u8303\u56F4\uFF0C\u518D\u6539 vars \u91CD\u8BD5\u3002`;
    }
    default:
      return "\u901A\u5E38\u662F\u6A21\u578B/\u8282\u70B9\u53C2\u6570\u4E0D\u5339\u914D\u3002\u5148\u7528 comfyui_workflow \u770B\u7F3A\u4E0D\u7F3A\u8282\u70B9\u4E0E\u6A21\u578B\uFF0C\u518D\u964D\u5206\u8FA8\u7387\u6216\u6362\u5E95\u6A21\u91CD\u8BD5\u3002";
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
  const hint = type === "prompt_no_outputs" ? "\u8FD9\u4EFD\u5DE5\u4F5C\u6D41\u6CA1\u6709\u8F93\u51FA\u8282\u70B9\uFF08ComfyUI \u7684 prompt_no_outputs\uFF09\uFF0C\u8DD1\u5B8C\u4E0D\u4F1A\u4EA7\u751F\u4EFB\u4F55\u4EA7\u7269\u3002\u63A5\u4E00\u4E2A SaveImage / PreviewImage \u4E4B\u7C7B\u7684\u8F93\u51FA\u8282\u70B9\u518D\u63D0\u4EA4\u3002" : type === "prompt_outputs_failed_validation" ? "\u6240\u6709\u8F93\u51FA\u94FE\u7684\u53C2\u6570\u90FD\u88AB\u5224\u4E3A\u975E\u6CD5\u3002\u6309\u88AB\u70B9\u540D\u7684\u8282\u70B9\u9010\u4E2A\u6539\uFF0C\u6216\u5148\u7528 comfyui_workflow \u5BF9\u4E00\u904D\u69FD\u4F4D\u3002" : "\u68C0\u67E5\u88AB\u70B9\u540D\u7684\u8282\u70B9\u53C2\u6570\uFF08\u7C7B\u578B\u3001\u53D6\u503C\u8303\u56F4\uFF09\uFF0C\u6216\u5148\u7528 inspect \u770B\u8BE5\u8282\u70B9\u7684\u8F93\u5165\u3002";
  return new RunError(
    "submit_rejected",
    `ComfyUI \u62D2\u7EDD\u4E86\u8FD9\u6B21\u63D0\u4EA4${first === "" ? "" : `\uFF1A${first}`}`,
    hint,
    body
  );
}
var MAX_WARNINGS = 3;
function renderReceived(value) {
  if (value === void 0) return "";
  if (value === null) return "\uFF0C\u6536\u5230 null";
  if (typeof value === "string") return value === "" ? "\uFF0C\u6536\u5230\u7A7A\u5B57\u7B26\u4E32" : `\uFF0C\u6536\u5230 ${value.length > 80 ? `${value.slice(0, 80)}\u2026` : value}`;
  if (typeof value === "number" || typeof value === "boolean") return `\uFF0C\u6536\u5230 ${String(value)}`;
  try {
    const text = JSON.stringify(value);
    return `\uFF0C\u6536\u5230 ${text.length > 80 ? `${text.slice(0, 80)}\u2026` : text}`;
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
      const text = typeof error.details === "string" ? error.details : "";
      const extra = error.extra_info !== null && typeof error.extra_info === "object" ? error.extra_info : {};
      const input = typeof extra.input_name === "string" ? `\u53C2\u6570 ${extra.input_name}` : "";
      const receivedType = typeof extra.received_type === "string" ? `\u7C7B\u578B ${extra.received_type}` : "";
      const head = [classType, input, receivedType].filter((part) => part !== "").join("\uFF0C");
      const body = [message, text].filter((part) => part !== "").join("\uFF0C");
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
function timedOut(waitedMs, promptId) {
  return new RunError(
    "timeout",
    `\u7B49\u4E86 ${Math.round(waitedMs / 1e3)} \u79D2\u4ECD\u672A\u5B8C\u6210\uFF08prompt ${promptId}\uFF09\u3002`,
    "\u4EFB\u52A1\u6CA1\u6709\u88AB\u53D6\u6D88\uFF0C\u53EF\u80FD\u8FD8\u5728 ComfyUI \u90A3\u8FB9\u8DD1 \u2014\u2014 \u7528\u540C\u4E00\u4E2A promptId \u7EED\u67E5\u3002\u4E5F\u53EF\u4EE5\u8C03\u5927\u7B49\u5F85\u4E0A\u9650\uFF0C\u6216\u964D\u4F4E\u5206\u8FA8\u7387/\u6B65\u6570\u3002"
  );
}

// src/shared/comfy/queue.ts
var RUNNING_KEYS = ["queue_running", "running"];
var PENDING_KEYS = ["queue_pending", "pending"];
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
  const pending = firstArray(bag, PENDING_KEYS);
  return (running?.length ?? 0) > 0 || (pending?.length ?? 0) > 0;
}

// src/shared/comfy/client.ts
var DEFAULT_REQUEST_TIMEOUT = 12e4;
var ComfyClient = class {
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
  async request(path4, init = {}, timeoutMs = this.requestTimeoutMs, skipEnsure = false) {
    if (this.ensure !== void 0 && !skipEnsure) {
      const ready = await this.ensure();
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
    }
    const url = `${this.baseUrl}${path4}`;
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
    const name = typeof bag?.name === "string" ? bag.name : "";
    if (name === "") throw new RunError("output_unreadable", "ComfyUI \u6CA1\u6709\u8FD4\u56DE\u6587\u4EF6\u540D\u3002", "\u68C0\u67E5 /upload/image \u7684\u8FD4\u56DE\u683C\u5F0F\u3002");
    return { name, subfolder: typeof bag?.subfolder === "string" ? bag.subfolder : "" };
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

// src/shared/comfy/supervisor.ts
async function probe(baseUrl, timeoutMs = 3e3) {
  try {
    const res = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}
async function queueBusy(baseUrl, timeoutMs = 2e3) {
  try {
    const res = await fetch(`${baseUrl}/queue`, { signal: AbortSignal.timeout(timeoutMs) });
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
  return names.map((name) => path2.join(installs, name, "ComfyUI"));
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
    return all.filter((name) => /\.(safetensors|ckpt)$/i.test(name) && !/(lora|upscale|vae|realesrgan|control)/i.test(name)).slice(0, limit);
  }
  return all.slice(0, limit);
}
export {
  ComfyClient,
  ComfySupervisor,
  RunError,
  asRunError,
  authFailed,
  availableModels,
  comfyUnreachable,
  describeNodeErrors,
  detectInstallation,
  ensureComfyImage,
  executionFailed,
  isQueueBusy,
  materializeImages,
  missingModels,
  noOutput,
  nodeMissing,
  outputUnreadable,
  parseQueue,
  queueBusy,
  shouldReclaim,
  submitRejected,
  suggestModels,
  timedOut
};
