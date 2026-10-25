// src/components/tool-danbooru/server/api.ts
var MIRRORS = ["https://danbooru.donmai.us", "https://safebooru.donmai.us"];
var UA = "dsh-comfyui-workbench (+https://github.com/YuChenLiao/dsh-comfyui-workbench)";
var timeoutMs = 8e3;
var preferred = 0;
var mirrors = [...MIRRORS];
async function fetchJson(path3, init) {
  let lastError;
  const total = mirrors.length;
  for (let step = 0; step < total; step += 1) {
    const index = (preferred + step) % total;
    const host = mirrors[index];
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal === void 0 || init.signal === null ? timeout : AbortSignal.any([init.signal, timeout]);
    try {
      const res = await fetch(host + path3, {
        ...init,
        signal,
        headers: { "User-Agent": UA, ...init?.headers ?? {} }
      });
      if (res.ok) {
        preferred = index;
        return res;
      }
      const retryAfter = Number(res.headers.get("retry-after")) || 0;
      const error = new Error(`Danbooru \u8FD4\u56DE ${res.status}\uFF1A${path3}`);
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
  throw lastError ?? new Error(`Danbooru \u8BF7\u6C42\u5931\u8D25\uFF1A${path3}`);
}
async function getJson(path3, init) {
  const res = await fetchJson(path3, init);
  return res.json();
}

// src/components/tool-danbooru/server/store.ts
import fs from "node:fs";
import path from "node:path";
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
  return path.join(dataDir, "danbooru");
}
function storePath(dataDir, kind) {
  return path.join(danbooruDir(dataDir), `${kind}s.jsonl`);
}
function readStore(file) {
  if (!fs.existsSync(file)) return [];
  const out = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const text = line.trim();
    if (text === "") continue;
    try {
      const record = JSON.parse(text);
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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const body = records.map((record) => JSON.stringify(record)).join("\n");
  fs.writeFileSync(tmp, body === "" ? "" : `${body}
`, "utf8");
  fs.renameSync(tmp, file);
}
function searchTags(records, query, limit = 10) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return [];
  const loose = needle.replace(/[\s_]+/g, "_");
  const spaced = needle.replace(/[_\s]+/g, " ");
  const matches = [];
  for (const record of records) {
    const candidates = [record.tag.toLowerCase(), ...record.names.map((name2) => name2.toLowerCase())];
    let best;
    for (const candidate of candidates) {
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
    if (best !== void 0) matches.push({ record, how: best });
  }
  const rank = { exact: 0, prefix: 1, contains: 2 };
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

// src/components/tool-danbooru/tools/lookup.ts
function createTagCache(dataDir) {
  const cache = /* @__PURE__ */ new Map();
  return {
    read: (kind) => {
      const hit = cache.get(kind);
      if (hit !== void 0) return hit;
      const loaded = readStore(storePath(dataDir, kind));
      cache.set(kind, loaded);
      return loaded;
    },
    invalidate: (kind) => {
      if (kind === void 0) cache.clear();
      else cache.delete(kind);
    }
  };
}
var CJK2 = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af]/;
var CATEGORY = { character: 4, artist: 1 };
async function searchOnlineDetailed(query, limit, kind) {
  const trimmed = query.trim();
  if (trimmed === "") return { tags: [], throttled: false };
  const kinds = kind === void 0 ? ["character", "artist"] : [kind];
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
          enum: ["character", "artist", "all"],
          description: "\u67E5\u89D2\u8272\u8FD8\u662F\u753B\u5E08\uFF0C\u9ED8\u8BA4 all\u3002"
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
      const limit = Math.min(Math.max(Number(args.limit ?? 5) || 5, 1), 20);
      if (query === "") return { ok: false, error: "query \u4E0D\u80FD\u4E3A\u7A7A" };
      const kinds = kindArg === "character" ? ["character"] : kindArg === "artist" ? ["artist"] : ["character", "artist"];
      const found = [];
      const rank = { exact: 0, prefix: 1, contains: 2 };
      for (const kind of kinds) {
        const records = deps.cache.read(kind);
        const matches = searchTags(records, query, limit).sort((a, b) => {
          const byHow = (rank[a.how] ?? 3) - (rank[b.how] ?? 3);
          return byHow !== 0 ? byHow : b.record.postCount - a.record.postCount;
        });
        for (const match of matches) found.push(match.record.tag);
      }
      let source = "local";
      let throttled = false;
      if (found.length === 0) {
        source = "online";
        const only = kindArg === "character" ? "character" : kindArg === "artist" ? "artist" : void 0;
        const online = await searchOnlineDetailed(query, limit, only);
        throttled = online.throttled;
        found.push(...online.tags);
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

// src/components/tool-danbooru/server/sync.ts
import fs2 from "node:fs";
var CATEGORY2 = { character: 4, artist: 1 };
async function getJson2(path3, signal) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await getJson(path3, signal === void 0 ? void 0 : { signal });
    } catch (error) {
      const failure = error;
      const status = failure.status;
      if (typeof status === "number" && status !== 404 && status !== 429 && status < 500) throw error;
      if (attempt === 3 || signal?.aborted === true) throw error;
      const hinted = typeof failure.retryAfterMs === "number" ? Math.min(failure.retryAfterMs, 3e4) : 0;
      await new Promise((resolve) => setTimeout(resolve, hinted > 0 ? hinted : 800 * (attempt + 1)));
    }
  }
  throw new Error(`Danbooru \u8BF7\u6C42\u5931\u8D25\uFF1A${path3}`);
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
  const file = storePath(options.dataDir, kind);
  const existing = readStore(file);
  if (records.length === 0) {
    log(`\u62FF\u5230 0 \u6761\uFF0C\u4FDD\u7559\u65E7\u5E93\uFF08${existing.length} \u6761\uFF09\u4E0D\u52A8`);
    return existing;
  }
  if (existing.length > 0 && records.length < existing.length * 0.5) {
    try {
      fs2.copyFileSync(file, `${file}.bak`);
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

// src/shared/host/paths.ts
import fs3 from "node:fs";
import path2 from "node:path";
function homeDir() {
  return process.env.USERPROFILE ?? process.env.HOME ?? "";
}
function pluginDataDir() {
  return path2.join(homeDir(), ".dsh-comfyui-workbench");
}

// src/entries/danbooru.ts
var name = "dsh-comfyui-workbench:danbooru";
var inject = ["tools"];
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
  for (const spec of [danbooruLookupTool(deps), danbooruSyncTool(deps, DEFAULT_SYNC)]) {
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
export {
  apply,
  inject,
  name
};
