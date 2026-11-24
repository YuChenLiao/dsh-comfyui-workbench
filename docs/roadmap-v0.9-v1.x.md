# `dsh-comfyui-workbench` 后续演进产品企划书（v0.9 → v1.x）

> 制定日期：2026-11-24  
> 当前基线：`v0.8.0`

---

## 一、企划背景与现状评估

### 1.1 当前基线（v0.8.0）

`dsh-comfyui-workbench` 已完成从“相册插件”到“ComfyUI 工作台”的架构跃迁，具备清晰的分层与较强的工程护城河：

- **通用工作流抽象**：任意 API / UI 格式工作流导入，仅向模型暴露输入/输出与可控变量，支持按底模分组、全库体检与局部编辑。
- **全媒体资产体系**：统一收纳图片、视频、音频及 sidecar 元数据，支持回收站、双图对比、涂蒙版、批量导出工作流 ZIP。
- **四大创作素材库**：Danbooru 标签库（99,372 条）、姿势库、衣装库（写实/二次元双源）、角色库，并已通过 `comfyui_compose` 串联。
- **工程化质量**：11 个独立可控组件 + 完整自动化测试基线。

### 1.2 核心痛点与生态差距

对照 **DSH 同类生图插件**（`dsh-qwen-paint`、`dsh-comfyui-image`、`dsh-image-gen`、`dsh-comfyui`）、**DSH 宿主生态插件**（`structured-prompt`、`memory-ledger`、`strata`、`pdf-reader`）以及 **ComfyUI 生态**（Comfy MCP、ComfyUI-Manager、Krita AI Diffusion、Lora-Manager），当前主要存在三类缺口：

1. **对话流反馈断层**：工具侧出图缺乏对话内原生进度/预览卡片，且 `progressStream` 尚未打通工具调用；用户只待在对话页时感知偏弱。
2. **新用户冷启动门槛高**：缺乏一键环境自检（Doctor）与开箱基础模板，遇到缺节点/缺模型/OOM 时仍偏“报错误”而非“引导修复/自愈”。
3. **高频场景与多算力支持不足**：LoRA/模型元数据依赖手工维护；批量出图缺乏网格挑图流；仅支持单 `baseUrl`，无法兼顾本地与远程/云端 ComfyUI。

---

## 二、总体目标与产品原则

### 2.1 演进目标

在不改变 **“不复制 ComfyUI 节点画布前端、只做模型与创作协同工作台”** 的核心定位下，将产品从“侧栏工作台面板”升级为 **DSH 原生 AI 创作中枢**：

- **对话内即可完成 80% 高频生图与迭代**；
- **模型更懂本地环境、更少幻觉与报错**；
- **支持本地与远程混合算力调度**。

### 2.2 设计红线

1. **不侵入宿主全局布局**：所有客户端能力严格走官方 `slots` / `deliverables` 体系，不注入全局覆盖型 CSS 或强行修改消息树 DOM。
2. **进程安全优先**：沿用 `idleShutdownMs: 0` 默认策略与“只管理自己拉起的进程”原则，绝不按端口盲杀外部 ComfyUI。
3. **上下文预算可控**：新增工具、枚举与 Skill 指令均需按组件按需加载、精简输出，避免挤占主对话上下文。
4. **宿主隔离优先（防腐层原则）**：面对 DSH 高频迭代与破坏性更新，所有宿主 API 调用必须收拢进独立适配层，禁止业务组件与入口直接硬编码宿主接口细节。

---

## 三、分阶段产品规划

### 前置基建（v0.9 前置）：抽离 DSH 双向适配层

- **背景与必要性**：目前 `shared/host` 已建立底层约束，但 `src/entries/*.ts`（7 个入口）、`src/shared/run/notify.ts`、`src/client/index.tsx` 与 `src/client/conversation.ts` 仍分散直接调用 `ctx.get`、`ctx.effect`、`tools.register`、`slots.register`、`betterSidebar` 等宿主 API。v0.9 引入新槽位后，宿主耦合面会成倍放大。
- **架构调整方案**：
  - **服务端适配层（收拢至 `src/shared/host/` 或 `src/adapters/dsh-server/`）**：统一封装 `registerTool`（含 schema 兼容与 `deliverables/presented` 钩子）、`mountRoutes`、`registerPrompt/Skill`、`notifySession`、`probeWorkspace` 与生命周期 `onDispose`；将可选服务（如 `sessionProjections`、`systemPrompt`）的局部 `inject` 与降级逻辑集中在一处，`src/entries/*.ts` 退化为纯声明式装配。
  - **客户端适配层（`src/client/host/` 或 `src/adapters/dsh-client/`）**：统一封装 `mountMainPanel`、`mountSidebarTab`、`mountToolView`、`mountComposerSlot`、`mountInputDock`、`navigateToConversation`、`pasteToConversation`、`getLocale`，屏蔽 DSH 槽位名、props 结构与 `betterSidebar` 探测细节，使业务 UI 组件与宿主完全解耦。
  - **静态架构门禁**：在 `tests/arch.mjs` 新增规则，禁止 `src/components/*` 与 `src/entries/*` 直接调用 `ctx.get` / `ctx.slots` / `ctx.effect` 或硬编码 DSH 槽位字符串，强制全部宿主交互经由适配层中转。

### 第一阶段：v0.9.0 —— 对话流原生体验与冷启动破冰（近期高优）

#### 需求 1.1：对话流原生工具卡片（`tool.call.toolview`）

- **DSH 原生图片能力边界调研结论**：
  - DSH 内置的 `ReadImageRow`（`tool.call.toolview`，`key: 'read_image'`）在 `imageCardModel` 中硬编码校验 `call?.name === 'read_image'`，且为**纯结算态（Result-side only）、默认折叠**，不支持进度条、潜空间实时预览、视频/音频及“再跑一次/涂蒙版”等交互，第三方工具无法直接复用。
  - 但其声明的公共子槽位 `tool.call.images`（带会话授权 `loadImage` 加载器）以及 `deliverables/presented` 交付物事件机制可按需复用。
- **目标问题**：模型调用 `comfyui_run` / `comfyui_run_batch` / `comfyui_rerun` 时，聊天流里只有文本折叠块，等待期无实时反馈、成图后缺少快捷操作。
- **方案设计**：
  - 通过客户端适配层在 `tool.call.toolview` 为核心出图工具注册专属卡片（必要时声明 `children: { 'tool.call.images': ... }` 复用宿主画廊能力）。
  - **运行态**：打通工具侧 `/ws` `progressStream`，卡片内实时展示排队位次、采样进度条，并支持渲染 ComfyUI `/ws` 推送的**潜空间实时预览帧（Latent Preview）**。
  - **完成态**：原地切换为成图缩略图/视频播放器，展示关键参数（工作流名、seed、耗时），提供 **「再跑一次」「涂蒙版重绘」「在相册中定位」** 快捷按钮。
  - **异常态**：输出结构化错误摘要与诊断按钮，避免静默失败。
- **交付物打通**：在 `tools/result` 阶段通过服务端适配层补齐 `deliverables/presented` 事件登记。

#### 需求 1.2：输入栏快捷入口（`composer.tools` + `input.dock`）

- **目标问题**：用户每次查 ComfyUI 状态或想按固定模板生图，都必须切去侧栏面板。
- **方案设计**：
  - **`conversation.composer.tools` 状态点**：发送按钮旁增加极简状态指示点（在线/运行中/队列数），悬停/点击可查看状态、切换 `async/sync`、一键拉起 ComfyUI 或跳转工作台。
  - **`input.dock` 快捷生图器**（参考 `dsh-plugin-structured-prompt`）：弹出轻量表单，选择已启用工作流与预设，填写核心变量与参考图后，一键发进对话执行。

#### 需求 1.3：`Doctor` 一键环境自检与开箱模板引导

- **目标问题**：新用户装完插件后常因环境路径、端口、缺工作流而卡在第一步。
- **方案设计**：
  - 在工作流面板与工具层提供 `Doctor` 诊断（检测本地 ComfyUI 安装、端口连通性、可用显存、工作流目录与写入权限、核心节点就绪度），给出可执行修复建议。
  - 内置基础场景引导模板（文生图、图生图、局部重绘、高清放大、去背景），支持探测本机已有底模一键生成可用模板。

---

### 第二阶段：v1.0.0 —— 智能闭环、模型自解释与批量挑图（中期核心）

#### 需求 2.1：模型元数据自动补全与合法枚举约束

- **目标问题**：`loras.json` 需手工维护；模型调参时容易因幻觉填错底模/LoRA/采样器名称。
- **方案设计**：
  - **哈希元数据抓取**：按本地模型/LoRA 文件 SHA256 哈希查询 Civitai / HuggingFace 元数据并本地缓存，自动补全**底模归属（SDXL / Flux / Qwen-Image / Wan）、触发词、推荐权重、预览封面**；工作流面板新增轻量“本机模型与 LoRA”只读抽屉。
  - **`/object_info` 动态枚举注入**：在 `comfyui_workflow` / `comfyui_run` 检视阶段向模型提供本机真实存在的模型、采样器、调度器合法值，降低无效提交。

#### 需求 2.2：工作流“体检 → 补齐 → 冒烟测试 → 自愈”闭环

- **目标问题**：网上导入的工作流常缺节点或运行时 OOM，目前仅停留在报错提示。
- **方案设计**：
  - **依赖补齐引导**：结合 ComfyUI-Manager 节点注册表映射，在 `audit` 时直接给出缺失节点对应的包名/仓库与安装指引。
  - **低分辨率 Dry-Run（冒烟测试）**：支持 1~2 步小图快速试跑验证管线连通性。
  - **异常自检与降级重试**：识别纯黑/全噪点异常图或 OOM 报错，提供策略开关（自动降一档分辨率/切轻量化工作流重试）。

#### 需求 2.3：高频编辑闭环与 `Grid` 网格挑图流

- **目标问题**：批量出图（`comfyui_run_batch` / `grid`）后缺乏高效筛选与局部迭代工具。
- **方案设计**：
  - **X/Y Grid 网格对比视图**：针对 `grid` 批次产物，在相册/灯箱内提供横纵轴参数矩阵对比。
  - **挑图工作流**：相册新增星标（收藏/淘汰）标记与按星级批量清理/导出。
  - **局部重绘坐标闭环**：基于现有 `MaskEditor`，支持重绘产物按原图位置叠回预览对比，确认后再入库。
  - **提示词配方与跨会话记忆**（参考 `dsh-plugin-memory-ledger`）：支持将“角色图 + LoRA 组合 + 画风/光影前缀 + 目标工作流”保存为轻量配方，并建立跨会话 FTS5 索引供模型在新对话中检索复用。

---

### 第三阶段：v1.x —— 混合算力路由与生态协同（远期扩展）

#### 需求 3.1：多后端 Profile 与智能路由

- **方案设计**：将单一 `baseUrl` 升级为多后端 Profile（支持本地 `127.0.0.1:8188`、局域网算力机、远程/云端 ComfyUI + 鉴权头），支持按工作流标签或底模类型自动路由（例如日常出图走本机，Wan 视频大模型走远端高显存节点）。

#### 需求 3.2：ComfyUI 原生 Lazy Execution / Switch 节点识别

- **方案设计**：增强 `surface` 解析能力，识别工作流内的条件开关与懒执行分支，将其映射为布尔/模式输入槽位，实现“单份工作流按需开启高清放大/修脸/ControlNet”。

#### 需求 3.3：DSH 生态显存协同（与本地模型 Provider 联动）

- **方案设计**：在 DSH 宿主内探索与本地推理插件（如 Strata）的状态协同——触发高显存任务前检测可用 VRAM，必要时提示或协调释放本地 LLM 显存占用，任务完成后恢复。

---

## 四、里程碑与验证标准

| 阶段 | 核心交付物 | 关键验收指标 |
| --- | --- | --- |
| **v0.9 前置** | 服务端/客户端 DSH 双向适配层、`tests/arch.mjs` 宿主隔离门禁 | 业务组件与 `entries/*` 零直接宿主耦合；模拟 DSH 接口变更仅需修改适配层 |
| **v0.9.0** | `toolView` 卡片（含潜空间预览）、`composer.tools` 状态点、`input.dock` 表单、`Doctor` 自检、基础引导模板 | 对话内出图全流程无需切出聊天页即可看进度与成图；新装环境可通过 `Doctor` 定位 100% 常见配置问题 |
| **v1.0.0** | 哈希元数据自动缓存、`/object_info` 枚举约束、`Dry-Run` 冒烟、Grid 对比与星标筛选、配方记忆 | 模型填错参数名导致的 ComfyUI 报错显著下降；`grid` 批量出图支持矩阵对比与一键清理淘汰图 |
| **v1.x** | 多后端 Profile 路由、Lazy 分支槽位识别、显存协同 | 支持同一工作台内无缝切换本地与远程 ComfyUI 执行不同工作流 |

---

## 五、风险与应对

1. **DSH 宿主版本差异风险**：客户端新槽位（`toolView`、`input.dock`、`composer.tools`）与 `deliverables` 需采用局部 `ctx.inject` + 存在性探测与降级兜底，确保老版本宿主不阻塞插件加载。
2. **外部元数据抓取网络稳定性**：Civitai/HF 查询必须设为纯异步按需触发且带本地缓存与超时控制，离线环境下不影响核心工作流执行。
3. **上下文膨胀风险**：枚举注入与配方检索必须做 Top-K 截断与按需展开，保持工具 schema 紧凑。
