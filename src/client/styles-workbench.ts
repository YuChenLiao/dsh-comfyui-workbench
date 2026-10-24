/**
 * 工作台样式。
 *
 * 设计语言对齐 DSH 宿主：所有颜色走 `--dsw-alias-*` token，字体、圆角、间距继承，
 * 深色模式下自动跟随。类名前缀 `cwb-`（工作台）/ `cwf-`（工作流），与继承来的
 * `.cfa-*`（相册）互不干扰。
 *
 * 布局用容器查询而不是媒体查询：面板可能被 dock 在很窄的侧栏里，窗口宽度不代表可用宽度。
 */
export const WORKBENCH_CSS = [
  // ── 外壳 ──
  `.cwb-root{--w-bg:var(--dsw-alias-bg-base,#fff);--w-surface:var(--dsw-alias-bg-layer-1,#f6f6f7);--w-text:var(--dsw-alias-label-primary,#1f2023);--w-muted:var(--dsw-alias-label-secondary,#6b6f76);--w-line:var(--dsw-alias-border-l3,#dcdce0);--w-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--w-danger:var(--dsw-alias-state-error-primary,#b53e3e);color:var(--w-text);font-family:inherit;font-size:var(--dsh-content-font-size,14px);line-height:1.5;height:100%;min-height:0;display:flex;flex-direction:column;container-type:inline-size;box-sizing:border-box}
.cwb-root *,.cwb-root *::before,.cwb-root *::after{box-sizing:border-box}
.cwb-root button,.cwb-root input,.cwb-root select,.cwb-root textarea{font:inherit;color:inherit}
.cwb-root :focus-visible{outline:1px solid var(--w-accent);outline-offset:2px}`,

  // ── 页签条 ──
  `.cwb-tabs{display:flex;gap:20px;padding:0 20px;border-bottom:1px solid var(--w-line);flex-shrink:0;min-height:44px;align-items:stretch}
.cwb-tab{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:0;font-size:.95em;cursor:pointer;position:relative;transition:color .12s ease}
.cwb-tab:hover{color:var(--w-text)}
.cwb-tab.on{color:var(--w-text);font-weight:500}
.cwb-tab.on::after{content:'';position:absolute;left:0;right:0;bottom:-1px;height:2px;background:var(--w-accent);border-radius:2px 2px 0 0}`,

  // ── 两栏：编辑器 + 常驻预览 ──
  `.cwb-body{flex:1;min-height:0;display:flex;flex-direction:column}
.cwf-root{flex:1;min-height:0;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,34%);gap:20px;padding:16px 20px 20px;overflow:hidden}
.cwf-editor{min-width:0;min-height:0;display:flex;flex-direction:column;gap:14px;overflow:auto;padding-right:4px;scrollbar-gutter:stable}
.cwf-side{min-width:0;min-height:0;display:flex;flex-direction:column;gap:12px}`,

  // ── 顶栏：选择器 + 模式 + 生成 ──
  `.cwf-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;flex-shrink:0}
.cwf-select{flex:1 1 220px;min-width:160px;height:34px;border-radius:8px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);padding:0 10px;font-size:.95em;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}
.cwf-select:hover{border-color:var(--w-muted)}
.cwf-modes{display:flex;gap:2px;background:var(--w-surface);border-radius:9px;padding:3px}
.cwf-mode{appearance:none;border:0;background:transparent;color:var(--w-muted);font-size:.85em;padding:5px 11px;border-radius:7px;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.cwf-mode:hover{color:var(--w-text)}
.cwf-mode.on{background:var(--w-bg);color:var(--w-text);box-shadow:0 1px 2px #0001}
.cwf-run{appearance:none;border:1px solid transparent;background:var(--w-accent);color:var(--dsw-alias-label-primary-foreground,#fff);font-size:.95em;font-weight:500;padding:8px 18px;border-radius:8px;cursor:pointer;min-height:34px;transition:background-color .12s ease,opacity .12s ease}
.cwf-run:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover,#3c55db)}
.cwf-run:disabled{opacity:.45;cursor:not-allowed}`,

  // ── 说明与提示 ──
  `.cwf-desc{margin:0;color:var(--w-muted);font-size:.88em;line-height:1.6}
.cwf-desc-weak{color:var(--w-muted);font-style:italic;opacity:.85}
.cwf-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;text-align:center;color:var(--w-muted);padding:48px 24px}
.cwf-empty-title{color:var(--w-text);font-size:1.05em}
.cwf-notice{flex-shrink:0;padding:8px 12px;border-radius:8px;background:var(--w-surface);border:1px solid var(--w-line);font-size:.88em;display:flex;gap:8px;align-items:center}
.cwf-notice.err{color:var(--w-danger)}
.cwf-warn{display:flex;align-items:flex-start;gap:8px;flex-wrap:wrap;padding:10px 12px;border:1px solid var(--w-line);border-left:3px solid var(--w-danger);border-radius:8px;background:var(--w-surface);font-size:.86em;line-height:1.6;color:var(--w-text)}
.cwf-warn svg{color:var(--w-danger);flex-shrink:0;margin-top:2px}
.cwf-warn-hint{color:var(--w-muted);flex-basis:100%}`,

  // ── 表单 ──
  `.cwf-form{display:flex;flex-direction:column;gap:16px}
.cwf-field{display:flex;flex-direction:column;gap:6px;min-width:0}
.cwf-field-label{display:flex;align-items:center;gap:6px;font-size:.88em;color:var(--w-muted);min-height:18px}
.cwf-field-label>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwf-req{color:var(--w-danger);font-weight:600}
.cwf-input{width:100%;min-width:0;border-radius:8px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.95em;padding:8px 10px;transition:border-color .12s ease,background-color .12s ease}
.cwf-input:hover{border-color:var(--w-muted)}
.cwf-input:focus{border-color:var(--w-accent);background:var(--w-bg);outline:none}
textarea.cwf-input{resize:vertical;min-height:96px;line-height:1.7}
.cwf-hint{font-size:.82em;color:var(--w-muted)}
.cwf-hint-err{color:var(--w-danger)}
.cwf-grid2{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}`,

  // ── 图片上传 ──
  `.cwf-drop{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:132px;padding:16px;border:1.5px dashed var(--w-line);border-radius:12px;background:var(--w-surface);cursor:pointer;text-align:center;transition:border-color .14s ease,background-color .14s ease}
.cwf-drop:hover{border-color:var(--w-muted);background:var(--dsw-alias-interactive-bg-hover,var(--w-surface))}
.cwf-drop.over{border-color:var(--w-accent);background:var(--w-bg)}
.cwf-drop.busy{opacity:.7;cursor:progress}
.cwf-drop-icon{display:grid;place-items:center;width:38px;height:38px;border-radius:50%;background:var(--w-bg);border:1px solid var(--w-line);color:var(--w-muted)}
.cwf-drop-title{font-size:.92em;color:var(--w-text)}
.cwf-drop-hint{font-size:.82em;color:var(--w-muted)}
.cwf-picked{display:flex;align-items:center;gap:12px;border:1px solid var(--w-line);border-radius:10px;padding:8px;background:var(--w-surface);min-width:0}
.cwf-picked-thumb{width:72px;height:72px;flex-shrink:0;border-radius:6px;overflow:hidden;background:var(--w-bg);display:grid;place-items:center}
.cwf-picked-thumb img{width:100%;height:100%;object-fit:contain;display:block}
.cwf-picked-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.cwf-picked-name{font-size:.88em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cwf-picked-sub{font-size:.8em;color:var(--w-muted);font-variant-numeric:tabular-nums}
.cwf-picked-actions{display:flex;gap:4px;flex-shrink:0}
.cwf-icon-btn{appearance:none;border:0;background:transparent;color:var(--w-muted);padding:6px;border-radius:6px;cursor:pointer;display:grid;place-items:center;transition:background-color .12s ease,color .12s ease}
.cwf-icon-btn:hover{background:var(--w-bg);color:var(--w-text)}
.cwf-icon-danger:hover{color:var(--w-danger)}
.cwf-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`,

  // ── 高级参数 ──
  `.cwf-advanced{border:1px solid var(--w-line);border-radius:10px;background:var(--w-surface);overflow:hidden}
.cwf-advanced>summary{cursor:pointer;padding:10px 12px;font-size:.88em;color:var(--w-muted);list-style:none;display:flex;align-items:center;gap:6px;user-select:none;transition:color .12s ease}
.cwf-advanced>summary::-webkit-details-marker{display:none}
.cwf-advanced>summary::before{content:'';width:6px;height:6px;border-right:1.5px solid currentColor;border-bottom:1.5px solid currentColor;transform:rotate(-45deg);transition:transform .15s ease;margin-right:2px}
.cwf-advanced[open]>summary::before{transform:rotate(45deg)}
.cwf-advanced>summary:hover{color:var(--w-text)}
.cwf-advanced-body{padding:0 12px 14px;display:flex;flex-direction:column;gap:12px}`,

  // ── 预览舞台 ──
  `.cwf-preview{display:flex;flex-direction:column;gap:10px;min-height:0;flex:1}
.cwf-preview-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:.88em;color:var(--w-muted)}
.cwf-stage{flex:1;min-height:220px;border:1px solid var(--w-line);border-radius:12px;background:var(--w-surface);overflow:hidden;display:grid;place-items:center;position:relative}
.cwf-stage img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.cwf-stage-empty{display:flex;flex-direction:column;align-items:center;gap:10px;padding:24px;text-align:center;color:var(--w-muted);font-size:.88em;line-height:1.6}
.cwf-stage-empty svg{opacity:.5}
.cwf-stage-meta{position:absolute;left:8px;bottom:8px;display:flex;gap:6px;flex-wrap:wrap}
.cwf-tag{background:#131417b8;color:#fff;font-size:.78em;padding:3px 7px;border-radius:5px}
.cwf-results{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.cwf-result{margin:0;border:1px solid var(--w-line);border-radius:8px;overflow:hidden;background:var(--w-surface)}
.cwf-result img{display:block;width:100%;height:auto}
.cwf-result figcaption{font-size:.75em;color:var(--w-muted);padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}`,

  // ── 窄面板：单栏 ──
  `@container(max-width:820px){.cwf-root{grid-template-columns:1fr;overflow:auto;padding:14px 16px 18px}.cwf-editor{overflow:visible;padding-right:0}.cwf-side{min-height:320px}.cwf-stage{min-height:200px}}
@container(max-width:460px){.cwb-tabs{padding:0 14px;gap:14px}.cwf-root{padding:12px}.cwf-bar{gap:6px}.cwf-run{width:100%}}
@media(prefers-reduced-motion:reduce){.cwb-root *{animation:none!important;transition:none!important}}`,
].join('\n')
