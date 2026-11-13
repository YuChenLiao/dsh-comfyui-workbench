var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};

// src/entries/costumes.ts
import fs19 from "node:fs";
import path20 from "node:path";

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

// src/components/panel-costumes/server/routes.ts
function pickStore(deps, raw) {
  if (raw !== "anime") return { index: deps.index, images: deps.images, uploadsDir: deps.uploadsDir };
  return deps.anime;
}
var MAX_BODY = 4 * 1024;
function fileOf(item, size) {
  if (size === "thumb") return item.thumb;
  if (size === "preview") return item.preview;
  return item.full;
}
function sizeOf(value) {
  return value === "full" ? "full" : value === "preview" ? "preview" : "thumb";
}
async function readJson(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > MAX_BODY) throw new Error("\u8BF7\u6C42\u8FC7\u5927");
    chunks.push(buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("\u8BF7\u6C42\u4F53\u8981\u662F JSON \u5BF9\u8C61");
  return parsed;
}
function createCostumeRoutes(deps) {
  const missing = (res) => {
    sendJson(res, 404, { ok: false, error: "no-anime-library", message: "\u8FD9\u4E2A\u5B89\u88C5\u6CA1\u63A5\u52A8\u753B\u7248\u8863\u88C5\u5E93\u3002" });
  };
  return {
    exact: {
      "/costumes": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u670D\u88C5\u5E93\u662F\u53EA\u8BFB\u7684\uFF0C\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const params = url.searchParams;
        const store = pickStore(deps, params.get("source"));
        if (store === void 0) {
          missing(res);
          return;
        }
        try {
          const result = store.index.search({
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
        const store = pickStore(deps, _url.searchParams.get("source"));
        if (store === void 0) {
          missing(res);
          return;
        }
        try {
          sendJson(res, 200, { ok: true, ...store.index.stats() });
        } catch (error) {
          sendJson(res, 500, { ok: false, error: "index-failed", message: error instanceof Error ? error.message : String(error) });
        }
      },
      "/costumes/image": async (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const store = pickStore(deps, url.searchParams.get("source"));
        if (store === void 0) {
          missing(res);
          return;
        }
        const item = store.index.get(url.searchParams.get("id") ?? "");
        if (item === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-costume", message: "\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\u3002" });
          return;
        }
        const size = sizeOf(url.searchParams.get("size"));
        try {
          const image = await store.images.fetch(fileOf(item, size));
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
          body = await readJson(req);
        } catch (error) {
          sendJson(res, 400, { ok: false, error: "bad-body", message: error instanceof Error ? error.message : String(error) });
          return;
        }
        const store = pickStore(deps, typeof body.source === "string" ? body.source : null);
        if (store === void 0) {
          missing(res);
          return;
        }
        const item = store.index.get(typeof body.id === "string" ? body.id : "");
        if (item === void 0) {
          sendJson(res, 404, { ok: false, error: "unknown-costume", message: "\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\u3002" });
          return;
        }
        const size = sizeOf(typeof body.size === "string" ? body.size : void 0);
        try {
          const { file, mediaType } = await store.images.materialize(fileOf(item, size), store.uploadsDir());
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
      "/costumes/cache": (url, res, req) => {
        if (req.method !== "GET" && req.method !== "HEAD") {
          sendJson(res, 405, { ok: false, error: "method-not-allowed", message: "\u8FD9\u6761\u53EA\u63A5\u53D7 GET\u3002" });
          return;
        }
        const store = pickStore(deps, url.searchParams.get("source"));
        if (store === void 0) {
          missing(res);
          return;
        }
        sendJson(res, 200, { ok: true, ...store.images.stats() });
      }
    }
  };
}

// src/components/panel-costumes/server/catalog.ts
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// src/shared/search/fallback.ts
var FILLER_TAIL = /^[着过了的在地得里中下上之吗呢吧啊呀哦嘛]+$/;
function isFillerTail(droppedTail) {
  return droppedTail !== "" && FILLER_TAIL.test(droppedTail);
}
function searchWithPrefixFallback(query, run, maxCuts = 4) {
  const direct = run(query);
  const trimmed = query.trim();
  if (direct.length > 0 || trimmed === "") {
    return { list: direct, usedQuery: query, fellBack: false, droppedTail: "" };
  }
  if (!/[\u4e00-\u9fff]/.test(trimmed)) {
    return { list: direct, usedQuery: query, fellBack: false, droppedTail: "" };
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  for (let cut = 1; cut <= Math.min(last.length - 1, maxCuts); cut += 1) {
    const shortened = last.slice(0, last.length - cut);
    if (shortened === "") break;
    const attempt = [...parts.slice(0, -1), shortened].join(" ");
    const result = run(attempt);
    if (result.length > 0) {
      return { list: result, usedQuery: attempt, fellBack: true, droppedTail: last.slice(last.length - cut) };
    }
  }
  return { list: direct, usedQuery: query, fellBack: false, droppedTail: "" };
}

// src/components/panel-costumes/server/catalog.ts
var MAX_LIMIT = 100;
var DEFAULT_LIMIT = 40;
var STYLE_DIR = { real: "costumes", anime: "costumes-anime" };
function bundledCostumePath(fromUrl = import.meta.url, style = "real") {
  let dir = path.dirname(fileURLToPath(fromUrl));
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, "package.json")) && fs.existsSync(path.join(dir, "data"))) {
      return path.join(dir, "data", STYLE_DIR[style], "catalog.json");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(path.dirname(fileURLToPath(fromUrl)), "..", "..", "..", "data", "costumes", "catalog.json");
}
function readCatalog(file) {
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) throw new Error(`\u670D\u88C5\u76EE\u5F55\u4E3A\u7A7A\u6216\u683C\u5F0F\u4E0D\u5BF9\uFF1A${file}`);
  return parsed;
}
function createCostumesIndex(dataDir, bundledFile, style = "real") {
  const bundled = bundledFile ?? bundledCostumePath(import.meta.url, style);
  let catalog = null;
  let byId = /* @__PURE__ */ new Map();
  let stats = null;
  let stamp = "";
  const fileOf2 = () => {
    const own = path.join(dataDir, STYLE_DIR[style], "catalog.json");
    return fs.existsSync(own) ? own : bundled;
  };
  const stampOf = () => {
    try {
      const stat = fs.statSync(fileOf2());
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
      const loaded = readCatalog(fileOf2());
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
      const limit = Math.min(Math.max(Number(options.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);
      const offset = Math.max(Number(options.offset ?? 0) || 0, 0);
      const filterWith = (raw) => {
        const list = [];
        const split = raw.trim() === "" ? [] : raw.trim().toLowerCase().split(/\s+/).filter(Boolean);
        for (const item of loaded.items) {
          if (onlySafe && item.adult) continue;
          if (category !== "" && item.category !== category) continue;
          if (split.length > 0) {
            const hay = haystack(item);
            if (!split.every((part) => hay.includes(part))) continue;
          }
          list.push(item);
        }
        return list;
      };
      const outcome = searchWithPrefixFallback(query, filterWith);
      return {
        total: outcome.list.length,
        items: outcome.list.slice(offset, offset + limit),
        usedQuery: outcome.usedQuery,
        fellBack: outcome.fellBack,
        droppedTail: outcome.droppedTail
      };
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

// src/shared/tools/types.ts
function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

// src/components/panel-costumes/server/tools.ts
function brief(item) {
  return {
    id: item.id,
    name: item.name,
    category: item.category,
    keywords: item.keywords,
    adult: item.adult
  };
}
function search(store, args) {
  const query = asString(args.query).trim();
  const category = asString(args.category).trim();
  const limit = Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 30);
  const onlySafe = args.onlySafe === true;
  const known = Object.keys(store.index.stats().categories);
  if (category !== "" && !known.includes(category)) {
    return { ok: false, error: `category \u53EA\u80FD\u662F ${known.join(" / ")}\uFF0C\u6536\u5230\u300C${category}\u300D\u3002` };
  }
  const result = store.index.search({ query, category, onlySafe, limit });
  if (result.items.length === 0) {
    const all = store.index.search({ query, limit: 1 });
    return {
      ok: true,
      mode: "search",
      costumes: [],
      total: 0,
      note: all.total === 0 ? "\u6CA1\u6709\u5339\u914D\u7684\u670D\u88C5\u3002\u6362\u4E2A\u8BCD\u8BD5\u8BD5\uFF08\u4E2D\u6587\u63CF\u8FF0\u6216\u82F1\u6587\u5173\u952E\u8BCD\u90FD\u884C\uFF09\uFF0C\u6216\u8005\u53BB\u6389 category / onlySafe\u3002" : `\u6709 ${all.total} \u5957\u7B26\u5408\u5173\u952E\u8BCD\uFF0C\u4F46\u88AB category / onlySafe \u8FC7\u6EE4\u6389\u4E86\u3002\u53BB\u6389\u6761\u4EF6\u518D\u67E5\u3002`
    };
  }
  const storeTotal = store.index.stats().total;
  const broadRatio = storeTotal > 0 ? result.total / storeTotal : 0;
  if (result.fellBack && !isFillerTail(result.droppedTail ?? "")) {
    return {
      ok: false,
      mode: "search",
      matchedQuery: result.usedQuery,
      droppedTail: result.droppedTail,
      error: `\u300C${query}\u300D\u6CA1\u547D\u4E2D\u3002\u81EA\u52A8\u780D\u77ED\u6210\u300C${result.usedQuery}\u300D\u80FD\u67E5\u5230 ${result.total} \u5957\uFF08\u5360\u5168\u5E93 ${Math.round(broadRatio * 100)}%\uFF09\uFF0C\u4F46\u780D\u6389\u7684\u300C${result.droppedTail}\u300D\u662F\u5B9E\u8BCD \u2014\u2014 \u90A3\u4E9B\u7ED3\u679C\u91CC\u53EF\u80FD\u6839\u672C\u6CA1\u6709\u300C${result.droppedTail}\u300D\u3002`,
      hint: "\u6362\u4E2A\u8BCD\uFF1A\u7528\u5355\u54C1\u540D\u8BCD\uFF08\u8FDE\u8863\u88D9 / \u534A\u8EAB\u88D9 / \u9488\u7EC7 / \u857E\u4E1D\uFF09\u6216\u914D\u8272\uFF08\u9ED1\u8272 / \u767D\u8272 / \u68D5\u8272\uFF09\uFF0C\u522B\u7528\u98CE\u683C\u8BCD\uFF08\u6C34\u624B\u670D / \u548C\u670D\uFF09\u3002\u5168\u8868\u89C1 skill\u3002"
    };
  }
  return {
    ok: true,
    mode: "search",
    total: result.total,
    costumes: result.items.map(brief),
    // 回退过的词必须说出来（理由同姿势库）
    ...result.fellBack ? {
      matchedQuery: result.usedQuery,
      droppedTail: result.droppedTail,
      matchedHint: `\u300C${query}\u300D\u6CA1\u547D\u4E2D\uFF0C\u780D\u6389\u300C${result.droppedTail}\u300D\u540E\u6309\u300C${result.usedQuery}\u300D\u67E5\u5230 ${result.total} \u5957\uFF08\u5360\u5168\u5E93 ${Math.round(broadRatio * 100)}%\uFF09\u3002\u7ED3\u679C\u53EF\u80FD\u6BD4\u4F60\u8981\u7684\u5BBD \u2014\u2014 \u88AB\u780D\u6389\u7684\u90A3\u90E8\u5206\u5728\u6570\u636E\u91CC\u53EF\u80FD\u6839\u672C\u4E0D\u5B58\u5728\u3002`
    } : {},
    hint: "\u8981\u54EA\u5957\u7684\u56FE\u5C31\u628A\u5B83\u7684 id \u4F20\u7ED9\u540C\u4E00\u4E2A\u5DE5\u5177\uFF08\u4E0D\u5E26 query\uFF09\u3002keywords \u53EF\u4EE5\u76F4\u63A5\u62FC\u8FDB\u63D0\u793A\u8BCD\u3002"
  };
}
async function fetchOne(store, id, sizeArg) {
  const item = store.index.get(id);
  if (item === void 0) {
    return { ok: false, error: `\u6CA1\u6709\u8FD9\u5957\u670D\u88C5\uFF1A${id}\u3002\u5148\u4E0D\u5E26 id \u641C\u4E00\u4E0B\u62FF\u5230\u6B63\u786E\u7684\u7F16\u53F7\u3002` };
  }
  const size = asString(sizeArg, "full");
  const relative = size === "thumb" ? item.thumb : size === "preview" ? item.preview : item.full;
  try {
    const { file, mediaType } = await store.images.materialize(relative, store.uploadsDir());
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
    description: '\u8863\u88C5\u53C2\u8003\u5E93\uFF0C\u4E24\u4E2A\u753B\u98CE\u7248\u672C\uFF1A`source: "real"`\uFF08\u9ED8\u8BA4\uFF0C1407 \u5957\u5B9E\u62CD\u98CE\uFF09\u4E0E `source: "anime"`\uFF081320 \u5957\u4E8C\u6B21\u5143\u98CE\uFF09\u3002\u4E24\u7248\u90FD\u662F**\u4E0D\u542B\u4EBA\u7269\u7684\u8863\u88C5\u642D\u914D**\uFF0C\u5E26\u4E2D\u6587\u6807\u7B7E\u4E0E**\u82F1\u6587\u5173\u952E\u8BCD**\uFF08\u53EF\u76F4\u63A5\u62FC\u8FDB\u63D0\u793A\u8BCD\uFF09\uFF1B\u7ED9 `query` \u641C\u3001\u7ED9 `id` \u53D6\u56FE\u3002**\u9009\u753B\u98CE\u770B\u4F60\u8981\u4EC0\u4E48**\uFF1A\u8981\u771F\u5B9E\u670D\u88C5\u8D28\u611F\u7528 real\uFF1B\u8981\u4E8C\u6B21\u5143\u753B\u98CE\u7684\u670D\u88C5\u7528 anime \u2014\u2014 \u540E\u8005\u5F53\u53C2\u8003\u56FE\u65F6\u4F1A\u628A\u753B\u98CE\u4E00\u8D77\u5E26\u8FDB\u53BB\u3002**\u67E5\u7684\u65F6\u5019\u7528\u5355\u54C1\u540D\u8BCD\u6216\u5C5E\u6027**\uFF08\u534A\u8EAB\u88D9 / \u9488\u7EC7 / \u8FDE\u8863\u88D9 / \u857E\u4E1D\uFF09\u6216\u914D\u8272\uFF08\u9ED1\u8272 / \u767D\u8272 / \u68D5\u8272\uFF09\uFF1A\u6570\u636E\u662F\u5355\u54C1\u7684\u7EC4\u5408\uFF0C\u6CA1\u6709"\u98CE\u683C"\u8FD9\u4E00\u5C42 \u2014\u2014 `\u6C34\u624B\u670D` / `\u548C\u670D` / `\u6821\u670D` \u8FD9\u7C7B\u98CE\u683C\u8BCD\u67E5\u4E0D\u5230\uFF0C\u8981\u7528\u5B83\u7684\u6784\u6210\u5355\u54C1\u53BB\u63CF\u8FF0\u3002\u4E24\u5E93\u8BCD\u8868\u7565\u6709\u5DEE\u5F02\uFF1A\u52A8\u753B\u7248\u8BF4\u300C\u7F0E\u5E26\u300D\u300C\u540A\u5E26\u80CC\u5FC3\u300D\u300C\u725B\u4ED4\u5E03\u300D\u300C\u76AE\u9769\u300D\uFF0C\u5199\u5B9E\u7248\u8BF4\u300C\u8774\u8776\u7ED3\u300D\u300C\u540A\u5E26\u886B\u300D\u300C\u725B\u4ED4\u300D\u300C\u76AE\u8D28\u300D\u2014\u2014 \u67E5\u4E0D\u5230\u65F6\u6362\u4E2A\u540C\u4E49\u8BCD\u518D\u8BD5\u3002',
    parameters: {
      type: "object",
      properties: {
        source: {
          type: "string",
          enum: ["real", "anime"],
          description: "\u67E5\u54EA\u4E2A\u5E93\uFF1Areal \u5199\u5B9E\u98CE\uFF08\u9ED8\u8BA4\uFF0C1407 \u5957\uFF09\u3001anime \u4E8C\u6B21\u5143\u98CE\uFF081320 \u5957\uFF09\u3002\u4E24\u5E93\u7F16\u53F7\u683C\u5F0F\u76F8\u540C\uFF0C\u6240\u4EE5\u5FC5\u987B\u660E\u786E\u6307\u5B9A\u3002"
        },
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
      const sourceArg = asString(args.source, "real").trim().toLowerCase();
      if (sourceArg !== "real" && sourceArg !== "anime") {
        return { ok: false, error: `source \u53EA\u80FD\u662F real\uFF08\u5199\u5B9E\uFF09\u6216 anime\uFF08\u4E8C\u6B21\u5143\uFF09\uFF0C\u6536\u5230\u300C${sourceArg}\u300D\u3002` };
      }
      const store = sourceArg === "anime" ? deps.anime : { index: deps.index, images: deps.images, uploadsDir: deps.uploadsDir };
      if (store === void 0) {
        return { ok: false, error: '\u8FD9\u4E2A\u5B89\u88C5\u6CA1\u63A5\u52A8\u753B\u7248\u8863\u88C5\u5E93\uFF08data/costumes-anime \u7F3A\u5931\uFF09\u3002\u7528 source: "real" \u6216\u4E0D\u4F20\u3002' };
      }
      const out = id === "" ? search(store, args) : await fetchOne(store, id, args.size);
      return { ...out, source: sourceArg };
    }
  };
}

// src/components/panel-poses/server/images.ts
import fs2 from "node:fs";
import path2 from "node:path";
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
  const diskPathOf = (relativePath) => path2.join(cacheDir, relativePath);
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
      const buffer = fs2.readFileSync(file);
      const mediaType = mediaTypeOf(buffer);
      if (mediaType === void 0 || buffer.length < MIN_BYTES || buffer.length > MAX_BYTES) return void 0;
      const stamp = /* @__PURE__ */ new Date();
      try {
        fs2.utimesSync(file, stamp, stamp);
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
      const dir = path2.join(cacheDir, sub);
      let names = [];
      try {
        names = fs2.readdirSync(dir);
      } catch {
        continue;
      }
      for (const name2 of names) {
        const file = path2.join(dir, name2);
        try {
          const stat = fs2.statSync(file);
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
        fs2.unlinkSync(item.file);
        left -= item.size;
      } catch {
      }
    }
  };
  const download = async (relativePath) => {
    if (!pathPattern.test(relativePath)) throw new Error("\u56FE\u7247\u8DEF\u5F84\u65E0\u6548");
    const cached = readDisk(relativePath);
    if (cached !== void 0) {
      remember(relativePath, cached);
      return cached;
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
      fs2.mkdirSync(path2.dirname(file), { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs2.writeFileSync(temp, buffer);
      fs2.renameSync(temp, file);
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
      const file = path2.join(dir, path2.basename(relativePath));
      fs2.mkdirSync(dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      fs2.writeFileSync(temp, image.buffer);
      fs2.renameSync(temp, file);
      return { file, mediaType: image.mediaType };
    },
    stats: () => {
      let diskFiles = 0;
      let diskBytes = 0;
      for (const sub of cacheSubdirs) {
        const dir = path2.join(cacheDir, sub);
        let names = [];
        try {
          names = fs2.readdirSync(dir);
        } catch {
          continue;
        }
        for (const name2 of names) {
          try {
            const stat = fs2.statSync(path2.join(dir, name2));
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

// src/shared/host/paths.ts
import fs3 from "node:fs";
import path3 from "node:path";
function homeDir() {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}
function pluginDataDir() {
  return path3.join(homeDir(), ".dsh-comfyui-workbench");
}
function workflowsDir() {
  return path3.join(pluginDataDir(), "workflows");
}
function canonical(target) {
  const abs = path3.resolve(target);
  try {
    return fs3.realpathSync.native(abs);
  } catch {
    return abs;
  }
}
function ensureDir(dir) {
  fs3.mkdirSync(dir, { recursive: true });
}
function foldPathCase(value) {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

// src/runtime.ts
import path19 from "node:path";

// src/shared/comfy/client.ts
import crypto from "node:crypto";

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
  async request(path21, init = {}, timeoutMs = this.requestTimeoutMs, skipEnsure = false) {
    if (this.ensure !== void 0 && !skipEnsure) {
      const ready = await this.ensure();
      if (!ready) throw comfyUnreachable(this.baseUrl, new Error("\u670D\u52A1\u672A\u5C31\u7EEA\uFF0C\u81EA\u52A8\u62C9\u8D77\u4E5F\u5931\u8D25\u4E86"));
    }
    const url = `${this.baseUrl}${path21}`;
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
import fs4 from "node:fs";
import path4 from "node:path";
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
    if (!fs4.statSync(path4.join(dir, "main.py")).isFile()) return false;
    return fs4.statSync(path4.join(dir, "models")).isDirectory();
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
    candidates.push(path4.join(home, "ComfyUI"));
    candidates.push(path4.join(home, "comfyui"));
    candidates.push(path4.join(home, ".dsh-comfyui-workbench", "ComfyUI"));
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData !== "") {
    candidates.push(path4.join(localAppData, "ComfyUI"));
    candidates.push(path4.join(localAppData, "Programs", "ComfyUI"));
  }
  for (const drive of ["C:", "D:", "E:", "F:"]) {
    candidates.push(path4.join(`${drive}${path4.sep}`, "ComfyUI"));
    candidates.push(path4.join(`${drive}${path4.sep}`, "comfyui"));
    candidates.push(path4.join(`${drive}${path4.sep}`, "ComfyUI_windows_portable", "ComfyUI"));
    candidates.push(...desktopCandidates(`${drive}${path4.sep}`));
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
  const installs = path4.join(root, "Comfy-Desktop", "ComfyUI-Installs");
  let names;
  try {
    names = fs4.readdirSync(installs);
  } catch {
    return [];
  }
  return names.map((name2) => path4.join(installs, name2, "ComfyUI"));
}
function interpreterOf(dir) {
  const parent = path4.dirname(dir);
  const candidates = [
    path4.join(dir, "venv", "Scripts", "python.exe"),
    path4.join(dir, "venv", "bin", "python"),
    path4.join(dir, "python_embeded", "python.exe"),
    path4.join(dir, ".venv", "Scripts", "python.exe"),
    // Desktop 版：解释器在 ComfyUI 的上一级（ComfyUI-Installs/<实例>/standalone-env）
    path4.join(parent, "standalone-env", "python.exe"),
    path4.join(parent, "standalone-env", "bin", "python")
  ];
  for (const candidate of candidates) {
    try {
      if (fs4.statSync(candidate).isFile()) return candidate;
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
import fs5 from "node:fs";
import path5 from "node:path";

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
import fs6 from "node:fs";
import path6 from "node:path";
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
    this.filePath = outputDir === void 0 ? void 0 : path6.join(outputDir, FILE_NAME);
    if (this.filePath !== void 0) this.load();
  }
  /** 从盘上读回历史。进程重启时还在跑的，标成 stale。 */
  load() {
    if (this.filePath === void 0) return;
    let parsed;
    try {
      if (!fs6.existsSync(this.filePath)) return;
      parsed = JSON.parse(fs6.readFileSync(this.filePath, "utf8"));
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
      fs6.mkdirSync(path6.dirname(this.filePath), { recursive: true });
      const all = [...this.records.values()].sort((a, b) => b.seq - a.seq).slice(0, MAX_RECORDS);
      const tmp = `${this.filePath}.tmp`;
      fs6.writeFileSync(tmp, `${JSON.stringify(all, null, 1)}
`, "utf8");
      fs6.renameSync(tmp, this.filePath);
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
import fs7 from "node:fs";
import path7 from "node:path";
var TAIL_LINES = 200;
function readTail(file, lines = TAIL_LINES) {
  let fd;
  try {
    fd = fs7.openSync(file, "r");
    const size = fs7.fstatSync(fd).size;
    if (size === 0) return "";
    const chunk = 64 * 1024;
    let pos = size;
    let found = 0;
    const pieces = [];
    while (pos > 0 && found <= lines) {
      const readSize = Math.min(chunk, pos);
      pos -= readSize;
      const buf = Buffer.alloc(readSize);
      fs7.readSync(fd, buf, 0, readSize, pos);
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
        fs7.closeSync(fd);
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
      stat = fs7.statSync(this.file);
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
      fd = fs7.openSync(this.file, "r");
      const length = stat.size - this.offset;
      const buf = Buffer.alloc(length);
      fs7.readSync(fd, buf, 0, length, this.offset);
      this.offset = stat.size;
      return buf.toString("utf8");
    } catch {
      return "";
    } finally {
      if (fd !== void 0) {
        try {
          fs7.closeSync(fd);
        } catch {
        }
      }
    }
  }
  /** 探测 ComfyUI 安装目录下的日志文件路径；找不到返回 undefined。 */
  static locate(installDir) {
    if (installDir === void 0 || installDir === "") return void 0;
    const candidate = path7.join(installDir, "user", "comfyui.log");
    try {
      if (fs7.existsSync(candidate)) return candidate;
    } catch {
    }
    return void 0;
  }
};

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
import path11 from "node:path";
function looksInternal(dir) {
  const norm = dir.replace(/\\/g, "/").toLowerCase();
  return !fs10.existsSync(dir) || norm.includes("/.dsh/profiles/") || norm.includes("/.dsh/plugins/") || norm.includes("/node_modules/") || norm.endsWith("/.dsh");
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
    return { guess: { dir: path11.resolve(explicit.trim()), source: "env" }, probe: probe2 };
  }
  try {
    const wd = ctx.get?.("workingDirectory");
    const dir = wd?.defaultDirectory;
    if (typeof dir === "string" && dir !== "") probe2.workingDirectory = dir;
    if (typeof dir === "string" && dir !== "" && !looksInternal(dir)) {
      return { guess: { dir: path11.resolve(dir), source: "workingDirectory" }, probe: probe2 };
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
    return result !== "" && !looksInternal(result) ? path11.resolve(result) : void 0;
  }
  if (result !== null && typeof result === "object") {
    const candidate = result.path ?? result.directory;
    if (typeof candidate === "string" && candidate !== "" && !looksInternal(candidate)) return path11.resolve(candidate);
  }
  return void 0;
}
function resolveOutputDir(configured, guess, dataDir) {
  if (configured !== null) return { dir: configured, source: "config" };
  if (guess !== void 0) {
    return { dir: path11.join(guess.dir, "comfyui-output"), source: guess.source };
  }
  return { dir: path11.join(dataDir, "outputs"), source: "data" };
}

// src/components/panel-gallery/server/store/index-file.ts
import fs11 from "node:fs";
import path12 from "node:path";
function indexPath() {
  return path12.join(pluginDataDir(), "assets.jsonl");
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
    ensureDir(path12.dirname(this.file));
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
    ensureDir(path12.dirname(this.file));
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
import path17 from "node:path";

// src/components/panel-gallery/server/scan/constants.ts
var SIDECAR_MAX_BYTES = 8 * 1024 * 1024;
var PNG_META_READ_BYTES = 64 * 1024;

// src/components/panel-gallery/server/scan/collect.ts
import fs14 from "node:fs";
import path14 from "node:path";

// src/components/panel-gallery/server/scan/embedded.ts
import fs13 from "node:fs";
import path13 from "node:path";

// src/components/panel-gallery/server/scan/png-text.ts
import fs12 from "node:fs";
import zlib from "node:zlib";

// src/components/panel-gallery/server/scan/sidecar.ts
import fs15 from "node:fs";
import "node:path";

// src/components/panel-gallery/server/scan/mime.ts
import path16 from "node:path";

// src/shared/run/runner.ts
import crypto2 from "node:crypto";
import fs18 from "node:fs";
import path18 from "node:path";

// src/shared/media/png-text.ts
import fs17 from "node:fs";
import zlib2 from "node:zlib";

// src/shared/media/constants.ts
var SIDECAR_MAX_BYTES2 = 8 * 1024 * 1024;
var PNG_META_READ_BYTES2 = 64 * 1024;

// src/shared/run/policy.ts
var SWEEP_MIN_BUDGET_MS = 30 * 6e4;

// src/shared/run/notify.ts
import crypto3 from "node:crypto";
var watchers = /* @__PURE__ */ new Map();
var progressStops = /* @__PURE__ */ new Set();
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

// src/http/router.ts
var router_exports = {};
__export(router_exports, {
  PREFIX: () => PREFIX,
  createDispatch: () => createDispatch
});
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
    const dir = path19.join(sessionDir, "comfyui-output");
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

// src/entries/costumes.ts
var name = "dsh-comfyui-workbench:costumes";
var inject = ["webServer", "workspaceRegistry", "tools"];
var COMPONENT = "panel.costumes";
var COSTUME_PATH = /^(thumbs|img)\/costume\/[A-Za-z0-9_-]+\.webp$/;
var COSTUME_ANIME_PATH = /^(thumbs|img)\/[A-Z]+-\d+\.webp$|^png\/[A-Z]+-\d+\.png$/;
var COSTUME_ANIME_ORIGIN = "https://ai-costume-anime-gallery.pages.dev";
var realSingleton = null;
var animeSingleton = null;
function realStore(dataDir, origin, uploadsDir) {
  const key = `${dataDir}|${origin}`;
  if (realSingleton !== null && realSingleton.key === key) return realSingleton.store;
  const index = createCostumesIndex(dataDir, void 0, "real");
  const images = createImageCache({
    cacheDir: path20.join(dataDir, "cache", "costumes"),
    origin,
    pathPattern: COSTUME_PATH,
    // 服装图是两级目录；不传这个，磁盘上限与 /costumes/cache 统计都会失效
    cacheSubdirs: ["thumbs/costume", "img/costume"]
  });
  const store = { index, images, uploadsDir };
  realSingleton = { key, store };
  return store;
}
function animeStore(dataDir, uploadsDir) {
  const key = dataDir;
  if (animeSingleton !== null && animeSingleton.key === key) return animeSingleton.store;
  const index = createCostumesIndex(dataDir, void 0, "anime");
  const images = createImageCache({
    cacheDir: path20.join(dataDir, "cache", "costumes-anime"),
    origin: COSTUME_ANIME_ORIGIN,
    pathPattern: COSTUME_ANIME_PATH,
    cacheSubdirs: ["thumbs", "img", "png"]
  });
  const animeUploads = () => path20.join(uploadsDir(), "anime");
  const store = { index, images, uploadsDir: animeUploads };
  animeSingleton = { key, store };
  return store;
}
function recordFailure(error) {
  const message = error instanceof Error ? `${error.message}
${error.stack ?? ""}` : String(error);
  try {
    const dir = pluginDataDir();
    fs19.mkdirSync(dir, { recursive: true });
    fs19.writeFileSync(path20.join(dir, "last-error.log"), `[${(/* @__PURE__ */ new Date()).toISOString()}] costumes entry
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
  const settings = resolveSettings(config, process.env);
  if (new Set(settings.disabledComponents).has(COMPONENT)) {
    console.warn(`[comfyui-workbench] \u7EC4\u4EF6 ${COMPONENT} \u5DF2\u6309\u914D\u7F6E\u5173\u95ED\u3002`);
    return;
  }
  const dataDir = pluginDataDir();
  const real = realStore(dataDir, settings.posesOrigin, () => settings.uploadsDir ?? path20.join(dataDir, "uploads"));
  const { index, images } = real;
  const anime = fs19.existsSync(path20.join(dataDir, "costumes-anime", "catalog.json")) || fs19.existsSync(bundledCostumePath(import.meta.url, "anime")) ? animeStore(dataDir, () => settings.uploadsDir ?? path20.join(dataDir, "uploads")) : void 0;
  const uploadsDir = () => settings.uploadsDir ?? path20.join(dataDir, "uploads");
  const routes = createCostumeRoutes({ index, images, uploadsDir, ...anime === void 0 ? {} : { anime } });
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
    },
    ...anime === void 0 ? {} : {
      costumeAnime: (id) => {
        const item = anime.index.get(id);
        return item === void 0 ? void 0 : { id: item.id, name: item.name, keywords: item.keywords };
      },
      fetchCostumeAnime: async (id, size) => {
        const item = anime.index.get(id);
        if (item === void 0) throw new Error(`\u52A8\u753B\u7248\u8863\u88C5\u5E93\u91CC\u6CA1\u6709\uFF1A${id}`);
        const relative = size === "thumb" ? item.thumb : item.full;
        const { file } = await anime.images.materialize(relative, anime.uploadsDir());
        return file;
      }
    }
  };
  ensureHttp(ctx, rt);
  if (typeof ctx.effect === "function") {
    ctx.effect(() => mountRoutes(ctx, COMPONENT, { exact: routes.exact }), "costumes: routes");
  } else {
    mountRoutes(ctx, COMPONENT, { exact: routes.exact });
  }
  const tools = ctx.get?.("tools");
  if (tools === void 0 || typeof tools.register !== "function") {
    console.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 tools \u670D\u52A1\uFF0C\u670D\u88C5\u5DE5\u5177\u672A\u6CE8\u518C\u3002");
  } else {
    const deps = { index, images, uploadsDir, ...anime === void 0 ? {} : { anime } };
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
export {
  COMPONENT,
  COSTUME_ANIME_ORIGIN,
  COSTUME_ANIME_PATH,
  COSTUME_PATH,
  apply,
  inject,
  name
};
