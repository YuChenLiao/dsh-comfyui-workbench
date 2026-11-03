/**
 * 标签面板的样式。
 *
 * 沿用工作台那套 `--w-*` 变量，不另起一套主题 —— 面板是同一个壳里的一个页签，
 * 换配色会让它看起来像另一个应用。
 */
export const TAGS_CSS = `
.ctg-root{display:flex;flex-direction:column;gap:10px;padding:14px 20px 24px;min-height:0;height:100%;overflow:auto}
.ctg-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.ctg-title{font-size:1.02em;font-weight:600}
.ctg-sub{font-size:.8em;color:var(--w-muted);margin-top:2px}
.ctg-search{display:flex;gap:8px}
.ctg-input{flex:1;min-width:0;border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.9em;padding:8px 10px}
.ctg-input:focus{border-color:var(--w-accent);outline:none}
.ctg-input::placeholder{color:var(--w-muted)}
.ctg-select{border-radius:9px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.86em;padding:8px 6px}
.ctg-chips{display:flex;flex-wrap:wrap;gap:6px}
.ctg-chip{display:inline-flex;align-items:center;gap:5px;border-radius:99px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:4px 10px;cursor:pointer;transition:border-color .12s ease,background-color .12s ease}
.ctg-chip:hover{border-color:var(--w-accent)}
.ctg-chip.on{background:var(--w-accent);border-color:var(--w-accent);color:var(--w-bg)}
.ctg-count{font-size:.85em;opacity:.72;font-variant-numeric:tabular-nums}
.ctg-error{font-size:.82em;color:var(--w-danger)}
.ctg-notice{font-size:.82em;color:var(--w-muted)}
.ctg-head-actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
.ctg-sync{border-radius:8px;border:1px solid var(--w-line);background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:5px 12px;cursor:pointer}
.ctg-sync:hover:not(:disabled){border-color:var(--w-accent)}
.ctg-sync:disabled{opacity:.6;cursor:default}
.ctg-syncbar{font-size:.8em;color:var(--w-muted);border-left:2px solid var(--w-accent);padding-left:8px}
.ctg-syncbar.bad{color:var(--w-danger);border-left-color:var(--w-danger)}
.ctg-seg{display:inline-flex;border:1px solid var(--w-line);border-radius:99px;overflow:hidden}
.ctg-seg-item{border:0;background:var(--w-surface);color:var(--w-text);font-size:.8em;padding:5px 14px;cursor:pointer}
.ctg-seg-item.on{background:var(--w-accent);color:var(--w-bg)}
.ctg-refs{display:flex;flex-direction:column;gap:10px;min-height:0}
.ctg-refs-bar{display:flex;align-items:center;justify-content:space-between;gap:10px}
.ctg-anyrating{display:inline-flex;align-items:center;gap:5px;font-size:.76em;color:var(--w-muted);cursor:pointer;margin-left:auto}
.ctg-anyrating input{margin:0;cursor:pointer}
.ctg-refs-pool{display:flex;align-items:center;gap:10px;font-size:.8em;color:var(--w-muted)}
.ctg-refs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ctg-ref{display:flex;flex-direction:column;gap:5px;border:1px solid var(--w-line);border-radius:10px;background:var(--w-surface);padding:7px;min-width:0}
.ctg-ref-thumb{display:block;border-radius:7px;overflow:hidden;background:var(--w-bg);aspect-ratio:1}
.ctg-ref-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.ctg-ref-prompt{margin:0;font-size:.74em;line-height:1.4;color:var(--w-muted);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word}
.ctg-ref-actions{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:.72em;color:var(--w-muted)}
.ctg-list{display:flex;flex-direction:column;gap:6px;min-height:0}
.ctg-row{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:center;gap:10px;border:1px solid var(--w-line);border-radius:10px;background:var(--w-surface);padding:7px 10px}
.ctg-row-main{display:flex;align-items:baseline;gap:8px;min-width:0}
.ctg-tag{font-size:.88em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctg-zh{font-size:.84em;color:var(--w-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ctg-row-meta{display:flex;align-items:center;gap:6px;font-size:.76em;color:var(--w-muted);white-space:nowrap}
.ctg-badge{border:1px solid var(--w-line);border-radius:5px;padding:0 5px;background:var(--w-bg);color:var(--w-text)}
.ctg-hot{font-variant-numeric:tabular-nums}
.ctg-alias{max-width:180px;overflow:hidden;text-overflow:ellipsis}
.ctg-copy{border-radius:7px;border:1px solid var(--w-line);background:var(--w-bg);color:var(--w-text);font-size:.76em;padding:3px 8px;cursor:pointer}
.ctg-copy:hover{border-color:var(--w-accent)}
.ctg-empty{font-size:.86em;color:var(--w-muted);padding:18px 0;text-align:center}
.ctg-more-hint{align-self:center;color:var(--w-muted);font-size:.78em;padding:6px 0 2px}
`.trim()
