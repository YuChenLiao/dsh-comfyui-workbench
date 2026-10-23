/**
 * 工作台新增界面的样式（页签条、工作流表单、输出区）。
 *
 * 与相册继承来的 `.cfa-*` 分开：那批是"搬过来的"，这批是新增的，
 * 各自演进时不会互相牵连。类名前缀 `cwb-`（工作台）与 `cwf-`（工作流）。
 */
export const WORKBENCH_CSS = [
  '.cwb-root{display:flex;flex-direction:column;height:100%;min-height:0}',
  '.cwb-tabs{display:flex;gap:4px;padding:6px 12px 0;border-bottom:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}',
  '.cwb-tab{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:6px 10px;border-radius:8px 8px 0 0;cursor:pointer}',
  '.cwb-tab:hover{background:var(--dsw-alias-bg-l2)}',
  '.cwb-tab.on{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-l2);font-weight:600}',
  '.cwb-body{flex:1;min-height:0;display:flex;flex-direction:column}',

  '.cwf-root{display:flex;flex-direction:column;gap:10px;padding:12px;height:100%;min-height:0;overflow:auto}',
  '.cwf-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
  '.cwf-select{flex:1 1 240px;min-width:180px;height:30px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:0 8px;font-size:13px}',
  '.cwf-modes{display:flex;gap:4px}',
  '.cwf-chip{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;padding:5px 9px;border-radius:999px;cursor:pointer}',
  '.cwf-chip.on{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-label-secondary)}',
  '.cwf-run{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-size:13px;font-weight:600;padding:6px 16px;border-radius:8px;cursor:pointer}',
  '.cwf-run:disabled{opacity:.5;cursor:default}',
  '.cwf-desc{margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}',
  '.cwf-desc-missing{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-style:italic}',
  '.cwf-form{display:flex;flex-direction:column;gap:10px}',
  '.cwf-grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}',
  '.cwf-field{display:flex;flex-direction:column;gap:4px}',
  '.cwf-field-label{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
  '.cwf-field-type{font-size:10px;opacity:.6;border:1px solid var(--dsw-alias-border-l1);padding:0 4px;border-radius:4px}',
  '.cwf-req{color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary))}',
  '.cwf-input{width:100%;box-sizing:border-box;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;padding:6px 8px;font-family:inherit;resize:vertical}',
  '.cwf-hint{font-size:11px;color:var(--dsw-alias-label-secondary);opacity:.8}',
  '.cwf-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:8px 10px}',
  '.cwf-advanced>summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);user-select:none}',
  '.cwf-advanced[open]>summary{margin-bottom:8px}',
  '.cwf-output{display:flex;flex-direction:column;gap:6px}',
  '.cwf-output-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
  '.cwf-output-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px}',
  '.cwf-out-card{margin:0;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;overflow:hidden}',
  '.cwf-out-card img{display:block;width:100%;height:auto}',
  '.cwf-out-card figcaption{font-size:10px;color:var(--dsw-alias-label-secondary);padding:3px 6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.cwf-notice{position:sticky;bottom:0;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-primary);font-size:12px}',
  '.cwf-notice.err{background:var(--dsw-alias-bg-l2);color:var(--dsw-alias-label-danger,var(--dsw-alias-label-primary));border:1px solid var(--dsw-alias-border-l1)}',
  '.cwf-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;height:100%;color:var(--dsw-alias-label-secondary);font-size:13px;text-align:center}',
].join('\n')
