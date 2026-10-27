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

// src/client/styles-workbench.ts
var WORKBENCH_CSS = [
  // ── 外壳 ──
  `.cwb-root{--w-bg:var(--dsw-alias-bg-base,#fff);--w-surface:var(--dsw-alias-bg-layer-1,#f6f6f7);--w-sunken:var(--dsw-alias-bg-layer-2,#ececef);--w-text:var(--dsw-alias-label-primary,#1f2023);--w-muted:var(--dsw-alias-label-secondary,#6b6f76);--w-line:var(--dsw-alias-border-l3,#dcdce0);--w-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--w-danger:var(--dsw-alias-state-error-primary,#b53e3e);color:var(--w-text);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:1.5;height:100%;min-height:0;display:flex;flex-direction:column;container-type:inline-size;box-sizing:border-box}
.cwb-root *,.cwb-root *::before,.cwb-root *::after{box-sizing:border-box}
.cwb-root button,.cwb-root input,.cwb-root select,.cwb-root textarea{font:inherit;color:inherit}
.cwb-root :focus-visible{outline:1px solid var(--w-accent);outline-offset:2px}`,
  // ── 顶部页签 ──
  `.cwb-tabs{display:flex;gap:22px;padding:0 20px;border-bottom:1px solid var(--w-line);flex-shrink:0;min-height:46px;align-items:stretch}
.cwb-tab{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:0;font-size:.95em;cursor:pointer;position:relative;transition:color .12s ease}
.cwb-tab:hover{color:var(--w-text)}
.cwb-tab.on{color:var(--w-text);font-weight:500}
.cwb-tab.on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--w-accent);border-radius:2px 2px 0 0}`,
  // ── 应用区：顶部条 + 左右两栏 ──
  `.cwb-body{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.cwb-body>*{flex:1;min-height:0}
.cwf-app{flex:1;min-height:0;display:flex;flex-direction:column}
.cwf-top{display:flex;align-items:center;gap:10px;padding:10px 20px;flex-shrink:0;border-bottom:1px solid var(--w-line)}
.cwf-pick{flex:1;min-width:0;display:flex;align-items:center;gap:8px;background:var(--w-surface);border:1px solid var(--w-line);border-radius:10px;padding:0 10px;height:36px}
.cwf-pick select{flex:1;min-width:0;appearance:none;border:0;background:transparent;color:var(--w-text);font-size:.95em;cursor:pointer}
.cwf-pick .cwf-chevron{width:7px;height:7px;border-right:1.5px solid var(--w-muted);border-bottom:1.5px solid var(--w-muted);transform:rotate(45deg);flex-shrink:0}
.cwf-status{display:flex;align-items:center;gap:12px;font-size:.85em;color:var(--w-muted);white-space:nowrap}
.cwf-status .cwf-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary,#5ba97a);display:inline-block;margin-right:6px}
.cwf-status .cwf-dot.off{background:var(--w-muted)}
.cwf-ghost{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.9em;cursor:pointer;padding:4px 6px;border-radius:6px}
.cwf-ghost:hover{background:var(--w-surface);color:var(--w-text)}

.cwf-main{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1.32fr) minmax(330px,1fr);overflow:hidden}`,
  // ── 左：预览 ──
  `.cwf-left{min-width:0;min-height:0;display:flex;flex-direction:column;padding:14px 16px 12px;gap:10px;border-right:1px solid var(--w-line)}
.cwf-left-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.88em;color:var(--w-muted);flex-shrink:0}
.cwf-left-actions{display:flex;align-items:center;gap:10px}
.cwf-stage{flex:1;min-height:200px;border-radius:14px;background:var(--w-sunken);overflow:hidden;position:relative;display:grid;place-items:center}
.cwf-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.cwf-stage-empty{display:flex;flex-direction:column;align-items:center;gap:10px;color:var(--w-muted);font-size:.88em;text-align:center;padding:24px}
.cwf-stage-empty svg{opacity:.45}
.cwf-stage-badge{position:absolute;left:10px;bottom:10px;display:flex;gap:6px;flex-wrap:wrap}
.cwf-tag{background:#141519c9;color:#fff;font-size:.75em;padding:3px 8px;border-radius:6px}
.cwf-stage-foot{display:flex;align-items:center;gap:6px;flex-wrap:wrap;flex-shrink:0}
.cwf-pill{appearance:none;border:1px solid var(--w-line);background:transparent;color:var(--w-muted);font-size:.82em;padding:5px 10px;border-radius:8px;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.cwf-pill:hover{background:var(--w-surface);color:var(--w-text)}
.cwf-pill:disabled{opacity:.4;cursor:not-allowed}
.cwf-strip{display:flex;gap:8px;overflow-x:auto;flex-shrink:0;padding:2px}
.cwf-strip button{appearance:none;padding:0;width:58px;height:58px;border-radius:10px;overflow:hidden;border:1px solid var(--w-line);background:var(--w-sunken);cursor:pointer;flex-shrink:0}
.cwf-strip button.on{border-color:var(--w-accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--w-accent) 35%,transparent)}
.cwf-strip img{width:100%;height:100%;object-fit:cover;display:block}`,
  // ── 右：表单 ──
  `.cwf-right{min-width:0;min-height:0;display:flex;flex-direction:column;padding:14px 16px 0;gap:12px;overflow:auto;scrollbar-gutter:stable}
.cwf-group{display:flex;flex-direction:column;gap:7px}
.cwf-group-label{font-size:.86em;color:var(--w-muted);display:flex;align-items:center;justify-content:space-between;gap:8px}
.cwf-area{width:100%;min-height:96px;max-height:26vh;resize:vertical;border-radius:12px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.95em;line-height:1.65;padding:10px 12px}
.cwf-area:focus{border-color:var(--w-accent);background:var(--w-bg);outline:none}
.cwf-ref{display:flex;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:8px;min-width:0}
.cwf-ref-thumb{width:56px;height:56px;border-radius:8px;overflow:hidden;background:var(--w-sunken);flex-shrink:0;display:grid;place-items:center}
.cwf-ref-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.cwf-ref-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cwf-ref-title{font-size:.9em}
.cwf-ref-sub{font-size:.8em;color:var(--w-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwf-ratios{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:6px}
.cwf-ratio{appearance:none;border:1px solid var(--w-line);background:transparent;color:var(--w-muted);border-radius:10px;padding:8px 0;font-size:.88em;cursor:pointer;font-variant-numeric:tabular-nums;transition:border-color .12s ease,color .12s ease,background-color .12s ease}
.cwf-ratio:hover{color:var(--w-text)}
.cwf-ratio.on{border-color:var(--w-accent);color:var(--w-text);background:color-mix(in srgb,var(--w-accent) 10%,transparent)}
.cwf-pairs{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.cwf-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.cwf-field-label{font-size:.82em;color:var(--w-muted);display:flex;align-items:center;gap:5px;min-height:16px}
.cwf-req{color:var(--w-danger);font-weight:600}
.cwf-field-type{font-size:.7em;opacity:.65;border:1px solid var(--w-line);padding:0 4px;border-radius:4px;letter-spacing:.02em}
.cwf-icon-btn{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:6px;border-radius:8px;cursor:pointer;display:grid;place-items:center;transition:background-color .12s ease,color .12s ease}
.cwf-icon-btn:hover{background:var(--w-bg);color:var(--w-text)}
.cwf-icon-danger:hover{color:var(--w-danger)}
.cwf-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:118px;padding:16px;border:1.5px dashed var(--w-line);border-radius:12px;background:var(--w-surface);cursor:pointer;text-align:center;transition:border-color .14s ease,background-color .14s ease}
.cwf-drop:hover{border-color:var(--w-muted)}
.cwf-drop.over{border-color:var(--w-accent);background:var(--w-bg)}
.cwf-drop.busy{opacity:.7;cursor:progress}
.cwf-drop-icon{display:grid;place-items:center;width:36px;height:36px;border-radius:50%;background:var(--w-bg);border:1px solid var(--w-line);color:var(--w-muted)}
.cwf-drop-title{font-size:.92em;color:var(--w-text)}
.cwf-drop-hint{font-size:.8em;color:var(--w-muted);line-height:1.5}
.cwf-picked{display:flex;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:8px;min-width:0}
.cwf-picked-thumb{width:56px;height:56px;flex-shrink:0;border-radius:8px;overflow:hidden;background:var(--w-sunken);display:grid;place-items:center}
.cwf-picked-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.cwf-picked-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cwf-picked-name{font-size:.9em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwf-picked-sub{font-size:.78em;color:var(--w-muted);font-variant-numeric:tabular-nums}
.cwf-picked-actions{display:flex;gap:2px;flex-shrink:0}
.cwf-input{width:100%;min-width:0;border-radius:10px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.92em;padding:8px 10px}
.cwf-input:focus{border-color:var(--w-accent);background:var(--w-bg);outline:none}
.cwf-hint{font-size:.78em;color:var(--w-muted);opacity:.9}
.cwf-hint-err{color:var(--w-danger);opacity:1}
.cwf-advanced{border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);overflow:hidden}
.cwf-advanced>summary{cursor:pointer;padding:9px 12px;font-size:.86em;color:var(--w-muted);list-style:none;display:flex;align-items:center;gap:6px;user-select:none}
.cwf-advanced>summary::-webkit-details-marker{display:none}
.cwf-advanced>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease}
.cwf-advanced[open]>summary::before{transform:rotate(45deg)}
.cwf-advanced-body{padding:0 12px 12px;display:flex;flex-direction:column;gap:10px}
.cwf-meta{font-size:.78em;color:var(--w-muted);line-height:1.6;padding:2px 0}

.cwf-dock{position:sticky;bottom:0;padding:10px 0 14px;background:linear-gradient(to top,var(--w-bg) 70%,transparent);flex-shrink:0}
.cwf-dock .cwf-generate{width:100%;appearance:none;border:1px solid transparent;border-radius:12px;padding:12px 16px;font-size:.98em;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--w-text);color:var(--w-bg);transition:opacity .12s ease}
.cwf-dock .cwf-generate:hover:not(:disabled){opacity:.86}
.cwf-dock .cwf-generate:disabled{opacity:.5;cursor:not-allowed}
.cwf-dock .cwf-kbd{margin-left:auto;font-size:.78em;opacity:.75;border:1px solid currentColor;border-radius:5px;padding:0 5px;line-height:1.5}

.cwf-warn{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:9px 11px;border:1px solid var(--w-line);border-left:3px solid var(--w-danger);border-radius:10px;background:var(--w-surface);font-size:.84em;line-height:1.55}
.cwf-warn svg{color:var(--w-danger);flex-shrink:0;margin-top:2px}
.cwf-warn-hint{color:var(--w-muted);flex-basis:100%}
.cwf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--w-muted);padding:48px 24px}
.cwf-empty-title{color:var(--w-text);font-size:1.05em}
.cwf-notice{padding:8px 11px;border-radius:9px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.84em}
.cwf-notice.err{color:var(--w-danger)}
.cwf-field .cwf-link{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.8em;padding:2px 0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:3px}
.cwf-field .cwf-link:hover{color:var(--w-text)}
.cwf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,
  // ── 窄面板：单列 ──
  `@container(max-width:900px){.cwf-main{grid-template-columns:1fr;overflow:auto}.cwf-left{border-right:0;border-bottom:1px solid var(--w-line);min-height:320px}.cwf-right{overflow:visible}.cwf-stage{min-height:240px}}
@container(max-width:460px){.cwb-tabs{padding:0 14px;gap:14px}.cwf-top{padding:8px 12px}.cwf-ratios{grid-template-columns:repeat(2,1fr)}.cwf-pairs{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.cwb-root *{animation:none!important;transition:none!important}}`,
  // ── 工作流管理 ──
  `.cwa-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 10px;border-bottom:1px solid var(--w-line);flex-shrink:0}
.cwa-title{font-size:1.02em;font-weight:600}
.cwa-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}
.cwa-error{margin:10px 20px 0;padding:8px 11px;border-radius:9px;border:1px solid var(--w-danger);color:var(--w-danger);font-size:.84em}
.cwa-notice{margin:10px 20px 0;padding:8px 11px;border-radius:9px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.84em}
.cwa-list{flex:1;min-height:0;overflow:auto;padding:12px 20px 24px;display:flex;flex-direction:column;gap:10px;scrollbar-gutter:stable}
.cwa-row{border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);padding:11px 13px;display:flex;flex-direction:column;gap:8px;transition:opacity .15s ease}
.cwa-row.off{opacity:.62}
.cwa-row-head{display:flex;align-items:flex-start;gap:11px}
.cwa-switch{position:relative;display:inline-flex;flex-shrink:0;cursor:pointer;margin-top:2px}
.cwa-switch input{position:absolute;opacity:0;width:100%;height:100%;margin:0;cursor:pointer}
.cwa-track{width:34px;height:19px;border-radius:99px;background:var(--w-line);position:relative;transition:background-color .16s ease;display:block}
.cwa-knob{position:absolute;top:2px;left:2px;width:15px;height:15px;border-radius:50%;background:var(--w-bg);box-shadow:0 1px 2px #0003;transition:transform .16s ease}
.cwa-switch input:checked+.cwa-track{background:var(--w-accent)}
.cwa-switch input:checked+.cwa-track .cwa-knob{transform:translateX(15px)}
.cwa-switch input:focus-visible+.cwa-track{outline:1px solid var(--w-accent);outline-offset:2px}
.cwa-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
.cwa-name{font-size:.94em;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwa-facts{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:.78em;color:var(--w-muted)}
.cwa-badge{background:var(--w-bg);border:1px solid var(--w-line);border-radius:5px;padding:0 5px;color:var(--w-text)}
.cwa-warn{font-size:.78em;color:var(--w-danger)}
.cwa-note{width:100%;resize:vertical;min-height:46px;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;line-height:1.55;padding:7px 9px}
.cwa-note:focus{border-color:var(--w-accent);outline:none}
.cwa-note::placeholder{color:var(--w-muted)}`
].join("\n");

// src/components/panel-workflow/client/WorkflowAdmin.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function WorkflowAdmin({ t, visible }) {
  const [items, setItems] = (0, import_react.useState)([]);
  const [loading, setLoading] = (0, import_react.useState)(true);
  const [saving, setSaving] = (0, import_react.useState)({});
  const [notice, setNotice] = (0, import_react.useState)("");
  const [error, setError] = (0, import_react.useState)("");
  const load = () => {
    setLoading(true);
    fetchWorkflowList().then((data) => {
      setItems(data.workflows);
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
  if (loading) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwb-root", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: WORKBENCH_CSS }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwf-empty", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "workflow", size: 24 }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwf-empty-title", children: t("loadingWorkflows") })
      ] })
    ] });
  }
  const enabledCount = items.filter((item) => item.enabled !== false).length;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "cwb-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("style", { children: WORKBENCH_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("header", { className: "cwa-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-title", children: t("adminTitle") }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-sub", children: t("adminSub").replace("{on}", String(enabledCount)).replace("{all}", String(items.length)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "button", className: "cwf-ghost", onClick: load, title: t("refresh"), children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "refresh", size: 15 }) })
    ] }),
    error !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-error", children: error }) : null,
    notice !== "" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "cwa-notice", children: notice }) : null,
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
var import_jsx_runtime3 = require("react/jsx-runtime");
function Card({ item, t, selecting, selected, onToggle, onOpen, onAction }) {
  const act = (kind) => (event) => {
    event.stopPropagation();
    event.preventDefault();
    onAction(kind, item);
  };
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(
    "figure",
    {
      className: `cfa-card${selecting ? " cfa-selectable" : ""}${selecting && selected ? " selected" : ""}`,
      onClick: () => selecting ? onToggle(item) : onOpen(item),
      title: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : item.name,
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
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
        selecting ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: `cfa-pick${selected ? " on" : ""}`, "aria-hidden": "true", children: selected ? "\u2713" : "" }) : null,
        !selecting && dupCount > 1 ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cfa-dup", title: t("duplicateBadge").replace("{n}", String(dupCount)), children: `\xD7${dupCount}` }) : null,
        selecting ? null : /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: "cfa-actions", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "cfa-btn", title: t("copyImage"), "aria-label": t("copyImage"), onClick: act("copyImage"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "copy", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "cfa-btn", title: t("copyPrompt"), "aria-label": t("copyPrompt"), onClick: act("copyPrompt"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "text", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "cfa-btn", title: t("exportWorkflow"), "aria-label": t("exportWorkflow"), onClick: act("exportWorkflow"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "download", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "cfa-btn", title: t("addToChat"), "aria-label": t("addToChat"), onClick: act("addToChat"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "chat", size: 15 }) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("button", { type: "button", className: "cfa-btn cfa-danger", title: t("remove"), "aria-label": t("remove"), onClick: act("remove"), children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "trash", size: 15 }) })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("figcaption", { className: "cfa-cap", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cfa-prompt", children: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : item.name }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: "cfa-meta", children: metaLine(item) })
        ] })
      ]
    }
  );
}

// src/components/panel-gallery/client/Confirm.tsx
var import_jsx_runtime4 = require("react/jsx-runtime");
function ConfirmRemove(props) {
  const { item, t, busy, onCancel, onConfirm } = props;
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  const copyCount = dupCount > 1 ? Math.min((item.duplicates ?? []).length, dupCount - 1) : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "cfa-modal", onClick: busy ? void 0 : onCancel, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cfa-modal-card", onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "cfa-modal-title", children: t("removeTitle") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "cfa-modal-body", children: t("removeBody") }),
    copyCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "cfa-modal-body", children: t("duplicateHint").replace("{n}", String(copyCount)) }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "cfa-modal-name", children: item.name }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cfa-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "cfa-chip", onClick: onCancel, disabled: busy, children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "cfa-btn-solid-danger", onClick: () => onConfirm(), disabled: busy, children: t("removeConfirm") })
    ] })
  ] }) });
}
function ConfirmBulkRemove(props) {
  const { count, t, busy, onCancel, onConfirm } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "cfa-modal", onClick: busy ? void 0 : onCancel, children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cfa-modal-card", onClick: (event) => event.stopPropagation(), children: [
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { className: "cfa-modal-title", children: t("bulkRemoveTitle").replace("{n}", String(count)) }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { className: "cfa-modal-body", children: t("bulkRemoveBody") }),
    /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { className: "cfa-modal-actions", children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "cfa-chip", onClick: onCancel, disabled: busy, children: t("cancel") }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("button", { type: "button", className: "cfa-btn-solid-danger", onClick: () => onConfirm(), disabled: busy, children: t("removeConfirm") })
    ] })
  ] }) });
}

// src/components/panel-gallery/client/Gallery.tsx
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
async function addToConversation(item, actions) {
  const blob = await fetchBlob(item.path);
  const type = blob.type !== "" && blob.type.startsWith("image/") ? blob.type : "image/png";
  const file = new File([blob], item.name !== "" ? item.name : "image.png", { type });
  let editor = findComposerEditor();
  if (editor === null) {
    actions.goToConversation();
    editor = await waitForEditor(1400);
  }
  if (editor === null) {
    await copyImageToClipboard(item.path);
    throw new Error("\u6CA1\u627E\u5230\u8F93\u5165\u6846\uFF0C\u56FE\u7247\u5DF2\u590D\u5236\u5230\u526A\u8D34\u677F\u3002");
  }
  try {
    editor.focus();
  } catch {
  }
  pasteFile(editor, file);
}

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
var import_react2 = require("react");

// src/client/types.ts
var PAGE = 60;

// src/components/panel-gallery/client/hooks/useGalleryData.ts
function useGalleryData(options) {
  const { visible, root, query, includeBare, mergeDuplicates } = options;
  const [items, setItems] = (0, import_react2.useState)([]);
  const [total, setTotal] = (0, import_react2.useState)(0);
  const [truncated, setTruncated] = (0, import_react2.useState)(false);
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const [loadingMore, setLoadingMore] = (0, import_react2.useState)(false);
  const [hasMore, setHasMore] = (0, import_react2.useState)(false);
  const [notice, setNotice] = (0, import_react2.useState)(null);
  const [roots, setRoots] = (0, import_react2.useState)([]);
  const itemsRef = (0, import_react2.useRef)([]);
  const hasMoreRef = (0, import_react2.useRef)(false);
  const inFlightRef = (0, import_react2.useRef)(false);
  const requestRef = (0, import_react2.useRef)(0);
  const scrollRef = (0, import_react2.useRef)(null);
  const loadRef = (0, import_react2.useRef)(null);
  const observerRef = (0, import_react2.useRef)(null);
  const load = (0, import_react2.useCallback)(async (reset) => {
    if (!reset && inFlightRef.current) return;
    const token = ++requestRef.current;
    inFlightRef.current = true;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    try {
      const offset = reset ? 0 : itemsRef.current.length;
      const params = {
        offset: String(offset),
        limit: String(PAGE),
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
  const sentinelRef = (0, import_react2.useCallback)((node) => {
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
  (0, import_react2.useEffect)(() => {
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
  (0, import_react2.useEffect)(() => {
    if (!visible) return void 0;
    const delay = query.trim() === "" ? 0 : 240;
    const timer = setTimeout(() => {
      void load(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [visible, root, includeBare, query, load]);
  (0, import_react2.useEffect)(() => {
    if (notice === null) return void 0;
    const timer = setTimeout(() => setNotice(null), 2800);
    return () => clearTimeout(timer);
  }, [notice]);
  const dropItems = (0, import_react2.useCallback)((paths, totalDelta) => {
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

// src/components/panel-gallery/client/styles.ts
var CSS = [
  ".cfa-root{display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font-size:13px}",
  ".cfa-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);position:sticky;top:0;z-index:5;background:var(--dsw-alias-bg-base)}",
  ".cfa-head{display:flex;align-items:center;gap:8px;font-weight:600}",
  ".cfa-head svg{color:var(--dsw-alias-brand-primary)}",
  ".cfa-title{font-size:13.5px;letter-spacing:.01em}",
  ".cfa-count{font-size:11px;font-weight:500;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border-radius:999px;padding:1px 8px;min-width:10px;text-align:center}",
  ".cfa-tools{display:flex;align-items:center;gap:6px;margin-left:auto;flex-wrap:wrap}",
  ".cfa-search{display:flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary)}",
  ".cfa-search:focus-within{border-color:var(--dsw-alias-brand-primary)}",
  ".cfa-search input{border:none;outline:none;background:transparent;color:var(--dsw-alias-label-primary);font-size:12.5px;width:150px;font-family:inherit}",
  ".cfa-search input::placeholder{color:var(--dsw-alias-label-secondary)}",
  ".cfa-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12.5px;padding:5px 9px;outline:none;max-width:180px;font-family:inherit}",
  ".cfa-select:focus{border-color:var(--dsw-alias-brand-primary)}",
  ".cfa-chip{border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:12px;padding:5px 9px;cursor:pointer;font-family:inherit}",
  ".cfa-chip:hover{border-color:var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}",
  ".cfa-chip.on{color:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent)}",
  ".cfa-btn{display:grid;place-items:center;width:28px;height:28px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}",
  ".cfa-btn:hover,.cfa-btn:focus-visible{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary);outline:none}",
  ".cfa-btn[disabled]{opacity:.45;cursor:default}",
  ".cfa-btn.cfa-danger:hover,.cfa-btn.cfa-danger:focus-visible{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}",
  ".cfa-body{flex:1;min-height:240px;overflow:auto;padding:14px 16px 28px;scrollbar-gutter:stable}",
  ".cfa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(172px,1fr));gap:12px}",
  ".cfa-card{position:relative;margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;overflow:hidden;background:var(--dsw-alias-bg-layer-1);cursor:zoom-in;transition:transform .14s ease,box-shadow .14s ease,border-color .14s ease}",
  ".cfa-card:hover{transform:translateY(-2px);box-shadow:0 10px 24px rgba(0,0,0,.16);border-color:var(--dsw-alias-border-l2)}",
  ".cfa-thumb{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;background:var(--dsw-alias-bg-layer-2)}",
  ".cfa-actions{position:absolute;top:6px;right:6px;display:flex;gap:4px;opacity:0;transform:translateY(-3px);transition:opacity .14s ease,transform .14s ease}",
  ".cfa-card:hover .cfa-actions,.cfa-card:focus-within .cfa-actions{opacity:1;transform:none}",
  ".cfa-actions .cfa-btn{width:27px;height:27px;color:#fff;border-color:rgba(255,255,255,.22);background:rgba(14,14,18,.62);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}",
  ".cfa-actions .cfa-btn:hover{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}",
  ".cfa-actions .cfa-btn.cfa-danger:hover{background:var(--dsw-alias-state-error-primary);border-color:transparent;color:#fff}",
  ".cfa-dup{position:absolute;left:6px;top:6px;z-index:2;pointer-events:none;padding:1px 7px;border-radius:999px;font-size:10.5px;line-height:1.5;color:#fff;background:rgba(14,14,18,.66);border:1px solid rgba(255,255,255,.22);backdrop-filter:blur(7px);-webkit-backdrop-filter:blur(7px)}",
  ".cfa-dup-list{max-height:132px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px}",
  ".cfa-selectable{cursor:pointer}",
  ".cfa-pick{position:absolute;left:6px;top:6px;z-index:3;display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1.5px solid rgba(255,255,255,.8);background:rgba(14,14,18,.5);color:#fff;font-size:12px;line-height:1;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
  ".cfa-pick.on{background:var(--dsw-alias-brand-primary);border-color:transparent}",
  ".cfa-card.selected{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 42%,transparent)}",
  ".cfa-bulk{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2500;display:flex;align-items:center;gap:6px;padding:8px 10px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 14px 40px rgba(0,0,0,.34);flex-wrap:wrap;max-width:min(680px,92vw)}",
  ".cfa-bulk-count{font-size:12.5px;color:var(--dsw-alias-label-primary);padding:0 4px;white-space:nowrap}",
  ".cfa-bulk-gap{width:6px}",
  ".cfa-bulk .cfa-chip{display:inline-flex;align-items:center;gap:5px}",
  ".cfa-chip.cfa-bulk-danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent)}",
  ".cfa-chip.cfa-bulk-danger:hover{border-color:var(--dsw-alias-state-error-primary)}",
  ".cfa-chip[disabled]{opacity:.45;cursor:default}",
  ".cfa-cap{display:flex;flex-direction:column;gap:2px;padding:7px 9px 8px;background:var(--dsw-alias-bg-layer-1)}",
  ".cfa-prompt{font-size:11.5px;color:var(--dsw-alias-label-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".cfa-meta{font-size:10.5px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".cfa-hint,.cfa-empty{color:var(--dsw-alias-label-secondary);padding:48px 24px;text-align:center;line-height:1.7}",
  ".cfa-more{display:flex;justify-content:center;align-items:center;min-height:38px;padding:8px 0 4px}",
  ".cfa-notice{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:3000;max-width:min(560px,86vw);padding:8px 14px;border-radius:10px;font-size:12.5px;line-height:1.5;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 30px rgba(0,0,0,.28);animation:cfa-in .16s ease}",
  ".cfa-notice.err{color:var(--dsw-alias-state-error-primary)}",
  "@keyframes cfa-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}",
  ".cfa-modal{position:fixed;inset:0;z-index:2900;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(8,8,11,.62);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}",
  ".cfa-modal-card{width:340px;max-width:100%;display:flex;flex-direction:column;gap:10px;padding:16px 17px;border-radius:12px;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 20px 60px rgba(0,0,0,.4);color:var(--dsw-alias-label-primary)}",
  ".cfa-modal-title{font-size:13.5px;font-weight:600}",
  ".cfa-modal-body{margin:0;font-size:12.5px;line-height:1.65;color:var(--dsw-alias-label-secondary)}",
  ".cfa-modal-name{padding:7px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:11.5px;word-break:break-all}",
  ".cfa-modal-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:2px}",
  ".cfa-btn-solid-danger{border:1px solid var(--dsw-alias-state-error-primary);background:var(--dsw-alias-state-error-primary);color:#fff;border-radius:8px;padding:5px 12px;font-size:12.5px;font-family:inherit;cursor:pointer}",
  ".cfa-btn-solid-danger:hover{filter:brightness(1.08)}",
  ".cfa-btn-solid-danger[disabled]{opacity:.5;cursor:default}",
  ".cfa-lb{position:fixed;inset:0;z-index:2600;display:flex;gap:16px;padding:20px;background:rgba(8,8,11,.76);backdrop-filter:blur(9px);-webkit-backdrop-filter:blur(9px)}",
  ".cfa-lb-stage{position:relative;overflow:hidden;flex:1;min-width:0;display:flex;align-items:center;justify-content:center}",
  ".cfa-lb-img{max-width:100%;max-height:calc(100vh - 40px);border-radius:10px;box-shadow:0 24px 70px rgba(0,0,0,.5);user-select:none;touch-action:none;will-change:transform}",
  ".cfa-lb-img.dragging{cursor:grabbing}",
  ".cfa-lb-nav{position:absolute;top:50%;transform:translateY(-50%);display:grid;place-items:center;width:40px;height:40px;border-radius:50%;border:1px solid rgba(255,255,255,.2);background:rgba(14,14,18,.6);color:#fff;cursor:pointer;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:background .12s ease}",
  ".cfa-lb-nav:hover{background:var(--dsw-alias-brand-primary);border-color:transparent}",
  ".cfa-lb-nav.prev{left:12px}",
  ".cfa-lb-nav.next{right:12px}",
  ".cfa-lb-count{position:absolute;top:10px;left:50%;transform:translateX(-50%);padding:2px 9px;border-radius:999px;font-size:11.5px;color:#fff;background:rgba(14,14,18,.6);border:1px solid rgba(255,255,255,.16);font-variant-numeric:tabular-nums}",
  ".cfa-lb-zoom{position:absolute;left:50%;bottom:12px;transform:translateX(-50%);display:flex;align-items:center;gap:4px;padding:4px 6px;border-radius:10px;background:rgba(14,14,18,.66);border:1px solid rgba(255,255,255,.18);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)}",
  ".cfa-lb-zbtn{display:grid;place-items:center;width:24px;height:24px;border-radius:6px;border:none;background:transparent;color:#fff;cursor:pointer;padding:0}",
  ".cfa-lb-zbtn:hover{background:rgba(255,255,255,.14)}",
  ".cfa-lb-zvalue{min-width:50px;border:none;background:transparent;color:#fff;font-size:11.5px;cursor:pointer;font-variant-numeric:tabular-nums;font-family:inherit}",
  ".cfa-lb-side{width:344px;flex:none;display:flex;flex-direction:column;gap:12px;padding:14px 15px;border-radius:12px;overflow:auto;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary)}",
  ".cfa-lb-head{display:flex;align-items:center;gap:8px;justify-content:space-between}",
  ".cfa-lb-head strong{font-size:12.5px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".cfa-lb-actions{display:flex;gap:6px;flex-wrap:wrap}",
  ".cfa-lb-actions .cfa-btn{width:auto;padding:0 10px;height:28px;display:flex;align-items:center;gap:5px;font-size:12px;font-family:inherit}",
  ".cfa-kv{display:grid;grid-template-columns:auto 1fr;gap:4px 10px;margin:0;font-size:12px}",
  ".cfa-kv dt{color:var(--dsw-alias-label-secondary);white-space:nowrap}",
  ".cfa-kv dd{margin:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".cfa-kv-k{font-size:11px;font-weight:600;letter-spacing:.03em;text-transform:uppercase;color:var(--dsw-alias-label-secondary)}",
  ".cfa-prompt-box{margin:0;padding:9px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;max-height:220px;overflow:auto;user-select:text}",
  "@media (hover:none){.cfa-actions{opacity:1;transform:none}}",
  "@media (max-width:820px){.cfa-lb{flex-direction:column;padding:12px}.cfa-lb-side{width:auto;max-height:44vh}.cfa-lb-img{max-height:62vh}.cfa-lb-nav{width:34px;height:34px}}",
  ".cfa-extra{position:relative;display:inline-flex}",
  ".cfa-extra-trigger{letter-spacing:1px;line-height:1;padding:0 8px}",
  // top:100% + 自身 padding 撑出间距：不能用 top:calc(100% + 6px)，那中间的 6px 是真空，
  // 鼠标斜着移过去时 :hover 会断，面板在指针到达之前就没了。
  ".cfa-extra-panel{display:none;position:absolute;top:100%;margin-top:0;right:0;z-index:20;min-width:150px;padding:12px 6px 6px;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:8px;box-shadow:0 6px 20px rgba(0,0,0,.35)}",
  // 悬浮才展开：常驻会一直挤占工具条，这个开关不是每次都要点
  ".cfa-extra:hover .cfa-extra-panel,.cfa-extra:focus-within .cfa-extra-panel{display:block}",
  ".cfa-extra-item{display:flex;align-items:center;gap:8px;width:100%;padding:6px 9px;border:0;border-radius:6px;background:transparent;color:inherit;font:inherit;font-size:12px;text-align:left;cursor:pointer}",
  ".cfa-extra-item:hover{background:var(--dsw-alias-bg-layer-2)}",
  ".cfa-extra-item.on{color:var(--dsw-alias-brand-primary)}",
  ".cfa-extra-count{margin-left:auto;font-size:11px;opacity:.65}"
].join("\n");

// src/components/panel-gallery/client/BulkBar.tsx
var import_jsx_runtime5 = require("react/jsx-runtime");
function BulkBar(props) {
  const { t, selectedCount, busy } = props;
  const idle = selectedCount === 0 || busy.startsWith("bulk:");
  return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { className: "cfa-bulk", children: [
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "cfa-bulk-count", children: t("selectedCount").replace("{n}", String(selectedCount)) }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onSelectAll, children: t("selectAll") }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onSelectNone, children: t("selectNone") }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { className: "cfa-bulk-gap" }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "cfa-chip", disabled: idle, onClick: props.onExport, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: "download", size: 14 }),
      " ",
      t("bulkExport")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("button", { type: "button", className: "cfa-chip cfa-bulk-danger", disabled: idle, onClick: props.onRemove, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: "trash", size: 14 }),
      " ",
      t("bulkDelete")
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("button", { type: "button", className: "cfa-chip", onClick: props.onExit, children: t("exitSelect") })
  ] });
}

// src/components/panel-gallery/client/Lightbox.tsx
var import_react3 = require("react");
var import_jsx_runtime6 = require("react/jsx-runtime");
function clampZoom(value) {
  return Math.min(8, Math.max(0.2, value));
}
function Kv({ k, v }) {
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_jsx_runtime6.Fragment, { children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("dt", { children: k }),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("dd", { title: String(v), children: String(v) })
  ] });
}
function Lightbox(props) {
  const { item, index, count, t, onClose, onAction, onPrev, onNext } = props;
  const [zoom, setZoom] = (0, import_react3.useState)(1);
  const [pan, setPan] = (0, import_react3.useState)({ x: 0, y: 0 });
  const [dragging, setDragging] = (0, import_react3.useState)(false);
  const stageRef = (0, import_react3.useRef)(null);
  const dragRef = (0, import_react3.useRef)(null);
  (0, import_react3.useEffect)(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    dragRef.current = null;
    setDragging(false);
  }, [item.path]);
  (0, import_react3.useEffect)(() => {
    const node = stageRef.current;
    if (node === null) return void 0;
    const onWheel = (event) => {
      event.preventDefault();
      setZoom((previous) => clampZoom(previous * (event.deltaY < 0 ? 1.12 : 1 / 1.12)));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [item.path]);
  (0, import_react3.useEffect)(() => {
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
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("size"), v: `${item.width}\xD7${item.height}` }, "size"));
  }
  if (typeof item.seed === "number") rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("seed"), v: item.seed }, "seed"));
  if (typeof item.checkpoint === "string" && item.checkpoint !== "") rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("model"), v: item.checkpoint }, "model"));
  if (typeof item.samplerName === "string" && item.samplerName !== "") {
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("sampler"), v: item.samplerName + (item.scheduler !== void 0 && item.scheduler !== "" ? ` / ${item.scheduler}` : "") }, "sampler"));
  }
  if (typeof item.steps === "number" && item.steps > 0) rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("steps"), v: item.steps }, "steps"));
  if (typeof item.cfgScale === "number" && item.cfgScale > 0) rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("cfg"), v: item.cfgScale }, "cfg"));
  if (typeof item.mode === "string" && item.mode !== "") rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("mode"), v: item.mode }, "mode"));
  if (typeof item.createdAt === "string" && item.createdAt !== "") {
    rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("createdAt"), v: String(item.createdAt).replace("T", " ").slice(0, 19) }, "created"));
  }
  rows.push(/* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Kv, { k: t("filePath"), v: item.path }, "path"));
  const dupCount = typeof item.duplicateCount === "number" ? item.duplicateCount : 0;
  return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cfa-lb", onClick: onClose, children: [
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(
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
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
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
          count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-lb-nav prev", title: t("prevImage"), "aria-label": t("prevImage"), onClick: (event) => {
            event.stopPropagation();
            onPrev();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "chevronLeft", size: 18 }) }) : null,
          count > 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-lb-nav next", title: t("nextImage"), "aria-label": t("nextImage"), onClick: (event) => {
            event.stopPropagation();
            onNext();
          }, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "chevronRight", size: 18 }) }) : null,
          typeof index === "number" && count > 0 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { className: "cfa-lb-count", children: `${index + 1} / ${count}` }) : null,
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cfa-lb-zoom", onClick: (event) => event.stopPropagation(), children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-lb-zbtn", title: t("zoomOut"), "aria-label": t("zoomOut"), onClick: () => setZoom((previous) => clampZoom(previous / 1.2)), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "minus", size: 14 }) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-lb-zvalue", title: t("zoomReset"), onClick: resetZoom, children: `${Math.round(zoom * 100)}%` }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-lb-zbtn", title: t("zoomIn"), "aria-label": t("zoomIn"), onClick: () => setZoom((previous) => clampZoom(previous * 1.2)), children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "plus", size: 14 }) })
          ] })
        ]
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("aside", { className: "cfa-lb-side", onClick: (event) => event.stopPropagation(), children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cfa-lb-head", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("strong", { title: item.name, children: item.name }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("button", { type: "button", className: "cfa-btn", title: t("close"), "aria-label": t("close"), onClick: onClose, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "close", size: 15 }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { className: "cfa-lb-actions", children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("copyImage"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "copy", size: 14 }),
          t("copyImage")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("copyPrompt"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "text", size: 14 }),
          t("copyPrompt")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("exportWorkflow"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "download", size: 14 }),
          t("exportWorkflow")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("addToChat"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "chat", size: 14 }),
          t("addToChat")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn", onClick: act("describe"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "text", size: 14 }),
          t("describe")
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("button", { type: "button", className: "cfa-btn cfa-danger", onClick: act("remove"), children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: "trash", size: 14 }),
          t("remove")
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("dl", { className: "cfa-kv", children: rows }),
      dupCount > 1 ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cfa-kv-k", children: `${t("duplicates")} \xB7 ${dupCount}` }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cfa-prompt-box cfa-dup-list", children: (item.duplicates ?? []).map((other) => /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { children: other }, other)) })
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cfa-kv-k", children: t("prompt") }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "cfa-prompt-box", children: item.prompt !== void 0 && item.prompt !== "" ? item.prompt : t("noPrompt") }),
      item.negativePrompt !== void 0 && item.negativePrompt !== "" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { className: "cfa-kv-k", children: t("negativePrompt") }) : null,
      item.negativePrompt !== void 0 && item.negativePrompt !== "" ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { className: "cfa-prompt-box", children: item.negativePrompt }) : null
    ] })
  ] });
}

// src/components/panel-gallery/client/Toolbar.tsx
var import_jsx_runtime7 = require("react/jsx-runtime");
function Toolbar(props) {
  const { t, total, roots, root, query, includeBare, mergeDuplicates, selecting, embedded, hideNsfw, hiddenNsfwCount, onToggleNsfw, visibleCount, loadedCount } = props;
  return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("header", { className: "cfa-bar", children: [
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cfa-head", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "album", size: 18 }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-title", children: t("tabAssets") }),
      total > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-count", children: hideNsfw && visibleCount < loadedCount ? `${visibleCount} / ${loadedCount}` : String(loadedCount) }) : null
    ] }),
    /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cfa-tools", children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("label", { className: "cfa-search", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "search", size: 14 }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("input", { value: query, placeholder: t("search"), onChange: (event) => props.onQuery(event.target.value) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("select", { className: "cfa-select", value: root, title: t("allRoots"), onChange: (event) => props.onRoot(event.target.value), children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: "all", children: t("allRoots") }),
        roots.map((entry) => /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("option", { value: entry.path, title: entry.path, children: entry.label !== "" ? entry.label : entry.path }, entry.path))
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${includeBare ? " on" : ""}`,
          title: includeBare ? t("onlyGenerated") : t("onlyGeneratedOn"),
          onClick: props.onToggleBare,
          children: includeBare ? t("onlyGeneratedOn") : t("onlyGenerated")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${mergeDuplicates ? " on" : ""}`,
          title: t("mergeDuplicates"),
          onClick: props.onToggleDuplicates,
          children: t("mergeDuplicates")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
        "button",
        {
          type: "button",
          className: `cfa-chip${selecting ? " on" : ""}`,
          title: selecting ? t("exitSelect") : t("select"),
          onClick: props.onToggleSelecting,
          children: selecting ? t("exitSelect") : t("select")
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("refresh"), "aria-label": t("refresh"), onClick: props.onRefresh, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "refresh", size: 15 }) }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { className: "cfa-extra", children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn cfa-extra-trigger", title: t("moreActions"), "aria-label": t("moreActions"), children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { "aria-hidden": "true", children: "\u22EF" }) }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { className: "cfa-extra-panel", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)(
          "button",
          {
            type: "button",
            className: `cfa-extra-item${hideNsfw ? " on" : ""}`,
            title: t("hideNsfwHint"),
            onClick: props.onToggleNsfw,
            children: [
              hideNsfw ? t("showNsfw") : t("hideNsfw"),
              hiddenNsfwCount > 0 ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { className: "cfa-extra-count", children: hiddenNsfwCount }) : null
            ]
          }
        ) })
      ] }),
      embedded ? null : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("button", { type: "button", className: "cfa-btn", title: t("openSidebar"), "aria-label": t("openSidebar"), onClick: props.onOpenSidebar, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "dock", size: 15 }) })
    ] })
  ] });
}

// src/components/panel-gallery/client/Gallery.tsx
var import_jsx_runtime8 = require("react/jsx-runtime");
function Gallery({ t, visible, embedded, goToConversation, openSidebar }) {
  const [root, setRoot] = (0, import_react4.useState)("all");
  const [query, setQuery] = (0, import_react4.useState)("");
  const [includeBare, setIncludeBare] = (0, import_react4.useState)(false);
  const [mergeDuplicates, setMergeDuplicates] = (0, import_react4.useState)(true);
  const [hideNsfw, setHideNsfw] = (0, import_react4.useState)(false);
  const [activePath, setActivePath] = (0, import_react4.useState)(null);
  const [busy, setBusy] = (0, import_react4.useState)("");
  const [pendingDelete, setPendingDelete] = (0, import_react4.useState)(null);
  const [selecting, setSelecting] = (0, import_react4.useState)(false);
  const [selected, setSelected] = (0, import_react4.useState)(() => /* @__PURE__ */ new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = (0, import_react4.useState)(false);
  const gallery = useGalleryData({ visible, root, query, includeBare, mergeDuplicates });
  const { items, itemsRef, total, truncated, loading, loadingMore, hasMore, notice, setNotice } = gallery;
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
  (0, import_react4.useEffect)(() => {
    if (hideNsfw && activePath !== null && activeItem === null) setActivePath(null);
  }, [hideNsfw, activePath, activeItem]);
  (0, import_react4.useEffect)(() => {
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
  const onAction = (kind, item) => {
    if (kind === "remove") {
      setPendingDelete(item);
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
  return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("style", { children: CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-body", ref: gallery.scrollRef, children: [
      loading && visibleItems.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-hint", children: t("loading") }) : null,
      !loading && visibleItems.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-empty", children: emptyText }) : null,
      visibleItems.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-grid", children: visibleItems.map((item) => /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
      items.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { className: "cfa-more", ref: gallery.sentinelRef, children: [
        loadingMore ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("span", { className: "cfa-hint", children: t("loading") }) : null,
        !loadingMore && hasMore ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("button", { type: "button", className: "cfa-chip", onClick: () => gallery.reload(false), children: t("loadMore") }) : null
      ] }) : null,
      truncated ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: "cfa-hint", children: t("truncated") }) : null
    ] }),
    notice !== null ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { className: `cfa-notice${notice.kind === "err" ? " err" : ""}`, children: notice.text }) : null,
    selecting ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    activeItem !== null ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    pendingDelete !== null ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
    bulkConfirmOpen && selecting ? /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(
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
var import_react6 = require("react");

// src/components/panel-terminal/client/Terminal.tsx
var import_react5 = require("react");

// src/components/panel-terminal/client/styles.ts
var TERMINAL_CSS = `
.cwt-root{display:flex;flex-direction:column;height:100%;min-height:0;background:#11151a;color:#cfd6de;font-family:ui-monospace,SFMono-Regular,"SF Mono",Menlo,Consolas,"Liberation Mono",monospace}
.cwt-bar{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #232a32;flex-shrink:0;flex-wrap:wrap}
.cwt-state{font-size:11px;letter-spacing:.04em;text-transform:uppercase;padding:2px 7px;border:1px solid #2c353f;border-radius:3px;color:#8b98a6}
.cwt-state-ready{color:#5ec98a;border-color:#2c5140}
.cwt-state-starting{color:#e0b354;border-color:#5a4a24}
.cwt-state-failed{color:#e0705f;border-color:#5c322c}
.cwt-state-external{color:#7f8b99;border-color:#333c46}
.cwt-meta{font-size:11px;color:#6d7987}
.cwt-filter{flex:1;min-width:120px;background:#0c1014;border:1px solid #232a32;border-radius:3px;color:#cfd6de;font:inherit;font-size:12px;padding:4px 8px;outline:none}
.cwt-filter:focus{border-color:#3d4a58}
.cwt-btn{background:#171d24;border:1px solid #232a32;border-radius:3px;color:#9aa7b5;font:inherit;font-size:11px;padding:4px 10px;cursor:pointer}
.cwt-btn:hover{color:#cfd6de;border-color:#3d4a58}
.cwt-btn.on{color:#79b8e0;border-color:#35506a;background:#16202a}
.cwt-btn-primary{color:#8fd0a0;border-color:#2f5a3f;background:#14201a}
.cwt-btn-primary:hover{color:#b6e6c3;border-color:#3f7a55}
.cwt-note{padding:4px 12px;font-size:11px;color:#8a6f3a;background:#1b1810;border-bottom:1px solid #2a2418}
.cwt-hint{padding:10px 12px;font-size:12px;color:#75818f;line-height:1.5}
.cwt-box{flex:1;min-height:0;overflow-y:auto;padding:8px 0;font-size:12px;line-height:1.45}
.cwt-line{display:flex;padding:0 12px;white-space:pre-wrap;word-break:break-word}
.cwt-line:hover{background:#161c23}
.cwt-line.err .cwt-text{color:#b8938a}
.cwt-text{flex:1;min-width:0}
.cwt-box::-webkit-scrollbar{width:10px}
.cwt-box::-webkit-scrollbar-thumb{background:#2a333d;border-radius:5px}
.cwt-box::-webkit-scrollbar-track{background:transparent}
`;

// src/components/panel-terminal/client/Terminal.tsx
var import_jsx_runtime9 = require("react/jsx-runtime");
var POLL_MS = 1e3;
var MAX_RENDER = 2e3;
function Terminal({ t, visible }) {
  const [lines, setLines] = (0, import_react5.useState)([]);
  const [status, setStatus] = (0, import_react5.useState)(void 0);
  const [dropped, setDropped] = (0, import_react5.useState)(0);
  const [following, setFollowing] = (0, import_react5.useState)(true);
  const [filter, setFilter] = (0, import_react5.useState)("");
  const [paused, setPaused] = (0, import_react5.useState)(false);
  const cursor = (0, import_react5.useRef)(0);
  const epochRef = (0, import_react5.useRef)("");
  const inflight = (0, import_react5.useRef)(false);
  const boxRef = (0, import_react5.useRef)(null);
  const pull = (0, import_react5.useCallback)(async () => {
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
  (0, import_react5.useEffect)(() => {
    if (!visible || paused) return void 0;
    void pull();
    const timer = setInterval(() => {
      void pull();
    }, POLL_MS);
    return () => {
      clearInterval(timer);
    };
  }, [visible, paused, pull]);
  (0, import_react5.useEffect)(() => {
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
  const hint = status === void 0 ? t("termConnecting") : state === "external" ? t("termNotManaged") : state === "failed" ? status.detail ?? t("termFailed") : state === "starting" ? t("termStarting") : state === "unknown" ? lines.length > 0 ? t("termLogOnly") : t("termNotStarted") : lines.length === 0 ? t("termEmpty") : "";
  const canStart = status !== void 0 && !managed && state !== "external" && state !== "starting";
  return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "cwt-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("style", { children: TERMINAL_CSS }),
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "cwt-bar", children: [
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: `cwt-state cwt-state-${state === "external" ? "external" : state}`, children: state === "external" ? t("termExternal") : state }),
      status?.pid !== void 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("span", { className: "cwt-meta", children: [
        "pid ",
        status.pid
      ] }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
        "input",
        {
          className: "cwt-filter",
          value: filter,
          placeholder: t("termFilter"),
          onChange: (event) => setFilter(event.target.value)
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: `cwt-btn${paused ? " on" : ""}`, onClick: () => setPaused((value) => !value), children: paused ? t("termResume") : t("termPause") }),
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: `cwt-btn${following ? " on" : ""}`, onClick: () => setFollowing(true), children: t("termFollow") }),
      canStart ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("button", { type: "button", className: "cwt-btn", onClick: () => {
        void clear();
      }, children: t("termClear") })
    ] }),
    dropped > 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "cwt-note", children: t("termDropped").replace("{n}", String(dropped)) }) : null,
    hint !== "" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "cwt-hint", children: hint }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("div", { className: "cwt-box", ref: boxRef, onScroll, children: [
      shown.map((line) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: `cwt-line${line.stream === "err" ? " err" : ""}`, children: /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("span", { className: "cwt-text", children: line.text }) }, line.seq)),
      shown.length === 0 && lines.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)("div", { className: "cwt-hint", children: t("termNoMatch") }) : null
    ] })
  ] });
}

// src/client/components/Workbench.tsx
var import_jsx_runtime10 = require("react/jsx-runtime");
var TABS = [
  { id: "assets", component: "panel.gallery", label: "tabAssets" },
  { id: "workflow", component: "panel.workflow", label: "tabWorkflowAdmin" },
  { id: "terminal", component: "panel.terminal", label: "tabTerminal" }
];
function Workbench({ t, visible, embedded, goToConversation, openSidebar }) {
  const [tab, setTab] = (0, import_react6.useState)("assets");
  const [enabled, setEnabled] = (0, import_react6.useState)({
    "panel.gallery": true,
    "panel.workflow": true,
    "panel.terminal": true
  });
  (0, import_react6.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cwb-root", children: [
    /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("style", { children: WORKBENCH_CSS }),
    available.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)("div", { className: "cwf-empty", children: [
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cwf-empty-title", children: t("allPanelsOff") }),
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { children: t("allPanelsOffHint") })
    ] }) : /* @__PURE__ */ (0, import_jsx_runtime10.jsxs)(import_jsx_runtime10.Fragment, { children: [
      available.length > 1 ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("nav", { className: "cwb-tabs", role: "tablist", "aria-label": "\u5DE5\u4F5C\u53F0", children: available.map((item) => /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(
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
      /* @__PURE__ */ (0, import_jsx_runtime10.jsx)("div", { className: "cwb-body", children: current === "assets" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Gallery, { t, visible, ...embedded === true ? { embedded } : {}, goToConversation, openSidebar }) : current === "workflow" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(WorkflowAdmin, { t, visible }) : current === "terminal" ? /* @__PURE__ */ (0, import_jsx_runtime10.jsx)(Terminal, { t, visible }) : null })
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
    tabTerminal: "\u7EC8\u7AEF",
    termConnecting: "\u6B63\u5728\u8BFB\u53D6 ComfyUI \u7684\u8F93\u51FA\u2026",
    termNotManaged: "\u5F53\u524D\u670D\u52A1\u662F\u5916\u90E8\u5B9E\u4F8B \u2014\u2014 \u5B83\u7684\u8F93\u51FA\u5728\u542F\u52A8\u5B83\u7684\u90A3\u4E2A\u7EC8\u7AEF\u91CC\uFF0C\u63D2\u4EF6\u770B\u4E0D\u5230\u3002\u60F3\u5728\u8FD9\u91CC\u770B\u5230\u65E5\u5FD7\uFF0C\u5173\u6389\u5916\u90E8\u5B9E\u4F8B\u540E\u7531\u63D2\u4EF6\u81EA\u5DF1\u62C9\u8D77\u3002",
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
    emptyWorkflowsHint: "\u5728 ComfyUI \u91CC\u7528 Export (API) \u5BFC\u51FA\uFF0C\u7136\u540E\u8FD0\u884C node scripts/import.mjs <\u6587\u4EF6>\u3002",
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
    termNotManaged: "This service is an external instance \u2014 its output lives in whatever terminal started it. Stop it to let the plugin launch its own process.",
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
    emptyWorkflowsHint: "Export one from ComfyUI with Export (API), then run node scripts/import.mjs <file>.",
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
var import_jsx_runtime11 = require("react/jsx-runtime");
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
  const Tab = (tabProps) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(
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
        icon: (size) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "album", size: size ?? 16 }),
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
  }, (props) => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)("span", { style: { display: "grid", placeItems: "center" }, children: /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Icon, { name: "album", size: props?.size ?? 18 }) })));
  slots.inject("main", () => slots.register({
    name: "main",
    key: PANEL_ID
  }, () => /* @__PURE__ */ (0, import_jsx_runtime11.jsx)(Workbench, { t, visible: true, goToConversation, openSidebar })));
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
  metaLine,
  planPage,
  addToConversation,
  pasteFile,
  findComposerEditor,
  DICT,
  CSS,
  WORKBENCH_CSS
};
return module.exports; } });
