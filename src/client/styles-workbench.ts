/**
 * 工作台样式 —— 左预览 / 右参数的版式。
 *
 * 只依赖宿主 token（`--dsw-alias-*`），浅色与深色主题都自动跟随；
 * 版式用容器查询，面板被 dock 到窄侧栏时自动并成单列。
 */
export const WORKBENCH_CSS = [
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
  `.cwf-app{flex:1;min-height:0;display:flex;flex-direction:column}
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
.cwf-generate{width:100%;appearance:none;border:1px solid transparent;border-radius:12px;padding:12px 16px;font-size:.98em;font-weight:600;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:8px;background:var(--dsw-alias-button-primary-fill,var(--w-accent));color:var(--dsw-alias-label-primary-foreground,#fff);transition:background-color .12s ease,opacity .12s ease}
.cwf-generate:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,color-mix(in srgb,var(--w-accent) 86%,#000))}
.cwf-generate:disabled{opacity:.5;cursor:not-allowed}
.cwf-kbd{margin-left:auto;font-size:.78em;opacity:.75;border:1px solid currentColor;border-radius:5px;padding:0 5px;line-height:1.5}

.cwf-warn{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:9px 11px;border:1px solid var(--w-line);border-left:3px solid var(--w-danger);border-radius:10px;background:var(--w-surface);font-size:.84em;line-height:1.55}
.cwf-warn svg{color:var(--w-danger);flex-shrink:0;margin-top:2px}
.cwf-warn-hint{color:var(--w-muted);flex-basis:100%}
.cwf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--w-muted);padding:48px 24px}
.cwf-empty-title{color:var(--w-text);font-size:1.05em}
.cwf-notice{padding:8px 11px;border-radius:9px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.84em}
.cwf-notice.err{color:var(--w-danger)}
.cwf-link{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.8em;padding:2px 0;cursor:pointer;text-align:left;text-decoration:underline;text-underline-offset:3px}
.cwf-link:hover{color:var(--w-text)}
.cwf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,

  // ── 窄面板：单列 ──
  `@container(max-width:900px){.cwf-main{grid-template-columns:1fr;overflow:auto}.cwf-left{border-right:0;border-bottom:1px solid var(--w-line);min-height:320px}.cwf-right{overflow:visible}.cwf-stage{min-height:240px}}
@container(max-width:460px){.cwb-tabs{padding:0 14px;gap:14px}.cwf-top{padding:8px 12px}.cwf-ratios{grid-template-columns:repeat(2,1fr)}.cwf-pairs{grid-template-columns:1fr}}
@media(prefers-reduced-motion:reduce){.cwb-root *{animation:none!important;transition:none!important}}`,
].join('\n')
