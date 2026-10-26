/**
 * 终端面板的样式。
 *
 * 刻意用「终端」的视觉语言而不是卡片：深底、等宽、无圆角、行高紧。
 * 这不是装饰偏好 —— 日志要能被扫读，行距和字体比配色重要得多。
 */
export const TERMINAL_CSS = `
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
`
