// src/run/runner.ts
import crypto2 from "node:crypto";
import fs6 from "node:fs";
import path6 from "node:path";

// src/host/paths.ts
import fs from "node:fs";
import path from "node:path";
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// src/scan/constants.ts
var SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
var PNG_META_READ_BYTES = 64 * 1024;

// src/scan/collect.ts
import fs4 from "node:fs";
import path3 from "node:path";

// src/scan/embedded.ts
import fs3 from "node:fs";
import path2 from "node:path";

// src/scan/png-text.ts
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

// src/scan/sidecar.ts
import fs5 from "node:fs";
import "node:path";

// src/scan/mime.ts
import path5 from "node:path";

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
function nodeMissing(missing) {
  return new RunError(
    "node_missing",
    `\u5DE5\u4F5C\u6D41\u9700\u8981\u8FD9\u4E9B\u8282\u70B9\uFF0C\u4F46 ComfyUI \u91CC\u6CA1\u6709\uFF1A${missing.join("\u3001")}`,
    "\u5148\u5B89\u88C5\u5BF9\u5E94\u7684\u81EA\u5B9A\u4E49\u8282\u70B9\u5305\uFF0C\u6216\u6362\u6210\u53EA\u542B\u5185\u7F6E\u8282\u70B9\u7684\u5DE5\u4F5C\u6D41\u3002",
    { missing }
  );
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
function timedOut(waitedMs, promptId) {
  return new RunError(
    "timeout",
    `\u7B49\u4E86 ${Math.round(waitedMs / 1e3)} \u79D2\u4ECD\u672A\u5B8C\u6210\uFF08prompt ${promptId}\uFF09\u3002`,
    "\u5DF2\u5411 ComfyUI \u53D1\u51FA\u53D6\u6D88\u3002\u53EF\u4EE5\u8C03\u5927 timeoutMs\uFF0C\u6216\u964D\u4F4E\u5206\u8FA8\u7387/\u6B65\u6570\u3002"
  );
}

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
  const ext = path6.extname(file).toLowerCase();
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
  const safe = path6.basename(filename);
  const first = path6.join(outputDir, safe);
  if (!fs6.existsSync(first)) return first;
  const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
  return path6.join(outputDir, `${stamp}-${safe}`);
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
    const missing = requiredNodes(applied.workflow).filter((name) => !known.has(name));
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
    fs6.writeFileSync(target, bytes);
    const digest = digestOf(bytes);
    const artifact = {
      path: target,
      digest,
      mime: mimeOf2(target),
      bytes: bytes.length
    };
    if (path6.extname(target).toLowerCase() === ".png") {
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
      fs6.writeFileSync(metadataPath, `${JSON.stringify(meta, null, 2)}
`, "utf8");
    } catch {
      metadataPath = void 0;
      notes.push("sidecar \u5199\u5165\u5931\u8D25\uFF08\u4EA7\u7269\u5DF2\u5B58\u5728\uFF0C\u4EC5\u7F3A\u5143\u6570\u636E\uFF09\u3002");
    }
  }
  return { promptId, artifacts, durationMs, effective: applied.effective, notes, ...metadataPath === void 0 ? {} : { metadataPath } };
}
function digestOf(bytes) {
  return crypto2.createHash("sha256").update(bytes).digest("hex").slice(0, 12);
}
export {
  runWorkflow
};
