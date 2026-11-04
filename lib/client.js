window.__ModuleLoader__.load({ id: "dsh-comfyui-workbench", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  __test: () => __test,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/components/panel-workflow/client/WorkflowAdmin.tsx
var import_react = require("react");

// src/client/api.ts
var API = "/comfyui-workbench/api";
async function apiJson(route, params) {
  const qs = params !== void 0 ? `?${new URLSearchParams(params).toString()}` : "";
  const res = await fetch(API + route + qs);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const bag = data !== null && typeof data === "object" ? data : null;
  if (!res.ok || bag === null || bag.ok !== true) {
    const message = typeof bag?.message === "string" ? bag.message : `\u8BF7\u6C42\u5931\u8D25\uFF1AHTTP ${res.status}`;
    throw new Error(message);
  }
  return bag ?? {};
}
async function setProgressStream(progressStream) {
  const res = await fetch(`${API}/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ progressStream })
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) throw new Error(typeof bag?.message === "string" ? bag.message : `\u4FDD\u5B58\u5931\u8D25\uFF1AHTTP ${res.status}`);
  const toggles = bag.toggles !== null && typeof bag.toggles === "object" ? bag.toggles : null;
  if (toggles === null) throw new Error("\u5BBF\u4E3B\u6CA1\u6709\u8FD4\u56DE\u5F00\u5173\u72B6\u6001\u3002");
  return toggles;
}
async function updateWorkflow(id, body) {
  const res = await fetch(`${API}/workflows/${encodeURIComponent(id)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) throw new Error(typeof bag?.message === "string" ? bag.message : `\u4FDD\u5B58\u5931\u8D25\uFF1AHTTP ${res.status}`);
  return data;
}
async function fetchTags(options) {
  const params = new URLSearchParams();
  if (options.query !== void 0 && options.query !== "") params.set("q", options.query);
  if (options.kind !== void 0 && options.kind !== "") params.set("kind", options.kind);
  if (options.category !== void 0 && options.category !== "") params.set("category", options.category);
  if (options.offset !== void 0) params.set("offset", String(options.offset));
  if (options.limit !== void 0) params.set("limit", String(options.limit));
  const res = await fetch(`${API}/tags?${params.toString()}`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u6807\u7B7E\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    items: Array.isArray(bag.items) ? bag.items : [],
    total: typeof bag.total === "number" ? bag.total : 0
  };
}
async function fetchTagStats() {
  const res = await fetch(`${API}/tags/stats`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u6807\u7B7E\u7EDF\u8BA1\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    kinds: bag.kinds !== null && typeof bag.kinds === "object" ? bag.kinds : {},
    categories: bag.categories !== null && typeof bag.categories === "object" ? bag.categories : {},
    labels: bag.labels !== null && typeof bag.labels === "object" ? bag.labels : {},
    total: typeof bag.total === "number" ? bag.total : 0
  };
}
async function startTagSync() {
  const res = await fetch(`${API}/tags/sync`, { method: "POST" });
  return readSyncState(res);
}
async function fetchTagSync() {
  const res = await fetch(`${API}/tags/sync`);
  return readSyncState(res);
}
async function readSyncState(res) {
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u66F4\u65B0\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    state: bag.state ?? "idle",
    stage: typeof bag.stage === "string" ? bag.stage : "",
    done: typeof bag.done === "number" ? bag.done : 0,
    total: typeof bag.total === "number" ? bag.total : 0,
    message: typeof bag.message === "string" ? bag.message : "",
    lastSuccessAt: typeof bag.lastSuccessAt === "number" ? bag.lastSuccessAt : 0,
    results: Array.isArray(bag.results) ? bag.results : [],
    groups: bag.groups ?? null
  };
}
async function fetchRunStatus(promptId) {
  const res = await fetch(`${API}/run-status?promptId=${encodeURIComponent(promptId)}`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u67E5\u8FD0\u884C\u72B6\u6001\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    found: bag.found === true,
    state: typeof bag.state === "string" ? bag.state : "unknown",
    ...typeof bag.queuePosition === "number" ? { queuePosition: bag.queuePosition } : {},
    ...bag.progress === void 0 ? {} : { progress: bag.progress },
    ...bag.error === void 0 ? {} : { error: bag.error },
    ...bag.artifacts === void 0 ? {} : { artifacts: bag.artifacts }
  };
}
async function fetchPostRefs(options) {
  const params = new URLSearchParams();
  if (options.query !== void 0 && options.query !== "") params.set("q", options.query);
  if (options.limit !== void 0) params.set("limit", String(options.limit));
  if (options.rating !== void 0) params.set("rating", options.rating);
  const res = await fetch(`${API}/tags/refs?${params.toString()}`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u53C2\u8003\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return Array.isArray(bag.items) ? bag.items : [];
}
var WorkflowExistsError = class extends Error {
  workflowId;
  constructor(workflowId, message) {
    super(message);
    this.name = "WorkflowExistsError";
    this.workflowId = workflowId;
  }
};
async function importWorkflow(body) {
  const res = await fetch(`${API}/workflows/import`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.error === "already-exists") {
    throw new WorkflowExistsError(String(bag.workflowId ?? ""), typeof bag.message === "string" ? bag.message : "");
  }
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u5BFC\u5165\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return { workflowId: String(bag.workflowId ?? ""), replaced: bag.replaced === true };
}
async function fetchConfig() {
  const data = await apiJson("/config");
  const bag = data.config !== null && typeof data.config === "object" ? data.config : null;
  if (bag === null) throw new Error("\u5BBF\u4E3B\u6CA1\u6709\u8FD4\u56DE\u914D\u7F6E\u3002");
  return bag;
}
async function fetchWorkflowList() {
  const data = await apiJson("/workflows");
  return {
    workflows: Array.isArray(data.workflows) ? data.workflows : [],
    ...Array.isArray(data.broken) ? { broken: data.broken } : {}
  };
}
function fileUrl(path, thumb) {
  return `${API}/file?path=${encodeURIComponent(path)}${thumb === true ? "&thumb=1" : ""}`;
}
async function fetchBlob(path) {
  const res = await fetch(fileUrl(path));
  if (!res.ok) throw new Error(`\u8BFB\u53D6\u56FE\u7247\u5931\u8D25\uFF1AHTTP ${res.status}`);
  return await res.blob();
}
function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5e3);
}
async function fetchPoses(options) {
  const params = new URLSearchParams();
  if (options.query !== void 0 && options.query !== "") params.set("q", options.query);
  if (options.system !== void 0 && options.system !== "") params.set("system", options.system);
  if (options.category !== void 0 && options.category !== "") params.set("category", options.category);
  if (options.safe === true) params.set("safe", "1");
  if (options.offset !== void 0) params.set("offset", String(options.offset));
  if (options.limit !== void 0) params.set("limit", String(options.limit));
  const res = await fetch(`${API}/poses?${params.toString()}`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u59FF\u52BF\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    items: Array.isArray(bag.items) ? bag.items : [],
    total: typeof bag.total === "number" ? bag.total : 0
  };
}
async function fetchPoseStats() {
  const res = await fetch(`${API}/poses/stats`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    const message = typeof bag?.message === "string" ? bag.message : `\u53D6\u59FF\u52BF\u7EDF\u8BA1\u5931\u8D25\uFF1AHTTP ${res.status}`;
    throw new Error(message);
  }
  return {
    systems: Array.isArray(bag.systems) ? bag.systems : [],
    categories: bag.categories !== null && typeof bag.categories === "object" ? bag.categories : {},
    poseCount: typeof bag.poseCount === "number" ? bag.poseCount : 0,
    viewCount: typeof bag.viewCount === "number" ? bag.viewCount : 0,
    adultPoseCount: typeof bag.adultPoseCount === "number" ? bag.adultPoseCount : 0,
    safePoseCount: typeof bag.safePoseCount === "number" ? bag.safePoseCount : 0,
    attribution: typeof bag.attribution === "string" ? bag.attribution : "",
    source: typeof bag.source === "string" ? bag.source : "",
    origin: typeof bag.origin === "string" ? bag.origin : ""
  };
}
function poseImageUrl(viewId, size = "thumb") {
  return `${API}/poses/image?id=${encodeURIComponent(viewId)}&size=${size}`;
}
async function fetchPoseFile(viewId, size = "full") {
  const res = await fetch(`${API}/poses/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: viewId, size })
  });
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true || typeof bag.file !== "string") {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u7EBF\u7A3F\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return { file: bag.file };
}
async function fetchCostumes(options) {
  const params = new URLSearchParams();
  if (options.query !== void 0 && options.query !== "") params.set("q", options.query);
  if (options.category !== void 0 && options.category !== "") params.set("category", options.category);
  if (options.safe === true) params.set("safe", "1");
  if (options.offset !== void 0) params.set("offset", String(options.offset));
  if (options.limit !== void 0) params.set("limit", String(options.limit));
  const res = await fetch(`${API}/costumes?${params.toString()}`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u670D\u88C5\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    items: Array.isArray(bag.items) ? bag.items : [],
    total: typeof bag.total === "number" ? bag.total : 0
  };
}
async function fetchCostumeStats() {
  const res = await fetch(`${API}/costumes/stats`);
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true) {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u670D\u88C5\u7EDF\u8BA1\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  return {
    total: typeof bag.total === "number" ? bag.total : 0,
    adultCount: typeof bag.adultCount === "number" ? bag.adultCount : 0,
    safeCount: typeof bag.safeCount === "number" ? bag.safeCount : 0,
    categories: bag.categories !== null && typeof bag.categories === "object" ? bag.categories : {},
    attribution: typeof bag.attribution === "string" ? bag.attribution : "",
    source: typeof bag.source === "string" ? bag.source : "",
    origin: typeof bag.origin === "string" ? bag.origin : ""
  };
}
function costumeImageUrl(id, size = "thumb") {
  return `${API}/costumes/image?id=${encodeURIComponent(id)}&size=${size}`;
}
async function fetchCostumeFile(id, size = "full") {
  const res = await fetch(`${API}/costumes/fetch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, size })
  });
  const data = await res.json().catch(() => null);
  const bag = data !== null && typeof data === "object" ? data : null;
  if (bag?.ok !== true || typeof bag.file !== "string") {
    throw new Error(typeof bag?.message === "string" ? bag.message : `\u53D6\u670D\u88C5\u56FE\u5931\u8D25\uFF1AHTTP ${res.status}`);
  }
  const keywords = bag.costume !== void 0 && typeof bag.costume.keywords === "string" ? bag.costume.keywords : "";
  return { file: bag.file, keywords };
}

// src/client/icons-data.ts
var ICON_BODY = {
  workflow: '<rect x="3" y="3.5" width="7" height="6" rx="1.6"/><rect x="14" y="3.5" width="7" height="6" rx="1.6"/><rect x="3" y="14" width="7" height="6" rx="1.6"/><rect x="14" y="14" width="7" height="6" rx="1.6"/>',
  album: '<rect x="2.75" y="4.75" width="18.5" height="14.5" rx="2.6"/><circle cx="8.4" cy="9.7" r="1.55" fill="currentColor" stroke="none"/><path d="M3.9 17.4l4.35-4.2a1.6 1.6 0 0 1 2.2 0l3.55 3.5"/><path d="M12.9 14.2l1.75-1.7a1.6 1.6 0 0 1 2.2 0l2.55 2.5"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2.4"/><path d="M15 5.6A2.1 2.1 0 0 0 12.9 3.5H5.9A2.4 2.4 0 0 0 3.5 5.9v7a2.1 2.1 0 0 0 2.1 2.1"/>',
  text: '<path d="M4 6.5h16"/><path d="M4 12h11"/><path d="M4 17.5h8"/>',
  download: '<path d="M12 3.8v10.4"/><path d="M7.9 10.5l4.1 4.1 4.1-4.1"/><path d="M4.2 18.2v.6A2.2 2.2 0 0 0 6.4 21h11.2a2.2 2.2 0 0 0 2.2-2.2v-.6"/>',
  chat: '<path d="M4.2 5.8A2.3 2.3 0 0 1 6.5 3.5h11A2.3 2.3 0 0 1 19.8 5.8v8.2a2.3 2.3 0 0 1-2.3 2.3H9.6l-5.4 4z"/><path d="M12 7.6v5"/><path d="M9.5 10.1h5"/>',
  close: '<path d="M6.5 6.5l11 11"/><path d="M17.5 6.5l-11 11"/>',
  refresh: '<path d="M20.2 12a8.2 8.2 0 1 1-2.5-5.9"/><path d="M20.4 3.8v5h-5"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.6"/><path d="M15.6 15.6l4.4 4.4"/>',
  dock: '<rect x="3" y="4.2" width="18" height="15.6" rx="2.5"/><path d="M14.6 4.2v15.6"/>',
  chevronLeft: '<path d="M14.6 5.6L8 12l6.6 6.4"/>',
  chevronRight: '<path d="M9.4 5.6L16 12l-6.6 6.4"/>',
  minus: '<path d="M5.5 12h13"/>',
  plus: '<path d="M12 5.5v13"/><path d="M5.5 12h13"/>',
  image: '<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="M4.5 17l4.6-4.4a2 2 0 0 1 2.7 0l2.1 2"/><path d="M13.5 15.5l1.9-1.8a2 2 0 0 1 2.7 0l1.4 1.3"/>',
  trash: '<path d="M4.5 6.8h15"/><path d="M9.4 6.8V4.9a1.4 1.4 0 0 1 1.4-1.4h2.4a1.4 1.4 0 0 1 1.4 1.4v1.9"/><path d="M6.6 6.8l.8 12a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.8-12"/><path d="M10.3 10.4v6.2"/><path d="M13.7 10.4v6.2"/>'
};

// src/client/icons.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function Icon({ name: name2, size = 16 }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "svg",
    {
      viewBox: "0 0 24 24",
      width: size,
      height: size,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.7,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": "true",
      style: { display: "block" },
      dangerouslySetInnerHTML: { __html: ICON_BODY[name2] ?? "" }
    }
  );
}

// src/client/styles.css
var styles_default = "/**\n * \u5DE5\u4F5C\u53F0\u6837\u5F0F \u2014\u2014 \u5DE6\u9884\u89C8 / \u53F3\u53C2\u6570\u7684\u7248\u5F0F\u3002\n *\n * \u53EA\u4F9D\u8D56\u5BBF\u4E3B token\uFF08`--dsw-alias-*`\uFF09\uFF0C\u6D45\u8272\u4E0E\u6DF1\u8272\u4E3B\u9898\u90FD\u81EA\u52A8\u8DDF\u968F\uFF1B\n * \u7248\u5F0F\u7528\u5BB9\u5668\u67E5\u8BE2\uFF0C\u9762\u677F\u88AB dock \u5230\u7A84\u4FA7\u680F\u65F6\u81EA\u52A8\u5E76\u6210\u5355\u5217\u3002\n */\n\n/* \u2500\u2500 \u5916\u58F3 \u2500\u2500 */\n.cwb-root{--w-bg:var(--dsw-alias-bg-base,#fff);--w-surface:var(--dsw-alias-bg-layer-1,#f6f6f7);--w-sunken:var(--dsw-alias-bg-layer-2,#ececef);--w-text:var(--dsw-alias-label-primary,#1f2023);--w-muted:var(--dsw-alias-label-secondary,#6b6f76);--w-line:var(--dsw-alias-border-l3,#dcdce0);--w-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--w-danger:var(--dsw-alias-state-error-primary,#b53e3e);color:var(--w-text);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:1.5;height:100%;min-height:0;display:flex;flex-direction:column;container-type:inline-size;box-sizing:border-box}\n.cwb-root *,.cwb-root *::before,.cwb-root *::after{box-sizing:border-box}\n.cwb-root button,.cwb-root input,.cwb-root select,.cwb-root textarea{font:inherit;color:inherit}\n.cwb-root :focus-visible{outline:1px solid var(--w-accent);outline-offset:2px}\n/* \u2500\u2500 \u9876\u90E8\u9875\u7B7E \u2500\u2500 */\n.cwb-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--w-line);flex-shrink:0;min-height:46px;align-items:stretch}\n.cwb-tab{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:0;font-size:.95em;cursor:pointer;position:relative;transition:color .12s ease}\n.cwb-tab:hover{color:var(--w-text)}\n.cwb-tab.on{color:var(--w-text);font-weight:500}\n.cwb-tab.on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--w-accent);border-radius:2px 2px 0 0}\n/* \u2500\u2500 \u5E94\u7528\u533A\uFF1A\u9876\u90E8\u6761 + \u5DE6\u53F3\u4E24\u680F \u2500\u2500 */\n.cwb-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}\n.cwb-body>*{flex:1;min-height:0}\n.cwf-app{flex:1;min-height:0;display:flex;flex-direction:column}\n.cwf-top{display:flex;align-items:center;gap:10px;padding:10px 20px;flex-shrink:0;border-bottom:1px solid var(--w-line)}\n.cwf-pick{flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--w-surface);border:1px solid var(--w-line);border-radius:10px;padding:0 10px;height:36px}\n.cwf-pick select{flex:1;min-width:0;appearance:none;border:0;background:transparent;color:var(--w-text);font-size:.95em;cursor:pointer}\n.cwf-pick .cwf-chevron{width:7px;height:7px;border-right:1.5px solid var(--w-muted);border-bottom:1.5px solid var(--w-muted);transform:rotate(45deg);flex-shrink:0}\n.cwf-status{display:flex;align-items:center;gap:12px;font-size:.85em;color:var(--w-muted);white-space:nowrap}\n.cwf-status .cwf-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#5ba97a);display:inline-block;margin-right:6px}\n.cwf-status .cwf-dot.off{background:var(--w-muted)}\n.cwf-ghost{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.9em;cursor:pointer;padding:4px 6px;border-radius:6px}\n.cwf-ghost:hover{background:var(--w-surface);color:var(--w-text)}\n\n.cwf-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.32fr) minmax(330px,1fr);overflow:hidden}\n/* \u2500\u2500 \u5DE6\uFF1A\u9884\u89C8 \u2500\u2500 */\n.cwf-left{min-width:0;min-height:0;display:flex;flex-direction:column;padding:14px 16px 12px;gap:10px;border-right:1px solid var(--w-line)}\n.cwf-left-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.88em;color:var(--w-muted);flex-shrink:0}\n.cwf-left-actions{display:flex;align-items:center;gap:10px}\n.cwf-stage{flex:1;min-height:200px;border-radius:14px;background:var(--w-sunken);overflow:hidden;position:relative;display:grid;place-items:center}\n.cwf-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}\n.cwf-stage-empty{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--w-muted);font-size:.88em;text-align:center;padding:24px}\n.cwf-stage-empty svg{opacity:.45}\n.cwf-stage-badge{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:wrap}\n.cwf-tag{background:#141519c9;color:#fff;font-size:.75em;padding:3px 8px;border-radius:6px}\n.cwf-stage-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0}\n.cwf-pill{appearance:none;border:1px solid var(--w-line);background:transparent;color:var(--w-muted);font-size:.82em;padding:5px 10px;border-radius:8px;cursor:pointer;transition:background-color .12s ease,color .12s ease}\n.cwf-pill:hover{background:var(--w-surface);color:var(--w-text)}\n.cwf-pill:disabled{opacity:.4;cursor:not-allowed}\n.cwf-strip{display:flex;gap:8px;overflow-x:auto;flex-shrink:0;padding:2px}\n.cwf-strip button{appearance:none;padding:0;width:58px;height:58px;border-radius:10px;overflow:hidden;border:1px solid var(--w-line);background:var(--w-sunken);cursor:pointer;flex-shrink:0}\n.cwf-strip button.on{border-color:var(--w-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--w-accent) 35%,transparent)}\n.cwf-strip img{width:100%;height:100%;object-fit:cover;display:block}\n/* \u2500\u2500 \u53F3\uFF1A\u8868\u5355 \u2500\u2500 */\n.cwf-right{min-width:0;min-height:0;display:flex;flex-direction:column;padding:14px 16px 0;gap:12px;overflow:auto;scrollbar-gutter:stable}\n.cwf-group{display:flex;flex-direction:column;gap:7px}\n.cwf-group-label{font-size:.86em;color:var(--w-muted);display:flex;align-items:center;justify-content:space-between;gap:8px}\n.cwf-area{width:100%;min-height:96px;max-height:26vh;resize:vertical;border-radius:12px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.95em;line-height:1.65;padding:10px 12px}\n.cwf-area:focus{border-color:var(--w-accent);background:var(--w-bg);outline:none}\n.cwf-ref{display:flex;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:8px;min-width:0}\n.cwf-ref-thumb{width:56px;height:56px;border-radius:8px;overflow:hidden;background:var(--w-sunken);flex-shrink:0;display:grid;place-items:center}\n.cwf-ref-thumb img{width:100%;height:100%;object-fit:cover;display:block}\n.cwf-ref-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}\n.cwf-ref-title{font-size:.9em}\n.cwf-ref-sub{font-size:.8em;color:var(--w-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cwf-ratios{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}\n.cwf-ratio{appearance:none;border:1px solid var(--w-line);background:transparent;color:var(--w-muted);border-radius:10px;padding:8px 0;font-size:.88em;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .12s ease,color .12s ease,background-color .12s ease}\n.cwf-ratio:hover{color:var(--w-text)}\n.cwf-ratio.on{border-color:var(--w-accent);color:var(--w-text);background:color-mix(in srgb,var(--w-accent) 10%,transparent)}\n.cwf-pairs{display:grid;grid-template-columns:1fr 1fr;gap:10px}\n.cwf-field{display:flex;flex-direction:column;gap:5px;min-width:0}\n.cwf-field-label{font-size:.82em;color:var(--w-muted);display:flex;align-items:center;gap:5px;min-height:16px}\n.cwf-req{color:var(--w-danger);font-weight:600}\n.cwf-field-type{font-size:.7em;opacity:.65;border:1px solid var(--w-line);padding:0 4px;border-radius:4px;letter-spacing:.02em}\n.cwf-icon-btn{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:6px;border-radius:8px;cursor:pointer;display:grid;place-items:center;transition:background-color .12s ease,color .12s ease}\n.cwf-icon-btn:hover{background:var(--w-bg);color:var(--w-text)}\n.cwf-icon-danger:hover{color:var(--w-danger)}\n.cwf-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:118px;padding:16px;border:1.5px dashed var(--w-line);border-radius:12px;background:var(--w-surface);cursor:pointer;text-align:center;transition:border-color .14s ease,background-color .14s ease}\n.cwf-drop:hover{border-color:var(--w-muted)}\n.cwf-drop.over{border-color:var(--w-accent);background:var(--w-bg)}\n.cwf-drop.busy{opacity:.7;cursor:progress}\n.cwf-drop-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--w-bg);border:1px solid var(--w-line);color:var(--w-muted)}\n.cwf-drop-title{font-size:.92em;color:var(--w-text)}\n.cwf-drop-hint{font-size:.8em;color:var(--w-muted);line-height:1.5}\n.cwf-picked{display:flex;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:8px;min-width:0}\n.cwf-picked-thumb{width:56px;height:56px;flex-shrink:0;border-radius:8px;overflow:hidden;background:var(--w-sunken);display:grid;place-items:center}\n.cwf-picked-thumb img{width:100%;height:100%;object-fit:cover;display:block}\n.cwf-picked-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}\n.cwf-picked-name{font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cwf-picked-sub{font-size:.78em;color:var(--w-muted);font-variant-numeric:tabular-nums}\n.cwf-picked-actions{display:flex;gap:2px;flex-shrink:0}\n.cwf-input{width:100%;min-width:0;border-radius:10px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.92em;padding:8px 10px}\n.cwf-input:focus{border-color:var(--w-accent);background:var(--w-bg);outline:none}\n.cwf-hint{font-size:.78em;color:var(--w-muted);opacity:.9}\n.cwf-hint-err{color:var(--w-danger);opacity:1}\n.cwf-advanced{border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);overflow:hidden}\n.cwf-advanced>summary{cursor:pointer;padding:9px 12px;font-size:.86em;color:var(--w-muted);list-style:none;display:flex;align-items:center;gap:6px;user-select:none}\n.cwf-advanced>summary::-webkit-details-marker{display:none}\n.cwf-advanced>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease}\n.cwf-advanced[open]>summary::before{transform:rotate(45deg)}\n.cwf-advanced-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}\n.cwf-meta{font-size:.78em;color:var(--w-muted);line-height:1.6;padding:2px 0}\n\n.cwf-dock{position:sticky;bottom:0;padding:10px 0 14px;background:linear-gradient(to top,var(--w-bg) 70%,transparent);flex-shrink:0}\n.cwf-dock .cwf-generate{width:100%;appearance:none;border:1px solid transparent;border-radius:12px;padding:12px 16px;font-size:.98em;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--w-text);color:var(--w-bg);transition:opacity .12s ease}\n.cwf-dock .cwf-generate:hover:not(:disabled){opacity:.86}\n.cwf-dock .cwf-generate:disabled{opacity:.5;cursor:not-allowed}\n.cwf-dock .cwf-kbd{margin-left:auto;font-size:.78em;opacity:.75;border:1px solid currentColor;border-radius:5px;padding:0 5px;line-height:1.5}\n\n.cwf-warn{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:9px 11px;border:1px solid var(--w-line);border-left:3px solid var(--w-danger);border-radius:10px;background:var(--w-surface);font-size:.84em;line-height:1.55}\n.cwf-warn svg{color:var(--w-danger);flex-shrink:0;margin-top:2px}\n.cwf-warn-hint{color:var(--w-muted);flex-basis:100%}\n.cwf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--w-muted);padding:48px 24px}\n.cwf-empty-title{color:var(--w-text);font-size:1.05em}\n.cwf-notice{padding:8px 11px;border-radius:9px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.84em}\n.cwf-notice.err{color:var(--w-danger)}\n.cwf-field .cwf-link{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.8em;padding:2px 0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:3px}\n.cwf-field .cwf-link:hover{color:var(--w-text)}\n.cwf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}\n/* \u2500\u2500 \u7A84\u9762\u677F\uFF1A\u5355\u5217 \u2500\u2500 */\n@container(max-width:900px){.cwf-main{grid-template-columns:1fr;overflow:auto}.cwf-left{border-right:0;border-bottom:1px solid var(--w-line);min-height:320px}.cwf-right{overflow:visible}.cwf-stage{min-height:240px}}\n@container(max-width:460px){.cwb-tabs{padding:0 14px;gap:14px}.cwf-top{padding:8px 12px}.cwf-ratios{grid-template-columns:repeat(2,1fr)}.cwf-pairs{grid-template-columns:1fr}}\n@media(prefers-reduced-motion:reduce){.cwb-root *{animation:none!important;transition:none!important}}\n/* \u2500\u2500 \u5DE5\u4F5C\u6D41\u7BA1\u7406 \u2500\u2500 */\n.cwa-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 10px;border-bottom:1px solid var(--w-line);flex-shrink:0}\n.cwa-head-actions{display:flex;align-items:center;gap:4px;flex-shrink:0}\n.cwa-title{font-size:1.02em;font-weight:600}\n.cwa-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}\n.cwa-error{margin:10px 20px 0;padding:8px 11px;border-radius:9px;border:1px solid var(--w-danger);color:var(--w-danger);font-size:.84em}\n.cwa-notice{margin:10px 20px 0;padding:8px 11px;border-radius:9px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.84em}\n.cwa-list{flex:1;min-height:0;overflow:auto;padding:12px 20px 24px;display:flex;flex-direction:column;gap:10px;scrollbar-gutter:stable}\n.cwa-row{border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:11px 13px;display:flex;flex-direction:column;gap:8px;transition:opacity .15s ease}\n.cwa-row.off{opacity:.62}\n.cwa-row-head{display:flex;align-items:flex-start;gap:11px}\n.cwa-switch{position:relative;display:inline-flex;flex-shrink:0;cursor:pointer;margin-top:2px}\n.cwa-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}\n.cwa-track{width:34px;height:19px;border-radius:99px;background:var(--w-line);position:relative;transition:background-color .16s ease;display:block}\n.cwa-knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--w-bg);box-shadow:0 1px 2px #0003;transition:transform .16s ease}\n.cwa-switch input:checked+.cwa-track{background:var(--w-accent)}\n.cwa-switch input:checked+.cwa-track .cwa-knob{transform:translateX(15px)}\n.cwa-switch input:focus-visible+.cwa-track{outline:1px solid var(--w-accent);outline-offset:2px}\n.cwa-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}\n.cwa-name{font-size:.94em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cwa-facts{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:.78em;color:var(--w-muted)}\n.cwa-badge{background:var(--w-bg);border:1px solid var(--w-line);border-radius:5px;padding:0 5px;color:var(--w-text)}\n.cwa-warn{font-size:.78em;color:var(--w-danger)}\n.cwa-note{width:100%;resize:vertical;min-height:46px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;line-height:1.55;padding:7px 9px}\n.cwa-note:focus{border-color:var(--w-accent);outline:none}\n.cwa-note::placeholder{color:var(--w-muted)}\n.cwa-actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}\n.cwa-actions label.cwf-ghost{display:inline-flex;align-items:center;gap:5px;cursor:pointer;margin-right:auto}\n";

// src/components/panel-workflow/client/WorkflowAdmin.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function WorkflowAdmin({ t, visible }) {
  const [items, setItems] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [saving, setSaving] = (0, import_react.useState)({});
  const [notice, setNotice] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)("");
  const [toggles, setToggles] = (0, import_react.useState)(null);
  const [toggleSaving, setToggleSaving] = (0, import_react.useState)(false);
  const [importOpen, setImportOpen] = (0, import_react.useState)(false);
  const [importName, setImportName] = (0, import_react.useState)("");
  const [importText, setImportText] = (0, import_react.useState)("");
  const [importing, setImporting] = (0, import_react.useState)(false);
  const load = () => {
    setLoading(true);
    Promise.all([
      fetchWorkflowList(),
      // 拿不到开关不影响列表：老宿主 / 关掉面板时这里会失败
      fetchConfig().catch(() => null)
    ]).then(([data, config]) => {
      setItems(data.workflows);
      setToggles(config?.toggles ?? null);
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason))).finally(() => setLoading(false));
  };
  (0, import_react.useEffect)(() => {
    if (!visible) return void 0;
    load();
    return void 0;
  }, [visible]);
  (0, import_react.useEffect)(() => {
    if (notice === "") return void 0;
    const timer = setTimeout(() => setNotice(""), 2200);
    return () => clearTimeout(timer);
  }, [notice]);
  const patch = async (id, body) => {
    setSaving((previous) => ({ ...previous, [id]: true }));
    try {
      const next = await updateWorkflow(id, body);
      setItems((previous) => previous.map((item) => item.workflowId === id ? { ...item, ...next } : item));
      setNotice(t("adminSaved"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setSaving((previous) => ({ ...previous, [id]: false }));
    }
  };
  const toggleProgress = async (next) => {
    setToggleSaving(true);
    try {
      const updated = await setProgressStream(next);
      setToggles(updated);
      setNotice(t("adminSaved"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setToggleSaving(false);
    }
  };
  const submitImport = async () => {
    const text = importText.trim();
    if (text === "") {
      setError(t("importEmpty"));
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (reason) {
      setError(`JSON \u89E3\u6790\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
      return;
    }
    const name2 = importName.trim() === "" ? void 0 : importName.trim();
    setImporting(true);
    try {
      let result;
      try {
        result = await importWorkflow({ ...name2 === void 0 ? {} : { name: name2 }, workflow: parsed });
      } catch (reason) {
        if (!(reason instanceof WorkflowExistsError)) throw reason;
        const confirmed = window.confirm(t("importConfirmOverwrite").replace("{id}", reason.workflowId));
        if (!confirmed) {
          setImporting(false);
          return;
        }
        result = await importWorkflow({ ...name2 === void 0 ? {} : { name: name2 }, workflow: parsed, overwrite: true });
      }
      setNotice((result.replaced ? t("importReplaced") : t("importDone")).replace("{id}", result.workflowId));
      setError("");
      setImportOpen(false);
      setImportText("");
      setImportName("");
      load();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setImporting(false);
    }
  };
  const pickFile = (file) => {
    if (file === void 0) return;
    void file.text().then((content) => {
      setImportText(content);
      if (importName.trim() === "") setImportName(file.name.replace(/\.json$/i, ""));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  if (loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwb-root", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: styles_default }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwf-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "workflow", size: 24 }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwf-empty-title", children: t("loadingWorkflows") })
      ] })
    ] });
  }
  const enabledCount = items.filter((item) => item.enabled !== false).length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwb-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: styles_default }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "cwa-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-title", children: t("adminTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-sub", children: t("adminSub").replace("{on}", String(enabledCount)).replace("{all}", String(items.length)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-head-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "cwf-ghost", onClick: () => setImportOpen((open) => !open), title: t("importWorkflow"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "download", size: 15 }) }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "cwf-ghost", onClick: load, title: t("refresh"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "refresh", size: 15 }) })
      ] })
    ] }),
    error !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-error", children: error }) : null,
    notice !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-notice", children: notice }) : null,
    importOpen ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: "cwa-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-row-head", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-meta", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-name", children: t("importWorkflow") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-facts", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("importHint") }) })
      ] }) }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "input",
        {
          className: "cwa-note",
          type: "text",
          value: importName,
          placeholder: t("importName"),
          disabled: importing,
          onChange: (event) => setImportName(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "textarea",
        {
          className: "cwa-note",
          value: importText,
          placeholder: t("importPlaceholder"),
          disabled: importing,
          rows: 6,
          onChange: (event) => setImportText(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "cwf-ghost", title: t("importPickFile"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "file",
              accept: ".json,application/json",
              className: "cwf-sr-only",
              disabled: importing,
              onChange: (event) => {
                pickFile(event.target.files?.[0]);
                event.target.value = "";
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "image", size: 15 }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("importPickFile") })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "cwf-ghost", disabled: importing, onClick: () => {
          setImportOpen(false);
          setImportText("");
          setImportName("");
        }, children: t("importCancel") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "cwf-ghost", disabled: importing, onClick: () => {
          void submitImport();
        }, children: t("importSubmit") })
      ] })
    ] }) : null,
    toggles === null ? null : (() => {
      const hint = t("progressToggleHint").replace("{value}", "n").replace("{max}", "N");
      return /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("article", { className: `cwa-row${toggles.progressStream ? "" : " off"}`, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-row-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "cwa-switch", title: hint, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "checkbox",
              checked: toggles.progressStream,
              disabled: toggleSaving,
              onChange: (event) => {
                void toggleProgress(event.target.checked);
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-track", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-knob" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-name", children: t("progressToggle") }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-facts", children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: hint }),
            toggles.progressStreamSource === "config" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-badge", children: t("progressToggleFromConfig") }) : null
          ] })
        ] })
      ] }) });
    })(),
    items.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwf-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "workflow", size: 26 }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwf-empty-title", children: t("emptyWorkflows") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { children: t("emptyWorkflowsHint") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-list", children: items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("article", { className: `cwa-row${item.enabled === false ? " off" : ""}`, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-row-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "cwa-switch", title: item.enabled === false ? t("enableHint") : t("disableHint"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              type: "checkbox",
              checked: item.enabled !== false,
              disabled: saving[item.workflowId] === true,
              onChange: (event) => {
                void patch(item.workflowId, { enabled: event.target.checked });
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-track", "aria-hidden": "true", children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-knob" }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-name", title: item.workflowId, children: item.title }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwa-facts", children: [
            item.model !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: item.model }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: t("noModel") }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              item.inputCount,
              " \u8F93\u5165"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { children: "\xB7" }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { children: [
              item.nodes,
              " \u8282\u70B9"
            ] }),
            item.enabled === false ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "cwa-badge", children: t("disabledBadge") }) : null
          ] }),
          item.missingModels !== void 0 && item.missingModels.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-warn", children: t("missingModels").replace("{names}", item.missingModels.join("\u3001")) }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
        "textarea",
        {
          className: "cwa-note",
          defaultValue: item.description,
          placeholder: t("notePlaceholder"),
          disabled: saving[item.workflowId] === true,
          onBlur: (event) => {
            const value = event.target.value.trim();
            if (value === item.description) return;
            void patch(item.workflowId, { description: value });
          },
          rows: 2
        }
      )
    ] }, item.workflowId)) })
  ] });
}

// src/components/panel-tags/client/TagsPanel.tsx
var import_react2 = require("react");

// src/client/scroll.ts
var LOAD_MORE_MARGIN = 320;
var LOAD_MORE_GAP = 100;
function shouldLoadMore(input, margin = LOAD_MORE_MARGIN, gap = LOAD_MORE_GAP) {
  if (input.loading || input.shown === 0 || input.shown >= input.total) return false;
  if (input.now - input.busyAt < gap) return false;
  const remain = input.scrollHeight - input.scrollTop - input.clientHeight;
  return remain <= margin;
}
var AUTO_FILL_SLACK = 4;
function shouldAutoFill(input, slack = AUTO_FILL_SLACK) {
  if (input.loading) return false;
  if (input.clientHeight <= 0) return false;
  if (input.shown === 0 || input.shown >= input.total) return false;
  if (input.lastFilledShown === input.shown) return false;
  return input.scrollHeight <= input.clientHeight + slack;
}

// src/components/panel-tags/client/TagsPanel.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
var PAGE = 50;
var DEBOUNCE_MS = 250;
var CATEGORY_ORDER = ["action", "clothing", "appearance", "composition", "object", "theme", "explicit", "other"];
var KIND_LABEL = {
  character: "\u89D2\u8272",
  artist: "\u753B\u5E08",
  copyright: "\u4F5C\u54C1",
  general: "\u901A\u7528"
};
function TagsPanel({ t, visible }) {
  const [query, setQuery] = (0, import_react2.useState)("");
  const [kind, setKind] = (0, import_react2.useState)("");
  const [category, setCategory] = (0, import_react2.useState)("");
  const [items, setItems] = (0, import_react2.useState)([]);
  const itemsRef = (0, import_react2.useRef)([]);
  const [total, setTotal] = (0, import_react2.useState)(0);
  const [stats, setStats] = (0, import_react2.useState)(null);
  const [loading, setLoading] = (0, import_react2.useState)(false);
  const [error, setError] = (0, import_react2.useState)("");
  const [notice, setNotice] = (0, import_react2.useState)("");
  const [sync, setSync] = (0, import_react2.useState)(null);
  const seq = (0, import_react2.useRef)(0);
  const load = (0, import_react2.useCallback)(async (nextQuery, nextKind, nextCategory, append, take) => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    try {
      const result = await fetchTags({
        query: nextQuery,
        kind: nextKind,
        category: nextCategory,
        // 读 ref 而不是闭包里的 `items`：前者是实时的，后者永远是首次渲染那个空数组
        offset: append ? itemsRef.current.length : 0,
        limit: take
      });
      if (seq.current !== mine) return;
      setItems((prev) => {
        const next = append ? [...prev, ...result.items] : result.items;
        itemsRef.current = next;
        return next;
      });
      setTotal(result.total);
      setError("");
    } catch (reason) {
      if (seq.current !== mine) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, []);
  (0, import_react2.useEffect)(() => {
    if (!visible) return;
    let alive = true;
    fetchTagStats().then((value) => {
      if (alive) setStats(value);
    }).catch((reason) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => {
      alive = false;
    };
  }, [visible]);
  (0, import_react2.useEffect)(() => {
    if (!visible) return void 0;
    const timer = setTimeout(() => {
      void load(query, kind, category, false, PAGE);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [visible, query, kind, category, load]);
  (0, import_react2.useEffect)(() => {
    if (!visible || sync?.state !== "running") return void 0;
    const timer = setInterval(() => {
      void fetchTagSync().then((next) => {
        setSync(next);
        if (next.state !== "running") {
          void fetchTagStats().then(setStats).catch(() => {
          });
          seq.current += 1;
          void load(query, kind, category, false, PAGE);
        }
      }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, 1e3);
    return () => clearInterval(timer);
  }, [visible, sync?.state, query, kind, category, load]);
  const beginSync = () => {
    setError("");
    setNotice("");
    void startTagSync().then(setSync).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  const change = (apply2) => {
    seq.current += 1;
    itemsRef.current = [];
    setItems([]);
    setNotice("");
    autoFill.current = -1;
    apply2();
  };
  const more = () => {
    void load(query, kind, category, true, PAGE);
  };
  const scroller = (0, import_react2.useRef)(null);
  const live = (0, import_react2.useRef)({ loading: false, shown: 0, total: 0, busyAt: 0 });
  live.current.loading = loading;
  live.current.shown = items.length;
  live.current.total = total;
  const autoFill = (0, import_react2.useRef)(-1);
  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    const state = live.current;
    const now = Date.now();
    const go = shouldLoadMore({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      shown: state.shown,
      total: state.total,
      loading: state.loading,
      now,
      busyAt: state.busyAt
    });
    if (!go) return;
    state.busyAt = now;
    more();
  };
  (0, import_react2.useEffect)(() => {
    const element = scroller.current;
    if (element === null) return;
    const go = shouldAutoFill({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      shown: items.length,
      total,
      loading,
      lastFilledShown: autoFill.current
    });
    if (!go) return;
    autoFill.current = items.length;
    more();
  }, [items.length, total, loading]);
  const copy = (tag) => {
    void navigator.clipboard.writeText(tag).then(() => {
      setNotice(`\u5DF2\u590D\u5236 ${tag}`);
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  if (!visible) return /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-root" });
  const categoryCount = stats?.categories ?? {};
  const labels = stats?.labels ?? {};
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-root", ref: scroller, onScroll, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("header", { className: "ctg-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-title", children: t("tagsTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-sub", children: stats === null ? t("tagsLoading") : t("tagsSub").replace("{total}", String(stats.total)).replace("{shown}", String(total)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-head-actions", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
        "button",
        {
          type: "button",
          className: "ctg-sync",
          disabled: sync?.state === "running",
          title: t("tagsSyncHint"),
          onClick: beginSync,
          children: sync?.state === "running" ? t("tagsSyncRunning") : t("tagsSync")
        }
      ) })
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_jsx_runtime3.Fragment, { children: [
      sync !== null && sync.state !== "idle" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: `ctg-syncbar${sync.state === "failed" ? " bad" : ""}`, children: sync.state === "running" ? `${sync.stage}${sync.total > 0 ? `\uFF08${sync.done}/${sync.total}\uFF09` : ""}` : sync.state === "done" ? t("tagsSyncDone").replace("{kinds}", sync.results.map((item) => `${item.kind} ${item.records}`).join(" / ")).replace("{groups}", String(sync.groups?.groups ?? 0)).replace("{tags}", String(sync.groups?.tags ?? 0)) : t("tagsSyncFailed").replace("{message}", sync.message) + (sync.results.length === 0 ? "" : `\uFF08\u5DF2\u5B8C\u6210\uFF1A${sync.results.map((item) => item.kind).join(" / ")}\uFF09`) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-search", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "input",
          {
            className: "ctg-input",
            type: "search",
            value: query,
            placeholder: t("tagsPlaceholder"),
            onChange: (event) => change(() => setQuery(event.target.value))
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("select", { className: "ctg-select", value: kind, onChange: (event) => change(() => setKind(event.target.value)), children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("option", { value: "", children: t("tagsAllKinds") }),
          Object.entries(KIND_LABEL).map(([value, label]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("option", { value, children: [
            label,
            stats === null ? "" : `\uFF08${stats.kinds[value] ?? 0}\uFF09`
          ] }, value))
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-chips", children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "button",
          {
            type: "button",
            className: `ctg-chip${category === "" ? " on" : ""}`,
            onClick: () => change(() => setCategory("")),
            children: t("tagsAllCategories")
          }
        ),
        CATEGORY_ORDER.map((key) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
          "button",
          {
            type: "button",
            className: `ctg-chip${category === key ? " on" : ""}`,
            title: t("tagsCategoryHint"),
            onClick: () => change(() => setCategory(key)),
            children: [
              labels[key] ?? key,
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-count", children: categoryCount[key] ?? 0 })
            ]
          },
          key
        ))
      ] }),
      error !== "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-error", children: error }) : null,
      notice !== "" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-notice", children: notice }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-list", children: [
        items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("article", { className: "ctg-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-row-main", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("code", { className: "ctg-tag", children: item.tag }),
            item.zh === "" ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-zh", children: item.zh })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "ctg-row-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-badge", children: KIND_LABEL[item.kind] ?? item.kind }),
            item.category === "other" ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-badge", children: labels[item.category] ?? item.category }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-hot", children: item.postCount.toLocaleString() }),
            item.aliases.length === 0 ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "ctg-alias", children: item.aliases.join(" / ") })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "ctg-copy", title: t("tagsCopy"), onClick: () => copy(item.tag), children: t("tagsCopy") })
        ] }, `${item.kind}:${item.tag}`)),
        items.length === 0 && !loading && total === 0 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { className: "ctg-empty", children: t("tagsEmpty") }) : null
      ] }),
      items.length > 0 && items.length < total ? (
        // 提示行同时是键盘可达的手动兜底：自动加载是主路径，但不该让只能按 Tab/回车的人
        // 一直等。刻意不做成按钮样式 —— 用户明确说过不要那个"再看"按钮。
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
          "div",
          {
            className: "ctg-more-hint",
            role: "button",
            tabIndex: 0,
            onClick: () => {
              if (!loading) more();
            },
            onKeyDown: (event) => {
              if (event.key !== "Enter" && event.key !== " ") return;
              event.preventDefault();
              if (!loading) more();
            },
            children: loading ? t("tagsLoadingMore") : t("tagsScrollMore").replace("{left}", String(total - items.length))
          }
        )
      ) : null
    ] })
  ] });
}

// src/components/panel-tags/client/PromptRefs.tsx
var import_react3 = require("react");
var import_jsx_runtime4 = require("react/jsx-runtime");
var DEBOUNCE_MS2 = 300;
var LIMIT = 12;
function PromptRefs({ t, visible }) {
  const [mode, setMode] = (0, import_react3.useState)("random");
  const [query, setQuery] = (0, import_react3.useState)("");
  const [items, setItems] = (0, import_react3.useState)([]);
  const [loading, setLoading] = (0, import_react3.useState)(false);
  const [error, setError] = (0, import_react3.useState)("");
  const [notice, setNotice] = (0, import_react3.useState)("");
  const [anyRating, setAnyRating] = (0, import_react3.useState)(false);
  const seq = (0, import_react3.useRef)(0);
  const load = (nextMode, nextQuery) => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    void fetchPostRefs({
      query: nextMode === "search" ? nextQuery : "",
      limit: LIMIT,
      rating: anyRating ? "all" : "general"
    }).then((result) => {
      if (seq.current !== mine) return;
      setItems(result);
      setError("");
    }).catch((reason) => {
      if (seq.current !== mine) return;
      setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (seq.current === mine) setLoading(false);
    });
  };
  (0, import_react3.useEffect)(() => {
    if (!visible) return void 0;
    if (mode === "random") {
      load("random", "");
      return void 0;
    }
    const timer = setTimeout(() => {
      load("search", query);
    }, DEBOUNCE_MS2);
    return () => clearTimeout(timer);
  }, [visible, mode, query, anyRating]);
  const copy = (text) => {
    try {
      void navigator.clipboard.writeText(text).then(() => {
        setNotice(t("refsCopied"));
        setError("");
      }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    } catch {
      setError(t("refsCopyFailed"));
    }
  };
  if (!visible) return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ctg-refs" });
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ctg-refs", children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ctg-refs-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ctg-seg", role: "tablist", "aria-label": t("refsTabRefs"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "random",
            className: `ctg-seg-item${mode === "random" ? " on" : ""}`,
            onClick: () => setMode("random"),
            children: t("refsRandom")
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": mode === "search",
            className: `ctg-seg-item${mode === "search" ? " on" : ""}`,
            onClick: () => setMode("search"),
            children: t("refsSearch")
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("label", { className: "ctg-anyrating", title: t("refsAnyRatingHint"), children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("input", { type: "checkbox", checked: anyRating, onChange: (event) => setAnyRating(event.target.checked) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { children: t("refsAnyRating") })
      ] }),
      mode === "random" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ctg-sync", disabled: loading, onClick: () => load("random", ""), children: t("refsAnother") }) : null
    ] }),
    mode === "search" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ctg-search", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "input",
      {
        className: "ctg-input",
        type: "search",
        value: query,
        "aria-label": t("refsSearch"),
        placeholder: t("refsPlaceholder"),
        onChange: (event) => setQuery(event.target.value)
      }
    ) }) : null,
    error !== "" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ctg-error", children: error }) : null,
    notice !== "" ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ctg-notice", children: notice }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ctg-refs-grid", children: [
      items.map((item) => /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("article", { className: "ctg-ref", children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("a", { href: item.largeUrl, target: "_blank", rel: "noreferrer noopener", className: "ctg-ref-thumb", children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("img", { src: `${API}/tags/refs/image?u=${encodeURIComponent(item.previewUrl)}`, alt: "", loading: "lazy" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "ctg-ref-prompt", title: item.prompt, children: item.prompt }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "ctg-ref-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { className: "ctg-hot", children: [
            "#",
            item.id
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "ctg-copy", title: t("refsCopy"), onClick: () => copy(item.prompt), children: t("refsCopy") })
        ] })
      ] }, item.id)),
      items.length === 0 && !loading ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "ctg-empty", children: t("refsEmpty") }) : null
    ] })
  ] });
}

// src/components/panel-tags/client/styles.css
var styles_default2 = "/**\n * \u6807\u7B7E\u9762\u677F\u7684\u6837\u5F0F\u3002\n *\n * \u6CBF\u7528\u5DE5\u4F5C\u53F0\u90A3\u5957 `--w-*` \u53D8\u91CF\uFF0C\u4E0D\u53E6\u8D77\u4E00\u5957\u4E3B\u9898 \u2014\u2014 \u9762\u677F\u662F\u540C\u4E00\u4E2A\u58F3\u91CC\u7684\u4E00\u4E2A\u9875\u7B7E\uFF0C\n * \u6362\u914D\u8272\u4F1A\u8BA9\u5B83\u770B\u8D77\u6765\u50CF\u53E6\u4E00\u4E2A\u5E94\u7528\u3002\n */\n\n.ctg-root{display:flex;flex-direction:column;gap:10px;padding:14px 20px 24px;min-height:0;height:100%;overflow:auto}\n.ctg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}\n.ctg-title{font-size:1.02em;font-weight:600}\n.ctg-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}\n.ctg-search{display:flex;gap:8px}\n.ctg-input{flex:1;min-width:0;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.9em;padding:8px 10px}\n.ctg-input:focus{border-color:var(--w-accent);outline:none}\n.ctg-input::placeholder{color:var(--w-muted)}\n.ctg-select{border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;padding:8px 6px}\n.ctg-chips{display:flex;flex-wrap:wrap;gap:6px}\n.ctg-chip{display:inline-flex;align-items:center;gap:5px;border-radius:99px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:4px 10px;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}\n.ctg-chip:hover{border-color:var(--w-accent)}\n.ctg-chip.on{background:var(--w-accent);border-color:var(--w-accent);color:var(--w-bg)}\n.ctg-count{font-size:.85em;opacity:.72;font-variant-numeric:tabular-nums}\n.ctg-error{font-size:.82em;color:var(--w-danger)}\n.ctg-notice{font-size:.82em;color:var(--w-muted)}\n.ctg-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}\n.ctg-sync{border-radius:8px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:5px 12px;cursor:pointer}\n.ctg-sync:hover:not(:disabled){border-color:var(--w-accent)}\n.ctg-sync:disabled{opacity:.6;cursor:default}\n.ctg-syncbar{font-size:.8em;color:var(--w-muted);border-left:2px solid var(--w-accent);padding-left:8px}\n.ctg-syncbar.bad{color:var(--w-danger);border-left-color:var(--w-danger)}\n.ctg-seg{display:inline-flex;border:1px solid var(--w-line);border-radius:99px;overflow:hidden}\n.ctg-seg-item{border:0;background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:5px 14px;cursor:pointer}\n.ctg-seg-item.on{background:var(--w-accent);color:var(--w-bg)}\n.ctg-refs{display:flex;flex-direction:column;gap:10px;min-height:0}\n.ctg-refs-bar{display:flex;align-items:center;justify-content:space-between;gap:10px}\n.ctg-anyrating{display:inline-flex;align-items:center;gap:5px;font-size:.76em;color:var(--w-muted);cursor:pointer;margin-left:auto}\n.ctg-anyrating input{margin:0;cursor:pointer}\n.ctg-refs-pool{display:flex;align-items:center;gap:10px;font-size:.8em;color:var(--w-muted)}\n.ctg-refs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}\n.ctg-ref{display:flex;flex-direction:column;gap:5px;border:1px solid var(--w-line);border-radius:10px;background:var(--w-surface);padding:7px;min-width:0}\n.ctg-ref-thumb{display:block;border-radius:7px;overflow:hidden;background:var(--w-bg);aspect-ratio:1}\n.ctg-ref-thumb img{width:100%;height:100%;object-fit:cover;display:block}\n.ctg-ref-prompt{margin:0;font-size:.74em;line-height:1.4;color:var(--w-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}\n.ctg-ref-actions{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:.72em;color:var(--w-muted)}\n.ctg-list{display:flex;flex-direction:column;gap:6px;min-height:0}\n.ctg-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:10px;background:var(--w-surface);padding:7px 10px}\n.ctg-row-main{display:flex;align-items:baseline;gap:8px;min-width:0}\n.ctg-tag{font-size:.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.ctg-zh{font-size:.84em;color:var(--w-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}\n.ctg-row-meta{display:flex;align-items:center;gap:6px;font-size:.76em;color:var(--w-muted);white-space:nowrap}\n.ctg-badge{border:1px solid var(--w-line);border-radius:5px;padding:0 5px;background:var(--w-bg);color:var(--w-text)}\n.ctg-hot{font-variant-numeric:tabular-nums}\n.ctg-alias{max-width:180px;overflow:hidden;text-overflow:ellipsis}\n.ctg-copy{border-radius:7px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.76em;padding:3px 8px;cursor:pointer}\n.ctg-copy:hover{border-color:var(--w-accent)}\n.ctg-empty{font-size:.86em;color:var(--w-muted);padding:18px 0;text-align:center}\n.ctg-more-hint{align-self:center;color:var(--w-muted);font-size:.78em;padding:6px 0 2px}\n";

// src/components/panel-poses/client/PosesPanel.tsx
var import_react4 = require("react");

// src/client/clipboard.ts
async function toPngBlob(blob) {
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("\u65E0\u6CD5\u521B\u5EFA\u753B\u5E03\u4E0A\u4E0B\u6587\u3002");
  context.drawImage(bitmap, 0, 0);
  const png = await new Promise((resolve, reject) => {
    canvas.toBlob((out) => out !== null ? resolve(out) : reject(new Error("\u56FE\u7247\u8F6C\u7801\u5931\u8D25")), "image/png");
  });
  if (typeof bitmap.close === "function") bitmap.close();
  return png;
}
async function copyImageToClipboard(path) {
  if (typeof ClipboardItem === "undefined" || navigator.clipboard === void 0 || typeof navigator.clipboard.write !== "function") {
    throw new Error("\u8FD9\u4E2A\u73AF\u5883\u4E0D\u652F\u6301\u5199\u5165\u56FE\u7247\u526A\u8D34\u677F\uFF08\u9700\u8981\u5B89\u5168\u4E0A\u4E0B\u6587\uFF09\u3002");
  }
  const blob = await fetchBlob(path);
  const png = blob.type === "image/png" ? blob : await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}
async function copyTextToClipboard(text) {
  if (navigator.clipboard === void 0 || typeof navigator.clipboard.writeText !== "function") {
    throw new Error("\u8FD9\u4E2A\u73AF\u5883\u4E0D\u652F\u6301\u5199\u5165\u526A\u8D34\u677F\u3002");
  }
  await navigator.clipboard.writeText(text);
}

// src/client/conversation.ts
function findComposerEditor() {
  const scoped = document.querySelector('[data-input-scroll] [contenteditable="true"]');
  if (scoped !== null) return scoped;
  const lexical = document.querySelector('[contenteditable="true"][data-lexical-editor]');
  if (lexical !== null) return lexical;
  return document.querySelector('[contenteditable="true"]');
}
async function waitForEditor(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = findComposerEditor();
    if (found !== null) return found;
    await new Promise((resolve) => requestAnimationFrame(() => resolve()));
  }
  return null;
}
function pasteFile(editor, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  let event = null;
  try {
    event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
  } catch {
    event = null;
  }
  if (event === null || event.clipboardData !== transfer) {
    event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
  }
  editor.dispatchEvent(event);
}
function pasteText(editor, text) {
  const transfer = new DataTransfer();
  transfer.setData("text/plain", text);
  let event = null;
  try {
    event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
  } catch {
    event = null;
  }
  if (event === null || event.clipboardData !== transfer) {
    event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: transfer });
  }
  editor.dispatchEvent(event);
}
var DESCRIBE_INSTRUCTION = [
  "\u8BF7\u53C2\u8003\u8FD9\u5F20\u56FE\uFF0C\u5199\u4E00\u6761\u53EF\u4EE5\u76F4\u63A5\u7528\u4E8E\u751F\u56FE\u7684\u6B63\u5411\u63D0\u793A\u8BCD\u3002",
  "\u53EA\u8F93\u51FA\u4E00\u4E2A <prompt>\u2026</prompt> \u5757\uFF0C\u5757\u5185\u662F\u63D0\u793A\u8BCD\u672C\u8EAB\uFF0C\u4E0D\u8981\u89E3\u91CA\u3001\u4E0D\u8981\u7F57\u5217\u53C2\u6570\u3002"
].join("");
async function describeImage(item, actions) {
  await addToConversation(item, actions);
  const editor = findComposerEditor();
  if (editor === null) throw new Error("\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u65E0\u6CD5\u586B\u5165\u8F6C\u5199\u6307\u4EE4\u3002");
  try {
    editor.focus();
  } catch {
  }
  pasteText(editor, `
${DESCRIBE_INSTRUCTION}`);
}
async function addImageToConversation(blob, filename, actions, fallbackPath) {
  const type = blob.type !== "" && blob.type.startsWith("image/") ? blob.type : "image/png";
  const file = new File([blob], filename !== "" ? filename : "image.png", { type });
  let editor = findComposerEditor();
  if (editor === null) {
    actions.goToConversation();
    editor = await waitForEditor(1400);
  }
  if (editor === null) {
    if (fallbackPath !== void 0) {
      await copyImageToClipboard(fallbackPath);
      throw new Error("\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u56FE\u7247\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\u3002");
    }
    throw new Error("\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u56FE\u7247\u6CA1\u80FD\u52A0\u5165\u5BF9\u8BDD\u3002");
  }
  try {
    editor.focus();
  } catch {
  }
  pasteFile(editor, file);
}
async function addToConversation(item, actions) {
  const blob = await fetchBlob(item.path);
  await addImageToConversation(blob, item.name, actions, item.path);
}

// src/components/panel-poses/client/PosesPanel.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
var PAGE2 = 40;
var DEBOUNCE_MS3 = 250;
function PosesPanel({ t, visible, goToConversation }) {
  const [query, setQuery] = (0, import_react4.useState)("");
  const [system, setSystem] = (0, import_react4.useState)("");
  const [category, setCategory] = (0, import_react4.useState)("");
  const [onlySafe, setOnlySafe] = (0, import_react4.useState)(false);
  const [items, setItems] = (0, import_react4.useState)([]);
  const [total, setTotal] = (0, import_react4.useState)(0);
  const [stats, setStats] = (0, import_react4.useState)(null);
  const [loading, setLoading] = (0, import_react4.useState)(false);
  const [error, setError] = (0, import_react4.useState)("");
  const [angleOf, setAngleOf] = (0, import_react4.useState)({});
  const [files, setFiles] = (0, import_react4.useState)({});
  const [busy, setBusy] = (0, import_react4.useState)("");
  const timer = (0, import_react4.useRef)(null);
  const seq = (0, import_react4.useRef)(0);
  const itemsRef = (0, import_react4.useRef)([]);
  const scroller = (0, import_react4.useRef)(null);
  const live = (0, import_react4.useRef)({ loading: false, shown: 0, total: 0, busyAt: 0 });
  live.current.loading = loading;
  live.current.shown = items.length;
  live.current.total = total;
  const autoFill = (0, import_react4.useRef)(-1);
  const load = (0, import_react4.useCallback)(async (nextQuery, nextSystem, nextCategory, nextSafe, append = false) => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    if (!append) setError("");
    try {
      const result = await fetchPoses({
        query: nextQuery,
        system: nextSystem,
        category: nextCategory,
        safe: nextSafe,
        offset: append ? itemsRef.current.length : 0,
        limit: PAGE2
      });
      if (seq.current !== mine) return;
      const next = append ? [...itemsRef.current, ...result.items] : result.items;
      itemsRef.current = next;
      setItems(next);
      setTotal(result.total);
    } catch (err) {
      if (seq.current !== mine) return;
      setError(err instanceof Error ? err.message : String(err));
      if (!append) {
        itemsRef.current = [];
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, []);
  (0, import_react4.useEffect)(() => {
    if (!visible) return void 0;
    let alive = true;
    fetchPoseStats().then((value) => {
      if (alive) setStats(value);
    }).catch(() => {
    });
    void load("", "", "", false);
    return () => {
      alive = false;
    };
  }, [visible, load]);
  const schedule = (0, import_react4.useCallback)((next) => {
    if (timer.current !== null) clearTimeout(timer.current);
    seq.current += 1;
    itemsRef.current = [];
    autoFill.current = -1;
    timer.current = setTimeout(() => {
      void load(
        next.query ?? query,
        next.system ?? system,
        next.category ?? category,
        next.safe ?? onlySafe
      );
    }, DEBOUNCE_MS3);
  }, [load, query, system, category, onlySafe]);
  const viewOf = (pose) => angleOf[pose.id] ?? pose.cover.viewId;
  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    const state = live.current;
    const now = Date.now();
    const go = shouldLoadMore({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      shown: state.shown,
      total: state.total,
      loading: state.loading,
      now,
      busyAt: state.busyAt
    });
    if (!go) return;
    state.busyAt = now;
    void load(query, system, category, onlySafe, true);
  };
  (0, import_react4.useEffect)(() => {
    const element = scroller.current;
    if (element === null) return;
    const go = shouldAutoFill({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      shown: items.length,
      total,
      loading,
      lastFilledShown: autoFill.current
    });
    if (!go) return;
    autoFill.current = items.length;
    void load(query, system, category, onlySafe, true);
  }, [items.length, total, loading]);
  const angleButtons = (pose) => {
    const current = viewOf(pose).split("_").pop() ?? "";
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-angles", children: pose.angleIds.map((angle) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "button",
      {
        type: "button",
        className: angle === current ? "cps-angle on" : "cps-angle",
        onClick: () => setAngleOf((prev) => ({ ...prev, [pose.id]: `${pose.id}_${angle}` })),
        children: angleLabel(t, angle)
      },
      angle
    )) });
  };
  const fetchFile = async (pose) => {
    const viewId = viewOf(pose);
    setBusy(viewId);
    setError("");
    try {
      const { file } = await fetchPoseFile(viewId, "full");
      setFiles((prev) => ({ ...prev, [viewId]: file }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };
  const addToChat = async (pose) => {
    const viewId = viewOf(pose);
    setBusy(viewId);
    setError("");
    try {
      const res = await fetch(poseImageUrl(viewId, "full"));
      if (!res.ok) throw new Error(`\u7EBF\u7A3F\u53D6\u4E0D\u5230\uFF1AHTTP ${res.status}`);
      const blob = await res.blob();
      const angle = viewId.split("_").pop() ?? "front";
      await addImageToConversation(blob, `${pose.id}_${angle}.png`, { goToConversation });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };
  if (!visible) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-root" });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-root", ref: scroller, onScroll, children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-head", children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-title", children: t("posesTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-sub", children: stats === null ? t("posesLoading") : t("posesSub").replace("{poses}", String(stats.poseCount)).replace("{views}", String(stats.viewCount)) })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-search", children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
        "input",
        {
          className: "cps-input",
          value: query,
          placeholder: t("posesPlaceholder"),
          onChange: (event) => {
            const value = event.target.value;
            setQuery(value);
            schedule({ query: value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "select",
        {
          className: "cps-select",
          value: system,
          onChange: (event) => {
            const value = event.target.value;
            setSystem(value);
            schedule({ system: value });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: t("posesAllSystems") }),
            (stats?.systems ?? []).map((item) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: item.id, children: `${item.name}\uFF08${item.poseCount}\uFF09` }, item.id))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(
        "select",
        {
          className: "cps-select",
          value: category,
          onChange: (event) => {
            const value = event.target.value;
            setCategory(value);
            schedule({ category: value });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: "", children: t("posesAllCategories") }),
            Object.keys(stats?.categories ?? {}).map((name2) => /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("option", { value: name2, children: name2 }, name2))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("label", { className: "cps-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          "input",
          {
            type: "checkbox",
            checked: onlySafe,
            onChange: (event) => {
              const value = event.target.checked;
              setOnlySafe(value);
              schedule({ safe: value });
            }
          }
        ),
        t("posesOnlySafe")
      ] })
    ] }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-note bad", children: error }),
    loading && items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-empty", children: t("posesLoading") }),
    !loading && items.length === 0 && error === "" && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-empty", children: t("posesEmpty") }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-grid", children: items.map((pose) => {
      const viewId = viewOf(pose);
      const file = files[viewId];
      return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-shot", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(PoseImage, { src: poseImageUrl(viewId, "thumb"), alt: pose.name, fail: t("posesImageFail") }),
          angleButtons(pose)
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-name", title: pose.name, children: [
            pose.adult && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "cps-badge", children: t("posesAdultBadge") }),
            pose.name
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-tagline", children: `${pose.code} \xB7 ${pose.category} \xB7 ${pose.viewCount} \u89D2\u5EA6` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              className: "cps-btn",
              disabled: busy === viewId,
              onClick: () => {
                void addToChat(pose);
              },
              children: t("posesAddToChat")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
            "button",
            {
              type: "button",
              className: "cps-btn",
              disabled: busy === viewId,
              onClick: () => {
                void fetchFile(pose);
              },
              children: busy === viewId ? t("posesFetching") : t("posesFetch")
            }
          )
        ] }),
        file !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-note", title: file, children: `${t("posesFetched")}\uFF1A${file}` })
      ] }, pose.id);
    }) }),
    items.length < total && // 提示行同时是键盘可达的手动兜底：自动加载是主路径，但不该让只能按 Tab/回车的人
    // 一直等。刻意不做成按钮样式 —— 用户明确说过不要那个"再看"按钮。
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
      "div",
      {
        className: "cps-more-hint",
        role: "button",
        tabIndex: 0,
        onClick: () => {
          if (!loading) void load(query, system, category, onlySafe, true);
        },
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!loading) void load(query, system, category, onlySafe, true);
        },
        children: loading ? t("posesLoadingMore") : t("posesScrollMore").replace("{left}", String(total - items.length))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cps-attr", children: [
      stats?.attribution ?? "",
      stats?.source !== void 0 && stats.source !== "" && /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(import_jsx_runtime5.Fragment, { children: [
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("a", { href: stats.source, target: "_blank", rel: "noreferrer", children: t("posesSource") })
      ] })
    ] })
  ] });
}
function PoseImage({ src, alt, fail }) {
  const [bad, setBad] = (0, import_react4.useState)(false);
  if (bad) return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { className: "cps-shot-fail", children: fail });
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("img", { src, alt, loading: "lazy", onError: () => setBad(true) });
}
function angleLabel(t, angle) {
  const key = `posesAngle_${angle}`;
  return t(key);
}

// src/components/panel-poses/client/styles.css
var styles_default3 = "/**\n * \u59FF\u52BF\u5E93\u9762\u677F\u7684\u6837\u5F0F\u3002\n *\n * \u6CBF\u7528\u5DE5\u4F5C\u53F0\u90A3\u5957 `--w-*` \u53D8\u91CF\uFF0C\u4E0D\u53E6\u8D77\u4E3B\u9898 \u2014\u2014 \u5B83\u662F\u540C\u4E00\u4E2A\u58F3\u91CC\u7684\u4E00\u4E2A\u9875\u7B7E\u3002\n * \u7C7B\u540D\u524D\u7F00 `cps-`\uFF08comfyui pose studio\uFF09\uFF0C\u4E0E `ctg-`\uFF08\u6807\u7B7E\uFF09\u3001`cwb-`\uFF08\u76F8\u518C\uFF09\u533A\u5206\u5F00\u3002\n *\n * \u5361\u7247\u662F\u56FA\u5B9A\u7684 3:4 \u6BD4\u4F8B\uFF1A\u59FF\u52BF\u7EBF\u7A3F\u5168\u662F\u7AD6\u6784\u56FE\uFF0C\u8BA9\u5B83\u6309\u5185\u5BB9\u6491\u9AD8\u4F1A\u8BA9\u7F51\u683C\u9AD8\u4F4E\u4E0D\u5E73\u3002\n */\n\n.cps-root{display:flex;flex-direction:column;gap:10px;padding:14px 20px 24px;min-height:0;height:100%;overflow:auto}\n.cps-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}\n.cps-title{font-size:1.02em;font-weight:600}\n.cps-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}\n.cps-search{display:flex;flex-wrap:wrap;gap:8px}\n.cps-input{flex:1;min-width:180px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.9em;padding:8px 10px}\n.cps-input:focus{border-color:var(--w-accent);outline:none}\n.cps-input::placeholder{color:var(--w-muted)}\n.cps-select{border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;padding:8px 6px}\n.cps-toggle{display:inline-flex;align-items:center;gap:6px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.82em;padding:7px 10px;cursor:pointer}\n.cps-toggle input{accent-color:var(--w-accent)}\n.cps-chips{display:flex;flex-wrap:wrap;gap:6px}\n.cps-chip{display:inline-flex;align-items:center;gap:5px;border-radius:99px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.78em;padding:4px 10px;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}\n.cps-chip:hover{border-color:var(--w-accent)}\n.cps-chip.on{background:var(--w-accent);border-color:var(--w-accent);color:var(--w-bg)}\n.cps-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}\n.cps-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--w-line);border-radius:11px;background:var(--w-surface);overflow:hidden}\n.cps-card:hover{border-color:var(--w-accent)}\n.cps-shot{position:relative;aspect-ratio:3/4;background:var(--w-bg);display:flex;align-items:center;justify-content:center;overflow:hidden}\n.cps-shot img{width:100%;height:100%;object-fit:contain;display:block}\n.cps-shot-fail{font-size:.72em;color:var(--w-muted);text-align:center;padding:8px}\n.cps-angles{position:absolute;left:0;right:0;bottom:0;display:flex;gap:3px;padding:4px;background:linear-gradient(transparent,rgba(0,0,0,.55))}\n.cps-angle{border:0;border-radius:6px;background:rgba(0,0,0,.35);color:#fff;font-size:.68em;padding:2px 6px;cursor:pointer}\n.cps-angle.on{background:var(--w-accent);color:var(--w-bg)}\n.cps-meta{padding:0 8px 8px;display:flex;flex-direction:column;gap:3px;min-width:0}\n.cps-name{font-size:.82em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cps-badge{display:inline-block;margin-right:5px;border-radius:5px;background:var(--w-line);color:var(--w-muted);font-size:.66em;padding:0 4px;vertical-align:1px}\n.cps-tagline{font-size:.72em;color:var(--w-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cps-actions{display:flex;gap:6px;padding:0 8px 8px}\n.cps-btn{flex:1;border-radius:8px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.74em;padding:5px 6px;cursor:pointer}\n.cps-btn:hover{border-color:var(--w-accent)}\n.cps-btn[disabled]{opacity:.55;cursor:default}\n.cps-note{font-size:.76em;color:var(--w-muted)}\n.cps-more-hint{align-self:center;color:var(--w-muted);font-size:.78em;padding:6px 0 2px}\n.cps-note.bad{color:#d97757}\n.cps-empty{font-size:.82em;color:var(--w-muted);padding:18px 4px}\n.cps-attr{font-size:.72em;color:var(--w-muted);line-height:1.5;border-top:1px solid var(--w-line);padding-top:8px}\n.cps-attr a{color:inherit}\n";

// src/components/panel-costumes/client/CostumesPanel.tsx
var import_react5 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
var PAGE3 = 40;
var DEBOUNCE_MS4 = 250;
function CostumesPanel({ t, visible, goToConversation }) {
  const [query, setQuery] = (0, import_react5.useState)("");
  const [category, setCategory] = (0, import_react5.useState)("");
  const [onlySafe, setOnlySafe] = (0, import_react5.useState)(false);
  const [items, setItems] = (0, import_react5.useState)([]);
  const [total, setTotal] = (0, import_react5.useState)(0);
  const [stats, setStats] = (0, import_react5.useState)(null);
  const [loading, setLoading] = (0, import_react5.useState)(false);
  const [error, setError] = (0, import_react5.useState)("");
  const [notice, setNotice] = (0, import_react5.useState)("");
  const [files, setFiles] = (0, import_react5.useState)({});
  const [busy, setBusy] = (0, import_react5.useState)("");
  const timer = (0, import_react5.useRef)(null);
  const seq = (0, import_react5.useRef)(0);
  const itemsRef = (0, import_react5.useRef)([]);
  const scroller = (0, import_react5.useRef)(null);
  const live = (0, import_react5.useRef)({ loading: false, shown: 0, total: 0, busyAt: 0 });
  live.current.loading = loading;
  live.current.shown = items.length;
  live.current.total = total;
  const autoFill = (0, import_react5.useRef)(-1);
  const load = (0, import_react5.useCallback)(async (nextQuery, nextCategory, nextSafe, append = false) => {
    const mine = seq.current + 1;
    seq.current = mine;
    setLoading(true);
    if (!append) setError("");
    try {
      const result = await fetchCostumes({
        query: nextQuery,
        category: nextCategory,
        safe: nextSafe,
        offset: append ? itemsRef.current.length : 0,
        limit: PAGE3
      });
      if (seq.current !== mine) return;
      const next = append ? [...itemsRef.current, ...result.items] : result.items;
      itemsRef.current = next;
      setItems(next);
      setTotal(result.total);
    } catch (err) {
      if (seq.current !== mine) return;
      setError(err instanceof Error ? err.message : String(err));
      if (!append) {
        itemsRef.current = [];
        setItems([]);
        setTotal(0);
      }
    } finally {
      if (seq.current === mine) setLoading(false);
    }
  }, []);
  (0, import_react5.useEffect)(() => {
    if (!visible) return void 0;
    let alive = true;
    fetchCostumeStats().then((value) => {
      if (alive) setStats(value);
    }).catch(() => {
    });
    void load("", "", false);
    return () => {
      alive = false;
    };
  }, [visible, load]);
  const schedule = (0, import_react5.useCallback)((next) => {
    if (timer.current !== null) clearTimeout(timer.current);
    seq.current += 1;
    itemsRef.current = [];
    autoFill.current = -1;
    timer.current = setTimeout(() => {
      void load(next.query ?? query, next.category ?? category, next.safe ?? onlySafe);
    }, DEBOUNCE_MS4);
  }, [load, query, category, onlySafe]);
  const onScroll = () => {
    const element = scroller.current;
    if (element === null) return;
    const state = live.current;
    const now = Date.now();
    const go = shouldLoadMore({
      scrollHeight: element.scrollHeight,
      scrollTop: element.scrollTop,
      clientHeight: element.clientHeight,
      shown: state.shown,
      total: state.total,
      loading: state.loading,
      now,
      busyAt: state.busyAt
    });
    if (!go) return;
    state.busyAt = now;
    void load(query, category, onlySafe, true);
  };
  (0, import_react5.useEffect)(() => {
    const element = scroller.current;
    if (element === null) return;
    const go = shouldAutoFill({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      shown: items.length,
      total,
      loading,
      lastFilledShown: autoFill.current
    });
    if (!go) return;
    autoFill.current = items.length;
    void load(query, category, onlySafe, true);
  }, [items.length, total, loading]);
  const copyKeywords = (item) => {
    void navigator.clipboard.writeText(item.keywords).then(() => {
      setNotice(`${t("costumesCopied")} ${item.id}`);
      setError("");
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
  };
  const fetchFile = async (item) => {
    setBusy(item.id);
    setError("");
    try {
      const { file } = await fetchCostumeFile(item.id, "full");
      setFiles((prev) => ({ ...prev, [item.id]: file }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };
  const addToChat = async (item) => {
    setBusy(item.id);
    setError("");
    try {
      const res = await fetch(costumeImageUrl(item.id, "full"));
      if (!res.ok) throw new Error(`${t("costumesImageFail")}\uFF1AHTTP ${res.status}`);
      const blob = await res.blob();
      await addImageToConversation(blob, `${item.id}.webp`, { goToConversation });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy("");
    }
  };
  if (!visible) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-root" });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-root", ref: scroller, onScroll, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-head", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-title", children: t("costumesTitle") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-sub", children: stats === null ? t("costumesLoading") : t("costumesSub").replace("{total}", String(stats.total)).replace("{cats}", String(Object.keys(stats.categories).length)) })
    ] }) }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-search", children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
        "input",
        {
          className: "cct-input",
          value: query,
          placeholder: t("costumesPlaceholder"),
          onChange: (event) => {
            const value = event.target.value;
            setQuery(value);
            schedule({ query: value });
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
        "select",
        {
          className: "cct-select",
          value: category,
          onChange: (event) => {
            const value = event.target.value;
            setCategory(value);
            schedule({ category: value });
          },
          children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: "", children: t("costumesAllCategories") }),
            Object.entries(stats?.categories ?? {}).map(([name2, count]) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { value: name2, children: `${name2}\uFF08${count}\uFF09` }, name2))
          ]
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("label", { className: "cct-toggle", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
          "input",
          {
            type: "checkbox",
            checked: onlySafe,
            onChange: (event) => {
              const value = event.target.checked;
              setOnlySafe(value);
              schedule({ safe: value });
            }
          }
        ),
        t("costumesOnlySafe")
      ] })
    ] }),
    error !== "" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-note bad", children: error }),
    notice !== "" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-note", children: notice }),
    loading && items.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-empty", children: t("costumesLoading") }),
    !loading && items.length === 0 && error === "" && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-empty", children: t("costumesEmpty") }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-grid", children: items.map((item) => {
      const file = files[item.id];
      return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-card", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-shot", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(CostumeImage, { src: costumeImageUrl(item.id, "thumb"), alt: item.name, fail: t("costumesImageFail") }) }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-meta", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-name", title: item.name, children: [
            item.adult && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "cct-badge", children: t("costumesAdultBadge") }),
            item.name
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-tagline", children: `${item.id} \xB7 ${item.category}` })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-keywords", title: item.keywords, children: item.keywords }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cct-btn", onClick: () => copyKeywords(item), children: t("costumesCopyKeywords") }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              type: "button",
              className: "cct-btn",
              disabled: busy === item.id,
              onClick: () => {
                void addToChat(item);
              },
              children: t("costumesAddToChat")
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              type: "button",
              className: "cct-btn",
              disabled: busy === item.id,
              onClick: () => {
                void fetchFile(item);
              },
              children: busy === item.id ? t("costumesFetching") : t("costumesFetch")
            }
          )
        ] }),
        file !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-note", title: file, children: `${t("costumesFetched")}\uFF1A${file}` })
      ] }, item.id);
    }) }),
    items.length > 0 && items.length < total && // 提示行同时是键盘可达的手动兜底（自动加载是主路径）。刻意不是按钮样式。
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
      "div",
      {
        className: "cct-more-hint",
        role: "button",
        tabIndex: 0,
        onClick: () => {
          if (!loading) void load(query, category, onlySafe, true);
        },
        onKeyDown: (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          if (!loading) void load(query, category, onlySafe, true);
        },
        children: loading ? t("costumesLoadingMore") : t("costumesScrollMore").replace("{left}", String(total - items.length))
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cct-attr", children: [
      stats?.attribution ?? "",
      stats?.source !== void 0 && stats.source !== "" && /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
        " ",
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("a", { href: stats.source, target: "_blank", rel: "noreferrer", children: t("costumesSource") })
      ] })
    ] })
  ] });
}
function CostumeImage({ src, alt, fail }) {
  const [bad, setBad] = (0, import_react5.useState)(false);
  if (bad) return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cct-shot-fail", children: fail });
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("img", { src, alt, loading: "lazy", onError: () => setBad(true) });
}

// src/components/panel-costumes/client/styles.css
var styles_default4 = "/**\n * \u670D\u88C5\u5E93\u9762\u677F\u7684\u6837\u5F0F\u3002\n *\n * \u6CBF\u7528\u5DE5\u4F5C\u53F0\u90A3\u5957 `--w-*` \u53D8\u91CF\u3002\u7C7B\u540D\u524D\u7F00 `cct-`\uFF08comfyui costume\uFF09\uFF0C\u4E0E `cps-`\uFF08\u59FF\u52BF\uFF09\u3001\n * `ctg-`\uFF08\u6807\u7B7E\uFF09\u3001`cwb-`\uFF08\u76F8\u518C\uFF09\u533A\u5206\u3002\n *\n * \u670D\u88C5\u56FE\u662F\u7AD6\u6784\u56FE\u5E73\u94FA\u7167\uFF0C\u540C\u6837\u7528 3:4\uFF0C\u8BA9\u7F51\u683C\u6574\u9F50\u3002\n */\n\n.cct-root{display:flex;flex-direction:column;gap:10px;padding:14px 20px 24px;min-height:0;height:100%;overflow:auto}\n.cct-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}\n.cct-title{font-size:1.02em;font-weight:600}\n.cct-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}\n.cct-search{display:flex;flex-wrap:wrap;gap:8px}\n.cct-input{flex:1;min-width:180px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.9em;padding:8px 10px}\n.cct-input:focus{border-color:var(--w-accent);outline:none}\n.cct-input::placeholder{color:var(--w-muted)}\n.cct-select{border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;padding:8px 6px}\n.cct-toggle{display:inline-flex;align-items:center;gap:6px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.82em;padding:7px 10px;cursor:pointer}\n.cct-toggle input{accent-color:var(--w-accent)}\n.cct-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px}\n.cct-card{display:flex;flex-direction:column;gap:6px;border:1px solid var(--w-line);border-radius:11px;background:var(--w-surface);overflow:hidden}\n.cct-card:hover{border-color:var(--w-accent)}\n.cct-shot{position:relative;aspect-ratio:3/4;background:var(--w-bg);display:flex;align-items:center;justify-content:center;overflow:hidden}\n.cct-shot img{width:100%;height:100%;object-fit:contain;display:block}\n.cct-shot-fail{font-size:.72em;color:var(--w-muted);text-align:center;padding:8px}\n.cct-meta{padding:0 8px;display:flex;flex-direction:column;gap:3px;min-width:0}\n.cct-name{font-size:.8em;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cct-badge{display:inline-block;margin-right:5px;border-radius:5px;background:var(--w-line);color:var(--w-muted);font-size:.66em;padding:0 4px;vertical-align:1px}\n.cct-tagline{font-size:.72em;color:var(--w-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cct-keywords{font-size:.7em;color:var(--w-muted);padding:0 8px;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}\n.cct-actions{display:flex;gap:6px;padding:0 8px 8px}\n.cct-btn{flex:1;border-radius:8px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.74em;padding:5px 6px;cursor:pointer}\n.cct-btn:hover{border-color:var(--w-accent)}\n.cct-btn[disabled]{opacity:.55;cursor:default}\n.cct-note{font-size:.76em;color:var(--w-muted);padding:0 8px 8px}\n.cct-note.bad{color:#d97757}\n.cct-empty{font-size:.82em;color:var(--w-muted);padding:18px 4px}\n.cct-more-hint{align-self:center;color:var(--w-muted);font-size:.78em;padding:6px 0 2px}\n.cct-attr{font-size:.72em;color:var(--w-muted);line-height:1.5;border-top:1px solid var(--w-line);padding-top:8px}\n.cct-attr a{color:inherit}\n";

// src/client/format.ts
function metaLine(item) {
  const parts = [];
  if (item.width !== void 0 && item.height !== void 0 && item.width > 0 && item.height > 0) {
    parts.push(`${item.width}\xD7${item.height}`);
  }
  if (typeof item.seed === "number") parts.push(`seed ${item.seed}`);
  if (typeof item.checkpoint === "string" && item.checkpoint !== "") parts.push(item.checkpoint);
  if (parts.length === 0) parts.push(item.name);
  return parts.join(" \xB7 ");
}
function planPage(baseItems, batch, offset, total) {
  const seen = new Set(baseItems.map((entry) => entry.path));
  const appended = [];
  for (const entry of batch) {
    if (seen.has(entry.path)) continue;
    seen.add(entry.path);
    appended.push(entry);
  }
  return {
    items: [...baseItems, ...appended],
    more: appended.length > 0 && offset + batch.length < total
  };
}

// src/components/panel-gallery/client/Card.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function Card({ item, t, selecting, selected, onToggle, onOpen, onAction }) {
  const act = (kind) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    onAction(kind, item);
  };
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
    "figure",
    {
      className: `cfa-card${selecting ? " cfa-selectable" : ""}${selecting && selected ? " selected" : ""}`,
      onClick: () => selecting ? onToggle(item) : onOpen(item),
      title: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : item.name,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          "img",
          {
            className: "cfa-thumb",
            src: fileUrl(item.path, true),
            alt: item.name,
            loading: "lazy",
            decoding: "async",
            draggable: false
          }
        ),
        selecting ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: `cfa-pick${selected ? " on" : ""}`, "aria-hidden": "true", children: selected ? "\u2713" : "" }) : null,
        !selecting && dupCount > 1 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-dup", title: t("duplicateBadge").replace("{n}", String(dupCount)), children: `\xD7${dupCount}` }) : null,
        selecting ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cfa-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("copyImage"), "aria-label": t("copyImage"), onClick: act("copyImage"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "copy", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("copyPrompt"), "aria-label": t("copyPrompt"), onClick: act("copyPrompt"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "text", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("exportWorkflow"), "aria-label": t("exportWorkflow"), onClick: act("exportWorkflow"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "download", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("addToChat"), "aria-label": t("addToChat"), onClick: act("addToChat"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "chat", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("useAsInput"), "aria-label": t("useAsInput"), onClick: act("useAsInput"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "image", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn cfa-danger", title: t("remove"), "aria-label": t("remove"), onClick: act("remove"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "trash", size: 15 }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("figcaption", { className: "cfa-cap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-prompt", children: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-meta", children: metaLine(item) })
        ] })
      ]
    }
  );
}

// src/components/panel-gallery/client/Confirm.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function ConfirmRemove(props) {
  const { item, t, busy, onCancel, onConfirm } = props;
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  const copyCount = dupCount > 1 ? Math.min((item.duplicates ?? []).length, dupCount - 1) : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-modal", onClick: busy ? void 0 : onCancel, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-modal-card", onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-modal-title", children: t("removeTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "cfa-modal-body", children: t("removeBody") }),
    copyCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "cfa-modal-body", children: t("duplicateHint").replace("{n}", String(copyCount)) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-modal-name", children: item.name }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "cfa-chip", onClick: onCancel, disabled: busy, children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "cfa-btn-solid-danger", onClick: () => onConfirm(), disabled: busy, children: t("removeConfirm") })
    ] })
  ] }) });
}
function ConfirmBulkRemove(props) {
  const { count, t, busy, onCancel, onConfirm } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-modal", onClick: busy ? void 0 : onCancel, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-modal-card", onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-modal-title", children: t("bulkRemoveTitle").replace("{n}", String(count)) }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { className: "cfa-modal-body", children: t("bulkRemoveBody") }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "cfa-chip", onClick: onCancel, disabled: busy, children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "cfa-btn-solid-danger", onClick: () => onConfirm(), disabled: busy, children: t("removeConfirm") })
    ] })
  ] }) });
}

// src/components/panel-gallery/client/Gallery.tsx
var import_react8 = require("react");

// src/client/actions.ts
async function copyPrompt(item, t) {
  let prompt = item.prompt;
  if (prompt === void 0 || prompt === "") {
    try {
      const data = await apiJson("/meta", { path: item.path });
      const meta = data.meta !== null && typeof data.meta === "object" ? data.meta : null;
      prompt = typeof meta?.prompt === "string" ? meta.prompt : "";
    } catch {
    }
  }
  if (prompt === void 0 || prompt === "") throw new Error(t("noPrompt"));
  await copyTextToClipboard(prompt);
  return t("copiedPrompt");
}
async function exportWorkflow(item, t) {
  const res = await fetch(`${API}/workflow?path=${encodeURIComponent(item.path)}`);
  if (!res.ok) {
    let message = `\u5BFC\u51FA\u5931\u8D25\uFF1AHTTP ${res.status}`;
    try {
      const data = await res.json();
      const bag = data !== null && typeof data === "object" ? data : null;
      if (typeof bag?.message === "string") message = bag.message;
    } catch {
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const base = item.name.replace(/\.[^.]+$/, "");
  const filename = `${base}.workflow.json`;
  download(blob, filename);
  return `${t("exported")} ${filename}`;
}
async function runAction(kind, item, t, handlers) {
  if (kind === "copyImage") {
    await copyImageToClipboard(item.path);
    return t("copiedImage");
  }
  if (kind === "copyPrompt") return await copyPrompt(item, t);
  if (kind === "exportWorkflow") return await exportWorkflow(item, t);
  if (kind === "describe") {
    await describeImage(item, handlers);
    return t("describeQueued");
  }
  await addToConversation(item, handlers);
  return t("added");
}

// src/components/panel-gallery/client/hooks/useGalleryData.ts
var import_react6 = require("react");

// src/client/types.ts
var PAGE4 = 60;

// src/components/panel-gallery/client/hooks/useGalleryData.ts
function useGalleryData(options) {
  const { visible, root, query, includeBare, mergeDuplicates } = options;
  const [items, setItems] = (0, import_react6.useState)([]);
  const [total, setTotal] = (0, import_react6.useState)(0);
  const [truncated, setTruncated] = (0, import_react6.useState)(false);
  const [loading, setLoading] = (0, import_react6.useState)(true);
  const [loadingMore, setLoadingMore] = (0, import_react6.useState)(false);
  const [hasMore, setHasMore] = (0, import_react6.useState)(false);
  const [notice, setNotice] = (0, import_react6.useState)(null);
  const [roots, setRoots] = (0, import_react6.useState)([]);
  const itemsRef = (0, import_react6.useRef)([]);
  const hasMoreRef = (0, import_react6.useRef)(false);
  const inFlightRef = (0, import_react6.useRef)(false);
  const requestRef = (0, import_react6.useRef)(0);
  const scrollRef = (0, import_react6.useRef)(null);
  const loadRef = (0, import_react6.useRef)(null);
  const observerRef = (0, import_react6.useRef)(null);
  const load = (0, import_react6.useCallback)(async (reset) => {
    if (!reset && inFlightRef.current) return;
    const token = ++requestRef.current;
    inFlightRef.current = true;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const offset = reset ? 0 : itemsRef.current.length;
      const params = {
        offset: String(offset),
        limit: String(PAGE4),
        all: includeBare ? "1" : "0",
        dedupe: mergeDuplicates ? "1" : "0"
      };
      if (root !== "all") params.root = root;
      if (query.trim() !== "") params.q = query.trim();
      const data = await apiJson("/items", params);
      if (token !== requestRef.current) return;
      const batch = Array.isArray(data.items) ? data.items : [];
      const totalValue = typeof data.total === "number" ? data.total : 0;
      const base = reset ? [] : itemsRef.current;
      const planned = planPage(base, batch, offset, totalValue);
      itemsRef.current = planned.items;
      setItems(planned.items);
      setTotal(totalValue);
      setTruncated(data.truncated === true);
      hasMoreRef.current = planned.more;
      setHasMore(planned.more);
    } catch (error) {
      if (token === requestRef.current) {
        hasMoreRef.current = false;
        setHasMore(false);
        setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (token === requestRef.current) {
        inFlightRef.current = false;
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [root, query, includeBare, mergeDuplicates]);
  loadRef.current = load;
  const sentinelRef = (0, import_react6.useCallback)((node) => {
    if (observerRef.current !== null) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (node === null || typeof IntersectionObserver !== "function") return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (inFlightRef.current || !hasMoreRef.current) return;
      if (typeof loadRef.current === "function") loadRef.current(false);
    }, { root: scrollRef.current, rootMargin: "180px" });
    observer.observe(node);
    observerRef.current = observer;
  }, []);
  (0, import_react6.useEffect)(() => {
    if (!visible) return void 0;
    let alive = true;
    apiJson("/roots").then((data) => {
      if (alive) setRoots(Array.isArray(data.roots) ? data.roots : []);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [visible]);
  (0, import_react6.useEffect)(() => {
    if (!visible) return void 0;
    const delay = query.trim() === "" ? 0 : 240;
    const timer = setTimeout(() => {
      void load(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, root, includeBare, query, load]);
  (0, import_react6.useEffect)(() => {
    if (notice === null) return void 0;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  const dropItems = (0, import_react6.useCallback)((paths, totalDelta) => {
    const remaining = itemsRef.current.filter((entry) => !paths.has(entry.path));
    itemsRef.current = remaining;
    setItems(remaining);
    setTotal((value) => Math.max(0, value - totalDelta));
    if (hasMoreRef.current && typeof loadRef.current === "function") loadRef.current(false);
  }, []);
  return {
    items,
    itemsRef,
    total,
    truncated,
    loading,
    loadingMore,
    hasMore,
    hasMoreRef,
    notice,
    roots,
    scrollRef,
    sentinelRef,
    setNotice,
    reload: (reset) => {
      void load(reset);
    },
    dropItems
  };
}

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
  const text = [
    item.name ?? "",
    item.prompt ?? "",
    item.checkpoint ?? "",
    item.workflowId ?? ""
  ].join(" ").toLowerCase();
  if (text.trim() === "") return { nsfw: false, why: [] };
  const strong = STRONG.filter((word) => text.includes(word));
  if (strong.length > 0) return { nsfw: true, why: strong };
  const medium = MEDIUM.filter((word) => text.includes(word));
  if (medium.length >= MEDIUM_THRESHOLD) return { nsfw: true, why: medium };
  return { nsfw: false, why: medium };
}
function isNsfw(item) {
  return nsfwVerdictOf(item).nsfw;
}

// src/components/panel-gallery/client/styles.css
var styles_default5 = "/**\n * \u9762\u677F\u6837\u5F0F\u3002\n *\n * \u4EE5\u5B57\u7B26\u4E32\u8FD4\u56DE\uFF0C\u7531\u6839\u7EC4\u4EF6\u5185\u8054\u6CE8\u5165\uFF08<style>{CSS}</style>\uFF09\u3002\n * \u7528\u5185\u8054\u800C\u4E0D\u662F\u5916\u90E8 CSS \u6587\u4EF6\uFF1A\u63D2\u4EF6\u4EA7\u7269\u662F\u5355\u6587\u4EF6\uFF0C\u7701\u6389\u4E00\u6B21\u8D44\u6E90\u52A0\u8F7D\u4E0E\u8DEF\u5F84\u89E3\u6790\u3002\n */\n\n.cfa-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px}\n.cfa-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-base)}\n.cfa-head{display:flex;align-items:center;gap:8px;font-weight:600}\n.cfa-head svg{color:var(--dsw-alias-brand-primary)}\n.cfa-title{font-size:13.5px;letter-spacing:.01em}\n.cfa-count{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 8px;min-width:10px;text-align:center}\n.cfa-tools{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}\n.cfa-search{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}\n.cfa-search:focus-within{border-color:var(--dsw-alias-brand-primary)}\n.cfa-search input{border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;width:150px;font-family:inherit}\n.cfa-search input::placeholder{color:var(--dsw-alias-label-secondary)}\n.cfa-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;padding:5px 9px;outline:none;max-width:180px;font-family:inherit}\n.cfa-select:focus{border-color:var(--dsw-alias-brand-primary)}\n.cfa-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;padding:5px 9px;cursor:pointer;font-family:inherit}\n.cfa-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}\n.cfa-chip.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}\n.cfa-btn{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}\n.cfa-btn:hover,.cfa-btn:focus-visible{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);outline:none}\n.cfa-btn[disabled]{opacity:.45;cursor:default}\n.cfa-btn.cfa-danger:hover,.cfa-btn.cfa-danger:focus-visible{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}\n.cfa-body{flex:1;min-height:240px;overflow:auto;padding:14px 16px 28px;scrollbar-gutter:stable}\n.cfa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:12px}\n.cfa-card{position:relative;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);cursor:zoom-in;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}\n.cfa-card:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.16);border-color:var(--dsw-alias-border-l2)}\n.cfa-thumb{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}\n.cfa-actions{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transform:translateY(-3px);transition:opacity .14s ease,transform .14s ease}\n.cfa-card:hover .cfa-actions,.cfa-card:focus-within .cfa-actions{opacity:1;transform:none}\n.cfa-actions .cfa-btn{width:27px;height:27px;color:#fff;border-color:rgba(255,255,255,.22);background:rgba(14,14,18,.62);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}\n.cfa-actions .cfa-btn:hover{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}\n.cfa-actions .cfa-btn.cfa-danger:hover{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:#fff}\n.cfa-dup{position:absolute;left:6px;top:6px;z-index:2;pointer-events:none;padding:1px 7px;border-radius:999px;font-size:10.5px;line-height:1.5;color:#fff;background:rgba(14,14,18,.66);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}\n.cfa-dup-list{max-height:132px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}\n.cfa-selectable{cursor:pointer}\n.cfa-pick{position:absolute;left:6px;top:6px;z-index:3;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,.8);background:rgba(14,14,18,.5);color:#fff;font-size:12px;line-height:1;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}\n.cfa-pick.on{background:var(--dsw-alias-brand-primary);border-color:transparent}\n.cfa-card.selected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}\n.cfa-bulk{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2500;display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 40px rgba(0,0,0,.34);flex-wrap:wrap;max-width:min(680px,92vw)}\n.cfa-bulk-count{font-size:12.5px;color:var(--dsw-alias-label-primary);padding:0 4px;white-space:nowrap}\n.cfa-bulk-gap{width:6px}\n.cfa-bulk .cfa-chip{display:inline-flex;align-items:center;gap:5px}\n.cfa-chip.cfa-bulk-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}\n.cfa-chip.cfa-bulk-danger:hover{border-color:var(--dsw-alias-state-error-primary)}\n.cfa-chip[disabled]{opacity:.45;cursor:default}\n.cfa-cap{display:flex;flex-direction:column;gap:2px;padding:7px 9px 8px;background:var(--dsw-alias-bg-layer-1)}\n.cfa-prompt{font-size:11.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cfa-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cfa-hint,.cfa-empty{color:var(--dsw-alias-label-secondary);padding:48px 24px;text-align:center;line-height:1.7}\n.cfa-more{display:flex;justify-content:center;align-items:center;min-height:38px;padding:8px 0 4px}\n.cfa-notice{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3000;max-width:min(560px,86vw);padding:8px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 30px rgba(0,0,0,.28);animation:cfa-in .16s ease}\n.cfa-notice.err{color:var(--dsw-alias-state-error-primary)}\n@keyframes cfa-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}\n.cfa-modal{position:fixed;inset:0;z-index:2900;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(8,8,11,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}\n.cfa-modal-card{width:340px;max-width:100%;display:flex;flex-direction:column;gap:10px;padding:16px 17px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 20px 60px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary)}\n.cfa-modal-title{font-size:13.5px;font-weight:600}\n.cfa-modal-body{margin:0;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary)}\n.cfa-modal-name{padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:11.5px;word-break:break-all}\n.cfa-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}\n.cfa-btn-solid-danger{border:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:#fff;border-radius:8px;padding:5px 12px;font-size:12.5px;font-family:inherit;cursor:pointer}\n.cfa-btn-solid-danger:hover{filter:brightness(1.08)}\n.cfa-btn-solid-danger[disabled]{opacity:.5;cursor:default}\n.cfa-lb{position:fixed;inset:0;z-index:2600;display:flex;gap:16px;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}\n.cfa-lb-stage{position:relative;overflow:hidden;flex:1;min-width:0;display:flex;align-items:center;justify-content:center}\n.cfa-lb-img{max-width:100%;max-height:calc(100vh - 40px);border-radius:10px;box-shadow:0 24px 70px rgba(0,0,0,.5);user-select:none;touch-action:none;will-change:transform}\n.cfa-lb-img.dragging{cursor:grabbing}\n.cfa-lb-nav{position:absolute;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(14,14,18,.6);color:#fff;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .12s ease}\n.cfa-lb-nav:hover{background:var(--dsw-alias-brand-primary);border-color:transparent}\n.cfa-lb-nav.prev{left:12px}\n.cfa-lb-nav.next{right:12px}\n.cfa-lb-count{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:2px 9px;border-radius:999px;font-size:11.5px;color:#fff;background:rgba(14,14,18,.6);border:1px solid rgba(255,255,255,.16);font-variant-numeric:tabular-nums}\n.cfa-lb-zoom{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:10px;background:rgba(14,14,18,.66);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}\n.cfa-lb-zbtn{display:grid;place-items:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:#fff;cursor:pointer;padding:0}\n.cfa-lb-zbtn:hover{background:rgba(255,255,255,.14)}\n.cfa-lb-zvalue{min-width:50px;border:none;background:transparent;color:#fff;font-size:11.5px;cursor:pointer;font-variant-numeric:tabular-nums;font-family:inherit}\n.cfa-lb-side{width:344px;flex:none;display:flex;flex-direction:column;gap:12px;padding:14px 15px;border-radius:12px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}\n.cfa-lb-head{display:flex;align-items:center;gap:8px;justify-content:space-between}\n.cfa-lb-head strong{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cfa-lb-actions{display:flex;gap:6px;flex-wrap:wrap}\n.cfa-lb-actions .cfa-btn{width:auto;padding:0 10px;height:28px;display:flex;align-items:center;gap:5px;font-size:12px;font-family:inherit}\n.cfa-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px}\n.cfa-kv dt{color:var(--dsw-alias-label-secondary);white-space:nowrap}\n.cfa-kv dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}\n.cfa-kv-k{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}\n.cfa-prompt-box{margin:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;user-select:text}\n@media (hover:none){.cfa-actions{opacity:1;transform:none}}\n@media (max-width:820px){.cfa-lb{flex-direction:column;padding:12px}.cfa-lb-side{width:auto;max-height:44vh}.cfa-lb-img{max-height:62vh}.cfa-lb-nav{width:34px;height:34px}}\n.cfa-extra{position:relative;display:inline-flex}\n.cfa-extra-trigger{letter-spacing:1px;line-height:1;padding:0 8px}\n/* top:100% + \u81EA\u8EAB padding \u6491\u51FA\u95F4\u8DDD\uFF1A\u4E0D\u80FD\u7528 top:calc(100% + 6px)\uFF0C\u90A3\u4E2D\u95F4\u7684 6px \u662F\u771F\u7A7A\uFF0C */\n/* \u9F20\u6807\u659C\u7740\u79FB\u8FC7\u53BB\u65F6 :hover \u4F1A\u65AD\uFF0C\u9762\u677F\u5728\u6307\u9488\u5230\u8FBE\u4E4B\u524D\u5C31\u6CA1\u4E86\u3002 */\n.cfa-extra-panel{display:none;position:absolute;top:100%;margin-top:0;right:0;z-index:20;min-width:150px;padding:12px 6px 6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35)}\n/* \u60AC\u6D6E\u624D\u5C55\u5F00\uFF1A\u5E38\u9A7B\u4F1A\u4E00\u76F4\u6324\u5360\u5DE5\u5177\u6761\uFF0C\u8FD9\u4E2A\u5F00\u5173\u4E0D\u662F\u6BCF\u6B21\u90FD\u8981\u70B9 */\n.cfa-extra:hover .cfa-extra-panel,.cfa-extra:focus-within .cfa-extra-panel{display:block}\n.cfa-extra-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}\n.cfa-extra-item:hover{background:var(--dsw-alias-bg-layer-2)}\n.cfa-extra-item.on{color:var(--dsw-alias-brand-primary)}\n.cfa-extra-count{margin-left:auto;font-size:11px;opacity:.65}\n";

// src/components/panel-gallery/client/BulkBar.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
function BulkBar(props) {
  const { t, selectedCount, busy } = props;
  const idle = selectedCount === 0 || busy.startsWith("bulk:");
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "cfa-bulk", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "cfa-bulk-count", children: t("selectedCount").replace("{n}", String(selectedCount)) }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onSelectAll, children: t("selectAll") }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onSelectNone, children: t("selectNone") }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "cfa-bulk-gap" }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("button", { type: "button", className: "cfa-chip", disabled: idle, onClick: props.onExport, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Icon, { name: "download", size: 14 }),
      " ",
      t("bulkExport")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("button", { type: "button", className: "cfa-chip cfa-bulk-danger", disabled: idle, onClick: props.onRemove, children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(Icon, { name: "trash", size: 14 }),
      " ",
      t("bulkDelete")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onExit, children: t("exitSelect") })
  ] });
}

// src/components/panel-gallery/client/Lightbox.tsx
var import_react7 = require("react");
var import_jsx_runtime10 = require("react/jsx-runtime");
function clampZoom(value) {
  return Math.min(8, Math.max(0.2, value));
}
function Kv({ k, v }) {
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dt", { children: k }),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dd", { title: String(v), children: String(v) })
  ] });
}
function Lightbox(props) {
  const { item, index, count, t, onClose, onAction, onPrev, onNext } = props;
  const [zoom, setZoom] = (0, import_react7.useState)(1);
  const [pan, setPan] = (0, import_react7.useState)({ x: 0, y: 0 });
  const [dragging, setDragging] = (0, import_react7.useState)(false);
  const stageRef = (0, import_react7.useRef)(null);
  const dragRef = (0, import_react7.useRef)(null);
  (0, import_react7.useEffect)(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
    setDragging(false);
  }, [item.path]);
  (0, import_react7.useEffect)(() => {
    const node = stageRef.current;
    if (node === null) return void 0;
    const onWheel = (event) => {
      event.preventDefault();
      setZoom((previous) => clampZoom(previous * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [item.path]);
  (0, import_react7.useEffect)(() => {
    const onKey = (event) => {
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        setZoom((previous) => clampZoom(previous * 1.2));
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        setZoom((previous) => clampZoom(previous / 1.2));
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(1);
        setPan({ x: 0, y: 0 });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  const resetZoom = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const onPointerDown = (event) => {
    if (zoom <= 1) return;
    dragRef.current = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
    setDragging(true);
    if (typeof event.currentTarget.setPointerCapture === "function") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const onPointerMove = (event) => {
    const drag = dragRef.current;
    if (drag === null) return;
    setPan({ x: drag.panX + (event.clientX - drag.x), y: drag.panY + (event.clientY - drag.y) });
  };
  const endDrag = () => {
    dragRef.current = null;
    setDragging(false);
  };
  const act = (kind) => (event) => {
    event.stopPropagation();
    onAction(kind, item);
  };
  const rows = [];
  if (item.width !== void 0 && item.height !== void 0 && item.width > 0 && item.height > 0) {
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("size"), v: `${item.width}\xD7${item.height}` }, "size"));
  }
  if (typeof item.seed === "number") rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("seed"), v: item.seed }, "seed"));
  if (typeof item.checkpoint === "string" && item.checkpoint !== "") rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("model"), v: item.checkpoint }, "model"));
  if (typeof item.samplerName === "string" && item.samplerName !== "") {
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("sampler"), v: item.samplerName + (item.scheduler !== void 0 && item.scheduler !== "" ? ` / ${item.scheduler}` : "") }, "sampler"));
  }
  if (typeof item.steps === "number" && item.steps > 0) rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("steps"), v: item.steps }, "steps"));
  if (typeof item.cfgScale === "number" && item.cfgScale > 0) rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("cfg"), v: item.cfgScale }, "cfg"));
  if (typeof item.mode === "string" && item.mode !== "") rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("mode"), v: item.mode }, "mode"));
  if (typeof item.createdAt === "string" && item.createdAt !== "") {
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("createdAt"), v: String(item.createdAt).replace("T", " ").slice(0, 19) }, "created"));
  }
  rows.push(/* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Kv, { k: t("filePath"), v: item.path }, "path"));
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cfa-lb", onClick: onClose, children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(
      "div",
      {
        className: "cfa-lb-stage",
        ref: stageRef,
        onClick: (event) => event.stopPropagation(),
        onDoubleClick: () => zoom > 1 ? resetZoom() : setZoom(2),
        onPointerDown,
        onPointerMove,
        onPointerUp: endDrag,
        onPointerCancel: endDrag,
        onPointerLeave: endDrag,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
            "img",
            {
              className: `cfa-lb-img${dragging ? " dragging" : ""}`,
              src: fileUrl(item.path),
              alt: item.name,
              draggable: false,
              style: {
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                cursor: zoom > 1 ? dragging ? "grabbing" : "grab" : "zoom-in",
                transition: dragging ? "none" : "transform .1s ease"
              }
            },
            item.path
          ),
          count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-lb-nav prev", title: t("prevImage"), "aria-label": t("prevImage"), onClick: (event) => {
            event.stopPropagation();
            onPrev();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "chevronLeft", size: 18 }) }) : null,
          count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-lb-nav next", title: t("nextImage"), "aria-label": t("nextImage"), onClick: (event) => {
            event.stopPropagation();
            onNext();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "chevronRight", size: 18 }) }) : null,
          typeof index === "number" && count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("span", { className: "cfa-lb-count", children: `${index + 1} / ${count}` }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cfa-lb-zoom", onClick: (event) => event.stopPropagation(), children: [
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-lb-zbtn", title: t("zoomOut"), "aria-label": t("zoomOut"), onClick: () => setZoom((previous) => clampZoom(previous / 1.2)), children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "minus", size: 14 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-lb-zvalue", title: t("zoomReset"), onClick: resetZoom, children: `${Math.round(zoom * 100)}%` }),
            /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-lb-zbtn", title: t("zoomIn"), "aria-label": t("zoomIn"), onClick: () => setZoom((previous) => clampZoom(previous * 1.2)), children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "plus", size: 14 }) })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("aside", { className: "cfa-lb-side", onClick: (event) => event.stopPropagation(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cfa-lb-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("strong", { title: item.name, children: item.name }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("button", { type: "button", className: "cfa-btn", title: t("close"), "aria-label": t("close"), onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "close", size: 15 }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cfa-lb-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("copyImage"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "copy", size: 14 }),
          t("copyImage")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("copyPrompt"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "text", size: 14 }),
          t("copyPrompt")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("exportWorkflow"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "download", size: 14 }),
          t("exportWorkflow")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("addToChat"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "chat", size: 14 }),
          t("addToChat")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("describe"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "text", size: 14 }),
          t("describe")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("button", { type: "button", className: "cfa-btn cfa-danger", onClick: act("remove"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Icon, { name: "trash", size: 14 }),
          t("remove")
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("dl", { className: "cfa-kv", children: rows }),
      dupCount > 1 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cfa-kv-k", children: `${t("duplicates")} \xB7 ${dupCount}` }),
        /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cfa-prompt-box cfa-dup-list", children: (item.duplicates ?? []).map((other) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { children: other }, other)) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cfa-kv-k", children: t("prompt") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "cfa-prompt-box", children: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : t("noPrompt") }),
      item.negativePrompt !== void 0 && item.negativePrompt !== "" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cfa-kv-k", children: t("negativePrompt") }) : null,
      item.negativePrompt !== void 0 && item.negativePrompt !== "" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("p", { className: "cfa-prompt-box", children: item.negativePrompt }) : null
    ] })
  ] });
}

// src/components/panel-gallery/client/Toolbar.tsx
var import_jsx_runtime11 = require("react/jsx-runtime");
function Toolbar(props) {
  const { t, total, roots, root, query, includeBare, mergeDuplicates, selecting, embedded, hideNsfw, hiddenNsfwCount, onToggleNsfw, visibleCount, loadedCount } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("header", { className: "cfa-bar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "cfa-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "album", size: 18 }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "cfa-title", children: t("tabAssets") }),
      total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "cfa-count", children: hideNsfw && visibleCount < loadedCount ? `${visibleCount} / ${loadedCount}` : String(loadedCount) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "cfa-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("label", { className: "cfa-search", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "search", size: 14 }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("input", { value: query, placeholder: t("search"), onChange: (event) => props.onQuery(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("select", { className: "cfa-select", value: root, title: t("allRoots"), onChange: (event) => props.onRoot(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: "all", children: t("allRoots") }),
        roots.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("option", { value: entry.path, title: entry.path, children: entry.label !== "" ? entry.label : entry.path }, entry.path))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${includeBare ? " on" : ""}`,
          title: includeBare ? t("onlyGenerated") : t("onlyGeneratedOn"),
          onClick: props.onToggleBare,
          children: includeBare ? t("onlyGeneratedOn") : t("onlyGenerated")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${mergeDuplicates ? " on" : ""}`,
          title: t("mergeDuplicates"),
          onClick: props.onToggleDuplicates,
          children: t("mergeDuplicates")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${selecting ? " on" : ""}`,
          title: selecting ? t("exitSelect") : t("select"),
          onClick: props.onToggleSelecting,
          children: selecting ? t("exitSelect") : t("select")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "cfa-btn", title: t("refresh"), "aria-label": t("refresh"), onClick: props.onRefresh, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "refresh", size: 15 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)("div", { className: "cfa-extra", children: [
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "cfa-btn cfa-extra-trigger", title: t("moreActions"), "aria-label": t("moreActions"), children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { "aria-hidden": "true", children: "\u22EF" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("div", { className: "cfa-extra-panel", children: /* @__PURE__ */ (0, import_jsx_runtime11.jsxs)(
          "button",
          {
            type: "button",
            className: `cfa-extra-item${hideNsfw ? " on" : ""}`,
            title: t("hideNsfwHint"),
            onClick: props.onToggleNsfw,
            children: [
              hideNsfw ? t("showNsfw") : t("hideNsfw"),
              hiddenNsfwCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { className: "cfa-extra-count", children: hiddenNsfwCount }) : null
            ]
          }
        ) })
      ] }),
      embedded ? null : /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("button", { type: "button", className: "cfa-btn", title: t("openSidebar"), "aria-label": t("openSidebar"), onClick: props.onOpenSidebar, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "dock", size: 15 }) })
    ] })
  ] });
}

// src/components/panel-gallery/client/Gallery.tsx
var import_jsx_runtime12 = require("react/jsx-runtime");
var POLL_MS = 1500;
var POLL_MAX_TICKS = 200;
function Gallery({ t, visible, embedded, goToConversation, openSidebar }) {
  const [root, setRoot] = (0, import_react8.useState)("all");
  const [query, setQuery] = (0, import_react8.useState)("");
  const [includeBare, setIncludeBare] = (0, import_react8.useState)(false);
  const [mergeDuplicates, setMergeDuplicates] = (0, import_react8.useState)(true);
  const [hideNsfw, setHideNsfw] = (0, import_react8.useState)(false);
  const [activePath, setActivePath] = (0, import_react8.useState)(null);
  const [busy, setBusy] = (0, import_react8.useState)("");
  const [pendingDelete, setPendingDelete] = (0, import_react8.useState)(null);
  const [selecting, setSelecting] = (0, import_react8.useState)(false);
  const [selected, setSelected] = (0, import_react8.useState)(() => /* @__PURE__ */ new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = (0, import_react8.useState)(false);
  const [watching, setWatching] = (0, import_react8.useState)(null);
  const gallery = useGalleryData({ visible, root, query, includeBare, mergeDuplicates });
  const { items, itemsRef, total, truncated, loading, loadingMore, hasMore, notice, setNotice, reload } = gallery;
  const reloadRef = (0, import_react8.useRef)(reload);
  reloadRef.current = reload;
  const nsfwFlags = items.map((item) => isNsfw({
    name: item.name,
    prompt: item.prompt,
    negativePrompt: item.negativePrompt,
    checkpoint: item.checkpoint
  }));
  const hiddenNsfwCount = nsfwFlags.filter(Boolean).length;
  const visibleItems = hideNsfw ? items.filter((_, i) => nsfwFlags[i] !== true) : items;
  const activeIndex = activePath === null ? -1 : visibleItems.findIndex((entry) => entry.path === activePath);
  const activeItem = activeIndex >= 0 ? visibleItems[activeIndex] ?? null : null;
  const stepActive = (delta) => {
    if (activeIndex < 0 || visibleItems.length === 0) return;
    const next = (activeIndex + delta + visibleItems.length) % visibleItems.length;
    const target = visibleItems[next];
    if (target !== void 0) setActivePath(target.path);
  };
  (0, import_react8.useEffect)(() => {
    if (hideNsfw && activePath !== null && activeItem === null) setActivePath(null);
  }, [hideNsfw, activePath, activeItem]);
  (0, import_react8.useEffect)(() => {
    if (activePath === null) return void 0;
    const onKey = (event) => {
      if (event.key === "Escape") {
        if (pendingDelete !== null) setPendingDelete(null);
        else setActivePath(null);
        return;
      }
      if (pendingDelete !== null) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        stepActive(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        stepActive(1);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [activePath, pendingDelete, items]);
  const handlers = { goToConversation };
  const rerunAsInput = async (item) => {
    try {
      const res = await fetch(`${API}/rerun`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: item.path, asInput: true })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.ok !== true) throw new Error(String(data.message ?? data.error ?? "\u91CD\u8DD1\u5931\u8D25"));
      setNotice({ kind: "ok", text: t("useAsInputStarted").replace("{id}", item.name) });
      if (typeof data.promptId === "string" && data.promptId !== "") setWatching(data.promptId);
    } catch (error) {
      setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) });
    }
  };
  (0, import_react8.useEffect)(() => {
    if (watching === null) return void 0;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > POLL_MAX_TICKS) {
        clearInterval(timer);
        setWatching(null);
        setNotice({ kind: "err", text: t("rerunUnknown") });
        return;
      }
      void fetchRunStatus(watching).then((status) => {
        if (!status.found) return;
        if (status.state === "done") {
          setWatching(null);
          setNotice({ kind: "ok", text: t("rerunDone") });
          reloadRef.current(true);
          return;
        }
        if (status.state === "failed") {
          setWatching(null);
          setNotice({ kind: "err", text: t("rerunFailed").replace("{message}", status.error?.message ?? status.state) });
          return;
        }
        if (status.state === "unknown") {
          setWatching(null);
          reloadRef.current(true);
          setNotice({ kind: "err", text: t("rerunUnknown") });
        }
      }).catch(() => {
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [watching]);
  const onAction = (kind, item) => {
    if (kind === "remove") {
      setPendingDelete(item);
      return;
    }
    if (kind === "useAsInput") {
      const key2 = `useAsInput:${item.path}`;
      if (busy === key2) return;
      setBusy(key2);
      void rerunAsInput(item).finally(() => setBusy(""));
      return;
    }
    const key = `${kind}:${item.path}`;
    if (busy === key) return;
    setBusy(key);
    void runAction(kind, item, t, handlers).then((message) => {
      if (message !== "") setNotice({ kind: "ok", text: message });
    }).catch((error) => setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) })).finally(() => setBusy(""));
  };
  const removeBusyKey = pendingDelete === null ? "" : `remove:${pendingDelete.path}`;
  const confirmRemove = async () => {
    const target = pendingDelete;
    if (target === null || busy === `remove:${target.path}`) return;
    setBusy(`remove:${target.path}`);
    try {
      const paths = [target.path, ...target.duplicates ?? []];
      const res = await fetch(`${API}/delete-many`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths })
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
      }
      const bag = payload !== null && typeof payload === "object" ? payload : null;
      if (!res.ok || bag === null || bag.ok !== true) {
        throw new Error(typeof bag?.message === "string" ? bag.message : `\u5220\u9664\u5931\u8D25\uFF1AHTTP ${res.status}`);
      }
      const failures = Array.isArray(bag.failed) ? bag.failed : [];
      const failure = failures[0];
      if (failure !== void 0) throw new Error(typeof failure.message === "string" ? failure.message : "\u5220\u9664\u5931\u8D25");
      const removedSet = new Set(Array.isArray(bag.removed) ? bag.removed : []);
      gallery.dropItems(removedSet, 1);
      setActivePath((current) => current !== null && removedSet.has(current) ? null : current);
      setNotice({ kind: "ok", text: t("removed") });
    } catch (error) {
      setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
      setPendingDelete(null);
    }
  };
  const selectedItems = () => itemsRef.current.filter((entry) => selected.has(entry.path));
  const toggleSelect = (item) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(item.path)) next.delete(item.path);
      else next.add(item.path);
      return next;
    });
  };
  const exitSelect = () => {
    setSelecting(false);
    setSelected(/* @__PURE__ */ new Set());
    setBulkConfirmOpen(false);
  };
  const selectAllShown = () => setSelected(new Set(visibleItems.map((entry) => entry.path)));
  const selectNone = () => setSelected(/* @__PURE__ */ new Set());
  const bulkExport = async () => {
    const chosen = selectedItems();
    if (chosen.length === 0) return;
    const paths = chosen.map((entry) => entry.path);
    setBusy("bulk:export");
    try {
      const res = await fetch(`${API}/workflows`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths })
      });
      if (!res.ok) {
        let message = `\u5BFC\u51FA\u5931\u8D25\uFF1AHTTP ${res.status}`;
        try {
          const data = await res.json();
          const bag = data !== null && typeof data === "object" ? data : null;
          if (typeof bag?.message === "string") message = bag.message;
        } catch {
        }
        throw new Error(message);
      }
      const skipped = Number(res.headers.get("X-Workbench-Skipped") ?? "0");
      const blob = await res.blob();
      const stamp = (/* @__PURE__ */ new Date()).toISOString().replace(/[-:T]/g, "").slice(0, 14);
      download(blob, `comfyui-workbench-workflows-${stamp}.zip`);
      const exported = Math.max(0, paths.length - skipped);
      setNotice({
        kind: "ok",
        text: skipped > 0 ? t("bulkExportedSkipped").replace("{n}", String(exported)).replace("{m}", String(skipped)) : t("bulkExported").replace("{n}", String(exported))
      });
    } catch (error) {
      setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };
  const bulkRemove = async () => {
    const chosen = selectedItems();
    if (chosen.length === 0) return;
    const paths = [];
    for (const entry of chosen) {
      paths.push(entry.path);
      for (const extra of entry.duplicates ?? []) paths.push(extra);
    }
    setBusy("bulk:delete");
    try {
      const res = await fetch(`${API}/delete-many`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paths })
      });
      let payload = null;
      try {
        payload = await res.json();
      } catch {
      }
      const bag = payload !== null && typeof payload === "object" ? payload : null;
      if (!res.ok || bag === null || bag.ok !== true) {
        throw new Error(typeof bag?.message === "string" ? bag.message : `\u5220\u9664\u5931\u8D25\uFF1AHTTP ${res.status}`);
      }
      const failures = Array.isArray(bag.failed) ? bag.failed : [];
      const failedSet = new Set(failures.map((entry) => String(entry.path ?? "")));
      const chosenPaths = new Set(chosen.map((entry) => entry.path));
      const failedPrimary = chosen.filter((entry) => failedSet.has(entry.path)).length;
      const removedCount = chosen.length - failedPrimary;
      const removedPaths = new Set([...chosenPaths].filter((path) => !failedSet.has(path)));
      gallery.dropItems(removedPaths, removedCount);
      setActivePath((current) => current !== null && chosenPaths.has(current) ? null : current);
      setNotice({
        kind: failedPrimary > 0 ? "err" : "ok",
        text: failedPrimary > 0 ? t("bulkDeletePartial").replace("{n}", String(removedCount)).replace("{m}", String(failedPrimary)) : t("bulkDeleted").replace("{n}", String(removedCount))
      });
      setSelected(/* @__PURE__ */ new Set());
      setBulkConfirmOpen(false);
    } catch (error) {
      setNotice({ kind: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy("");
    }
  };
  const openInSidebar = () => {
    if (openSidebar() === false) setNotice({ kind: "err", text: t("noSidebar") });
  };
  const emptyText = query.trim() !== "" ? t("emptyFiltered") : hideNsfw && items.length > 0 ? t("emptyAllHidden") : t("empty");
  return /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "cfa-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("style", { children: styles_default5 }),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      Toolbar,
      {
        t,
        total,
        visibleCount: visibleItems.length,
        loadedCount: items.length,
        roots: gallery.roots,
        root,
        query,
        includeBare,
        mergeDuplicates,
        hideNsfw,
        hiddenNsfwCount,
        onToggleNsfw: () => setHideNsfw((value) => !value),
        selecting,
        embedded: embedded === true,
        onQuery: setQuery,
        onRoot: setRoot,
        onToggleBare: () => setIncludeBare((value) => !value),
        onToggleDuplicates: () => setMergeDuplicates((value) => !value),
        onToggleSelecting: () => selecting ? exitSelect() : setSelecting(true),
        onRefresh: () => gallery.reload(true),
        onOpenSidebar: openInSidebar
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "cfa-body", ref: gallery.scrollRef, children: [
      loading && visibleItems.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "cfa-hint", children: t("loading") }) : null,
      !loading && visibleItems.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "cfa-empty", children: emptyText }) : null,
      visibleItems.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "cfa-grid", children: visibleItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
        Card,
        {
          item,
          t,
          selecting,
          selected: selected.has(item.path),
          onToggle: toggleSelect,
          onOpen: (entry) => setActivePath(entry.path),
          onAction
        },
        item.path
      )) }) : null,
      items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime12.jsxs)("div", { className: "cfa-more", ref: gallery.sentinelRef, children: [
        loadingMore ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("span", { className: "cfa-hint", children: t("loading") }) : null,
        !loadingMore && hasMore ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("button", { type: "button", className: "cfa-chip", onClick: () => gallery.reload(false), children: t("loadMore") }) : null
      ] }) : null,
      truncated ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: "cfa-hint", children: t("truncated") }) : null
    ] }),
    notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)("div", { className: `cfa-notice${notice.kind === "err" ? " err" : ""}`, children: notice.text }) : null,
    selecting ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      BulkBar,
      {
        t,
        selectedCount: selected.size,
        busy,
        onSelectAll: selectAllShown,
        onSelectNone: selectNone,
        onExport: () => {
          void bulkExport();
        },
        onRemove: () => setBulkConfirmOpen(true),
        onExit: exitSelect
      }
    ) : null,
    activeItem !== null ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      Lightbox,
      {
        item: activeItem,
        index: activeIndex,
        count: visibleItems.length,
        t,
        onClose: () => setActivePath(null),
        onAction,
        onPrev: () => stepActive(-1),
        onNext: () => stepActive(1)
      }
    ) : null,
    pendingDelete !== null ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      ConfirmRemove,
      {
        item: pendingDelete,
        t,
        busy: busy === removeBusyKey,
        onCancel: () => {
          if (busy !== removeBusyKey) setPendingDelete(null);
        },
        onConfirm: () => {
          void confirmRemove();
        }
      }
    ) : null,
    bulkConfirmOpen && selecting ? /* @__PURE__ */ (0, import_jsx_runtime12.jsx)(
      ConfirmBulkRemove,
      {
        count: selected.size,
        t,
        busy: busy === "bulk:delete",
        onCancel: () => {
          if (busy !== "bulk:delete") setBulkConfirmOpen(false);
        },
        onConfirm: () => {
          void bulkRemove();
        }
      }
    ) : null
  ] });
}

// src/client/components/Workbench.tsx
var import_react10 = require("react");

// src/components/panel-terminal/client/Terminal.tsx
var import_react9 = require("react");

// src/components/panel-terminal/client/styles.css
var styles_default6 = "/*\n * \u7EC8\u7AEF\u9762\u677F\u7684\u6837\u5F0F\u3002\n *\n * \u523B\u610F\u7528\u300C\u7EC8\u7AEF\u300D\u7684\u89C6\u89C9\u8BED\u8A00\u800C\u4E0D\u662F\u5361\u7247\uFF1A\u6DF1\u5E95\u3001\u7B49\u5BBD\u3001\u65E0\u5706\u89D2\u3001\u884C\u9AD8\u7D27\u3002\n * \u8FD9\u4E0D\u662F\u88C5\u9970\u504F\u597D \u2014\u2014 \u65E5\u5FD7\u8981\u80FD\u88AB\u626B\u8BFB\uFF0C\u884C\u8DDD\u548C\u5B57\u4F53\u6BD4\u914D\u8272\u91CD\u8981\u5F97\u591A\u3002\n *\n * \u6CE8\u5165\u65B9\u5F0F\uFF1A\u6784\u5EFA\u65F6\u6309\u6587\u672C\u5BFC\u5165\uFF08`loader: { '.css': 'text' }`\uFF09\uFF0C\u8FD0\u884C\u65F6\u7531\u9762\u677F\n * `<style>{TERMINAL_CSS}</style>` \u63D2\u8FDB\u9875\u9762\u3002\u5BA2\u6237\u7AEF\u662F esbuild \u6253\u6210\u7684\u5355\u6587\u4EF6\u3001\n * \u7ECF `__ModuleLoader__` \u52A0\u8F7D\uFF0C\u6CA1\u6709 HTML \u5165\u53E3\uFF0C\u6240\u4EE5\u53EA\u80FD\u8FD0\u884C\u65F6\u6CE8\u5165 \u2014\u2014 \u4F46**\u6837\u5F0F\u5185\u5BB9\u672C\u8EAB\n * \u7559\u5728\u72EC\u7ACB\u7684 .css \u6587\u4EF6\u91CC**\uFF0C\u4E0D\u5199\u6210 TS \u5B57\u7B26\u4E32\u5E38\u91CF\u3002\n */\n\n.cwt-root{display:flex;flex-direction:column;height:100%;min-height:0;background:#11151a;color:#cfd6de;font-family:ui-monospace,SFMono-Regular,\"SF Mono\",Menlo,Consolas,\"Liberation Mono\",monospace}\n.cwt-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #232a32;flex-shrink:0;flex-wrap:wrap}\n.cwt-state{font-size:11px;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border:1px solid #2c353f;border-radius:3px;color:#8b98a6}\n.cwt-state-ready{color:#5ec98a;border-color:#2c5140}\n.cwt-state-starting{color:#e0b354;border-color:#5a4a24}\n.cwt-state-failed{color:#e0705f;border-color:#5c322c}\n.cwt-state-external{color:#7f8b99;border-color:#333c46}\n.cwt-meta{font-size:11px;color:#6d7987}\n.cwt-filter{flex:1;min-width:120px;background:#0c1014;border:1px solid #232a32;border-radius:3px;color:#cfd6de;font:inherit;font-size:12px;padding:4px 8px;outline:none}\n.cwt-filter:focus{border-color:#3d4a58}\n.cwt-btn{background:#171d24;border:1px solid #232a32;border-radius:3px;color:#9aa7b5;font:inherit;font-size:11px;padding:4px 10px;cursor:pointer}\n.cwt-btn:hover{color:#cfd6de;border-color:#3d4a58}\n.cwt-btn.on{color:#79b8e0;border-color:#35506a;background:#16202a}\n.cwt-btn-primary{color:#8fd0a0;border-color:#2f5a3f;background:#14201a}\n.cwt-btn-primary:hover{color:#b6e6c3;border-color:#3f7a55}\n.cwt-note{padding:4px 12px;font-size:11px;color:#8a6f3a;background:#1b1810;border-bottom:1px solid #2a2418}\n.cwt-hint{padding:10px 12px;font-size:12px;color:#75818f;line-height:1.5}\n.cwt-box{flex:1;min-height:0;overflow-y:auto;padding:8px 0;font-size:12px;line-height:1.45}\n.cwt-line{display:flex;padding:0 12px;white-space:pre-wrap;word-break:break-word}\n.cwt-line:hover{background:#161c23}\n.cwt-line.err .cwt-text{color:#b8938a}\n.cwt-text{flex:1;min-width:0}\n.cwt-box::-webkit-scrollbar{width:10px}\n.cwt-box::-webkit-scrollbar-thumb{background:#2a333d;border-radius:5px}\n.cwt-box::-webkit-scrollbar-track{background:transparent}\n";

// src/components/panel-terminal/client/Terminal.tsx
var import_jsx_runtime13 = require("react/jsx-runtime");
var POLL_MS2 = 1e3;
var MAX_RENDER = 2e3;
function Terminal({ t, visible }) {
  const [lines, setLines] = (0, import_react9.useState)([]);
  const [status, setStatus] = (0, import_react9.useState)(void 0);
  const [dropped, setDropped] = (0, import_react9.useState)(0);
  const [following, setFollowing] = (0, import_react9.useState)(true);
  const [filter, setFilter] = (0, import_react9.useState)("");
  const [paused, setPaused] = (0, import_react9.useState)(false);
  const cursor = (0, import_react9.useRef)(0);
  const epochRef = (0, import_react9.useRef)("");
  const inflight = (0, import_react9.useRef)(false);
  const boxRef = (0, import_react9.useRef)(null);
  const pull = (0, import_react9.useCallback)(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const res = await fetch(`/comfyui-workbench/api/terminal?since=${cursor.current}`, {
        headers: { Accept: "application/json" }
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data.ok) return;
      setStatus((prev) => prev !== void 0 && prev.state === data.status.state && prev.managed === data.status.managed && prev.pid === data.status.pid && prev.detail === data.status.detail ? prev : data.status);
      setDropped(data.dropped);
      if (data.epoch !== epochRef.current) {
        epochRef.current = data.epoch;
        cursor.current = 0;
        setLines([]);
        void pull();
        return;
      }
      if (data.lines.length > 0) {
        cursor.current = data.cursor;
        setLines((prev) => {
          const merged = [...prev, ...data.lines];
          return merged.length > MAX_RENDER ? merged.slice(-MAX_RENDER) : merged;
        });
      } else {
        cursor.current = data.cursor;
      }
    } catch {
    } finally {
      inflight.current = false;
    }
  }, []);
  (0, import_react9.useEffect)(() => {
    if (!visible || paused) return void 0;
    void pull();
    const timer = setInterval(() => {
      void pull();
    }, POLL_MS2);
    return () => {
      clearInterval(timer);
    };
  }, [visible, paused, pull]);
  (0, import_react9.useEffect)(() => {
    if (!following) return;
    const box = boxRef.current;
    if (box !== null) box.scrollTop = box.scrollHeight;
  }, [lines, following]);
  const onScroll = () => {
    const box = boxRef.current;
    if (box === null) return;
    setFollowing(box.scrollHeight - box.scrollTop - box.clientHeight < 24);
  };
  const clear = async () => {
    try {
      const res = await fetch("/comfyui-workbench/api/terminal", { method: "POST" });
      if (!res.ok) return;
    } catch {
      return;
    }
    setLines([]);
    cursor.current = 0;
    setDropped(0);
  };
  const start = async () => {
    try {
      await fetch("/comfyui-workbench/api/terminal?action=start", { method: "POST" });
    } catch {
    }
    void pull();
  };
  const shown = filter.trim() === "" ? lines : lines.filter((line) => line.text.toLowerCase().includes(filter.trim().toLowerCase()));
  const managed = status?.managed === true;
  const state = status?.state ?? "unknown";
  const hint = status === void 0 ? t("termConnecting") : state === "external" ? lines.length > 0 ? t("termNotManaged") : t("termNoLog") : state === "failed" ? status.detail ?? t("termFailed") : state === "starting" ? t("termStarting") : state === "unknown" ? lines.length > 0 ? t("termLogOnly") : t("termNotStarted") : lines.length === 0 ? t("termEmpty") : "";
  const canStart = status !== void 0 && !managed && state !== "external" && state !== "starting";
  return /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "cwt-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("style", { children: styles_default6 }),
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "cwt-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: `cwt-state cwt-state-${state === "external" ? "external" : state}`, children: state === "external" ? t("termExternal") : state }),
      status?.pid !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("span", { className: "cwt-meta", children: [
        "pid ",
        status.pid
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "input",
        {
          className: "cwt-filter",
          value: filter,
          placeholder: t("termFilter"),
          onChange: (event) => setFilter(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", className: `cwt-btn${paused ? " on" : ""}`, onClick: () => setPaused((value) => !value), children: paused ? t("termResume") : t("termPause") }),
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", className: `cwt-btn${following ? " on" : ""}`, onClick: () => setFollowing(true), children: t("termFollow") }),
      canStart ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)(
        "button",
        {
          type: "button",
          className: "cwt-btn cwt-btn-primary",
          onClick: () => {
            void start();
          },
          children: t("termStart")
        }
      ) : null,
      /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("button", { type: "button", className: "cwt-btn", onClick: () => {
        void clear();
      }, children: t("termClear") })
    ] }),
    dropped > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "cwt-note", children: t("termDropped").replace("{n}", String(dropped)) }) : null,
    hint !== "" ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "cwt-hint", children: hint }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime13.jsxs)("div", { className: "cwt-box", ref: boxRef, onScroll, children: [
      shown.map((line) => /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: `cwt-line${line.stream === "err" ? " err" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("span", { className: "cwt-text", children: line.text }) }, line.seq)),
      shown.length === 0 && lines.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime13.jsx)("div", { className: "cwt-hint", children: t("termNoMatch") }) : null
    ] })
  ] });
}

// src/client/components/Workbench.tsx
var import_jsx_runtime14 = require("react/jsx-runtime");
var TABS = [
  { id: "assets", component: "panel.gallery", label: "tabAssets" },
  { id: "workflow", component: "panel.workflow", label: "tabWorkflowAdmin" },
  { id: "tags", component: "panel.tags", label: "tabTags" },
  { id: "poses", component: "panel.poses", label: "tabPoses" },
  { id: "costumes", component: "panel.costumes", label: "tabCostumes" },
  { id: "terminal", component: "panel.terminal", label: "tabTerminal" }
];
function Workbench({ t, visible, embedded, goToConversation, openSidebar }) {
  const [tab, setTab] = (0, import_react10.useState)("assets");
  const [enabled, setEnabled] = (0, import_react10.useState)({
    "panel.gallery": true,
    "panel.workflow": true,
    "panel.tags": true,
    "panel.poses": true,
    "panel.costumes": true,
    "panel.terminal": true
  });
  (0, import_react10.useEffect)(() => {
    if (!visible) return void 0;
    let alive = true;
    fetchConfig().then((config) => {
      if (alive && config.components !== void 0) setEnabled(config.components);
    }).catch(() => {
    });
    return () => {
      alive = false;
    };
  }, [visible]);
  const available = TABS.filter((item) => enabled[item.component] !== false);
  const current = available.some((item) => item.id === tab) ? tab : available[0]?.id;
  return /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "cwb-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("style", { children: [styles_default, styles_default2, styles_default3, styles_default4].join("\n") }),
    available.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)("div", { className: "cwf-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "cwf-empty-title", children: t("allPanelsOff") }),
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { children: t("allPanelsOffHint") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime14.jsxs)(import_jsx_runtime14.Fragment, { children: [
      available.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("nav", { className: "cwb-tabs", role: "tablist", "aria-label": "\u5DE5\u4F5C\u53F0", children: available.map((item) => /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(
        "button",
        {
          type: "button",
          role: "tab",
          "aria-selected": current === item.id,
          className: `cwb-tab${current === item.id ? " on" : ""}`,
          onClick: () => setTab(item.id),
          children: t(item.label)
        },
        item.id
      )) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime14.jsx)("div", { className: "cwb-body", children: current === "assets" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Gallery, { t, visible, ...embedded === true ? { embedded } : {}, goToConversation, openSidebar }) : current === "workflow" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(WorkflowAdmin, { t, visible }) : current === "tags" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(TagsPanel, { t, visible }) : current === "poses" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(PosesPanel, { t, visible, goToConversation }) : current === "costumes" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(CostumesPanel, { t, visible, goToConversation }) : current === "terminal" ? /* @__PURE__ */ (0, import_jsx_runtime14.jsx)(Terminal, { t, visible }) : null })
    ] })
  ] });
}

// src/client/i18n-data.ts
var DICT = {
  zh: {
    title: "ComfyUI",
    sidebarDescription: "\u7BA1\u7406\u63D0\u4F9B\u7ED9\u6A21\u578B\u7684\u5DE5\u4F5C\u6D41\uFF1A\u662F\u5426\u53EF\u7528\u3001\u7528\u9014\u5907\u6CE8\u3002",
    search: "\u641C\u7D22\u63D0\u793A\u8BCD / \u6587\u4EF6\u540D",
    allRoots: "\u5168\u90E8\u76EE\u5F55",
    refresh: "\u91CD\u65B0\u626B\u63CF",
    openSidebar: "\u5728\u4FA7\u8FB9\u680F\u6253\u5F00",
    onlyGenerated: "\u4EC5\u751F\u6210\u56FE",
    onlyGeneratedOn: "\u542B\u5168\u90E8\u56FE\u7247",
    loading: "\u6B63\u5728\u626B\u63CF\u56FE\u7247\u2026",
    empty: "\u8FD8\u6CA1\u6709\u56FE\u7247\u3002\u7528 generate_image \u751F\u6210\u4E00\u5F20\uFF0C\u6216\u628A\u56FE\u7247\u653E\u8FDB\u5DE5\u4F5C\u76EE\u5F55\u3002",
    emptyFiltered: "\u6CA1\u6709\u5339\u914D\u7684\u56FE\u7247\u3002",
    loadMore: "\u52A0\u8F7D\u66F4\u591A",
    copyImage: "\u590D\u5236\u56FE\u7247",
    copyPrompt: "\u590D\u5236\u63D0\u793A\u8BCD",
    exportWorkflow: "\u5BFC\u51FA\u5DE5\u4F5C\u6D41",
    addToChat: "\u6DFB\u52A0\u5230\u5F53\u524D\u5BF9\u8BDD",
    useAsInput: "\u4F5C\u4E3A\u8F93\u5165\u51FA\u56FE",
    useAsInputStarted: "\u5DF2\u7528\u65B0 seed \u91CD\u8DD1\uFF1A{id}\uFF08\u51FA\u56FE\u4E2D\u2026\uFF09",
    rerunDone: "\u51FA\u56FE\u5B8C\u6210\uFF0C\u5DF2\u5237\u65B0\u8D44\u4EA7\u5E93\u3002",
    rerunFailed: "\u51FA\u56FE\u5931\u8D25\uFF1A{message}",
    rerunUnknown: "\u63D0\u4EA4\u6210\u529F\u4E86\uFF0C\u4F46\u67E5\u4E0D\u5230\u7ED3\u679C\uFF08\u63D2\u4EF6\u91CD\u542F\u540E\u8FD0\u884C\u8BB0\u5F55\u4F1A\u4E22\uFF09\u3002\u5230\u8D44\u4EA7\u5E93\u770B\u6709\u6CA1\u6709\u65B0\u56FE\u3002",
    describe: "\u8F6C\u63D0\u793A\u8BCD",
    describeQueued: "\u5DF2\u628A\u56FE\u7247\u4E0E\u6307\u4EE4\u586B\u5165\u8F93\u5165\u6846\uFF0C\u6309\u56DE\u8F66\u53D1\u9001\u3002",
    copiedImage: "\u56FE\u7247\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F",
    copiedPrompt: "\u63D0\u793A\u8BCD\u5DF2\u590D\u5236",
    added: "\u5DF2\u52A0\u5165\u8F93\u5165\u6846\u8349\u7A3F",
    noPrompt: "\uFF08\u8FD9\u5F20\u56FE\u6CA1\u6709\u63D0\u793A\u8BCD\u8BB0\u5F55\uFF09",
    prompt: "\u63D0\u793A\u8BCD",
    negativePrompt: "\u8D1F\u5411\u63D0\u793A\u8BCD",
    size: "\u5C3A\u5BF8",
    model: "\u5E95\u6A21",
    sampler: "\u91C7\u6837",
    seed: "\u79CD\u5B50",
    steps: "\u6B65\u6570",
    cfg: "CFG",
    mode: "\u6A21\u5F0F",
    createdAt: "\u751F\u6210\u65F6\u95F4",
    filePath: "\u8DEF\u5F84",
    close: "\u5173\u95ED",
    noSidebar: "\u6CA1\u6709\u68C0\u6D4B\u5230 dsh-better-sidebar\u3002",
    truncated: "\u56FE\u7247\u592A\u591A\uFF0C\u53EA\u5217\u51FA\u4E86\u524D\u9762\u4E00\u90E8\u5206\u3002",
    exported: "\u5DF2\u5BFC\u51FA",
    remove: "\u5220\u9664",
    removeTitle: "\u5F7B\u5E95\u5220\u9664\u8FD9\u5F20\u56FE\u7247\uFF1F",
    removeBody: "\u4F1A\u4ECE\u78C1\u76D8\u76F4\u63A5\u5220\u9664\u56FE\u7247\u4E0E\u540C\u540D\u5143\u6570\u636E\u6587\u4EF6\uFF0C\u4E0D\u8FDB\u56DE\u6536\u7AD9\uFF0C\u4E5F\u65E0\u6CD5\u6062\u590D\u3002",
    removeConfirm: "\u5F7B\u5E95\u5220\u9664",
    cancel: "\u53D6\u6D88",
    removed: "\u5DF2\u5220\u9664",
    mergeDuplicates: "\u5408\u5E76\u91CD\u590D",
    duplicates: "\u540C\u56FE\u526F\u672C",
    duplicateHint: "\u8FD9\u5F20\u56FE\u8FD8\u6709 {n} \u4EFD\u526F\u672C\uFF0C\u4F1A\u4E00\u5E76\u5220\u9664\u3002",
    duplicateBadge: "\u540C\u56FE\u526F\u672C {n} \u4EFD\uFF0C\u5DF2\u5408\u5E76\u663E\u793A",
    select: "\u9009\u62E9",
    exitSelect: "\u9000\u51FA\u9009\u62E9",
    selectAll: "\u5168\u9009",
    selectNone: "\u6E05\u9664",
    selectedCount: "\u5DF2\u9009 {n} \u5F20",
    bulkExport: "\u5BFC\u51FA\u5DE5\u4F5C\u6D41",
    bulkDelete: "\u5220\u9664",
    bulkRemoveTitle: "\u5F7B\u5E95\u5220\u9664\u8FD9 {n} \u5F20\u56FE\u7247\uFF1F",
    bulkRemoveBody: "\u4F1A\u4ECE\u78C1\u76D8\u5220\u9664\u6240\u9009\u56FE\u7247\u3001\u540C\u540D\u5143\u6570\u636E\u3001\u540C\u7EC4\u526F\u672C\u4E0E\u7F29\u7565\u56FE\u7F13\u5B58\uFF0C\u4E0D\u8FDB\u56DE\u6536\u7AD9\uFF0C\u65E0\u6CD5\u6062\u590D\u3002",
    bulkExported: "\u5DF2\u5BFC\u51FA {n} \u4EFD\u5DE5\u4F5C\u6D41",
    bulkExportedSkipped: "\u5DF2\u5BFC\u51FA {n} \u4EFD\u5DE5\u4F5C\u6D41\uFF0C{m} \u5F20\u6CA1\u6709\u5DE5\u4F5C\u6D41\u88AB\u8DF3\u8FC7",
    bulkDeleted: "\u5DF2\u5220\u9664 {n} \u5F20",
    bulkDeletePartial: "\u5DF2\u5220\u9664 {n} \u5F20\uFF0C{m} \u5F20\u5931\u8D25",
    zoomIn: "\u653E\u5927",
    zoomOut: "\u7F29\u5C0F",
    zoomReset: "\u9002\u5E94\u7A97\u53E3",
    prevImage: "\u4E0A\u4E00\u5F20\uFF08\u2190\uFF09",
    nextImage: "\u4E0B\u4E00\u5F20\uFF08\u2192\uFF09",
    tabAssets: "\u8D44\u4EA7\u5E93",
    moreActions: "\u66F4\u591A",
    hideNsfw: "\u9690\u85CF NSFW",
    showNsfw: "\u663E\u793A NSFW",
    hideNsfwHint: "\u628A\u5224\u5B9A\u4E3A NSFW \u7684\u8D44\u4EA7\u4ECE\u5217\u8868\u91CC\u85CF\u6389\uFF08\u6309\u63D0\u793A\u8BCD\u4E0E\u6587\u4EF6\u540D\u5224\u65AD\uFF0C\u4E0D\u662F\u5206\u7C7B\u5668\uFF09\u3002",
    emptyAllHidden: "\u8FD9\u4E2A\u5E93\u91CC\u6CA1\u6709\u53EF\u663E\u793A\u7684\u8D44\u4EA7 \u2014\u2014 \u5168\u90E8\u88AB\u5224\u4E3A NSFW \u5E76\u5DF2\u9690\u85CF\u3002",
    tabWorkflowAdmin: "\u5DE5\u4F5C\u6D41\u7BA1\u7406",
    tabTags: "\u6807\u7B7E\u5E93",
    tabPoses: "\u59FF\u52BF\u5E93",
    tagsTitle: "\u6807\u7B7E\u5E93",
    tagsSub: "\u5171 {total} \u6761\u6807\u7B7E\uFF0C\u5F53\u524D {shown} \u6761\u547D\u4E2D",
    tagsLoading: "\u6B63\u5728\u5EFA\u7D22\u5F15\u2026",
    tagsPlaceholder: "\u641C\u6807\u7B7E\uFF1A\u4E2D\u6587\u540D\u3001\u65E5\u6587\u540D\u6216 tag\uFF08\u5982 \u957F\u53D1 / long_hair\uFF09",
    tagsAllKinds: "\u5168\u90E8\u7C7B\u522B",
    tagsAllCategories: "\u5168\u90E8\u5927\u7C7B",
    tagsCategoryHint: "\u5206\u7C7B\u6765\u81EA Danbooru \u7684 tag group\uFF0C\u53EA\u8986\u76D6\u7EA6 27% \u7684\u901A\u7528\u6807\u7B7E\uFF1B\u67E5\u4E0D\u5230\u5C31\u53BB\u6389\u5927\u7C7B\u518D\u641C",
    tagsCopy: "\u590D\u5236",
    tagsEmpty: "\u6CA1\u6709\u5339\u914D\u7684\u6807\u7B7E\u3002\u8BD5\u8BD5\u66F4\u77ED\u7684\u8BCD\uFF0C\u6216\u53BB\u6389\u5927\u7C7B\u7B5B\u9009\u3002",
    tagsScrollMore: "\u7EE7\u7EED\u5F80\u4E0B\u6EDA\u8FD8\u6709 {left} \u6761",
    tagsLoadingMore: "\u6B63\u5728\u52A0\u8F7D\u2026",
    tagsSync: "\u66F4\u65B0\u6807\u7B7E",
    tagsSyncRunning: "\u6B63\u5728\u66F4\u65B0\u2026",
    tagsSyncHint: "\u4ECE\u4E0A\u6E38\u91CD\u65B0\u62C9\u56DB\u7C7B CSV \u4E0E 91 \u4E2A wiki \u5206\u7EC4\u9875\uFF0C\u7EA6\u4E24\u5206\u534A\u3002\u53EA\u5199\u63D2\u4EF6\u6570\u636E\u76EE\u5F55\uFF0C\u4E0D\u52A8\u968F\u5305\u6570\u636E\u3002",
    tagsSyncDone: "\u5DF2\u66F4\u65B0\uFF1A{kinds}\uFF1B\u5206\u7C7B {groups} \u7EC4 / {tags} \u6761",
    tagsSyncFailed: "\u66F4\u65B0\u5931\u8D25\uFF1A{message}",
    posesTitle: "\u59FF\u52BF\u5E93",
    posesSub: "{poses} \u7EC4 / {views} \u4E2A\u89D2\u5EA6\uFF0C\u5168\u90E8\u53EF\u7528",
    posesLoading: "\u6B63\u5728\u8BFB\u59FF\u52BF\u76EE\u5F55\u2026",
    posesPlaceholder: "\u641C\u59FF\u52BF\uFF1A\u4E2D\u6587\u540D\u3001\u7F16\u53F7\u6216\u5206\u7C7B\uFF08\u5982 \u5750\u59FF / P001 / \u540E\u4EF0\uFF09",
    posesAllSystems: "\u5168\u90E8\u4F53\u7CFB",
    posesAllCategories: "\u5168\u90E8\u5206\u7C7B",
    posesOnlySafe: "\u53EA\u770B\u5E38\u89C4",
    posesAdultBadge: "\u6210\u4EBA\u5411",
    posesAddToChat: "\u52A0\u5165\u5BF9\u8BDD",
    posesFetch: "\u53D6\u539F\u56FE",
    posesFetching: "\u53D6\u56FE\u4E2D\u2026",
    posesFetched: "\u5DF2\u5B58\u5230 uploads",
    posesEmpty: "\u6CA1\u6709\u5339\u914D\u7684\u59FF\u52BF\u3002\u8BD5\u8BD5\u66F4\u77ED\u7684\u8BCD\uFF0C\u6216\u53BB\u6389\u4F53\u7CFB / \u5206\u7C7B\u7B5B\u9009\u3002",
    posesScrollMore: "\u7EE7\u7EED\u5F80\u4E0B\u6EDA\u8FD8\u6709 {left} \u7EC4",
    posesLoadingMore: "\u6B63\u5728\u52A0\u8F7D\u2026",
    tabCostumes: "\u8863\u88C5\u5E93",
    costumesTitle: "\u8863\u88C5\u5E93",
    costumesSub: "{total} \u5957 / {cats} \u7C7B\uFF0C\u6BCF\u6761\u90FD\u5E26\u82F1\u6587\u5173\u952E\u8BCD",
    costumesLoading: "\u6B63\u5728\u8BFB\u8863\u88C5\u76EE\u5F55\u2026",
    costumesPlaceholder: "\u641C\u8863\u88C5\uFF1A\u4E2D\u6587\u63CF\u8FF0\u3001\u6807\u7B7E\u6216\u82F1\u6587\u5173\u952E\u8BCD\uFF08\u5982 \u725B\u4ED4\u88D9 / \u8377\u53F6\u8FB9 / denim knit\uFF09",
    costumesAllCategories: "\u5168\u90E8\u5206\u7C7B",
    costumesOnlySafe: "\u53EA\u770B\u5E38\u89C4",
    costumesAdultBadge: "\u6210\u4EBA\u5411",
    costumesCopyKeywords: "\u590D\u5236\u5173\u952E\u8BCD",
    costumesCopied: "\u5DF2\u590D\u5236\u5173\u952E\u8BCD\uFF1A",
    costumesAddToChat: "\u52A0\u5165\u5BF9\u8BDD",
    costumesFetch: "\u53D6\u539F\u56FE",
    costumesFetching: "\u53D6\u56FE\u4E2D\u2026",
    costumesFetched: "\u5DF2\u5B58\u5230 uploads",
    costumesEmpty: "\u6CA1\u6709\u5339\u914D\u7684\u8863\u88C5\u3002\u6362\u4E2A\u8BCD\u8BD5\u8BD5\uFF0C\u6216\u8005\u53BB\u6389\u5206\u7C7B\u7B5B\u9009\u3002",
    costumesScrollMore: "\u7EE7\u7EED\u5F80\u4E0B\u6EDA\u8FD8\u6709 {left} \u5957",
    costumesLoadingMore: "\u6B63\u5728\u52A0\u8F7D\u2026",
    costumesImageFail: "\u56FE\u6682\u65F6\u53D6\u4E0D\u5230",
    costumesSource: "\u6765\u6E90\u4E0E\u7248\u6743",
    posesImageFail: "\u7EBF\u7A3F\u6682\u65F6\u53D6\u4E0D\u5230",
    posesSource: "\u6765\u6E90\u4E0E\u7248\u6743",
    posesAngle_front: "\u6B63\u9762",
    posesAngle_diag: "\u659C\u4FA7",
    posesAngle_side: "\u4FA7\u9762",
    posesAngle_high: "\u4FEF\u89C6",
    posesAngle_low: "\u4EF0\u89C6",
    refsTabTags: "\u6807\u7B7E",
    refsTabRefs: "\u63D0\u793A\u8BCD\u53C2\u8003",
    refsSub: "\u770B Danbooru \u4E0A\u771F\u5B9E\u4F5C\u54C1\u7684 tag \u5199\u6CD5\uFF1A\u56FE + \u5B8C\u6574\u63D0\u793A\u8BCD\uFF0C\u641C\u7D22\u8D70\u670D\u52A1\u7AEF\uFF0C\u4E0D\u843D\u76D8",
    refsAnyRating: "\u5168\u5206\u7EA7",
    refsAnyRatingHint: "\u9ED8\u8BA4\u53EA\u770B general\uFF08\u5B89\u5168\u5206\u7EA7\uFF09\u3002\u52FE\u4E0A\u4E4B\u540E g/s/q/e \u5168\u6765 \u2014\u2014 \u53C2\u8003\u7684\u662F\u771F\u4EBA\u4F5C\u54C1\uFF0C\u5185\u5BB9\u4E0D\u53D7\u63A7\u3002",
    refsRandom: "\u968F\u673A",
    refsSearch: "\u641C\u7D22",
    refsAnother: "\u6362\u4E00\u6279",
    refsPlaceholder: "\u5173\u952E\u8BCD\uFF0C\u5982 cyberpunk city\uFF08\u7A7A\u683C\u5206\u9694\u8868\u793A\u90FD\u8981\u547D\u4E2D\uFF09",
    refsPoolEmpty: "\u672C\u5730\u6C60\u8FD8\u6CA1\u5EFA\uFF08\u641C\u7D22\u8981\u7528\u5B83\uFF09",
    refsPoolSize: "\u672C\u5730\u6C60 {n} \u6761",
    refsBuild: "\u5EFA\u6C60",
    refsRebuild: "\u91CD\u5EFA\u6C60",
    refsBuilding: "\u6B63\u5728\u5EFA\u2026",
    refsPoolDone: "\u6C60\u5B50\u5EFA\u597D\uFF1A{n} \u6761",
    refsPoolFailed: "\u5EFA\u6C60\u5931\u8D25\uFF1A{message}",
    refsNeedPool: "\u641C\u7D22\u6A21\u5F0F\u8981\u5148\u5EFA\u672C\u5730\u6C60\u3002\u968F\u673A\u6A21\u5F0F\u4E0D\u9700\u8981\u5B83\u3002",
    refsEmpty: "\u6CA1\u6709\u5339\u914D\u7684\u63D0\u793A\u8BCD\u3002\u8BD5\u8BD5\u66F4\u77ED\u7684\u8BCD\u3002",
    refsCopy: "\u590D\u5236",
    refsCopied: "\u5DF2\u590D\u5236",
    refsCopyFailed: "\u8FD9\u4E2A\u73AF\u5883\u4E0B\u8BFB\u4E0D\u5230\u526A\u8D34\u677F\uFF0C\u8BF7\u624B\u52A8\u9009\u4E2D\u590D\u5236\u3002",
    tabTerminal: "\u7EC8\u7AEF",
    termConnecting: "\u6B63\u5728\u8BFB\u53D6 ComfyUI \u7684\u8F93\u51FA\u2026",
    termNoLog: "\u5F53\u524D\u670D\u52A1\u662F\u5916\u90E8\u5B9E\u4F8B\uFF0C\u4F46\u6CA1\u627E\u5230\u5B83\u7684\u65E5\u5FD7\u6587\u4EF6\uFF08\u9ED8\u8BA4\u5728 <\u5B89\u88C5\u76EE\u5F55>/user/comfyui.log\uFF09\u3002\u82E5\u7528 --user-directory \u6539\u8FC7\u4F4D\u7F6E\uFF0C\u8FD9\u91CC\u5C31\u8BFB\u4E0D\u5230\u3002",
    termNotManaged: "\u5F53\u524D\u670D\u52A1\u662F\u5916\u90E8\u5B9E\u4F8B \u2014\u2014 \u5B83\u7684 stdout \u5728\u542F\u52A8\u5B83\u7684\u90A3\u4E2A\u7EC8\u7AEF\u91CC\uFF0C\u63D2\u4EF6\u8BFB\u4E0D\u5230\u3002\u8FD9\u91CC\u663E\u793A\u7684\u662F\u5B83\u5199\u7684 user/comfyui.log\u3002",
    termNotStarted: "\u670D\u52A1\u8FD8\u6CA1\u542F\u52A8\u3002\u70B9\u53F3\u4FA7\u300C\u542F\u52A8\u300D\u4F1A\u62C9\u8D77 ComfyUI\uFF0C\u52A0\u8F7D\u65E5\u5FD7\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC\u3002",
    termStarting: "\u6B63\u5728\u542F\u52A8 ComfyUI\uFF0C\u52A0\u8F7D\u65E5\u5FD7\u4F1A\u9646\u7EED\u51FA\u73B0\uFF08\u51B7\u542F\u53EF\u80FD\u8981\u51E0\u5341\u79D2\uFF09\u3002",
    termLogOnly: "\u6B63\u5728\u8BFB\u53D6 ComfyUI \u7684\u65E5\u5FD7\u6587\u4EF6\uFF08\u670D\u52A1\u5F53\u524D\u72B6\u6001\u672A\u77E5\uFF0C\u65E5\u5FD7\u662F\u5B83\u4E0A\u4E00\u6B21\u8FD0\u884C\u65F6\u5199\u7684\uFF09\u3002",
    termFailed: "\u542F\u52A8\u5931\u8D25\uFF0C\u539F\u56E0\u89C1\u4E0B\uFF08\u6216\u56DE\u5BF9\u8BDD\u91CC\u770B\u9519\u8BEF\u8BE6\u60C5\uFF09\u3002",
    termStart: "\u542F\u52A8",
    termEmpty: "\u8FD8\u6CA1\u6709\u8F93\u51FA\u3002\u670D\u52A1\u521A\u62C9\u8D77\u65F6\u8FD9\u91CC\u4F1A\u9646\u7EED\u51FA\u73B0\u52A0\u8F7D\u65E5\u5FD7\u3002",
    termExternal: "\u5916\u90E8\u5B9E\u4F8B",
    termFilter: "\u8FC7\u6EE4\u2026",
    termPause: "\u6682\u505C",
    termResume: "\u7EE7\u7EED",
    termFollow: "\u8DDF\u968F\u5E95\u90E8",
    termClear: "\u6E05\u5C4F",
    termDropped: "\u66F4\u65E9\u7684 {n} \u884C\u5DF2\u6EDA\u51FA\u7F13\u51B2\uFF08\u6700\u591A\u4FDD\u7559 2000 \u884C\uFF09\u3002",
    termNoMatch: "\u6CA1\u6709\u5339\u914D\u7684\u884C\u3002",
    tabWorkflow: "\u5DE5\u4F5C\u6D41",
    selectWorkflow: "\u9009\u62E9\u5DE5\u4F5C\u6D41\u2026",
    modeConversation: "\u53D1\u8FDB\u5BF9\u8BDD",
    modeConversationHint: "\u628A\u8FD0\u884C\u6307\u4EE4\u53D1\u8FDB\u5F53\u524D\u5BF9\u8BDD\uFF0C\u7531\u6A21\u578B\u6267\u884C\uFF1B\u56FE\u7247\u4F1A\u51FA\u73B0\u5728\u5BF9\u8BDD\u91CC",
    modeDirect: "\u76F4\u63A5\u751F\u6210",
    modeDirectHint: "\u76F4\u63A5\u6267\u884C\uFF0C\u4E0D\u6D88\u8017\u6A21\u578B\u5F80\u8FD4\uFF1B\u4EA7\u7269\u53EA\u5728\u672C\u9762\u677F\u663E\u793A",
    run: "\u751F\u6210",
    running: "\u8FD0\u884C\u4E2D\u2026",
    moreParams: "\u66F4\u591A\u53C2\u6570",
    outputTitle: "\u8F93\u51FA",
    emptyWorkflows: "\u8FD8\u6CA1\u6709\u5DE5\u4F5C\u6D41\u3002",
    emptyWorkflowsHint: "\u5728 ComfyUI \u91CC\u7528 Export (API) \u5BFC\u51FA\uFF0C\u518D\u70B9\u53F3\u4E0A\u89D2\u7684\u5BFC\u5165\u6309\u94AE\u7C98\u8D34\u8FDB\u6765\uFF08\u4E5F\u53EF\u4EE5\u76F4\u63A5\u9009\u6587\u4EF6\uFF09\u3002",
    needRequired: "\u8FD8\u5DEE\u5FC5\u586B\u53C2\u6570\uFF1A",
    instructionFilled: "\u5DF2\u628A\u8FD0\u884C\u6307\u4EE4\u586B\u5165\u8F93\u5165\u6846\uFF0C\u6309\u56DE\u8F66\u53D1\u9001\u540E\u7531\u6A21\u578B\u6267\u884C\u3002",
    instructionFailed: "\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u8BF7\u624B\u52A8\u590D\u5236\u53C2\u6570\u540E\u8BA9\u6A21\u578B\u8FD0\u884C\u3002",
    undescribedHint: "\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\u8FD8\u6CA1\u6709\u7528\u9014\u8BF4\u660E\uFF0C\u6A21\u578B\u4E0E\u4F60\u81EA\u5DF1\u90FD\u53EA\u80FD\u9760\u6807\u9898\u731C\u3002\u53EF\u4EE5\u8BA9\u6A21\u578B\u8865\u4E00\u6761\u3002",
    fieldImagePlaceholder: "\u56FE\u7247\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u4E5F\u53EF\u4EE5\u5148\u5728\u8D44\u4EA7\u5E93\u590D\u5236\u8DEF\u5F84\uFF09",
    brokenHint: "\u6709 {n} \u4E2A\u6587\u4EF6\u4E0D\u662F\u53EF\u7528\u7684 API \u683C\u5F0F\u5DE5\u4F5C\u6D41\uFF0C\u5DF2\u8DF3\u8FC7\u3002",
    requiredField: "\u5FC5\u586B",
    replaceImage: "\u6362\u4E00\u5F20",
    clearImage: "\u6E05\u9664",
    uploading: "\u6B63\u5728\u4E0A\u4F20\u2026",
    dropImage: "\u62D6\u5165\u56FE\u7247\uFF0C\u6216\u70B9\u51FB\u9009\u62E9",
    dropImageHint: "\u4E5F\u652F\u6301\u76F4\u63A5\u7C98\u8D34 \xB7 PNG / JPG / WEBP / GIF",
    manualPath: "\u56FE\u5DF2\u7ECF\u5728\u67D0\u4E2A\u76EE\u5F55\u91CC\uFF1F\u76F4\u63A5\u586B\u8DEF\u5F84",
    manualPathCancel: "\u6536\u8D77\u624B\u586B",
    manualPathHint: "\u56FE\u7247\u7684\u7EDD\u5BF9\u8DEF\u5F84\uFF0C\u56DE\u8F66\u786E\u8BA4",
    previewInput: "\u8F93\u5165\u56FE",
    previewOutput: "\u8F93\u51FA",
    previewInputTag: "\u5F85\u751F\u6210",
    previewEmpty: "\u751F\u6210\u540E\u7ED3\u679C\u4F1A\u51FA\u73B0\u5728\u8FD9\u91CC",
    previewPickWorkflow: "\u5148\u9009\u4E00\u4E2A\u5DE5\u4F5C\u6D41",
    runModeLabel: "\u8FD0\u884C\u65B9\u5F0F",
    runDone: "\u5B8C\u6210\uFF1A{n} \u4E2A\u4EA7\u7269\uFF0C\u7528\u65F6 {ms} ms",
    runFailed: "\u8FD0\u884C\u5931\u8D25",
    missingModels: "\u672C\u673A\u6CA1\u6709\u8FD9\u4E9B\u6A21\u578B\uFF1A{names}\uFF0C\u76F4\u63A5\u8DD1\u4F1A\u5931\u8D25\u3002",
    outputDirLabel: "\u8F93\u51FA\u5230",
    outputDirReset: "\u6062\u590D\u9ED8\u8BA4",
    outputDirHint: "\u7559\u7A7A\u5C31\u7528\u5BBF\u4E3B\u9ED8\u8BA4\u76EE\u5F55\uFF1B\u586B\u7684\u8DEF\u5F84\u5FC5\u987B\u5728 workspace \u6216\u5DF2\u6388\u6743\u7684\u76EE\u5F55\u91CC\u3002",
    submitted: "\u5DF2\u63D0\u4EA4\uFF0C\u6B63\u5728\u51FA\u56FE\u2026",
    adminTitle: "\u5DE5\u4F5C\u6D41\u7BA1\u7406",
    adminSub: "{on}/{all} \u4E2A\u5BF9\u6A21\u578B\u53EF\u7528",
    adminSaved: "\u5DF2\u4FDD\u5B58",
    progressToggle: "\u7CBE\u786E\u8FDB\u5EA6\uFF08WebSocket\uFF09",
    progressToggleHint: "\u5F00\u542F\u540E\uFF0C\u9762\u677F\u63D0\u4EA4\u7684\u8FD0\u884C\u4F1A\u8BB0\u5F55 {value}/{max} \u767E\u5206\u6BD4\u3002\u53EA\u5BF9\u300C\u8FD0\u884C\u300D\u4E0E\u300C\u4F5C\u4E3A\u8F93\u5165\u51FA\u56FE\u300D\u751F\u6548\uFF0C\u5DE5\u5177\u63D0\u4EA4\u7684\u6CA1\u6709\u8FDB\u5EA6\u3002\u6539\u5B8C\u4E0B\u4E00\u6B21\u63D0\u4EA4\u5373\u751F\u6548\uFF0C\u4E0D\u7528\u91CD\u542F\u3002",
    progressToggleFromConfig: "\u5F53\u524D\u503C\u6765\u81EA\u542F\u52A8\u914D\u7F6E\u6216\u5185\u7F6E\u9ED8\u8BA4\uFF08\u8FD8\u6CA1\u5728\u9762\u677F\u4E0A\u6539\u8FC7\uFF09",
    importWorkflow: "\u5BFC\u5165\u5DE5\u4F5C\u6D41",
    importName: "\u5DE5\u4F5C\u6D41\u540D\uFF08\u7528\u6765\u751F\u6210 id\uFF0C\u53EF\u7559\u7A7A\uFF09",
    importPlaceholder: "\u7C98\u8D34 ComfyUI \u5BFC\u51FA\u7684 API \u683C\u5F0F JSON",
    importPickFile: "\u9009\u62E9\u6587\u4EF6",
    importSubmit: "\u5BFC\u5165",
    importCancel: "\u53D6\u6D88",
    importDone: "\u5DF2\u5BFC\u5165 {id}",
    importReplaced: "\u5DF2\u8986\u76D6 {id}\uFF08\u5907\u6CE8\u4E0E schema \u4FDD\u7559\uFF09",
    importHint: "\u53EA\u63A5\u53D7 API \u683C\u5F0F\uFF1A\u5728 ComfyUI \u91CC\u7528 Export (API) \u5BFC\u51FA\u540E\u7C98\u8D34\u8FDB\u6765",
    importEmpty: "\u5148\u628A\u5DE5\u4F5C\u6D41 JSON \u7C98\u8FDB\u6765\uFF08\u6216\u70B9\u300C\u9009\u62E9\u6587\u4EF6\u300D\uFF09",
    importConfirmOverwrite: "\u5DF2\u5B58\u5728\u540D\u4E3A {id} \u7684\u5DE5\u4F5C\u6D41\u3002\u8986\u76D6\u4F1A\u66FF\u6362\u6A21\u677F\uFF08\u5907\u6CE8\u4E0E schema \u4FDD\u7559\uFF0C\u65E7\u6A21\u677F\u5907\u4EFD\u4E3A .json.bak\uFF09\u3002\u786E\u5B9A\u8986\u76D6\u5417\uFF1F",
    enableHint: "\u70B9\u51FB\u542F\u7528\uFF1A\u6A21\u578B\u53EF\u4EE5\u8C03\u7528\u5B83",
    disableHint: "\u70B9\u51FB\u505C\u7528\uFF1A\u6A21\u578B\u4E0D\u518D\u770B\u5230\u5B83",
    disabledBadge: "\u5DF2\u505C\u7528",
    noModel: "\u672A\u8BC6\u522B\u5E95\u6A21",
    notePlaceholder: "\u5199\u4E00\u53E5\u7528\u9014\u5907\u6CE8\uFF08\u6A21\u578B\u9760\u5B83\u5224\u65AD\u8BE5\u4E0D\u8BE5\u7528\u8FD9\u4E2A\u5DE5\u4F5C\u6D41\uFF09",
    loadingWorkflows: "\u6B63\u5728\u8BFB\u53D6\u5DE5\u4F5C\u6D41\u2026",
    allPanelsOff: "\u9762\u677F\u90FD\u88AB\u5173\u6389\u4E86\u3002",
    allPanelsOffHint: "\u5728\u914D\u7F6E\u91CC\u628A disabledComponents \u6E05\u7A7A\uFF0C\u6216\u5220\u6389\u5176\u4E2D\u7684 panel.* \u9879\u3002",
    freeMemory: "\u91CA\u653E\u5185\u5B58",
    ready: "\u6A21\u578B\u5DF2\u5C31\u7EEA",
    offline: "\u670D\u52A1\u79BB\u7EBF",
    done: "\u5DF2\u5B8C\u6210",
    clearPreview: "\u6E05\u9664\u9884\u89C8",
    download: "\u4E0B\u8F7D",
    useAsReference: "\u7528\u4F5C\u53C2\u8003",
    usedAsReference: "\u5DF2\u8BBE\u4E3A\u53C2\u8003\u56FE",
    reuseParams: "\u590D\u7528\u53C2\u6570",
    reuseHint: "\u53C2\u6570\u5DF2\u662F\u6700\u65B0\u4E00\u6B21\u8FD0\u884C\u7684\u503C",
    promptLabel: "\u753B\u9762\u63CF\u8FF0",
    promptPlaceholder: "\u63CF\u8FF0\u4F60\u60F3\u8981\u7684\u753B\u9762",
    referenceImage: "\u53C2\u8003\u539F\u56FE",
    aspectRatio: "\u753B\u9762\u6BD4\u4F8B",
    paramsLabel: "\u751F\u6210\u53C2\u6570",
    modelLabel: "\u6A21\u578B",
    memoryFreed: "\u5DF2\u901A\u77E5 ComfyUI \u91CA\u653E\u663E\u5B58"
  },
  en: {
    title: "ComfyUI",
    sidebarDescription: "Manage the workflows offered to the model: availability and purpose.",
    search: "Search prompt / filename",
    allRoots: "All folders",
    refresh: "Rescan",
    openSidebar: "Open in sidebar",
    onlyGenerated: "Generated only",
    onlyGeneratedOn: "All images",
    loading: "Scanning images\u2026",
    empty: "No images yet. Generate one with generate_image, or drop images into the workspace.",
    emptyFiltered: "No matching images.",
    loadMore: "Load more",
    copyImage: "Copy image",
    copyPrompt: "Copy prompt",
    exportWorkflow: "Export workflow",
    addToChat: "Add to current chat",
    useAsInput: "Use as input",
    useAsInputStarted: "Re-ran with a new seed: {id} (generating\u2026)",
    rerunDone: "Done \u2014 the gallery has been refreshed.",
    rerunFailed: "Generation failed: {message}",
    rerunUnknown: "Submitted, but the result cannot be looked up (run records are lost after a restart). Check the gallery for new images.",
    describe: "To prompt",
    describeQueued: "Image and instruction are in the composer \u2014 press Enter to send.",
    copiedImage: "Image copied to clipboard",
    copiedPrompt: "Prompt copied",
    added: "Added to the composer draft",
    noPrompt: "(no prompt recorded for this image)",
    prompt: "Prompt",
    negativePrompt: "Negative prompt",
    size: "Size",
    model: "Checkpoint",
    sampler: "Sampler",
    seed: "Seed",
    steps: "Steps",
    cfg: "CFG",
    mode: "Mode",
    createdAt: "Created",
    filePath: "Path",
    close: "Close",
    noSidebar: "dsh-better-sidebar is not installed.",
    truncated: "Too many images; only the first batch is listed.",
    exported: "Exported",
    remove: "Delete",
    removeTitle: "Delete this image permanently?",
    removeBody: "Removes the image and its metadata file from disk. No trash, no undo.",
    removeConfirm: "Delete permanently",
    cancel: "Cancel",
    removed: "Deleted",
    mergeDuplicates: "Merge duplicates",
    duplicates: "Copies",
    duplicateHint: "Its {n} copies are deleted too.",
    duplicateBadge: "{n} copies of the same image, merged",
    select: "Select",
    exitSelect: "Done",
    selectAll: "Select all",
    selectNone: "Clear",
    selectedCount: "{n} selected",
    bulkExport: "Export workflows",
    bulkDelete: "Delete",
    bulkRemoveTitle: "Delete these {n} images permanently?",
    bulkRemoveBody: "Removes the selected images, their metadata, copies and thumbnail cache from disk. No trash, no undo.",
    bulkExported: "Exported {n} workflows",
    bulkExportedSkipped: "Exported {n} workflows, skipped {m} without one",
    bulkDeleted: "Deleted {n} images",
    bulkDeletePartial: "Deleted {n}, {m} failed",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    zoomReset: "Fit to window",
    prevImage: "Previous (\u2190)",
    nextImage: "Next (\u2192)",
    adminTitle: "Workflow admin",
    adminSub: "{on}/{all} available to the model",
    adminSaved: "Saved",
    progressToggle: "Exact progress (WebSocket)",
    progressToggleHint: "When on, runs submitted from this panel record {value}/{max} progress. Applies to Run and Use-as-input only; tool submissions have no progress. Takes effect on the next submission, no restart needed.",
    progressToggleFromConfig: "Value comes from the startup config or the built-in default (not changed in the panel yet)",
    importWorkflow: "Import workflow",
    importName: "Workflow name (used for the id; optional)",
    importPlaceholder: "Paste the API-format JSON exported from ComfyUI",
    importPickFile: "Choose file",
    importSubmit: "Import",
    importCancel: "Cancel",
    importDone: "Imported {id}",
    importReplaced: "Overwrote {id} (notes and schema kept)",
    importHint: "API format only: export from ComfyUI with Export (API), then paste it here",
    importEmpty: "Paste the workflow JSON first (or use Choose file)",
    importConfirmOverwrite: "A workflow named {id} already exists. Overwriting replaces the template (notes and schema are kept, the old template is backed up as .json.bak). Overwrite?",
    enableHint: "Click to enable: the model can use it",
    disableHint: "Click to disable: the model will not see it",
    disabledBadge: "Disabled",
    noModel: "No model detected",
    notePlaceholder: "One line on what this workflow is for (the model uses it to decide)",
    loadingWorkflows: "Loading workflows\u2026",
    tabTerminal: "Terminal",
    moreActions: "More",
    hideNsfw: "Hide NSFW",
    showNsfw: "Show NSFW",
    hideNsfwHint: "Hide assets judged NSFW (keyword-based, not a classifier).",
    emptyAllHidden: "Nothing to show \u2014 everything here was judged NSFW and hidden.",
    termConnecting: "Reading ComfyUI output\u2026",
    termNoLog: "External instance, but its log file was not found (default: <install>/user/comfyui.log). If --user-directory moved it, this panel cannot read it.",
    termNotManaged: "This is an external instance \u2014 its stdout belongs to whatever terminal started it. What you see here is its user/comfyui.log.",
    termNotStarted: "Not started yet. Hit Start to launch ComfyUI; loading logs will appear here.",
    termStarting: "Starting ComfyUI \u2014 loading logs will show up here (cold start can take a while).",
    termLogOnly: "Reading ComfyUI's log file (service state unknown \u2014 this is from its last run).",
    termFailed: "Startup failed \u2014 see the reason below (or the error in the conversation).",
    termStart: "Start",
    termEmpty: "No output yet. Loading logs show up here once the service starts.",
    termExternal: "external",
    termFilter: "Filter\u2026",
    termPause: "Pause",
    termResume: "Resume",
    termFollow: "Follow",
    termClear: "Clear",
    termDropped: "{n} earlier lines scrolled out of the buffer (2000 max).",
    termNoMatch: "No matching lines.",
    allPanelsOff: "All panels are turned off.",
    allPanelsOffHint: "Clear disabledComponents in the config, or remove the panel.* entries.",
    freeMemory: "Free memory",
    ready: "Model ready",
    offline: "Offline",
    done: "Done",
    clearPreview: "Clear",
    download: "Download",
    useAsReference: "Use as reference",
    usedAsReference: "Set as reference",
    reuseParams: "Reuse params",
    reuseHint: "Parameters already reflect the last run",
    promptLabel: "Prompt",
    promptPlaceholder: "Describe what you want",
    referenceImage: "Reference image",
    aspectRatio: "Aspect ratio",
    paramsLabel: "Parameters",
    modelLabel: "Model",
    memoryFreed: "Asked ComfyUI to free memory",
    requiredField: "required",
    replaceImage: "Replace",
    clearImage: "Clear",
    uploading: "Uploading\u2026",
    dropImage: "Drop an image, or click to choose",
    dropImageHint: "Paste works too \xB7 PNG / JPG / WEBP / GIF",
    manualPath: "Already have the file? Paste its path",
    manualPathCancel: "Hide path input",
    manualPathHint: "Absolute path, press Enter",
    previewInput: "Input",
    previewOutput: "Output",
    previewInputTag: "pending",
    previewEmpty: "Results appear here after you run it",
    previewPickWorkflow: "Pick a workflow first",
    runModeLabel: "Run mode",
    runDone: "Done: {n} artifact(s) in {ms} ms",
    runFailed: "Run failed",
    missingModels: "Missing on this machine: {names} \u2014 running it will fail.",
    outputDirLabel: "Output to",
    outputDirReset: "Reset",
    outputDirHint: "Leave empty to use the host default. A custom path must sit inside the workspace or an authorized root.",
    submitted: "Submitted \u2014 generating\u2026",
    tabAssets: "Assets",
    tabWorkflow: "Workflow",
    tabTags: "Tags",
    tabPoses: "Poses",
    tagsTitle: "Tag library",
    tagsSub: "{total} tags total, {shown} matching",
    tagsLoading: "Building index\u2026",
    tagsPlaceholder: "Search tags: Chinese name, Japanese name or tag (e.g. \u957F\u53D1 / long_hair)",
    tagsAllKinds: "All kinds",
    tagsAllCategories: "All categories",
    tagsCategoryHint: "Categories come from Danbooru tag groups and cover only ~27% of general tags; drop the category filter if nothing matches",
    tagsCopy: "Copy",
    tagsEmpty: "No matching tags. Try a shorter word, or clear the category filter.",
    tagsScrollMore: "Keep scrolling \u2014 {left} more",
    tagsLoadingMore: "Loading\u2026",
    tagsSync: "Update tags",
    tagsSyncRunning: "Updating\u2026",
    tagsSyncHint: "Re-fetch the four CSVs and 91 wiki group pages (~2.5 min). Writes to the plugin data dir only.",
    tagsSyncDone: "Updated: {kinds}; categories {groups} groups / {tags} tags",
    tagsSyncFailed: "Update failed: {message}",
    posesTitle: "Pose library",
    posesSub: "{poses} poses / {views} angles, all available",
    posesLoading: "Reading the pose catalog\u2026",
    posesPlaceholder: "Search poses: Chinese name, code or category (e.g. \u5750\u59FF / P001)",
    posesAllSystems: "All systems",
    posesAllCategories: "All categories",
    posesOnlySafe: "Safe only",
    posesAdultBadge: "Adult",
    posesAddToChat: "Add to chat",
    posesFetch: "Get file",
    posesFetching: "Fetching\u2026",
    posesFetched: "Saved to uploads",
    posesEmpty: "No pose matches. Try a shorter word, or drop the system / category filter.",
    posesScrollMore: "Keep scrolling \u2014 {left} more",
    posesLoadingMore: "Loading\u2026",
    tabCostumes: "Costumes",
    costumesTitle: "Costume library",
    costumesSub: "{total} costumes across {cats} categories, each with English keywords",
    costumesLoading: "Reading the costume catalog\u2026",
    costumesPlaceholder: "Search: Chinese name, tag or English keywords (e.g. \u725B\u4ED4\u88D9 / denim knit)",
    costumesAllCategories: "All categories",
    costumesOnlySafe: "Safe only",
    costumesAdultBadge: "Adult",
    costumesCopyKeywords: "Copy keywords",
    costumesCopied: "Keywords copied: ",
    costumesAddToChat: "Add to chat",
    costumesFetch: "Get file",
    costumesFetching: "Fetching\u2026",
    costumesFetched: "Saved to uploads",
    costumesEmpty: "No costume matches. Try another word, or drop the category filter.",
    costumesScrollMore: "Keep scrolling \u2014 {left} more",
    costumesLoadingMore: "Loading\u2026",
    costumesImageFail: "Image unavailable",
    costumesSource: "Source & license",
    posesImageFail: "Sketch unavailable",
    posesSource: "Source & license",
    posesAngle_front: "Front",
    posesAngle_diag: "3/4",
    posesAngle_side: "Side",
    posesAngle_high: "High",
    posesAngle_low: "Low",
    refsTabTags: "Tags",
    refsTabRefs: "Prompt ideas",
    refsSub: "See how real Danbooru posts write their tags: image plus the full prompt, searched server-side, nothing cached locally",
    refsAnyRating: "All ratings",
    refsAnyRatingHint: "General (safe) only by default. Turning this on includes s/q/e \u2014 these are real posts and their content is unfiltered.",
    refsRandom: "Random",
    refsSearch: "Search",
    refsAnother: "Another",
    refsPlaceholder: "Keywords, e.g. cyberpunk city (space = all must match)",
    refsPoolEmpty: "Local pool not built yet (search needs it)",
    refsPoolSize: "Local pool: {n} prompts",
    refsBuild: "Build pool",
    refsRebuild: "Rebuild pool",
    refsBuilding: "Building\u2026",
    refsPoolDone: "Pool ready: {n} prompts",
    refsPoolFailed: "Build failed: {message}",
    refsNeedPool: "Search needs a local pool first. Random mode does not.",
    refsEmpty: "No matching prompts. Try a shorter word.",
    refsCopy: "Copy",
    refsCopied: "Copied",
    refsCopyFailed: "Clipboard is unavailable here; select and copy manually.",
    selectWorkflow: "Choose a workflow\u2026",
    modeConversation: "To chat",
    modeConversationHint: "Send the run instruction into this chat and let the model execute it; the image lands in the conversation",
    modeDirect: "Direct",
    modeDirectHint: "Run it here without a model round-trip; output stays in this panel",
    run: "Generate",
    running: "Running\u2026",
    moreParams: "More parameters",
    outputTitle: "Output",
    emptyWorkflows: "No workflows yet.",
    emptyWorkflowsHint: "Export one from ComfyUI with Export (API), then use the import button at the top right to paste it in (or pick the file).",
    needRequired: "Missing required: ",
    instructionFilled: "Instruction is in the composer \u2014 press Enter to send.",
    instructionFailed: "Could not find the composer; copy the parameters and ask the model to run it.",
    undescribedHint: "This workflow has no description, so neither you nor the model can tell what it does. Consider asking the model to write one.",
    fieldImagePlaceholder: "Absolute image path (or copy one from the asset library)",
    brokenHint: "Some files are not valid API-format workflows and were skipped ({n})."
  }
};

// src/client/i18n.ts
function makeTranslate(active) {
  const table = /^en/i.test(active) ? DICT.en : DICT.zh;
  const fallback = DICT.zh;
  return (key) => table[key] ?? fallback[key] ?? key;
}
function activeLocaleOf(locale) {
  try {
    const bag = locale;
    const snapshot = typeof bag?.getSnapshot === "function" ? bag.getSnapshot() : null;
    const active = snapshot !== null && typeof snapshot === "object" ? snapshot.active : void 0;
    if (typeof active === "string") return active;
  } catch {
  }
  return "zh";
}

// src/client/index.tsx
var import_jsx_runtime15 = require("react/jsx-runtime");
var name = "dsh-comfyui-workbench";
var inject = ["slots"];
var PANEL_ID = "comfyui-workbench";
var TAB_ID = "comfyui-workbench:workbench";
function apply(ctx) {
  const t = makeTranslate(activeLocaleOf(ctx.get("locale")));
  const goToConversation = () => {
    try {
      const layout = ctx.get("layout");
      if (layout !== null && typeof layout?.selectPanel === "function") layout.selectPanel("conversation");
    } catch {
    }
  };
  let sidebar = null;
  const openSidebar = () => {
    if (sidebar === null) return false;
    try {
      sidebar.openTab({ type: TAB_ID });
      return true;
    } catch {
      return false;
    }
  };
  const Tab = (tabProps) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(
    Workbench,
    {
      t,
      visible: tabProps === void 0 || tabProps.visible !== false,
      embedded: true,
      goToConversation,
      openSidebar
    }
  );
  ctx.inject(["betterSidebar"], (scope) => {
    scope.effect(() => {
      const service = scope.betterSidebar;
      const dispose = service.registerTab({
        id: TAB_ID,
        title: () => t("title"),
        description: () => t("sidebarDescription"),
        icon: (size) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Icon, { name: "album", size: size ?? 16 }),
        order: 40,
        single: true,
        component: Tab
      });
      sidebar = service;
      return () => {
        sidebar = null;
        dispose();
      };
    }, "comfyui-workbench: better-sidebar tab");
  });
  const slots = ctx.get("slots");
  if (slots === void 0) {
    console.warn("[comfyui-workbench] \u62FF\u4E0D\u5230 slots \u670D\u52A1\uFF0C\u5DE5\u4F5C\u6D41\u7BA1\u7406\u754C\u9762\u672A\u6CE8\u518C\u3002");
    return;
  }
  slots.inject("sidebar.panellist", () => slots.register({
    name: "sidebar.panellist",
    id: PANEL_ID,
    order: 40,
    label: () => t("title")
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)("span", { style: { display: "grid", placeItems: "center" }, children: /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Icon, { name: "album", size: props?.size ?? 18 }) })));
  slots.inject("main", () => slots.register({
    name: "main",
    key: PANEL_ID
  }, () => /* @__PURE__ */ (0, import_jsx_runtime15.jsx)(Workbench, { t, visible: true, goToConversation, openSidebar })));
  console.info("[comfyui-workbench] \u5DE5\u4F5C\u6D41\u7BA1\u7406\u754C\u9762\u5DF2\u6CE8\u518C\uFF08\u4FA7\u8FB9\u680F\u5165\u53E3 + \u4E3B\u9762\u677F\uFF09");
}
var __test = {
  Gallery,
  Card,
  Lightbox,
  ConfirmRemove,
  ConfirmBulkRemove,
  Workbench,
  WorkflowAdmin,
  TagsPanel,
  PromptRefs,
  TAGS_CSS: styles_default2,
  PosesPanel,
  POSES_CSS: styles_default3,
  CostumesPanel,
  COSTUMES_CSS: styles_default4,
  metaLine,
  planPage,
  shouldLoadMore,
  shouldAutoFill,
  addToConversation,
  addImageToConversation,
  pasteFile,
  findComposerEditor,
  DICT,
  CSS: styles_default5,
  WORKBENCH_CSS: styles_default
};
return module.exports; } });
