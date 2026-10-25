# dsh-comfyui-workbench

给 [DSH](https://github.com/deepseek-ai) 的 ComfyUI 工作台：**把本机的 ComfyUI 工作流交给模型调用**，并管理"哪些工作流对模型可用"。

面向用户的界面只有两块：浏览产物（资产库）、管理提供给模型的工作流（工作流管理）。**不内置生图前端** —— 想手工出图直接开 ComfyUI 就行。

> 本插件是 [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) 的继任者，资产浏览能力从相册继承（源码同源）。两者同时启用会出现两套入口与两套删除按钮，建议卸载相册。

## 五个组件

装载在 profile 的 `cordis.patch.yml` 里，每一条都是独立的 loader entry —— 在宿主「设置 → 插件」里能看到、能单独开关。

| entry | 形态 | 职责 |
| --- | --- | --- |
| `comfyui-workbench:core` | 服务端 | 初始化共享运行时（ComfyUI 客户端 / 进程托管 / 资产索引 / 产物目录）；承载浏览器端。**name 必须是包根**，宿主只给包根装配 `exports["./client"]` |
| `comfyui-workbench:gallery` | 面板 | 资产库：列表、筛选、缩略图、删除、批量导出工作流 ZIP |
| `comfyui-workbench:workflow` | 面板 | 工作流管理：列表、`enabled` 开关、用途备注，外加 `/run`、`/config`、服务托管接口 |
| `comfyui-workbench:generate` | 工具 | `comfyui_workflow_list`、`comfyui_workflow_inspect`、`comfyui_run` |
| `comfyui-workbench:edit` | 工具 | `comfyui_workflow_edit` |

关掉某一条只影响它自己：例如关掉 `gallery`，资产库路由随之 404，工作流管理与工具照常（两个例外：批量导出工作流 ZIP 要读图与 sidecar，依赖相册；关掉 `core` 等于关掉整个插件——HTTP API 与浏览器端都会消失）。

## 安装

```sh
# 发布态
dsh plugin --profile desktop add github:YuChenLiao/dsh-comfyui-workbench

# 本地开发
dsh plugin --profile desktop add link:D:/dsh/dsh-comfyui-workbench
```

装完重启 DSH。`cordis.patch.yml` 里会插入五条 entry，配置用 YAML 锚点共享，只写一次：

```yaml
- insert:
    - id: comfyui-workbench:core
      name: dsh-comfyui-workbench
      config: &cwf
        baseUrl: http://127.0.0.1:8188
        autoStart: true
        disabledComponents: []
    - id: comfyui-workbench:gallery
      name: dsh-comfyui-workbench/gallery
      config: *cwf
    # :workflow / :generate / :edit 同理
```

## 配置

| 字段 | 说明 |
| --- | --- |
| `baseUrl` | ComfyUI 地址，默认 `http://127.0.0.1:8188` |
| `outputDir` | 产物目录。**留空则落在 `<当前工作区>/comfyui-output`**；探测不到工作区时回退到 `<插件数据目录>/outputs`（`GET /config` 的 `outputSource` 会显示 `data`，`workspaceProbe` 给出探测过程：`cwd` 是否被判为宿主内部目录、`workspaceRegistry` 服务取到几个路径）。要钉死位置就显式配置这一项 |
| `workflowsDir` | 工作流仓库，默认 `~/.dsh-comfyui-workbench/workflows` |
| `autoStart` | 探测到本机安装时是否自动拉起 ComfyUI；只停自己拉起的进程 |
| `disabledComponents` | 关掉的组件，如 `['panel.gallery']`。空数组即全开 |
| `timeoutMs` | 单次 HTTP 请求超时，同时是 `comfyui_run` 的默认等待上限 |
| `pollIntervalMs` | 执行状态轮询间隔 |
| `roots` | 额外纳入资产库的目录（默认已含当前工作区、`dsh-comfyui-image` 的 `outputDir`、产物目录） |
| `assetRoots` | 额外的**可写**根。`assertWritable` 取的是全部授权根的合集（`roots` / 工作区 / cwd / 产物目录 / uploads / assetRoots），只有落在合集之外才拒绝写入 |

## 模型工具

| 工具 | 作用 |
| --- | --- |
| `comfyui_workflow_list` | 列出**可用的**工作流：id、标题、用途备注、底模、输入种类、输出形状。被停用的不列出（`hiddenCount` 告知藏了几条）。拿不到 `/object_info` 时不标缺模型，避免把"离线"说成"缺模型" |
| `comfyui_workflow_inspect` | 不传 `nodeId` 给 IO 面与节点清单；传了给单节点完整配置。顺带报告缺节点、缺模型与可用的替代 |
| `comfyui_run` | **默认异步**：提交后立即返回 `promptId`，后台盯着并在出图后主动通知对话。支持 `wait: true` 同步等、`promptId` 续查。停用的工作流直接拒绝 |
| `comfyui_workflow_edit` | 改标题 / 说明 / 标签，以及单节点参数。默认只影响下一次运行，写回模板需 `persist` + `expectHash`。被变量绑定的参数不能在这里改（会报 `param_bound`），变量请经 `comfyui_run` 的 `vars` 传 |

工作流的"可用"由 `<id>.meta.json` 的 `enabled` 决定（缺省 `true`），面板与 `comfyui_workflow_edit` 写同一份文件。

## 产物与通知

- 产物默认写入 `<当前工作区>/comfyui-output`，主产物旁写一份 `<文件>.json` sidecar（提示词、seed、工作流、原始尺寸、promptId）；一次出多张时只有第一张带 sidecar。
- 图片**只给路径与原始像素尺寸**，不内联字节：宿主会按 `{type:'image', attachment}` 重建请求，裸 base64 会抛错并污染该会话的后续请求。
- 出图完成后由插件主动通知对话（`Agent.followup`，来源 `plugin:dsh-comfyui-workbench`）；完成 / 失败 / 超时三条路径都只投递一次。

## 目录结构

```
src/components/panel-gallery/     相册：server/(路由/扫描/索引/缩略图) + client/
src/components/panel-workflow/    工作流管理：server/(路由/运行/配置) + client/
src/components/tool-generate/     生图工具
src/components/tool-workflow-edit/ 工作流编辑工具
src/shared/                       公用逻辑：host / comfy / workflow / run / tools / http / authz / media
src/http/                         HTTP 前缀与分派（router）
src/client/                       UI 外壳：页签、api、i18n、图标
src/index.ts                      包根入口（承载浏览器端 + 初始化共享运行时）
src/entries/                      四个组件 entry 的入口（core 即 src/index.ts）
src/runtime.ts                    跨 entry 共享的运行时（锚点挂在 ctx.root 上）
```

`npm test` 的首项（`node tests/arch.mjs`）会强制三条边界：`shared` 内部单向（host 最底）、组件 `server` 不依赖任何 `client`、外壳公共模块不依赖具体组件。

## 开发

```sh
npm install
npm run build      # src → lib/index.js（宿主）+ lib/client.js（浏览器）+ lib/entries/*.js + lib/{workflow,store,run,comfy}.js（测试用）
npm test           # 架构 + 类名 + 宿主接口 + 客户端渲染 + 通知 + 组件隔离
npm run typecheck
npm run accept     # 对着跑着的 DSH 逐条打勾（真实环境验收）；-- --run 会跑一次完整出图
node scripts/compat.mjs   # 工作流兼容性扫描：缺节点 / 缺模型 / 需选图
```

`node scripts/smoke-workflows.mjs` 逐个真跑工作流（参数压到 512 长边、1 步），只验证"能提交、能出图、能取回"。

导入工作流：`node scripts/import.mjs <workflow.json>`（`--list` 看已有）。只接受 API 格式 —— UI 格式请在 ComfyUI 里用 Export (API)。

## 兼容

| 插件 | 关系 |
| --- | --- |
| [`dsh-comfyui-image`](https://github.com/wbb316/dsh-comfyui-image) | **配套**：读它落盘的图片与 sidecar，以及它配置里的 `outputDir`。不 import 它的代码 |
| [`dsh-better-sidebar`](https://github.com/omdsh-dev/DSH-better-sidebar) | **可选**：注册页签；没装不影响原生侧栏入口。页签需在侧栏「+」菜单里添加一次 |
| [`dsh-comfyui-album`](https://github.com/YuChenLiao/dsh-comfyui-album) | **前身**：建议卸载。迁移：`node scripts/migrate-album.mjs --write` |

## 文档

- 设计方案：[docs/design.md](docs/design.md)
- 变更记录：[CHANGELOG.md](CHANGELOG.md)

## License

MIT
