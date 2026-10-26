# dsh-comfyui-workbench 设计方案 v2（评审稿）

**v2 变更**：资产管理不再另起炉灶，直接吸收 `dsh-comfyui-album` 的全部能力（源码整体搬迁），再叠加工作流执行与资产谱系。原 v1 的"与相册划清边界"整章作废。

实测基线：`dsh-comfyui-album` 0.1.6（`D:/dsh/dsh-plugin-comfyui-album`，共 2605 行，运行时零依赖）、`dsh-comfyui-image` 0.1.1、`dsh-better-sidebar` 0.28.0。

---

## 1. 定位

| 插件 | 关系 |
| --- | --- |
| `dsh-comfyui-album` | **被吸收的前身**。浏览与文件操作能力全量并入本插件，本插件 ship 后建议停用 |
| `dsh-comfyui-image` | 互补，不重复。它负责"一句话出图"的内置四模式；本插件负责"跑任意工作流"，且**继续复用它的配置文件** |
| `dsh-better-sidebar` | 只消费 `registerTab` 服务，不修改 |

包名取 `dsh-comfyui-workbench`（与 `dsh-comfyui-album` 同风格，不加 `plugin-` 前缀）。

本插件 = **相册（浏览 + 文件操作）+ 工作流执行 + 资产谱系**。仍然不做：图片生成参数编排、ComfyUI 前端界面复刻、模型下载、跨机同步。

---

## 2. 源码搬迁工程

### 2.1 搬什么

| 源文件 | 行数 | 处理 |
| --- | --- | --- |
| `index.js` | 825 | 整体搬，改前缀/命名/根目录解析，权限校验扩展 |
| `client.js` | 1318 | 整体搬，改 `API` 常量/面板 id/tab id，DICT 增补新页词条 |
| `lib/scan.js` | 462 | **原样搬，一行不改** |
| `tests/{lint,smoke,render}.mjs` | — | 原样搬，改路径常量后必须全绿 |

`scan.js` 一字不改是有意的：它包含 `readMeta`（sidecar 优先 → 回退 PNG tEXt chunk → 解析 workflow 图）、`collectImages`（深度/数量上限、SKIP_DIRS）、`toListItem`、`metaSummary`、`readFullSidecar`。这套逻辑解决的是"元数据既可能来自 sidecar，也可能内嵌在 PNG 里"这个真实分布，重写只会引入回归。

### 2.2 必改项（逐项）

| # | 位置 | 改动 | 不改会怎样 |
| --- | --- | --- | --- |
| 1 | `index.js:44` `PREFIX` | `'/comfyui-album/api'` → `'/comfyui-workbench/api'` | 与旧插件抢同一前缀，两者同时启用时路由互相覆盖 |
| 2 | `client.js:17` `API` | 同步改前缀 | 前端全部 404 |
| 3 | `client.js` `PANEL_ID` / `GALLERY_TAB_ID` | `comfyui-album` → `comfyui-workbench`；tab id → `comfyui-workbench:assets` | `main` 面板 key 与 panellist id 对齐关系断裂，点击图标切不过去 |
| 4 | `index.js` `name` 导出 | 改包名 | loader 行 id 与包名不一致 |
| 5 | `cordis.patch.yml` | 重写装载行 + 合并配置项（见 §6） | 装上去没有挂载声明 |
| 6 | `package.json` | 改 name/exports/files/meta/icon；`files` 必须含 `lib/`、`client.js`、`cordis.patch.yml` | 发布后缺文件，装上去即失效 |
| 7 | `rootsOf()` | 追加本插件 `outputDir` 与 `assetRoots`；**保留** `comfyOutputDir()` | 见 §2.3 |
| 8 | `isAuthorized()` | 扩展为"源与目标都校验" | 见 §2.4 |
| 9 | `thumbDir()` | `dsh-comfyui-album-thumbs` → `dsh-comfyui-workbench-thumbs` | 与旧插件共用缩略图目录，缓存 key 不冲突但清理会互相影响 |
| 10 | `routes` 表 | 保留原 8 个，新增 `/runs`、`/run`、`/workflows-list`、`/assets` 等 | — |
| 11 | `client.js` 末尾 `__test` | 保留并扩展导出 | `tests/render.mjs` 靠它挂组件，丢了渲染测试就废 |

保留不动：错误响应形状 `{ok, error, message}`、405/404 语义、`buildZip`（自建 ZIP，无第三方依赖）、`scanCache` 的 LRU 上限、`readJsonBody` 的体积限制、`pathsFromBody` 的 1–500 条上限。

### 2.3 输出目录继续读旧配置，不复制

`index.js` 的 `comfyOutputDir()` 读的是 `~/.dsh-comfyui-image/config.json` 的 `outputDir`。**必须保留这个读取，不要改成读本插件自己的 config**。

理由：用户已经在那份文件里配好了输出目录。复制一份配置意味着两处会漂移 —— 用户在 `dsh-comfyui-image` 里改了目录，本插件仍在旧目录扫，表现为"新图不见了"。本插件的配置只做**追加**（`assetRoots`、自己的 `outputDir`），不覆盖既有来源。

`rootsOf` 的最终来源顺序保持相册原样，末尾追加两条：

```text
custom(settings.roots) → workingDirectory → workspaceRegistry.list()
→ ~/.dsh-comfyui-image/config.json 的 outputDir → process.cwd()
→ 本插件 outputDir → assetRoots
```

去重仍按路径比较（`canonical()` 后交给 `foldPathCase`：Windows 折叠大小写、其余平台原样），缓存 2 秒。

### 2.4 权限校验必须扩展到目标路径

相册的 `isAuthorized(target, roots)` 只校验**读/删的源路径**（canonical 后前缀匹配，含 `\0` 拒绝）。本插件多了两类写：

- `archive`：把文件移到 `<root>/.archive/`
- `rerun`：向 `outputDir` 写新文件

两者都是"目标路径"写操作，必须同样过 `isAuthorized`。只校验源等于给路径穿越开后门：`{"path": "D:/dsh/a.png", "dest": "C:/Windows/x.png"}` 会被放行。

配套：`.archive` 目录必须加进 `SKIP_DIRS`，否则归档的文件会被下一次扫描重新收进列表，用户以为归档没生效。

### 2.5 去重算法保留原样，不要换成 sha256

相册的 `duplicateKey(item)` 是 `seed|WxH|prompt.slice(0,160)`，无 seed 不参与合并。这个签名解决的是真实分布：ComfyUI 自己存一份（`moss_8step_00017_.png`），插件另存一份（`comfyui-….png`），两图 seed/尺寸/提示词全同、字节不同。

**换成内容哈希会漏合并** —— 同图经不同编码或后处理后字节不同，哈希不同，用户就会看到两张并排的"重复图"。所以：

- 逻辑判同（列表合并、同组删除）：沿用 `duplicateKey`
- 物理判同（跨 run 判重、产物 digest 展示）：用 `sha256[:12]`

两者并存，不互相替代。这也是 v1 里我写 digest 时没交代清楚的地方。

### 2.6 命名冲突与新路由

新增路由（写操作，方法与权限同 `/delete` 一致）：

| 路由 | 方法 | 作用 |
| --- | --- | --- |
| `/runs` | GET | 执行记录分页列表 |
| `/run` | POST | 提交一次运行（见 §3） |
| `/run/:id` | GET | 单次运行状态与结果 |
| `/archive` | POST | 归档 / 反归档 |
| `/tag` | POST | 改标签（写 sidecar + 索引） |

冲突处理：`/delete` 与 `/delete-many` 的语义不变（删文件 + sidecar + 同组副本 + 缩略图，不进回收站），前端文案与二次确认一并搬过来，不要出现两套删除语义。

---

## 3. 工作流调用

### 3.1 触发

三条入口共用宿主服务：模型工具 `comfyui_run`、客户端 `POST /comfyui-workbench/api/run`、只读查询。宿主侧单实例串行队列（ComfyUI 单卡排队无并发收益，且串行保证 `/interrupt` 取消的一定是自己那条）。

### 3.2 输入

```ts
interface RunInput {
  workflow: { id: string } | { path: string }
  vars?: Record<string, string | number | boolean>
  outputPath?: string
  tags?: string[]
  wait?: boolean          // 默认 true
  timeoutMs?: number      // 默认 300000
  /** 已弃用，字段保留以兼容旧调用：工具响应不能承载图片字节，图片一律只给路径。见 §3.3。 */
  returnImages?: 'first' | 'all' | 'none'
}
```

`vars` 的键对应 IO 面的输入名。解析顺序：槽位声明了 `bind`（`'6.inputs.text'`）就走节点路径替换，否则退回全模板 `{{name}}` 文本替换（见 §3.6–3.8）。

变量替换沿用 `{{name}}` 并按值替换，禁止 `JSON.stringify` 后字符串替换 —— `dsh-comfyui-image` 已踩过：`"{{width}}"` 会变成 `"256"`，数字退化字符串，ComfyUI 拒整个工作流（`src/comfy/workflows.ts:288` 的注释有完整记录）。未绑定变量默认报错并列出名字（`strictVars: true`），可关。

### 3.3 输出

```ts
interface RunResult {
  ok: boolean
  runId: string
  promptId?: string
  comfyUrl: string
  workflowId: string
  workflowHash: string
  vars: Record<string, unknown>
  artifacts: Array<{ path: string; digest: string; mime: string; bytes: number; width?: number; height?: number }>
  durationMs: number
  notes: string[]
  error?: { code: ErrorCode; message: string; hint?: string; detail?: unknown }
}
```

**图片只给路径，不进工具响应（内联方案已废弃）。**

现行行为：`comfyui_run` 的响应是纯文本 —— 每个产物的路径、MIME、体积、**原始**像素尺寸。模型要看图就按返回的路径读原图；UI 侧的图片展示走插件自己的 HTTP 路由，与工具响应无关。

早先的实现把产物按 MCP 风格塞成 `{ type: 'image', data, mimeType }` 块，理由是"模型不必再 read 一次文件，宿主不支持就忽略"。实测不是忽略，是崩：宿主把工具结果的每个块当结构化内容重建模型请求，`image` 块必须携带附件引用（attachment），裸 base64 会让请求装配读到空 attachment 而抛错，被 LLM 适配器包装成 `TRANSPORT`。该块一旦落进会话历史就永久生效 —— 一次 `comfyui_run` 之后，这个会话每次请求都失败（重试全灭，重进会话仍只报 `TRANSPORT`），只能改历史数据才救得回来。

因此：

| 项 | 规则 |
| --- | --- |
| 块类型 | 工具响应只允许 `text`；`ToolBlock = ToolText`，类型上就不存在图片块 |
| 尺寸声明 | `artifacts[].width/height` 永远是**原始**像素，不是压缩后的 |
| 图片交付 | 只给 `artifacts[].path`；后续 img2img / inpaint / 超分必须用这个路径指向原图 |

路径才是真源：资产落在 `outputDir`，可检索、可重跑。展示交给 Web 端（缩略图走插件 HTTP 路由），不再往模型上下文里塞字节。

### 3.4 预检与产物发现

`WorkflowDefinition.requiredNodes` 在提交前用 `GET /object_info` 预检，把"排队 40 秒、跑到第 8 个节点才发现缺自定义节点"提前成提交前报错。`/object_info` 可达数 MB，进程内缓存，只由用户显式刷新。

产物发现不按节点名匹配：遍历 `/history/{id}.outputs` 所有键，凡值形如 `{filename, subfolder, type}` 或数组者视为产物。这样 SaveImage / PreviewImage / VHS_VideoCombine / 自定义 3D 节点都能覆盖。

### 3.5 异常处理

| code | 触发 | hint 方向 | 可重试 |
| --- | --- | --- | --- |
| `comfy_unreachable` | 连不上 / DNS 失败，且自动拉起失败 | 给出实际 URL、已探测的安装路径列表、拉起失败原因、上游下载地址（见 §3.16） | 是 |
| `auth_failed` | 401 / 403 | 指向 `headers` | 否 |
| `workflow_invalid` | 模板非 JSON 对象、非法 class_type | 指出节点 id | 否 |
| `variable_unbound` | `strictVars` 下缺必填变量 | 列出全部缺失名 | 否 |
| `node_missing` | `/object_info` 未命中 `requiredNodes` | 列出缺失 class_type | 否 |
| `submit_rejected` | `POST /prompt` 400，body 含 `node_errors` | 原样附 node_id 与消息 | 否 |
| `execution_failed` | `/history` 的 `status.messages` 含 `execution_error` | 附异常节点与堆栈首行 | 否 |
| `no_output` | 执行成功但 `outputs` 无文件引用 | 提示末端缺输出节点 | 否 |
| `output_unreadable` | `/view` 失败或 0 字节 | 附完整 query | 是 |
| `timeout` | 超 `timeoutMs` | **必须已发 `POST /interrupt`**，附 promptId | 是 |
| `cancelled` | 用户取消 | — | 是 |

超时必发 `/interrupt` 是硬要求，否则队列被已放弃的任务堵住，下一次运行莫名排队。`dsh-comfyui-image` 的 `comfy/client.ts` 已实现该调用，沿用。

### 3.6 视图分层：完整配置在里，只展示 IO 在外面

一条工作流的 API 格式 JSON 动辄几十 KB（SDXL 基础图 15–40 KB，带自定义节点更多）。这个体量对**任何**读者都是负担：塞进模型上下文会挤掉真实工作内容，糊到 UI 上则没人看得懂。

所以分三层，同一份真源、三个粒度：

| 层 | 谁能读 | 拿到什么 | 用途 |
| --- | --- | --- | --- |
| 完整配置 | 宿主内部（runner / 预检 / 执行） | 原样 API JSON + 全部节点、连线、`widgets_values` | 提交给 ComfyUI |
| IO 面（`WorkflowIOSurface`） | 模型工具、客户端 UI | 输入槽位 + 输出槽位 + 摘要 | 模型决定怎么填；UI 渲染表单 |
| 节点视图（按需） | 模型工具（`detail: 'nodes'`） | 节点 id / class_type / 连线拓扑 | 排查"为什么这个参数改不动" |

关键判断：**"dsh 能读详细配置"不等于"默认把详细配置交给模型"**。模型默认拿 IO 面；要看拓扑时显式要。否则一个"帮我跑一下超分"的请求会先烧掉几十 KB 上下文去读节点图。

### 3.7 IO 面数据结构

```ts
/** 两端共用的精简契约：UI 渲染它，模型阅读它。 */
interface WorkflowIOSurface {
  workflowId: string
  title: string
  /** 一句话说明这工作流做什么（超分 / 上色 / 换背景）。缺了它模型面对 prompt 无从下手。 */
  description: string
  /** 与完整配置绑定：模板一变 hash 就变，IO 面缓存同步失效。 */
  workflowHash: string
  /** 工作流引用的模型。用户和模型都靠它区分"同名但不同底模"的工作流。 */
  models: ModelRef[]
  inputs: IOSlot[]
  outputs: OutputSlot[]
  meta: {
    nodeCount: number
    /** /object_info 预检未命中的 class_type。 */
    missingNodes: string[]
    /** declared = 有人工 schema；inferred = 从模板自动推断。 */
    source: 'declared' | 'inferred'
  }
}

interface ModelRef {
  /** 模型文件名，保留 ComfyUI 里的相对路径原样（'SDXL/sd_xl_base_1.0.safetensors'）——
   *  basename 化会让同名不同目录的两个模型分不清。 */
  name: string
  /** checkpoint=底模 | diffusion=unet/扩散模型 | lora | vae | upscale=放大模型 | other */
  kind: 'checkpoint' | 'diffusion' | 'lora' | 'vae' | 'upscale' | 'other'
  /** 来源节点 id，便于在 inspect 里下钻。 */
  nodeId: string
  /** 列表里只展示 primary；多模型工作流的其余项进 others。 */
  primary?: boolean
}

interface IOSlot {
  /** 变量名，同时是 {{name}} 占位符。 */
  name: string
  /** '6.inputs.text'。有它就按节点路径精确替换；没有则退回全模板 {{name}} 文本替换。 */
  bind?: string
  /** UI 上显示的名字，默认取节点的 title，再退到 class_type.input。 */
  label: string
  type: 'string' | 'number' | 'boolean' | 'enum' | 'image' | 'mask'
  required: boolean
  default?: string | number | boolean
  min?: number
  max?: number
  step?: number
  /** type=enums 时的枚举值。 */
  options?: string[]
  /** basic 才默认展示；advanced 折进"更多参数"。 */
  group: 'basic' | 'advanced'
  hint?: string
  /** 展示打码、日志与工具输出里替换为 [redacted]。 */
  secret?: boolean
}

interface OutputSlot {
  nodeId: string
  /** outputs 里的键，如 images。 */
  key: string
  kind: 'image' | 'video' | 'audio' | 'file'
  /** 运行前是估计（'dynamic' 表示不确定），运行后以 /history 实际产物为准。 */
  count: number | 'dynamic'
  label?: string
}
```

`group` 是"只展示输入输出"的具体落地方式：默认只渲染 `basic`，`advanced` 收进折叠区。**不是丢信息，是分层** —— 用户想调采样器时它还在，只是不在第一屏。

`bind` 让两套语法统一：有 `bind` 的变量走节点路径替换（类型精确、可校验、UI 能双向映射），没有的退回 `{{name}}` 文本替换（兼容 `dsh-comfyui-image` 已有模板）。一个模板里可以两种混用。

### 3.8 IO 面怎么来：导入即压缩

手工维护两份描述必然漂移。所以 IO 面默认**自动推断**，人工 schema 只做覆盖：

```text
遍历 workflow 每个节点每个 input：
  value 是 [nodeId, slot] 连线  → 跳过（那是拓扑，不是旋钮）
  key 命中内部黑名单            → 跳过（vae / clip_skip / batch_size / 模型名…）
  → 成为候选槽位

候选归并：同名 input 合并（多节点共用 seed 只出一条）
类型推断：由字面量类型定 string / number / boolean；enum 由 schema 或 options 定
标签推断：节点 title → class_type.input → input 名
分组推断：**basic 只收"提示词"与"图像输入"** —— input 名匹配 (prompt|text|negative) 且类型为 string，
          或类型为 image / mask。其余一律 advanced（seed / steps / cfg / width / height 也进 advanced）
输出推断：末端节点（无下游连线者）+ outputs 声明 → OutputSlot
模型推断：按 class_type / input 名识别模型引用（见下），primary 优先取 checkpoint → diffusion → 首个命中
```

模型引用的识别规则（不写死节点全名，按特征匹配）：

| 特征 | kind |
| --- | --- |
| `class_type` 含 `CheckpointLoader`，取 `ckpt_name` | `checkpoint` |
| 含 `UNETLoader` / `UnetLoader`（含 GGUF 变体），取 `unet_name` | `diffusion` |
| 含 `LoraLoader`，取 `lora_name` | `lora` |
| 含 `VAELoader`，取 `vae_name` | `vae` |
| 含 `UpscaleModelLoader`，取 `model_name` | `upscale` |
| 兜底：input 名匹配 `(ckpt|checkpoint|unet|model|lora|vae).*name` 且值以 `.safetensors/.ckpt/.pt/.pth/.gguf` 结尾 | `other` |

这套遍历和相册 `scan.js:337` 的 `modelFromWorkflow` 是同一件事（它只挖底模名给列表用），可以直接把骨架扩成返回 `ModelRef[]`，而不是另写一份。

分组规则刻意从紧：用户打开一个工作流，看到的东西应该是"填提示词、选图、点运行"，而不是七个数值旋钮。`seed`/`steps`/`cfg` 是调参用的，归模型与高级模式，不进第一屏。basic 段超过 3 个槽位时按「名字命中 prompt 优先 → 有 default 优先」取前 3 个，其余下沉。

槽位提取代码和相册的 `modelFromWorkflow`（从 workflow 里挖模型名）是同一类遍历，可以直接复用其遍历骨架。

`schema.json` 只写要改的部分：

```json
{
  "title": "SDXL 四倍超分",
  "description": "对输入图片做 4x 放大，保持原构图。适合成图后处理。",
  "vars": [
    { "name": "input_image", "bind": "10.inputs.image", "type": "image", "required": true, "label": "输入图", "group": "basic" },
    { "name": "scale", "bind": "14.inputs.scale_by", "type": "number", "default": 4, "min": 1, "max": 8, "group": "basic" },
    { "name": "denoise", "bind": "14.inputs.denoise", "type": "number", "default": 0.3, "min": 0, "max": 1, "group": "advanced" }
  ],
  "internalInputs": ["vae_name", "clip_skip"]
}
```

导入命令 `dsh workbench import <path/to/workflow.json>`：解析 → 推断 → 生成 `workflows/<id>.json` + `<id>.schema.json`（带全部推断结果，人可直接改）→ 打印推断出的 IO 面供确认。**这就是"读取详细配置、产出简略版"的那一步**。

### 3.9 工具面（4 个，刻意压到 4 个）

每个工具都带固定 schema 与指引成本，进每次请求。`dsh-tool-session-query` 的教训在这里适用（memory-ledger ADR-0004）：5 个工具的固定开销值得为此设计合并。

| 工具 | 何时用 | 返回 |
| --- | --- | --- |
| `comfyui_workflow_list` | 不知道有哪些工作流，或用户没指定 | 每项：`workflowId / title / description / models(primary+kind) / inputKinds / 输入名+类型 / 输出形状 / usage`。可选 `q` 做 title+description+model 匹配。**不含节点** |
| `comfyui_workflow_inspect` | 需要看细节 | 无 `nodeId`：IO 面 + 节点清单（`id / class_type / title` 一行）+ 缺失节点；有 `nodeId`：该节点的完整配置（`inputs`、`widgets_values`、`title`、`mode`） |
| `comfyui_run` | 执行 | `RunResult`（§3.3） |
| `comfyui_workflow_edit` | 调参 / 写备注 | 改后的 IO 面与生效范围 |

`inspect` 用 `nodeId?` 一个可选参数承载"下钻到单节点"，不再另开 `node_inspect`：模型本来就是"先看清单、再点开某一个"的两跳，两跳合一个工具不影响表达力，还省一份 schema。没有 `detail` 档位 —— `nodeId` 的有无就是档位。

`edit` 把"改说明"和"改参数"收进一个入口：

```ts
interface WorkflowEditInput {
  workflowId: string
  /** 改用途备注：写进 <id>.meta.json，用户与模型都可改。 */
  notes?: {
    title?: string
    description?: string
    tags?: string[]
  }
  /** 改节点参数：默认只作用于下一次运行。 */
  patches?: Array<{
    nodeId: string
    input: string          // widgets_values 的键，或 inputs 里的字面量键
    value: string | number | boolean
  }>
  /** true 才写回模板；默认 false。见 §3.10。 */
  persist?: boolean
}
```

UI 侧只调 `GET /api/workflows?view=io`，永远拿不到完整配置 —— 前端请求里根本没有 `view=full` 这条路。浏览器端不需要节点图，给它等于把几十 KB JSON 送进 devtools 和内存。

### 3.10 参数修改的边界（这是最容易出事的一处）

模型能改参数，但改的是**运行覆盖**，不是资产：

| 问题 | 处理 |
| --- | --- |
| 模型随手改坏用户的模板 | `persist` 默认 `false`。patch 只进入下一次运行的 overrides，模板文件不动 |
| 落盘时覆盖别人刚做的修改 | `persist: true` 必须带 `expectHash`（读的时候拿到的 `workflowHash`），不匹配则拒绝并返回当前 hash |
| 改完没生效 | 该 parameter 被 `bind` 到某个变量时，改节点值会被变量替换盖掉。`patch` 检测到即报错：`param-bound`，并指出是哪个变量在控制它 |
| 改了一个不存在/连着线的输入 | 报 `param-not-editable`。连线输入的值来自上游节点，改它没有意义 |
| 类型不对 | 按 IO 面推断的类型校验：`number` 不接字符串、`enum` 校验 `options` 成员、`boolean` 不接 `"false"` |
| 改完不知道改了什么 | 每次 patch 追加一条审计：`{ at, by: 'agent'|'user', workflowId, expectHash, patches, persisted }`，写进 `runs/audit.jsonl` |
| 模型盲改 | 工具返回值里带"改前 → 改后"，并提示当前值来自 default 还是模板 |

overrides 的生效范围只有一次运行，不跨 run 累积 —— 否则模型调过一次 seed，用户之后每张图都被固定种子，且完全无感。

### 3.11 备注存储：两个来源、一个文件

用途说明由人写也由模型写，所以不能塞进人工维护的 `schema.json`（机器写入会打乱手写结构）。

`workflows/<id>.meta.json`：

```json
{
  "title": "SDXL 四倍超分",
  "description": "对输入图做 4x 放大，保持构图。适合成图后处理。",
  "tags": ["upscale", "post"],
  "updatedAt": "2026-10-23T13:50:00.000Z",
  "updatedBy": "agent"
}
```

合并优先级：`meta.json` → `schema.json` → 自动推断。两个文件都缺时 IO 面仍可用，只是 `description` 为空，此时 `comfyui_workflow_list` 会在该条目上标 `undescribed: true`，提示"这个工作流没有用途说明，模型无法判断该不该用它"。这条比让模型瞎猜便宜得多。

`updatedBy` 是溯源字段：用户看到某条说明是 `agent` 写的，就知道可以改。

### 3.12 打码规则

完整配置里可能出现敏感值：自定义节点存的 API key、模型绝对路径、内网地址。规则：

- `secret: true` 人工标记的槽位
- 键名匹配 `(api_?key|token|secret|passw(or)?d|credential|auth)` 自动命中
- 命中后在 `full` 视图里替换为 `[redacted]`，在 IO 面里显示 `••••`
- 执行时用原值（打码只作用于展示与日志，不影响提交）
- `comfyui_workflow_edit` 的 `patches` 命中 secret 字段时，返回值里同样打码；审计日志（§3.10）对 secret 只记"改过"，不记值

### 3.13 UI 呈现边界

只展示输入输出，意味着界面上没有节点图、没有连线、没有 `widgets_values`。具体形态：

- **输入区**：按 `group` 分两段。basic 段只有提示词与图像输入（§3.8 的从紧规则），直接铺开；其余全部收进"更多参数 (n)"，默认折叠。控件按 `type` 走：`string` 多行文本框、`number` 数字步进（带 min/max/step）、`enum` 下拉、`boolean` 开关。
- **用户看到的默认界面只有三样东西**：提示词输入框、可选图像输入、输出产物网格。`seed` / `steps` / `cfg` 这些不在第一屏 —— 要调就展开"更多参数"，或用自然语言让模型调。
- **image / mask 类型**：v0.1 只支持"从资产库选一张"（资产已在库里，天然有绝对路径）+ 手填绝对路径。不做文件上传 —— 相册的写接口是 `POST` JSON，没有 multipart 通道，为这个需求单独引入上传链路不划算。
- **输出区**：运行前只显示形状（"图片 ×1"）；运行后直接渲染产物缩略图，复用相册的 `Card` / `Lightbox`。
- **元信息条**：`description` + 节点数 + 缺失节点告警 + `workflowHash` 前 8 位。这些不是配置，是"这工作流可不可用"的判断依据，所以留在外面。

### 3.14 两条对话回路

用户视图里的两个主动作都不由插件自己执行，而是**把意图送进当前会话**，由模型调工具完成。这样执行路径只有一条（都要过 `comfyui_run`），产物也只有一份（工具响应里的图），不需要 UI 另开一条通道。

#### 回路 A：参考图转提示词

入口：资产卡片悬浮菜单 + 灯箱底部，按钮"转提示词"。

1. 取该资产的绝对路径（它已在库中，天然有）。
2. 把一条消息注入当前会话：附件是这张图，正文是一条固定指令模板，要求**只输出一个 `<prompt>…</prompt>` 块，块内是可直接使用的正向提示词，不要解释**。
3. 客户端订阅本会话新消息，取到 assistant 回复后抽出 `<prompt>` 块，填入表单的提示词槽位，并把该条消息标记为"已采用"，避免重复回填。
4. 标记里带上目标 `workflowId`：同一个回复不会误填到另一个工作流的表单里。

消息发送与附件入输入框这两段能力已由相册在生产环境验证，不是待确认项。唯一不确定的是**回复订阅**，所以降级只针对它：

- 拿不到消息订阅 → 消息正文改为"请把提示词贴回输入框"，用户手动复制，按钮旁给一句明确提示。
- 模型没按格式回（没有 `<prompt>` 块）→ 整条回复原样展示在弹窗里，用户可全选采用，不静默失败。
- 宿主改动了输入框结构（`findComposerEditor` 失配）→ 按钮置灰并提示"当前版本不支持，请手动粘贴"，不让用户点了没反应。

发图进会话复用相册已验证的 DOM 侧 `pasteFile` / `findComposerEditor`（`client.js:1315` 的 `__test` 里就有这两个函数，是实际在用的），不自造附件上传通道：相册的写接口是 POST JSON，没有 multipart。

#### 回路 B：生成即入对话

这是默认模式（`runMode: conversation`）。

1. UI 把表单组装成一条消息发进当前会话，正文固定格式：

```text
运行工作流 upscale-2x，参数如下（请原样传给 comfyui_run，不要自行改动或补充）：
{"workflow":"upscale-2x","vars":{"input_image":"D:/dsh/out/a.png","scale":4}}
```

2. 模型调 `comfyui_run`，工具返回 image content（§3.3），图片直接出现在对话里 —— 用户看到图、模型看到图，都是同一份响应。
3. 产物同时落 `outputDir` 并进资产索引，`Run` 记录与之关联。

参数保真不能靠模型自觉，靠两件事兜底：

- 消息里是结构化 JSON 而不是自然语言描述，减少改写空间。
- 工具返回的 `RunResult.vars` 是**实际生效值**。UI 收到后与表单快照比对，不一致就在输出区标红并列出差异（"你填的 seed=1234，实际用了 5678"）。这条比信任模型便宜。

保留 `direct` 模式（`runMode: direct`）：UI 直连 `POST /api/run`，产物落盘、网格显示，不消耗模型往返。适用于模型不可用、或用户明确只要一张图不想对话。两种模式共用同一个 runner 与同一份 `RunResult`，行为差异只在"谁发起"。

---

### 3.15 工作流选择：用户可指定，模型可挑

两边是同一份数据、两种用法：用户做**显式指定**，模型做**兜底挑选**。所以列表项的字段必须让两端都能判断，而不是只够人看。

```ts
interface WorkflowListEntry {
  workflowId: string
  title: string
  description: string                       // 作用备注；空则 undescribed: true
  undescribed?: boolean
  models: { primary: string; kind: string; others: string[] }
  inputKinds: Array<'text' | 'image' | 'mask'>   // 决策依据：这工作流吃图还是吃文本
  inputs: Array<{ name: string; type: string; required: boolean }>
  outputs: Array<{ kind: string; count: number | 'dynamic' }>
  usage: { runCount: number; lastRunAt?: string }
}
```

`inputKinds` 是给模型的机械判据，比 `description` 可靠：用户说"把这张图放大"，模型要能一眼分出"吃 image 的工作流"和"吃 text 的工作流"，而不是逐条读备注去猜。`description` 与 `models` 负责在同一类里再细分（两个都吃图的工作流，一个是超分、一个是上色；或都叫超分但底模不同）。

#### 用户侧

工作流选择器放在表单顶部，条目两行：`title`，下面一行小字 `primary model · description 摘要`。搜索框匹配 `title / description / model` 三者 —— 用户记得的往往是模型名（"那个用 UltraSharp 的"）而不是自己起的标题。

默认选中顺序：上次使用（`prefs.lastWorkflowId`）→ 只有一个工作流时自动选中 → 都没有则空态，提示"先导入工作流（`dsh workbench import <file>`）"。

切换工作流时表单按新 IO 面重渲染，**同名槽位保留已填的值**（两个工作流都有 `prompt`，用户不用重打）。

点生成前先做本地校验：`required` 且无值的槽位直接高亮，不发消息。这一步不依赖模型 —— 拿一次"忘了选输入图"的往返去问模型，成本比一个前端判断高得多。

#### 模型侧

不指定时，`comfyui_workflow_list` 是唯一入口，所以它的返回必须自足。加一个 `q` 参数（匹配 `title / description / model`）让模型能筛，不做分页：工作流数量在几十的量级，一次全给比翻页省往返。

选择失败的兜底：清单非空但模型挑错（例如把超分当文生图跑），工具侧会在缺 `required` 输入时报 `variable_unbound` 并列出缺失名 —— 提示里会带上该工作流 `inputKinds`，模型能据此纠错重选，而不是反复同一个错。

#### 工作流保真

用户显式指定后，模型不应改选。消息正文里写明"用户已指定工作流 `X`，不要替换"，但**不能只靠这句**：`comfyui_run` 返回的 `RunResult.workflowId` 与用户指定值不一致时，UI 输出区标红并列出「你选的是 A（底模 M1），实际跑了 B（底模 M2）」。与 §3.14 的参数保真合并成同一条一致性检查：**工作流与参数都要跟用户所见对齐**。

---

### 3.16 ComfyUI 服务托管：自动检测、按需拉起

地址由用户在设置里填，但默认不要求填 —— 插件自己找。三种状态，行为不同：

| 状态 | 判定 | 行为 |
| --- | --- | --- |
| 外部在跑 | `GET /system_stats` 在 `baseUrl` 上应答 | 只用，不托管。**永不停止它** —— 进程可能是用户或别的工具起的 |
| 未跑但已安装 | 探到安装目录（含 `main.py` 且有 `models/`） | 按需拉起，就绪后使用；空闲后只停自己拉起的那一个 |
| 未跑且未安装 | 探测全部失败 | 不重试、不猜端口，直接 `comfy_unreachable` 并给出下载地址与手动填写指引 |

探测与拉起顺序：

```text
1. 探 baseUrl（默认 http://127.0.0.1:8188）的 /system_stats，500ms 超时
2. 不活 → 扫安装候选：COMFYUI_HOME / COMFYUI_PATH → 上次成功路径（comfyui.json）→
   用户主目录、%LOCALAPPDATA%、各盘根下的 ComfyUI* 目录（深 2 层）
3. 命中 → 选解释器（目录内 venv/python_embeded 优先 → PATH 里的 python）
        → 拉起 `main.py --port <baseUrl 的端口>`
4. 轮询 /system_stats 直到就绪（默认上限 180s，ComfyUI 冷启比模型服务慢）
5. 拉起后仍不通 → comfy_unreachable，hint 附完整探测记录
```

状态机：`unknown → probing → external | starting → ready | failed`。`starting` 期间到达的运行请求**排队等待**而不是立即失败 —— 用户点生成时服务正在冷启，直接报错是最差的体验。

硬约束（`dsh-plugin-strata` 已踩过并验证过这几条，直接沿用）：

- 只停**自己拉起的**进程，用 pid + 启动时间双重校验，不用端口反查。
- 懒启动：dsh 装载时不拉，第一次真正要用时才拉。
- 空闲回收：默认 300s（`idleShutdownMs`），0 表示不回收。
- 托管能力依赖宿主 `subprocess` 服务，用 `ctx.inject` 可选装载；该 profile 没有它时插件照常工作，只是不托管（降级为"只看外部实例"）。
- `comfy_unreachable` 的 hint 必须带探测记录，否则用户不知道插件到底找过哪些地方。

配置面：

```yaml
    baseUrl: http://127.0.0.1:8188   # 设置里的输入框写这里
    autoDetect: true                 # 探安装位置
    autoStart: true                  # 按需拉起
    startCommand: []                 # 特殊情况才填：["D:/ComfyUI/venv/Scripts/python.exe","D:/ComfyUI/main.py","--port","8188"]（该模式不自动设 cwd，实际继承 dsh 进程的 cwd）
    readyTimeoutMs: 180000
    idleShutdownMs: 300000
```

---

---

## 4. 资产管理（吸收相册 + 谱系）

### 4.1 对象

| 对象 | 定义 | 身份 |
| --- | --- | --- |
| `Artifact` | 产物文件（图片为主，兼容 video/audio/file），**原地不动** | `duplicateKey`（逻辑）+ `sha256[:12]`（物理） |
| `Workflow` | API 格式模板 + 变量声明 | `id` + `hash` |
| `Run` | 一次执行：模板、绑定值、ComfyUI 地址、耗时、产物、错误 | `runId` |

`Run` 是 `Artifact` 的父，`Workflow` 是 `Run` 的输入。任意图片都能回答"哪个模板、哪组参数、哪台 ComfyUI 产出的"。

**仍不搬移产物**。v1 的理由（不与相册争所有权）随吸收而消失，但结论保留，理由换成：绝对路径已经被引用过（对话记录、git、其它工具），搬移会打断这些引用。归档是显式动作，不是默认行为。

### 4.2 能力继承清单（相册原样保留）

后端：`/roots` 根目录枚举、`/items` 分页列表（含深度/数量上限、`onlyGenerated` 过滤、`dedupeItems` 合并同组副本）、`/meta` 单图完整元数据、`/workflow` 单图工作流、`/file` 字节流（`?thumb=1` 走 webp 缩略图）、`/delete`、`/delete-many`、`/workflows`（批量导出 ZIP）。

客户端：搜索、根目录筛选、仅生成图、重新扫描、分页加载（60/页）、复制图片、复制提示词、导出工作流、加入当前对话、删除、合并重复副本、多选（全选/清除/批量导出/批量删除）、灯箱（缩放/适应窗口/←→ 翻页/ESC）。

新增：按 `Run` 分组视图、谱系侧栏（模板 + 绑定值 + 耗时 + promptId）、重跑、标签、归档。

### 4.3 存储

```text
~/.dsh-comfyui-workbench/
  config.json                 # 可选，优先级低于 profile 配置
  index.db                    # node:sqlite，可删可重建
  workflows/<id>.json         # API 格式模板（含 {{var}}）
  workflows/<id>.schema.json  # 变量声明
  runs/<runId>.json           # 执行记录 + 完整 workflow 快照
  thumbs/                     # 可选：替代 os.tmpdir()
```

sidecar `<产物>.json` 是主，索引是派生（`digest`/`path`/`mtime`/`bytes`/`workflowId`/`createdAt`/`tags`/`status` 等可查询列 + 指回 sidecar）。索引删了能重建，不含不可再生信息。

sidecar 字段是 `dsh-comfyui-image` 的超集，且 `readMeta` 的 PNG 内嵌回退保留 —— 旧图（`dsh-comfyui-image` 或外部产出）即使没有 sidecar 也能显示提示词。

### 4.4 检索

`GET /comfyui-workbench/api/assets`：`q`（FTS5 可用走 FTS5，否则扫描 sidecar）、`workflow`、`run`、`tag`（多值 AND）、`kind`、`since`/`until`、`status`（present/missing/archived）、`cursor`+`limit`（游标分页，文件会被删，offset 会跳项，限 200）。

### 4.5 生命周期

```text
登记 → 索引 → 标注 → 归档 → 删除
                ↘ missing（文件已消失，索引保留）
```

| 操作 | 行为 | 可逆 |
| --- | --- | --- |
| `register` | 登记已存在的外部文件 | — |
| `index` | 扫描 roots，按 `duplicateKey` 归组，按 `digest` 认同一文件 | — |
| `tag` | 改 sidecar 的 tags + 索引 | 可逆 |
| `archive` | 移入 `<root>/.archive/`，标 `archived` | 可逆（目标同名加时间戳后缀） |
| `delete` | 删文件 + sidecar + 同 digest 副本 + 缩略图，**不进回收站** | 不可逆，二次确认 |
| `repair` | sidecar 缺失/损坏时从 PNG 内嵌工作流回填 | 可逆 |
| `prune` | 文件已消失的行标 `missing`，不删行 | 可逆 |

删除语义与相册完全一致（文案、二次确认、`failed[]` 逐条报错一并搬），不出现第二套删除行为。

---

## 5. 与 dsh-better-sidebar 的共存

唯一契约面：`betterSidebar.registerTab(descriptor): () => void`（`lib/types/client/service.d.ts:603`）。注册形态沿用相册已验证可用的写法（`client.js:1268`）。

```ts
ctx.inject(['betterSidebar'], (scope) => {
  scope.effect(() => {
    const dispose = scope.betterSidebar.registerTab({
      id: 'comfyui-workbench:assets',
      title: () => t('title'),
      description: () => t('sidebarDescription'),
      icon: (size) => icon('workbench', size || 16),
      order: 40,                 // 沿用相册的 40，用户位置记忆不变
      single: true,
      component: AssetsTab,
    })
    return () => dispose()
  }, 'comfyui-workbench: better-sidebar tab')
})
```

边界（硬约束）：

- 只 `ctx.inject(['betterSidebar'])`，不 import 它的任何内部模块（`lib/client-registry.js`、`src/**` 一律不碰）。
- 只用 `registerTab` / `openTab` / `closeTab`；descriptor 只放 `id / title / description / icon / order / single / component` 这 7 个 `service.d.ts` 声明过的字段。`bottomOnly`(v0.26+)、`actions`(v0.25+) 一律不用。
- tab 组件只消费 `TabComponentProps`（`ctx`/`store`/`scope`/`tab`/`visible`），不读 `SidebarStore` 内部结构。
- `visible === false` 时必须暂停轮询与刷新 —— 它给外部的唯一性能契约。
- 不注册 `urlTarget`（不抢外链），不注册 `bottomOnly`（无底部工作台形态）。

冲突处理：

| 场景 | 行为 |
| --- | --- |
| better-sidebar 未装 / 被禁用 | inject 永不 resolve，不注册；只走原生面板，无异常 |
| better-sidebar 在 | 注册 tab；**不注册**原生 `sidebar.panellist`，避免左侧两个入口 |
| 用户仍装着 `dsh-comfyui-album` | 两者各自可用，但同一批文件出现两个入口、两套删除按钮。首次检测到即提示"可停用相册"，不强制禁用 |
| `registerTab` 抛错（版本不兼容） | try/catch + console.warn，降级原生面板，功能不丢 |
| `openTab({type})` 抛错 | 返回 false，UI 提示"请在左侧面板查看" |

---

## 6. 配置

```yaml
- id: comfyui-workbench
  name: dsh-comfyui-workbench
  config:
    # —— 相册原有，语义不变 ——
    roots: []                 # 额外扫描根（绝对路径）
    maxDepth: 3
    maxItems: 4000
    cacheMs: 4000
    includeHidden: false
    # —— 新增 ——
    baseUrl: http://127.0.0.1:8188   # 设置里的输入框写这里
    autoDetect: true          # 自动探测 ComfyUI 安装位置
    autoStart: true           # 未运行时按需拉起
    startCommand: []          # 特殊情况才填：["D:/ComfyUI/venv/Scripts/python.exe","D:/ComfyUI/main.py","--port","8188"]（该模式不自动设 cwd，实际继承 dsh 进程的 cwd）
    readyTimeoutMs: 180000    # 冷启就绪上限
    idleShutdownMs: 300000    # 空闲回收（0=不回收）
    headers: {}               # 鉴权透传，不内置任何默认
    outputDir: null           # 缺省落 workspace 根
    assetRoots: []            # 除 outputDir 外纳入索引的目录
    strictVars: true
    runMode: conversation     # conversation（默认，点生成=发进对话）| direct
    returnImages: first       # 已弃用：工具响应只给路径，字段保留以兼容旧配置
    timeoutMs: 300000
    pollIntervalMs: 1000
    indexMode: auto           # auto | off
    betterSidebarTab: auto    # auto | on | off
```

优先级与 `dsh-comfyui-image` 同链：profile 配置 → `~/.dsh-comfyui-workbench/config.json` → 环境变量（复用 `COMFYUI_URL` / `COMFYUI_BASE_URL` / `COMFYUI_TIMEOUT_MS` 同名键，保证三个插件指向同一台服务）→ 内置默认。`~/.dsh-comfyui-image/config.json` 的 `outputDir` 作为**扫描根来源**继续读取，不作为本插件配置项。

---

## 7. 已知边界与处置（设计已定稿，无阻塞项）

下列 8 条是实现时会遇到的外部不确定性，处置方案已定，不再需要拍板。每一条都有对应降级路径，任何一条踩空都不会让功能消失，只会让它退一档。

| # | 边界 | 影响 | 处置 |
| --- | --- | --- | --- |
| 1 | ComfyUI 节点集差异（SaveImage / PreviewImage / VHS / 自定义） | 产物发现 | 遍历 `/history` 的 `outputs` 全部键，不按节点名匹配；未知扩展名归 `file`；发现不到抛 `no_output` 并点名末端节点 |
| 2 | 认证方式（无 / Basic / Bearer / 反代 cookie / 白名单） | 请求头 | 只提供 `headers` 透传，不内置任何默认；401/403 抛 `auth_failed` 指向该键 |
| 3 | `registerTab` 的向后兼容承诺 | tab 注册 | 只依赖 7 个稳定字段（相册 0.1.6 在 better-sidebar 0.28.0 上实测可用） |
| 4 | `/history` 轮询 vs `/ws` | 进度呈现 | v0.2 用轮询；切 `/ws` 只换 runner 内部实现，`RunResult` 不变 |
| 5 | 多 ComfyUI 实例 | 资产归属 | 索引行存 `comfyUrl`；v0.2 单实例（`baseUrl` 一个） |
| 6 | `{{var}}` 之外是否需要 JSON Pointer 精确绑定 | 复杂模板可控性 | v0.2 只做全模板 `{{var}}`；`bind` 已覆盖"精确到节点输入"，Pointer 仅在需要改数组下标时才引入 |
| 7 | 客户端能否订阅本会话新消息（回路 A 自动回填的唯一依赖） | "转提示词"能否全自动 | **实现期首件要验的事**。消息发送与附件入输入框已由相册在生产环境验证；订阅侧一验即知 → 不通就弹窗让用户手动采用，功能不消失 |
| 8 | 自定义节点的模型字段名差异（GGUF loader / 社区 LoRA loader 等） | `ModelRef` 提取完整性 | 特征匹配 + 扩展名兜底；覆盖不到的由 `schema.json` 手写 `models` 覆盖，不阻塞导入 |

### 已定项（不在此表内）

| 项 | 结论 |
| --- | --- |
| 服务地址 | 设置里提供输入框，默认自动检测，未运行则自动拉起（§3.16） |
| 把资产加入对话 | 相册已在实际环境验证，直接复用该路径（§3.14） |
| 旧前缀 `/comfyui-album/api` 兼容 | 不做。相册使命完成后直接卸载，无兼容层 |
| 工具响应的 image content 体积 | 工具侧默认压缩，但必须同时声明原始尺寸与展示尺寸（§3.3） |


---

## 8. 验收项

搬迁等价性优先：先证明"搬过来还是原来那个相册"，再证明新能力。

| # | 验收项 | 检查方法 | 通过判据 |
| --- | --- | --- | --- |
| B1 | 搬迁等价（渲染） | `node tests/render.mjs` | 原相册 3 个测试全绿（lint / smoke / render） |
| B2 | 搬迁等价（列表） | 同一目录分别用旧插件与新插件打开 | `/items` 返回的 `path` 集合完全一致（排序与分页对齐后逐项比对） |
| B3 | 元数据回退链 | 取一张只有 PNG 内嵌工作流、无 sidecar 的旧图 | `/meta` 仍能返回 prompt / seed（走 `readPngTextChunks` 回退） |
| B4 | 缩略图 | 列表滚一屏 | 请求命中 `?thumb=1`，返回 webp，`~/.dsh-comfyui-workbench-thumbs` 或 tmp 下生成缓存 |
| B5 | 删除语义一致 | 删一张有 sidecar + 副本 + 缩略图的图 | 四类文件全消失；`failed[]` 为空；二次确认文案与相册一致 |
| B6 | 去重不误合并 | 同 seed/尺寸/提示词但渲染不同的两张图 | 被合并为一组（证明保留的是 `duplicateKey` 语义，不是哈希） |
| B7 | 权限：源 | `GET /file?path=C:/Windows/win.ini` | 403 `forbidden` |
| B8 | 权限：目标 | `archive` 目标是 roots 外路径 | 403，且源文件未被移动 |
| B9 | 归档不重复入列 | 归档一张图后重新 `/items` | 列表里不再出现，`.archive` 未被扫入 |
| B10 | 根目录来源 | 在 `~/.dsh-comfyui-image/config.json` 里设 `outputDir` | `/roots` 出现 `kind: output` 的该项（证明仍在读旧配置） |
| B11 | 类型保真 | 模板 `"steps": "{{steps}}"`，传 20 | 提交 JSON 里是数字 20；单测覆盖 |
| B12 | 变量缺失 / 节点预检 | 分别删必填绑定、塞不存在的 class_type | `variable_unbound` / `node_missing`，且**未发出** `POST /prompt`（请求日志核对） |
| B13 | 超时收尾 | `timeoutMs: 1500` 跑长工作流 | 返回 `timeout`，ComfyUI `/queue` 里该 prompt 已消失 |
| B14 | 无产物 | 模板末端无输出节点 | `no_output`，hint 提及末端节点 |
| B15 | sidecar 互通 | 用 `dsh-comfyui-image` 产出的图走本插件 | 列表显示提示词/种子；两者共用同一 `outputDir` 时新图立刻可见 |
| B16 | 索引可重建 | 删 `index.db` 重启 | 从 sidecar 重建，`/assets` 结果与删除前一致 |
| B17 | better-sidebar 缺席 | 禁用后重启 | 无未捕获异常；原生面板入口可用 |
| B18 | better-sidebar 共存 | 三者同时启用 | 右侧 `+` 菜单有"相册/工作流资产"一个入口（只有本插件）；左侧只一个入口或零入口 |
| B19 | 契约隔离 | `rg "better-sidebar/(lib|src)"` | 零命中 |
| B20 | 运行时零依赖 | 检查 `lib/` 与 `client.js` 的 import | 只出现 `node:*`；`ts`/`esbuild` 仅在 devDependencies |
| B21 | IO 面自动推断 | `dsh workbench import` 一份 SDXL 基础图 | 生成的 schema 里 basic 段只含 prompt/negative/seed/steps/cfg/width/height；`vae`/`clip_skip`/`batch_size` 未出现；`outputs` 识别出 SaveImage |
| B22 | 连线不当旋钮 | 检查推断结果 | 任何 `value` 为 `[nodeId, slot]` 的 input 都不在 `inputs[]` 里 |
| B23 | bind 路径替换 | 模板同时含 `{{prompt}}` 字面量与 `bind: '6.inputs.seed'` | 提交 JSON 里 node 6 的 `seed` 被替换为该值且类型为数字；`{{prompt}}` 文本处也被替换 |
| B24 | 视图不透传 | 客户端全部网络请求 | 抓包确认没有 `view=full`（或任何返回完整节点的响应）；`/api/workflows` 响应体不含 `class_type` |
| B25 | 打码 | 模板含 `api_key` 字段 + 一个 `secret: true` 槽位 | `detail:'full'` 输出里两处均为 `[redacted]`；IO 面显示 `••••`；提交给 ComfyUI 的 JSON 仍是原值 |
| B26 | IO 面随模板失效 | 改模板内容后不重启 | `workflowHash` 变化，`/api/workflows` 返回新 IO 面（旧缓存未命中） |
| B27 | 模型不吃全量 | `comfyui_workflow_list` 的返回体大小 | 单个工作流条目 ≤900 字节（比初版放宽，因为新增了 model 与 inputKinds 这两个选择判据）；`inspect` 不带 `nodeId` 时不含 `widgets_values` |
| B28 | 用户第一屏极简 | 打开一个标准 SDXL 工作流 | 未展开"更多参数"时，可见输入只有提示词（+ 图像，如果模板有）；`seed`/`steps`/`cfg` 不在可视区 |
| B29 | 单节点下钻 | `comfyui_workflow_inspect(workflowId, nodeId)` | 返回该节点的 `class_type` / `widgets_values` / `title`；不含其它节点的配置 |
| B30 | 调参生效且不落盘 | `comfyui_workflow_edit` 改 `seed`，不传 `persist` | 本次运行用新值；模板文件字节不变；下一次运行回到原值 |
| B31 | 落盘 hash 校验 | `persist: true` + 错误的 `expectHash` | 拒绝写入，返回当前 `workflowHash`；模板未变 |
| B32 | 绑定性冲突 | patch 一个被 `bind` 控制的 input | 返回 `param-bound` 并指出控制它的变量名；不静默写入 |
| B33 | 备注双来源 | 模型写 `description`，用户从 UI 改同一字段 | `meta.json` 里 `updatedBy` 依次为 `agent` → `user`；`comfyui_workflow_list` 立刻返回新文案 |
| B34 | 无备注可见 | 删除 `meta.json` 与 `schema.json` | IO 面仍生成，`undescribed: true` 被标出；`description` 为空串而不是 undefined |
| B35 | 生成即入对话 | `runMode: conversation` 下点生成 | 会话里出现一条含 JSON 参数的消息；模型调 `comfyui_run`；工具响应是文本（路径 + 原始尺寸）、不含 image block；`outputDir` 同时有该文件 |
| B36 | 工具响应不含图片字节 | 检查该轮工具响应与紧随其后的请求 | 响应只有 text 块；下一轮请求正常返回，不再出现 `TRANSPORT`；模型按路径读图 |
| B37 | 多图产出 | 一次产出 5 张图 | 响应列出全部 5 个产物路径与原始尺寸；无 image block；下一轮请求不失败 |
| B38 | 参数保真告警 | 手动让模型把 seed 改成别的值再跑 | UI 输出区标红并列出差异（表单值 vs `RunResult.vars`）；不静默接受 |
| B39 | 转提示词自动回填 | 对一张图点"转提示词" | 会话出现带图消息；回复含 `<prompt>` 块时表单提示词槽位被填入；该消息被标记已采用，不重复填 |
| B40 | 转提示词降级 | 模拟拿不到订阅 / 模型不按格式回 | 弹窗展示原回复可手动采用；按钮旁有提示；无未捕获异常、不静默失败 |
| B41 | 列表两端同源 | 对比 `/api/workflows?view=io` 与 `comfyui_workflow_list` | 每个条目的 `title / description / primary model` 一致；用户看到的和模型看到的不是两套 |
| B42 | 模型名进列表 | 两个工作流同标题、不同底模 | 列表里靠 `models.primary` 可区分；`description` 为空时也不影响区分 |
| B43 | 用户指定不被换 | 选工作流 A 后点生成 | 消息含 `workflowId: A`；实际 `RunResult.workflowId` 为 A |
| B44 | 换选告警 | 故意让模型跑成 B | 输出区标红并列出「你选 A（底模 M1），实际 B（底模 M2）」 |
| B45 | 切换保留输入 | 填好 prompt 后切到另一个也有 `prompt` 的工作流 | prompt 内容保留；只在该工作流没有同名槽位时清空 |
| B46 | 模型侧筛选 | `comfyui_workflow_list(q: "upscale")` | 只返回 title/description/model 命中者；无命中返回空数组而不是全部 |
| B47 | 前端必填校验 | 必填输入留空点生成 | 槽位高亮，**未发出会话消息**（抓包确认无新消息） |
| B48 | 托管：外部实例 | 先手工启动 ComfyUI，再让插件跑一次 | 直接使用；请求结束后该进程仍在运行（插件未停它） |
| B49 | 托管：自动拉起 | 关闭 ComfyUI 后点生成 | 探到安装目录 → 拉起 → `/system_stats` 就绪 → 完成运行；`idleShutdownMs` 到点后进程消失（仅自己拉起的那个） |
| B50 | 托管：未安装 | 指向一个没有 ComfyUI 的环境 | `comfy_unreachable`，hint 含已探测路径列表与下载地址；无无限重试 |
| B51 | 冷启期间排队 | 服务冷启中立刻发 2 个运行请求 | 两个都排队等待而非立即失败；就绪后按序执行 |
| B52 | 压缩告知原始尺寸 | 4096×4096 原图，长边限 2048 | 工具 text 段含"原图 4096×4096，展示副本缩放至 2048×2048"；`artifacts[].width` 仍为 4096；`notes` 含 `displayed-downscaled` |
| B53 | 尺寸不退化 | 把上一次产物作为 `input_image` 再跑一次 | 传给 ComfyUI 的 `input_image` 是 `artifacts[].path` 指向的原图；产物像素尺寸与首轮一致，未被 2048 副本截断 |
| B54 | 相册卸载后等价 | 跑完 migrate、卸载相册、重启 | `/roots` 与 `/items` 数量与卸载前一致；无对 `/comfyui-album/*` 的残留请求 |

---

## 9. 分层

**核心（v0.1）**：相册全量能力（8 路由 + 5 组件 + 缩略图 + 去重 + 删除）+ `comfyui_run` + 模板仓库 + 索引与检索 + 原生面板。

**可选（v0.2）**：better-sidebar tab、FTS5、归档、批量运行、`repair`、`prune`、按 run 分组视图。

**迭代**：可视化工作流编辑、`/ws` 实时进度、多实例、跨机同步、缩略图持久缓存策略。

## 10. 迁移路径

1. `dsh plugin --profile desktop add link:<workbench 目录>` 或 `add github:YuChenLiao/dsh-comfyui-workbench`。
2. `dsh workbench migrate-album`：读取相册的 roots 与 `~/.dsh-comfyui-image/config.json`，生成本插件 `config.json`，**不移动任何文件**。
3. 打开新插件，核对 `/items` 数量与相册一致（B2）。
4. **先跑 migrate 再卸载**：相册的配置（roots 等）只存在于它的装载行里，卸载即丢失。`migrate-album` 必须在卸载前执行。
5. `dsh plugin remove dsh-comfyui-album` 直接卸载 —— 不做前缀兼容层，旧 tab 与书签随插件一起消失。
6. 卸载后核对：`/roots` 与 `/items` 数量与迁移前一致；旧的 `dsh-comfyui-album-thumbs` 临时目录可留可删，无人再读。

---

## 11. 实施顺序

每阶段有硬过关判据，不达标不进下一阶段。顺序刻意让"等价性"先于"新能力"——先证明搬过来还是原来那个相册，再往上叠。一旦先拆模块再搬家，就没有可比基线了。

### 阶段 0：搬家与等价（不动结构）

复制整目录，只做 §2.2 的 11 项必改，**不拆文件、不改逻辑、不引构建链**。

- 过关：B1（三个原测试全绿）、B2（新旧 `/items` 路径集合一致）、B3（无 sidecar 的旧图仍读得出元数据）
- 为什么先不拆：相册的 `index.js` 825 行是能跑的完整单元，先拆会把"搬家是否正确"和"拆分是否正确"两个变量混在一起，出问题分不清是谁的错。等价基线立住之后再拆，每一步都有对照。

### 阶段 1：模板与 IO 面

`lib/host/io-surface.js`：模板解析、变量推断、`ModelRef` 提取、`definitionHash`。`import` 命令落 `workflows/<id>.json` + `.schema.json`。

- 过关：B21（推断出的 basic 段只有提示词与图像）、B22（连线不进 inputs）、B26（hash 随模板变化）

### 阶段 2：runner 与工具

`lib/host/runner.js`（提交、轮询、`/interrupt` 收尾、产物发现）+ `lib/host/tools.js`（4 个工具）。

- 过关：B11（类型保真）、B12（缺变量与缺节点都在 `POST /prompt` 之前失败）、B13（超时后队列已清）、B14、B27（列表体积）

### 阶段 3：索引与检索

`lib/host/index-db.js`（`node:sqlite`，`auto/off` 两档）+ sidecar 双写。

- 过关：B15（与 comfyui-image 的产物互通）、B16（删库可重建）、B6（去重仍按 `duplicateKey` 语义，不误合并）

### 阶段 4：客户端

表单只有 IO、工作流选择器、两条对话回路、生成后的一致性比对。

- 过关：B28（第一屏极简）、B38/B43/B44（参数与工作流保真告警）、B39/B40（转提示词主路径与降级）、B47（前端必填校验）
- 本阶段第一件事：验 §7 第 7 条（客户端消息订阅）。通不过就按降级实现，不在这上面耗。

### 阶段 5：托管与侧栏

`lib/host/supervisor.js` + better-sidebar tab。

- 过关：B48–B51（三种服务状态 + 冷启排队）、B17/B18（侧栏缺席与共存）

### 阶段 6：切换

`migrate-album` → 卸载相册 → 复核。

- 过关：B54（卸载后 `/roots` / `/items` 一致，无残留请求）

### 工程约定

- **不引构建链**。相册是裸 ESM + JSDoc 类型，改完即生效、无需 watch，这是它调试循环短的真实原因。新增模块沿用同一风格。等模块数量真的压不住，再单独评估 esbuild，不在本版引入。
- **运行时零依赖**（B20）。`node:*` 之外不 import 任何东西；测试用 `node --test`。
- 每个新增模块都要能被单测直接 require —— 相册的 `__test` 导出模式继续沿用，别把逻辑埋进闭包。
- 拆分（阶段 1 起）时，`lib/host/http.js` 从 `index.js` 提取路由骨架，`lib/host/assets.js` 承接现有 8 个路由的实现。拆分只搬代码不改行为，每次拆完立即跑 B1–B3 回归。

---

## 12. 实现状态对照（0.1–0.2 交付；0.3.0 增量见 CHANGELOG）

设计是靶子，不是承诺。下面逐项对照，未实现的直说，不粉饰。

| 设计项 | 状态 | 说明 |
| --- | --- | --- |
| 相册能力整体吸收 | ✅ | 浏览、搜索、筛选、分页、灯箱、多选、批量导出、批量删除、同图合并、元数据回退链 |
| 工作流导入（仅 API 格式） | ✅ | UI 格式拒绝并给出 Export (API) 指引 |
| IO 面推断 | ✅ | 连线跳过、内部参数跳过、正负提示词回溯命名、basic 段只收提示词与图像 |
| `bind` + `{{var}}` 双轨替换 | ✅ | 整串占位符保类型（有单测钉住） |
| 执行链（预检 → 提交 → 轮询 → 取产物 → sidecar） | ✅ | 超时必发 `/interrupt`；缺节点/缺变量在提交前失败 |
| 四个模型工具 | ✅ | list / inspect（nodeId 下钻）/ run / edit |
| 资产索引 | ✅（偏离） | 用 JSONL 而非 sqlite；追加超阈值自动压实；可删可重建 |
| `/assets` 检索与重建 | ✅ | q / workflow / tag / kind / status / 游标 |
| 客户端工作流面板 | ✅ | 选择器 + 只有输入输出的表单 + 两种运行方式 + 输出区 |
| 参考图转提示词 | ⚠️ 部分 | 图与指令能填入输入框；**自动回填未实现**（依赖"订阅会话新消息"，能力未验证） |
| 点生成即入对话 | ✅ | 结构化 JSON 指令填进输入框，由模型调 `comfyui_run` |
| 服务托管 | ✅ | 探测 / 按需拉起 / 就绪等待 / 空闲回收 / 只停自己拉起的 |
| better-sidebar 页签 | ✅ | 与原生面板共用同一个 `Workbench` |
| 相册迁移 | ✅ | `scripts/migrate-album.mjs`，只抄配置不改 profile |
| 归档 archive / 反归档 | ❌ 未实现 | 设计 §4.5 有，代码没有 |
| prune / repair | ❌ 未实现 | 同样推迟 |
| sqlite + FTS5 | ❌ 推迟 | JSONL 对当前规模够用 |
| `dsh workbench import` 命令 | ❌ 未实现 | 用 `scripts/import.mjs` 代替；宿主是否支持插件注册 CLI 子命令未验证 |
| `/ws` 实时进度 | ❌ 推迟 | 现在轮询 `/history` |
| 多实例 | ❌ 推迟 | 索引行已存 `comfyUrl`，但配置只支持一个 `baseUrl` |

### 与设计的实质偏离

1. **索引换成 JSONL**：规模（几千条）+ 零依赖 + 可手工修，比 sqlite 更划算。代价是大规模检索慢，且需要压实逻辑。
2. **图片不进工具响应**：设计里写的是"MCP 风格 image 块"，实现过一版，现已撤掉。核实结果：宿主不接受这种块，而且不是忽略 —— 请求装配按 `{ type: 'image', attachment }` 重建内容，裸 base64 读到空 attachment 抛错，被适配器包装成 `TRANSPORT`，并永久污染该会话的每次请求。现行实现只返回文本路径与原始尺寸。
3. **输出目录写入加了授权校验**：设计没写，实现时发现不给校验等于开任意路径写入的后门。默认输出目录本来就在授权根内，只有显式指定根外路径才会被拒。
