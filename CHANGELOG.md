# CHANGELOG

## 未发布


### 修复

- **五条 entry 面板全空**：组件 entry 是独立 bundle，`runtime.ts` 被各内联一份，模块级单例在 entry 之间不共享（`globalThis` 实测同样不共享），五个 prefix handler 各看各的路由表，导致 `/config`、`/workflows` 全 404、资产库与工作流面板同时为空。共享锚点改为 `ctx.root`（cordis 里所有 entry 的唯一共同原点，已用宿主 asar 内的 cordis 4.0.5 实测确认）。同时把 ComfyUI 客户端 / 进程托管 / 资产索引从「每条 entry 各建一份」收敛为一份。
- **重载后相册 404、要第二次重载才自愈**：core entry 只 `acquire` 不 `release`，引用计数永不到 0，旧运行时带着失效的 ctx 存活，重载时挂 effect 抛 `cannot create effect on inactive context`。现在 acquire / release 配对，卸载后 `refs=0`、`supervisor.dispose` 恰好调用一次。连续三轮全卸载→重载实测：prefix `1→0→1`、三个接口始终 200。
- **`ensureHttp` 先置位再注册**：失败或热重载后 `httpMounted` 恒为 true，前缀永不重新注册。改为注册成功后才置位，disposer 里复位。
- 注册类操作（`ensureHttp` / `track`）改用**调用方** ctx，不再用创建者的 —— 创建者 entry 卸载后再挂 effect 会抛。
- 被 `disabledComponents` 关掉的组件先判配置再 `acquire`，不再白建一份客户端与监督器；core 补 `inject: ['webServer']`，避免 HTTP 前缀落到某个组件身上（单独关它会整体失效）。
- `/workflows` 的批量导出实现留在相册（要读图、sidecar、打包），但不再挂进相册路由表，改由工作流组件的 POST 转发，消除两边抢同一路径的覆盖。
- 出图通知把消息来源写成 `{ kind: 'plugin', plugin: …, form: 'notice', summary: … }`，会话格式 v4 明确拒绝这个写法（`format v4 message requires a producer-owned source kind`），`Agent.followup` 在落事件时抛 `SessionFormatError`：通知永远发不出去，异常还发生在 agent 的 inbox 写入路径上，会把发起会话的驱动留在异常态（表现为那个对话再也接不到新消息）。现改为 v4 合法的 `{ kind: 'plugin:dsh-comfyui-workbench' }` —— 正是 v3→v4 迁移把旧写法改写成的形状。
- 通知投递一律经 `deliver()` 兜住异常并记日志，超时/完成/失败三条路径都不再把异常抛回宿主。
- `comfyui_run` 不再把产物作为 MCP 风格的内联图片块返回。宿主把工具结果的每个块按 `{type:'image', attachment}` 重建模型请求，裸 base64 块会让请求装配读到空 attachment 而抛错，被 LLM 适配器包装成 `TRANSPORT`；该块一旦落进会话历史，**这个会话之后每次请求都失败**（重进会话仍只报 `TRANSPORT`）。现在工具响应只含文本：路径、MIME、体积、原始宽高。
- `ToolBlock` 收窄为 `ToolText`，`ToolImage` 类型移除；`returnImages` 工具参数与同名配置字段保留但已弃用，只为兼容旧调用与旧配置。

### 清理

- 删除 `isDeadCtx`（判 `fiber.active` 在 cordis 4.0.5 下恒不成立，属死代码）、`runtimeReady`（无调用者）、`Runtime.ownerCtx`（只写不读）。
- 移除 `lib/{gallery,generate,edit}.js` 三个历史遗留产物（entry 产物已迁到 `lib/entries/`，这三个不再生成、全仓无引用）。

## 0.2.0

### 客户端

- 工作台外壳：资产库 / 工作流两个页签，共用侧边栏入口与 better-sidebar 页签。
- 工作流面板：选择器（标题 · 底模 · 备注）、只有输入输出的表单、advanced 折叠、输出区。
- 两种运行方式：**发进对话**（把结构化参数填进输入框，由模型调 `comfyui_run`）与**直接生成**（HTTP 直连，不消耗模型往返）。
- 参考图转提示词：图与固定格式指令一并填进输入框。自动回填依赖"订阅本会话新消息"，该能力尚未验证，因此当前停在"填好等你按回车"，并在找不到输入框时明确报错。

### 服务托管

- 探测：环境变量 `COMFYUI_HOME` / `COMFYUI_PATH` / `COMFYUI_DIR` → 常见位置；判据是"有 `main.py` 且有 `models/`"。
- 三种状态：外部在跑（只用不托管）、未跑但已安装（按需拉起）、未跑且未安装（报错给指引）。
- 只停**自己拉起的**进程；外部实例永不触碰（有测试钉住）。
- 空闲回收；拉起期间请求排队等待而不是立刻失败。
- `GET /service` 看状态（state / managed / pid / installDir / detail），`POST /service/stop` 停自己拉起的那个。

### 迁移

- `node scripts/migrate-album.mjs [--write]`：把相册的 roots / 扫描上限抄到本插件数据目录，不碰产物、不改 profile 装载行。

### 工程

- 测试 32 项：架构、静态、宿主接口、客户端渲染、IO 面与变量、索引、执行链、HTTP 契约、服务托管。


## 0.1.0

首个版本：把 `dsh-comfyui-album` 的资产浏览能力整体继承过来，并加上工作流执行。

### 资产库

- 侧边栏入口 + 主面板；装了 `dsh-better-sidebar` 时注册页签，未装静默缺席。
- 搜索、根目录筛选、仅生成图、分页、手动重扫。
- 悬浮动作：复制图片、复制提示词、导出工作流、加入当前对话、删除。
- 灯箱：缩放、适应窗口、←→ 翻页、ESC。
- 多选：全选 / 清除 / 批量导出工作流（ZIP）/ 批量删除。
- 同图副本合并（`seed + 尺寸 + 提示词` 签名，不做内容哈希 —— 编码差异会导致漏合并）。
- 元数据：sidecar 优先，缺失时回退 PNG 内嵌工作流。

### 工作流

- `dsh workbench import`：只接受 API 格式；UI 格式给出 Export (API) 指引。
- IO 面推断：连线跳过、内部参数跳过、正负提示词按采样器回溯命名、`basic` 段只收提示词与图像。
- `applyVariables`：`bind` 路径写入 + `{{var}}` 按值替换（整串占位符保类型，数字不退化字符串）。
- 四个工具：`comfyui_workflow_list` / `comfyui_workflow_inspect` / `comfyui_run` / `comfyui_workflow_edit`。
- 执行：预检 → 提交 → 轮询 → 超时必发 `/interrupt` → 取产物 → sidecar。
- 工具响应带回图片块，并在文本中声明原始像素尺寸。

### 索引

- JSONL 追加式索引，可删可重建（真源是 sidecar）。
- `GET /assets`（q / workflow / tag / kind / status / 游标）、`POST /assets/rebuild`。

### 工程

- 全部 TypeScript，按域分层（scan / host / assets / workflow / comfy / run / store / tools / http / client）。
- `tests/arch.mjs` 把依赖方向约束变成可执行检查。
- 运行时零依赖（只用 `node:*`），构建期只依赖 typescript + esbuild + @types。
- 22 项测试：架构、静态、宿主接口、客户端渲染、IO 面与变量、索引、执行链（本地假 ComfyUI）。
