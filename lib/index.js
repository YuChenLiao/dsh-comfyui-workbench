// src/index.ts
import fs11 from "node:fs";

// src/host/config.ts
var DEFAULT_CACHE_MS = 4e3;
function resolveSettings(input) {
  const raw = input !== null && typeof input === "object" ? input : {};
  const int = (value, fallback, min, max) => {
    const n = typeof value === "number" ? Math.round(value) : Number.parseInt(String(value ?? ""), 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, n));
  };
  return {
    maxDepth: int(raw.maxDepth, 3, 0, 8),
    maxItems: int(raw.maxItems, 4e3, 50, 2e4),
    cacheMs: int(raw.cacheMs, DEFAULT_CACHE_MS, 0, 6e4),
    includeHidden: raw.includeHidden === true,
    roots: Array.isArray(raw.roots) ? raw.roots.filter((item) => typeof item === "string" && item.trim() !== "") : []
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
import fs10 from "node:fs";
import path11 from "node:path";

// src/assets/authorize.ts
import path3 from "node:path";

// src/assets/paths.ts
import fs2 from "node:fs";
import path2 from "node:path";

// src/host/paths.ts
import fs from "node:fs";
import path from "node:path";
function homeDir() {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}
function canonical(target) {
  const abs = path.resolve(target);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

// src/assets/paths.ts
function comfyImageOutputDir() {
  const file = path2.join(homeDir(), ".dsh-comfyui-image", "config.json");
  try {
    const parsed = JSON.parse(fs2.readFileSync(file, "utf8"));
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
    return abs === base || abs.startsWith(base.endsWith(path3.sep) ? base : base + path3.sep);
  });
}

// src/assets/roots.ts
import fs3 from "node:fs";
import path4 from "node:path";
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
      exists = fs3.statSync(abs).isDirectory();
    } catch {
      exists = false;
    }
    if (!exists) continue;
    roots.push({ path: abs, label: path4.basename(abs) || abs, kind: candidate.kind });
  }
  rootsCache = { at: now, key: cacheKey, value: roots };
  return roots;
}

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
import path6 from "node:path";

// src/scan/embedded.ts
import fs5 from "node:fs";
import path5 from "node:path";

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
  if (path5.extname(imagePath).toLowerCase() !== ".png") return void 0;
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
  if (path5.extname(imagePath).toLowerCase() !== ".png") return false;
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
      const full = path6.join(dir, name2);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(name2)) continue;
        if (depth + 1 > options.maxDepth) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTS.has(path6.extname(name2).toLowerCase())) continue;
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
import path8 from "node:path";
function mimeOf(filePath) {
  return MIME_BY_EXT[path8.extname(filePath).toLowerCase()] ?? "application/octet-stream";
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
import fs9 from "node:fs";
import path10 from "node:path";

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
import crypto from "node:crypto";
import fs8 from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path9 from "node:path";
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
    if (home !== "") bases.push(path9.join(home, ".dsh", "profiles"));
    bases.push(path9.join(path9.dirname(process.execPath), "node_modules", "@deepseek-ai", "dsh"));
    for (const base of bases) {
      try {
        const req = createRequire(path9.join(base, "package.json"));
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
  return path9.join(os.tmpdir(), "dsh-comfyui-workbench-thumbs");
}
function thumbPathFor(target, stat) {
  const key = crypto.createHash("sha1").update(`${target.toLowerCase()}|${stat.mtimeMs}|${stat.size}|${THUMB_EDGE}`).digest("hex");
  return path9.join(thumbDir(), `${key}.webp`);
}
async function ensureThumb(target, stat) {
  const sharp = await loadSharp();
  if (sharp === null) return void 0;
  const dir = thumbDir();
  const file = thumbPathFor(target, stat);
  try {
    if (fs8.statSync(file).size > 0) return file;
  } catch {
  }
  try {
    fs8.mkdirSync(dir, { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await sharp(target, { animated: false, limitInputPixels: 268435456 }).rotate().resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toFile(temp);
    fs8.renameSync(temp, file);
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
  if (!IMAGE_EXTS.has(path10.extname(target).toLowerCase())) {
    return { target, removed: [], error: "\u53EA\u80FD\u5220\u9664\u56FE\u7247\uFF0C\u8DEF\u5F84\u770B\u8D77\u6765\u4E0D\u662F\u56FE\u7247\u3002", code: "not-an-image" };
  }
  let stat;
  try {
    stat = fs9.statSync(target);
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
    fs9.unlinkSync(target);
    removed.push(target);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { target, removed, error: `\u5220\u9664\u5931\u8D25\uFF1A${message}`, code: "delete-failed" };
  }
  try {
    if (fs9.existsSync(sidecar)) {
      fs9.unlinkSync(sidecar);
      removed.push(sidecar);
    }
  } catch {
  }
  try {
    fs9.unlinkSync(thumb);
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
    const base = path10.basename(one, path10.extname(one));
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

// src/http/router.ts
var PREFIX = "/comfyui-workbench/api";
var WRITABLE = /* @__PURE__ */ new Set(["/delete", "/delete-many", "/workflows"]);
function createHandler(ctx, settings) {
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
    const filename = `${path11.basename(target, path11.extname(target))}.workflow.json`;
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
      stat = fs10.statSync(target);
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
          const thumbStat = fs10.statSync(thumb);
          res.writeHead(200, {
            "Content-Type": "image/webp",
            "Content-Length": thumbStat.size,
            "Cache-Control": "private, max-age=86400"
          });
          const thumbStream = fs10.createReadStream(thumb);
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
    const stream = fs10.createReadStream(target);
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
  const routes = {
    "/roots": handleRoots,
    "/items": handleItems,
    "/meta": handleMeta,
    "/workflow": handleWorkflow,
    "/file": handleFile,
    "/delete": handleDelete,
    "/delete-many": handleDeleteMany,
    "/workflows": handleWorkflows
  };
  return async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const sub = url.pathname.slice(PREFIX.length) || "/";
      const writable = WRITABLE.has(sub);
      const methodOk = writable ? req.method === "POST" || req.method === "DELETE" : req.method === "GET" || req.method === "HEAD";
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

// src/index.ts
var name = "dsh-comfyui-workbench";
var inject = ["webServer"];
function readVersion() {
  try {
    const parsed = JSON.parse(fs11.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
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
  const server = ctx.get?.("webServer");
  if (server === void 0 || typeof server.register !== "function") {
    warn(`[${name}] \u62FF\u4E0D\u5230 webServer \u670D\u52A1\uFF0C\u8D44\u4EA7\u5E93 API \u672A\u6CE8\u518C\u3002`);
    return;
  }
  const handler = createHandler(ctx, settings);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => server.register({ kind: "prefix", path: PREFIX, handler }), `${name}: http routes`);
  } else {
    server.register({ kind: "prefix", path: PREFIX, handler });
  }
  info(`[${name}] v${VERSION} \u8D44\u4EA7\u5E93 API \u5C31\u7EEA\uFF1A${PREFIX}\uFF08\u6700\u5927\u6DF1\u5EA6 ${settings.maxDepth}\uFF09`);
}
export {
  VERSION,
  apply,
  inject,
  name
};
