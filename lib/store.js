// src/store/index-file.ts
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
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

// src/store/index-file.ts
function indexPath() {
  return path2.join(pluginDataDir(), "assets.jsonl");
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
    let text2 = "";
    try {
      text2 = fs2.readFileSync(this.file, "utf8");
    } catch {
      this.loadedAt = now;
      return;
    }
    for (const line of text2.split("\n")) {
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
    ensureDir(path2.dirname(this.file));
    fs2.appendFileSync(this.file, `${JSON.stringify(record)}
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
    ensureDir(path2.dirname(this.file));
    const body = list.map((record) => JSON.stringify(record)).join("\n");
    fs2.writeFileSync(this.file, body === "" ? "" : `${body}
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
import fs7 from "node:fs";
import path7 from "node:path";

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

// src/scan/collect.ts
import fs5 from "node:fs";
import path4 from "node:path";

// src/scan/embedded.ts
import fs4 from "node:fs";
import path3 from "node:path";

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

// src/scan/png-text.ts
import fs3 from "node:fs";
import zlib from "node:zlib";
function readPngTextChunks(imagePath, size) {
  if (size < 16) return void 0;
  const length = Math.min(size, PNG_META_READ_BYTES);
  let fd;
  try {
    fd = fs3.openSync(imagePath, "r");
    const buffer = Buffer.alloc(length);
    const read = fs3.readSync(fd, buffer, 0, length, 0);
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
    if (fd !== void 0) fs3.closeSync(fd);
  }
}

// src/scan/embedded.ts
function readEmbeddedMeta(imagePath, stat) {
  if (path3.extname(imagePath).toLowerCase() !== ".png") return void 0;
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
  if (path3.extname(imagePath).toLowerCase() !== ".png") return false;
  let fd;
  try {
    fd = fs4.openSync(imagePath, "r");
    const buffer = Buffer.alloc(256);
    const read = fs4.readSync(fd, buffer, 0, 256, 0);
    if (read < 64 || buffer[0] !== 137) return false;
    const head = buffer.toString("latin1", 0, read);
    return head.includes("tEXt") && head.includes("prompt");
  } catch {
    return false;
  } finally {
    if (fd !== void 0) fs4.closeSync(fd);
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
      entries = fs5.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = entry.name;
      if (!options.includeHidden && name.startsWith(".")) continue;
      const full = path4.join(dir, name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (depth + 1 > options.maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTS.has(path4.extname(name).toLowerCase())) continue;
      let stat;
      try {
        stat = fs5.statSync(full);
      } catch {
        continue;
      }
      const generatedFlag = fs5.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full);
      const record = {
        path: full,
        name,
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
import fs6 from "node:fs";
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
    sidecarStat = fs6.statSync(metaPath);
  } catch {
    sidecarStat = void 0;
  }
  try {
    imageStat = fs6.statSync(imagePath);
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
      const parsed = JSON.parse(fs6.readFileSync(metaPath, "utf8"));
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

// src/scan/mime.ts
import path6 from "node:path";

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
        bytes = fs7.statSync(file.path).size;
      } catch {
      }
      out.push({
        digest: typeof meta.digest === "string" ? meta.digest : "",
        path: file.path,
        bytes,
        mime: mimeOfExt(path7.extname(file.path)),
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
export {
  AssetIndex,
  indexPath,
  rebuildFromSidecars
};
