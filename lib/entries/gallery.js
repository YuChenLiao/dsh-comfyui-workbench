var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/components/panel-gallery/server/routes.ts
import fs13 from "node:fs";
import path14 from "node:path";

// src/components/panel-gallery/server/store/index-file.ts
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

// src/components/panel-gallery/server/store/index-file.ts
function indexPath() {
  return path2.join(pluginDataDir(), "assets.jsonl");
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
      text3 = fs2.readFileSync(this.file, "utf8");
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

// src/components/panel-gallery/server/store/rebuild.ts
import fs7 from "node:fs";
import path7 from "node:path";

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

// src/components/panel-gallery/server/scan/collect.ts
import fs5 from "node:fs";
import path4 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs4 from "node:fs";
import path3 from "node:path";

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

// src/components/panel-gallery/server/scan/embedded.ts
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

// src/components/panel-gallery/server/scan/collect.ts
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
      const name2 = entry.name;
      if (!options.includeHidden && name2.startsWith(".")) continue;
      const full = path4.join(dir, name2);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name2)) continue;
        if (depth + 1 > options.maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTS.has(path4.extname(name2).toLowerCase())) continue;
      let stat;
      try {
        stat = fs5.statSync(full);
      } catch {
        continue;
      }
      const generatedFlag = fs5.existsSync(`${full}.json`) || hasEmbeddedPromptHint(full);
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
import path6 from "node:path";
function mimeOf(filePath) {
  return MIME_BY_EXT[path6.extname(filePath).toLowerCase()] ?? "application/octet-stream";
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

// src/shared/authz/authorize.ts
import path9 from "node:path";

// src/shared/authz/legacy-paths.ts
import fs8 from "node:fs";
import path8 from "node:path";
function comfyImageOutputDir() {
  const file = path8.join(homeDir(), ".dsh-comfyui-image", "config.json");
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
  const abs = foldPathCase(canonical(target));
  return roots.some((root) => {
    const base = foldPathCase(root.path);
    return abs === base || abs.startsWith(base.endsWith(path9.sep) ? base : base + path9.sep);
  });
}

// src/shared/authz/roots.ts
import fs9 from "node:fs";
import path10 from "node:path";
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
    path: settings.uploadsDir ?? path10.join(pluginDataDir(), "uploads"),
    kind: "upload"
  });
  if (typeof settings.resolvedOutputDir === "string" && settings.resolvedOutputDir !== "") {
    candidates.push({ path: settings.resolvedOutputDir, kind: "output" });
  }
  candidates.push({ path: path10.join(pluginDataDir(), "outputs"), kind: "output" });
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
      exists = fs9.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path10.basename(abs) || abs, kind: candidate.kind });
  }
  rootsCache = { at: now, key: cacheKey, value: roots };
  return roots;
}

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
import fs11 from "node:fs";
import path12 from "node:path";

// src/components/panel-gallery/server/assets/dedupe.ts
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

// src/components/panel-gallery/server/assets/thumbs.ts
import crypto from "node:crypto";
import fs10 from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path11 from "node:path";
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
    if (home !== "") bases.push(path11.join(home, ".dsh", "profiles"));
    bases.push(path11.join(path11.dirname(process.execPath), "node_modules", "@deepseek-ai", "dsh"));
    for (const base of bases) {
      try {
        const req = createRequire(path11.join(base, "package.json"));
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
  return path11.join(os.tmpdir(), "dsh-comfyui-workbench-thumbs");
}
function thumbPathFor(target, stat) {
  const key = crypto.createHash("sha1").update(`${foldPathCase(target)}|${stat.mtimeMs}|${stat.size}|${THUMB_EDGE}`).digest("hex");
  return path11.join(thumbDir(), `${key}.webp`);
}
async function ensureThumb(target, stat) {
  const sharp = await loadSharp();
  if (sharp === null) return void 0;
  const dir = thumbDir();
  const file = thumbPathFor(target, stat);
  try {
    if (fs10.statSync(file).size > 0) return file;
  } catch {
  }
  try {
    fs10.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await sharp(target, { animated: false, limitInputPixels: 268435456 }).rotate().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(temp);
    fs10.renameSync(temp, file);
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
  if (!IMAGE_EXTS.has(path12.extname(target).toLowerCase())) {
    return { target, removed: [], error: "\u53EA\u80FD\u5220\u9664\u56FE\u7247\uFF0C\u8DEF\u5F84\u770B\u8D77\u6765\u4E0D\u662F\u56FE\u7247\u3002", code: "not-an-image" };
  }
  let stat;
  try {
    stat = fs11.statSync(target);
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
    fs11.unlinkSync(target);
    removed.push(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { target, removed, error: `\u5220\u9664\u5931\u8D25\uFF1A${message}`, code: "delete-failed" };
  }
  try {
    if (fs11.existsSync(sidecar)) {
      fs11.unlinkSync(sidecar);
      removed.push(sidecar);
    }
  } catch {
  }
  try {
    fs11.unlinkSync(thumb);
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
    const base = path12.basename(one, path12.extname(one));
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
import crypto2 from "node:crypto";
import fs12 from "node:fs";
import path13 from "node:path";

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

// src/components/panel-gallery/server/upload-api.ts
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
  const base = path13.basename(filename, path13.extname(filename));
  const cleaned = base.replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  return `${cleaned === "" ? "image" : cleaned}${ext}`;
}
function createUploadHandler(uploadsDir) {
  return async (url, res, req) => {
    const filename = url.searchParams.get("filename") ?? "";
    const ext = path13.extname(filename).toLowerCase() || ".png";
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
    const digest = crypto2.createHash("sha1").update(bytes).digest("hex").slice(0, 8);
    const target = path13.join(uploadsDir, `${stamp}-${digest}-${safeName(filename, ext)}`);
    try {
      fs12.writeFileSync(target, bytes);
    } catch (error) {
      sendJson(res, 500, { ok: false, error: "write-failed", message: error instanceof Error ? error.message : String(error) });
      return;
    }
    const result = { ok: true, path: target, bytes: bytes.length, mime, name: path13.basename(target) };
    if (ext === ".png") {
      const parsed = readPngTextChunks(target, bytes.length);
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
    const filename = `${path14.basename(target, path14.extname(target))}.workflow.json`;
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
      stat = fs13.statSync(target);
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
          const thumbStat = fs13.statSync(thumb);
          res.writeHead(200, {
            "Content-Type": "image/webp",
            "Content-Length": thumbStat.size,
            "Cache-Control": "private, max-age=86400"
          });
          const thumbStream = fs13.createReadStream(thumb);
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
    const stream = fs13.createReadStream(target);
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
import path19 from "node:path";

// src/shared/comfy/client.ts
import crypto3 from "node:crypto";

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
  clientId = crypto3.randomUUID();
  constructor(options) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.headers = options.headers ?? {};
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT;
    this.ensure = options.ensure;
  }
  /** 发一个请求；网络层失败统一归成 comfy_unreachable。 */
  async request(path20, init = {}, timeoutMs = this.requestTimeoutMs, skipEnsure = false) {
    if (this.ensure !== void 0 && !skipEnsure) {
      const ready = await this.ensure();
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
    }
    const url = `${this.baseUrl}${path20}`;
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
import fs14 from "node:fs";
import path15 from "node:path";
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
    if (!fs14.statSync(path15.join(dir, "main.py")).isFile()) return false;
    return fs14.statSync(path15.join(dir, "models")).isDirectory();
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
    candidates.push(path15.join(home, "ComfyUI"));
    candidates.push(path15.join(home, "comfyui"));
    candidates.push(path15.join(home, ".dsh-comfyui-workbench", "ComfyUI"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData !== "") {
    candidates.push(path15.join(localAppData, "ComfyUI"));
    candidates.push(path15.join(localAppData, "Programs", "ComfyUI"));
  }
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    candidates.push(path15.join(`${drive}${path15.sep}`, "ComfyUI"));
    candidates.push(path15.join(`${drive}${path15.sep}`, "comfyui"));
    candidates.push(path15.join(`${drive}${path15.sep}`, "ComfyUI_windows_portable", "ComfyUI"));
    candidates.push(...desktopCandidates(`${drive}${path15.sep}`));
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
  const installs = path15.join(root, "Comfy-Desktop", "ComfyUI-Installs");
  let names;
  try {
    names = fs14.readdirSync(installs);
  } catch {
    return [];
  }
  return names.map((name2) => path15.join(installs, name2, "ComfyUI"));
}
function interpreterOf(dir) {
  const parent = path15.dirname(dir);
  const candidates = [
    path15.join(dir, "venv", "Scripts", "python.exe"),
    path15.join(dir, "venv", "bin", "python"),
    path15.join(dir, "python_embeded", "python.exe"),
    path15.join(dir, ".venv", "Scripts", "python.exe"),
    // Desktop 版：解释器在 ComfyUI 的上一级（ComfyUI-Installs/<实例>/standalone-env）
    path15.join(parent, "standalone-env", "python.exe"),
    path15.join(parent, "standalone-env", "bin", "python")
  ];
  for (const candidate of candidates) {
    try {
      if (fs14.statSync(candidate).isFile()) return candidate;
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
import fs15 from "node:fs";
import path16 from "node:path";

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
import fs16 from "node:fs";
import path17 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs16.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
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
    return { guess: { dir: path17.resolve(explicit.trim()), source: "env" }, probe: probe2 };
  }
  try {
    const wd = ctx.get?.("workingDirectory");
    const dir = wd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") probe2.workingDirectory = dir;
    if (typeof dir === "string" && dir !== "" && !looksInternal(dir)) {
      return { guess: { dir: path17.resolve(dir), source: "workingDirectory" }, probe: probe2 };
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
    return result !== "" && !looksInternal(result) ? path17.resolve(result) : void 0;
  }
  if (result !== null && typeof result === "object") {
    const candidate = result.path ?? result.directory;
    if (typeof candidate === "string" && candidate !== "" && !looksInternal(candidate)) return path17.resolve(candidate);
  }
  return void 0;
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path17.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path17.join(dataDir, "outputs"), source: "data" };
}

// src/shared/run/runner.ts
import crypto4 from "node:crypto";
import fs18 from "node:fs";
import path18 from "node:path";

// src/shared/media/png-text.ts
import fs17 from "node:fs";
import zlib2 from "node:zlib";

// src/shared/media/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/shared/run/notify.ts
import crypto5 from "node:crypto";
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
    const dir = path19.join(sessionDir, "comfyui-output");
    ensureDir(dir);
    sessionOutputDirs.add(canonical(dir));
    return dir;
  };
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
  const assertWritable = (dir, agent) => {
    const roots = rootsOf(ctx, rootsSettings);
    if (roots.length === 0) return;
    if (isAuthorized(dir, roots)) return;
    const sessionDir = sessionWorkspaceDir(ctx, agent);
    if (sessionDir !== void 0) {
      const sessionOutput = canonical(path19.join(sessionDir, "comfyui-output"));
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

// src/entries/gallery.ts
var name = "dsh-comfyui-workbench:gallery";
function warnDisabled(id) {
  console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${id} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
}
var inject = ["webServer", "workspaceRegistry"];
function apply(ctx, config) {
  if (new Set(resolveSettings(config, process.env).disabledComponents).has("panel.gallery")) {
    warnDisabled("panel.gallery");
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
export {
  apply,
  inject,
  name
};
