# dsh-comfyui-workbench

> **这是 [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) 的继任者。**
> 资产浏览与管理能力从相册继承过来（源码同源），工作流执行、资产谱系与新界面正在 0.1 里补齐。相册在 0.1 完成后退役。

## 当前状态

`0.1.0-dev`：能力等价于相册 0.1.6 的全部功能，工作流部分尚未合入。

已具备：

- 侧边栏入口 + 主面板；装了 `dsh-better-sidebar` 时注册成页签（`comfyui-workbench:assets`），没装则安静缺席。
- 搜索、根目录筛选、仅生成图、分页加载、手动重新扫描。
- 悬浮菜单：复制图片、复制提示词、导出工作流、加入当前对话、删除。
- 灯箱：缩放、适应窗口、←→ 翻页、ESC 关闭。
- 多选：全选 / 清除 / 批量导出工作流（ZIP）/ 批量删除。
- 同图副本合并（按 seed + 尺寸 + 提示词签名，不做内容哈希，避免编码差异漏合并）。
- 元数据：优先读同名 `<文件>.json` sidecar，缺失时回退 PNG 内嵌工作流。

工作流能力（0.1 已落地）：

- **导入任意 API 格式工作流**：`dsh workbench import <file>`（或直接放进 `~/.dsh-comfyui-workbench/workflows/`）。UI 格式会被拒绝并提示用 ComfyUI 的 Export (API)。
- **IO 面推断**：把几十 KB 的节点图压成"输入 + 输出 + 模型"。连线不算旋钮、模型名/vae/batch_size 不进输入、正负提示词按采样器连线自动命名。
- **只展示输入输出**：`basic` 段只放提示词与图像输入，`seed/steps/cfg` 等折进"更多参数"。
- **四个模型工具**：`comfyui_workflow_list`（含底模名与作用备注）、`comfyui_workflow_inspect`（不传 nodeId 给 IO 面与节点清单，传了给单节点完整配置）、`comfyui_run`、`comfyui_workflow_edit`（默认只影响下一次运行，写模板需 `persist` + `expectHash`）。
- **执行链**：节点预检（缺节点在提交前失败）→ 提交 → 轮询 → 超时必发 `/interrupt` → 遍历 `history.outputs` 取产物 → 写 sidecar（`dsh-comfyui-image` 字段超集）。
- **图片随工具响应返回**，并在文本里声明**原始像素尺寸** —— 只给压缩图会让模型以为原图就那么小，下一轮按错的尺寸设参数。
- **资产索引**：JSONL，可删可重建（真源是产物旁的 sidecar）；`GET /assets` 支持 q / workflow / tag / kind / status / 游标分页。

0.2 计划：

- 客户端工作流表单（只有输入输出）、工作流选择器。
- 两条对话回路：参考图转提示词、点生成即入对话。
- ComfyUI 服务托管（自动检测、按需拉起）。
- better-sidebar 页签、相册迁移与卸载。

## 兼容插件

| 插件 | 关系 | 仓库 |
| --- | --- | --- |
| `dsh-comfyui-image` | **配套**：读取它落盘的图片与 `<图片>.json` sidecar，以及它配置里的 `outputDir`。不 import 它的代码，它升级不会拖垮本插件；没装时资产库只会是空的。 | [wbb316/dsh-comfyui-image](https://github.com/wbb316/dsh-comfyui-image) |
| `dsh-better-sidebar` | **可选**：检测到 `ctx.betterSidebar` 服务时注册页签；没装时静默缺席，不影响原生侧边栏入口。 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) |
| `dsh-comfyui-album` | **前身**：本插件 ship 后建议卸载。两者同时启用会出现两套入口与两套删除按钮，不推荐。 | [YuChenLiao/dsh-comfyui-album](https://github.com/YuChenLiao/dsh-comfyui-album) |

## 安装

```sh
# 发布态
dsh plugin --profile desktop add github:YuChenLiao/dsh-comfyui-workbench

# 本地开发（指向本仓库目录）
dsh plugin --profile desktop add link:D:/dsh/dsh-comfyui-workbench
```

装完重启 DSH；运行中的 dsh 也可在「设置 → 插件」里启用。

## 配置

在 profile 的 `cordis.patch.yml` 里给装载行加 `config`：

```yaml
- id: comfyui-workbench
  name: dsh-comfyui-workbench
  config:
    roots: []          # 额外纳入资产库的目录（绝对路径）
    maxDepth: 3        # 扫描深度
    maxItems: 4000     # 单根目录收集上限
    cacheMs: 4000      # 列表缓存毫秒数
    includeHidden: false
```

资产库的扫描根默认已包含：当前工作目录、全部 workspace、`~/.dsh-comfyui-image/config.json` 里的 `outputDir`、进程 cwd。

## 开发

全部源码用 TypeScript 编写，按域分目录；产物由 esbuild 打成两个单文件。

```sh
npm install          # 只装构建期依赖（typescript / esbuild / @types/*）
npm run typecheck    # tsc --noEmit
npm run build        # src/ → lib/index.js（宿主）+ lib/client.js（浏览器）
npm test             # 架构 + 静态 + 宿主接口 + 客户端渲染
npm run check        # typecheck + test
```

分层与依赖方向（`npm run arch` 会强制检查，反向依赖直接失败）：

```text
src/scan/     只读磁盘与 PNG 内嵌元数据      依赖：node:*
src/host/     宿主最小面、logger、配置        依赖：node:*
src/assets/   授权、扫描缓存、缩略图、去重、ZIP  依赖：scan / host
src/http/     解析请求 → 调 service → 响应     依赖：assets / scan / host
src/index.ts  装配                           依赖：全部
src/client/   浏览器侧组件与 hook            依赖：react（由宿主注入）
```

客户端产物是 `window.__ModuleLoader__.load({ factory })` 形态，文件里没有任何 ESM import ——
所以它既能在浏览器里跑，也能被 node 直接 import 做 SSR 自检（`tests/render.mjs` 就是这么用的）。

## License

MIT
