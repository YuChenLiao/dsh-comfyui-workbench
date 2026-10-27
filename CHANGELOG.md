# CHANGELOG

## 0.4.0

### 新增

- **终端面板**（`panel.terminal`，可单独开关）：第三个面板，展示 ComfyUI 的命令行输出。想知道服务在干什么、卡在哪一步、模型加载到几成，这些只在终端里。

  **前提是把输出接上**：`ComfySupervisor` 此前用 `stdio: 'ignore'` 拉起子进程，ComfyUI 的输出被直接丢弃。现在改成 pipe，配一个 2000 行的环形缓冲挂在 runtime 上（组件可能还没加载，进程就已经在拉了）。缓冲带单调序号，前端按 cursor 拉增量，不重复下载整屏。

  **两个容易被忽略的细节**：ANSI 转义必须在入库前剥掉 —— ComfyUI 的进度条用 `\r` 加颜色码反复刷新同一行，原样送到浏览器是一屏乱码；子进程强制 `PYTHONIOENCODING=utf-8`，Windows 上不指定的话 Python 按控制台代码页输出（GBK），中文日志全是豆腐块。解码用 `TextDecoder` 的流式模式，进程退出时多字节字符被截在半个字符上也能拼回来。

  **面板能自己拉起服务**：只展示不启动的话，「打开终端看进度」必须先回对话生成一张图才会触发拉起 —— 那正是用户想避免的被动等待。面板上没有 `external` 实例时给出「启动」按钮。

  **外部实例也能看**：插件拉起的进程直接接 stdout / stderr；外部启动的实例（Desktop 自己起的那些）拿不到 stdout，改读它写的 `user/comfyui.log` —— 新增的 `LogTail` 首次给末尾 200 行、之后按偏移读增量、文件轮转则重来。两条路只走一条：ComfyUI 的 logger 同时挂 Stream 与 File 两个 handler，两边都读是每行两份。`installDirOf` 改成惰性探测（带负缓存，否则每 2 秒扫一次盘）—— 它原本只在 `start()` 里赋值，而外部实例根本走不到那里，日志就永远读不到。

  面板按状态分支说明（未启动 / 外部实例 / 启动失败带原因 / 正在读日志），而不是留一片空白让人以为是 bug。

  UI 上做了自动跟随底部（用户往上翻时不拽回来）、暂停、关键字过滤、清屏、丢弃行提示。

- **资产库可以一键隐藏 NSFW**：刷新按钮右侧一个省略号，悬浮展开。判定是启发式词表，不是分类器。

  强信号（`nsfw` / `explicit` / `hentai` / 性器官 / 中文「完全裸露」「完整裸露」「赤裸」「全裸」等）单命中即判；中信号（`nude` / `breast` / `lingerie` / 「裸露」「乳房」等）要凑够两个才算 —— 动漫 tag 里 `breasts`+`nipples` 是泳装与解剖图的标配，单命中必然误伤。

  三条约束都是被真数据打回来的：**存词根不存复数**（子串匹配，存 `breasts` 就漏 `breast`）；**不用下划线做边界**（tag 里 `lewd` 与 `lewd_pose` 都有）；**负向提示词不参与判定**（Danbooru 系底模的官方负向模板里就写着 `nsfw`，拿它判定会让一整库图全被藏，而那正是在排除成人内容）。在 363 张真实语料上校准过：「裸露」原本是强信号，会误伤 4 张 SFW 水彩插画（触发词「肩头裸露」），降为中信号后翻转恰好那 4 张。

### 修复

- **清屏接口恒 405**：`POST /terminal` 没进 `WRITABLE` 白名单，而前端不检查响应码 —— 界面清空了、下一秒整屏回填，看起来像灵异现象。同时前端现在看状态码，失败就不动本地状态。
- **cursor 超前会永久失明**：`since()` 原本回 `Math.max(cursor, last)`。插件热重载后缓冲重建、seq 从 1 开始，浏览器还拿着旧的高位 cursor，于是之后每轮都判成「没有新行」，面板死在原地；而唯一的自救手段（清屏）正好是坏的。改成回「实际给到哪一行」。
- **清屏会弹「更早的 N 行已滚出缓冲」**：可见行被计进了 `dropped`，而那是用户自己按的。
- **`/config` 只在工作流组件里注册**：关掉工作流后它 404，前端 catch 退化成「全开」—— 被关掉的页签照样显示，「独立开关」在组合场景下失效。挪到 core entry。
- **CRLF 收尾的进度条被拼成一行**：Windows 上 tqdm 的帧以 `\r` 开头、整行以 `\r\n` 收尾，
  先判「末尾是不是回车」就会整段保留，几十帧拼成一行。改成先剥 ANSI、再摘行尾回车、最后取最后一段 ——
  顺序错了就出错（转义码夹在回车两边，带着它们判必然拼帧）。
- **热重载后 cursor 失效却判不出来**：靠「序号是否连续」识别缓冲重建是错的 ——
  新缓冲可能已经输出到旧 cursor 之后，看起来完全连续，于是新内容前面几行永久丢失、旧行残留。
  改成给缓冲一个 `epoch` 代号，变了就清屏全量重拉。
- **首屏把「从未启动」说成「外部实例」**：只按 `managed` 二分，未启动时 `managed` 也是 false。改成按 `state` 分支。
- **计数比的是服务端总数**：PAGE=60 的库里没滚到底会显示「37 / 363」，像藏了 326 张。改成比「已加载」的条数。
- **隐藏后的「全选」会连带删掉看不见的**：`selectAllShown` 用的是未过滤全量列表 —— 隐藏 30 张后全选 39 张，一次删除把它们一起删掉。灯箱同源：按 → 会翻到隐藏的图，计数显示成「30 / 9」。三处都改成走过滤后的列表。
- **悬浮面板在指针到达前消失**：`top: calc(100% + 6px)` 中间是真空，鼠标斜着移过去时 `:hover` 断掉。改成面板自身 `padding-top` 撑间距；触屏没有 hover，补 `@media (hover:none)` 常驻。

## 0.3.0

### 新增

- **Danbooru 标签库组件**（`comfyui-workbench:danbooru`，可单独开关）：`danbooru_lookup` 支持按中文名或 Danbooru tag 查角色 / 画师，`danbooru_sync` 支持从 Danbooru 自抓。查询同时接受中文名、日文名与 Danbooru tag，空格与下划线等价，结果按「tag 名 → 别名精确 → 前缀 → 包含」分档、同档按帖子数降序。**输出只含 tag**（不带 postCount / 别名 / 匹配方式，避免挤占上下文）。本地库为空或没命中时自动走在线查询（`source: 'online'`），没同步过也能用。

  **数据随包内置**：`data/danbooru/` 里带 60,265 条（角色 35,384 + 画师 24,881，约 12MB），装好即可离线查询，不必先联网同步。来源是社区维护的中文库 [`danbooru-tags-data-zh`](https://github.com/amenorira/danbooru-tags-data-zh)（MIT，© 2026 amenorira），含中文名、别名（社区昵称如「葱娘」）与注释；上游 LICENSE 随数据保留。去掉被多条记录共用的别名后，角色 98.7% / 画师 94.9% 有中文名或别名（上游 CSV 为 99.7% / 95.8%）。`npm run danbooru:zh` 约 5 秒可重新导入（视网速）；自抓 wiki 作为补充路径保留（数据更新更及时，但对画师几乎拿不到中文名 —— Danbooru 平台不填 `other_names`）。

  **数据源降级**：`safebooru.donmai.us` 是 Danbooru 官方镜像（同接口、同数据，实测 `post_count` / `other_names` / 别名反查结果逐字段一致）。主站超时（8 秒）、`5xx`、`429` 或端点 `404` 时自动切换，`404` 也算镜像不可用 —— Danbooru 的"查无此项"是 `200 + []`，`404` 只表示这个站没有该端点。切过一次之后优先走能用的那个。`aibooru.online` 这类"同一套软件、不同数据库"的站不能当镜像（`hatsune_miku` 只有 1821 帖 vs 主站 148311）。

  **随包附带两个数据脚本**：`import-danbooru-zh.mjs`（从上游 CSV 重新导入）与 `sync-danbooru.mjs`（从 Danbooru 自抓），装包的人不必 clone 仓库就能自己更新数据。刻意排除了 `build.mjs`（依赖 devDep `esbuild`，装后跑必然 `ERR_MODULE_NOT_FOUND`）与 `acceptance.mjs`（打本机端口、写真数据目录）。

### 修复

含 0.3.0 新组件在开发期发现并修掉的缺陷（0.2.0 没有这个组件，升级者不会踩到）。

- **产物落到不相关的工作区**：`workspaceRegistry` 只知道有哪些工作区、不知道当前会话属于哪个，cwd 匹配不上时取列表首项 —— 而那个顺序与用户当前在哪个工作区无关，于是图落进了别人的目录。改成执行期用 `workingDirectory.get(session)` 取会话自己的工作区（`comfyui_run` 的 `exec.agent` 就带着 session），续查分支同步；`<会话工作区>/comfyui-output` 一棵并进写入授权，相册的读取授权也追加同一份（只修写入侧会变成"产物落对了、相册却列不出来、`/file` 还 403"）。该目录做 `canonical`，否则工作区是 junction / 符号链接时产物目录会把自己拒掉。配置项 `outputDir` 仍然最优先；面板直连（`runMode=direct`）与面板续查没有会话上下文，仍用启动期目录。
- **热度阈值是死旋钮**：参数写成 `post_count_gte`（Danbooru 不认，静默忽略），无论传多少都返回最热的那批。正确写法是 `search[post_count]=>N`。
- **限流下别名大面积丢失却报"同步完成"**：网络错误被一律当成"查不到"，覆盖率从 94% 掉到 61% 而日志正常。现在区分失败与空结果，日志报失败条数，退避吃服务端 `Retry-After`（30 秒上限）。
- **在线查询给出与本地不同的答案**：取 wiki 返回的第一条（顺序不代表热度）。改为逐条回查 `post_count` 后取最热。
- **在线被限流时静默返回空**：用户分不清"名字错了"与"被限流"。现在两种文案分开。
- **`404` 判定用错误文本匹配**：tag 名里可能含 404。改用状态码。
- **脚本参数传非法值时回退成 1/NaN**：`--min` 不带值会让 `Number(true) = 1`，静默跑成全量（全量 40 万条，实测 3~4 条/秒，约 30 小时）。现在挡类型。

### 工程

- **测试一直在测旧的 `lib`**：`npm test` 直接跑产物，而改代码只改 `src` —— 忘了 build 就变成"测试全绿、发包是旧的"。加 `pretest` 自动 build，守护断言明确盯产物（`lib/entries/gallery.js`）而不是源码。另加 `prepublishOnly` 在发布前重建，保证包内 `lib` 与 `src` 同步。
- 修掉五处形同虚设的测试（都是变异验证揭出来的）：断言硬依赖本机磁盘路径；某条靠"路径不存在"蒙对了规则；只测工具函数、没测工具有没有把参数传下去；测试自己传参数，测的是"支持"而不是"接没接上"；守护读 `src` 而运行时走 `lib`。
- **用户自己的库不会顶掉随包数据**：读路径优先用户数据目录、没有才回退包内；写路径只写用户目录，
  且 `writeStore` 拒绝任何指向随包数据目录的目标（含大小写变体与子目录）—— 否则一次写错就把随包的 12MB 覆盖掉。
- `files` 去掉一个不存在的根级 `client.js`。

## 0.2.0

### 修复

- **POSIX 上授权校验可被大小写绕过（读删越权）**：仓库里有两份 `authorize` / `roots` 实现 —— `shared/authz/` 一份，`panel-gallery/server/assets/` 一份，生产路由用的是后者。修前一份时漏了后一份，而它按 `toLowerCase()` 比较路径：POSIX 路径大小写敏感，`/data/App/x.png` 会被判在根 `/data/app` 之内而**放行**，随后 `statSync` / `unlinkSync` 用的却是原始路径 —— 校验通过的是 A，实际动的是 B。现在两处各一行 `export * from shared/authz/*`，只保留一份实现；折叠规则抽成 `foldPathCase`（Windows 折叠、其余平台原样），授权 / 根去重 / 缩略图缓存 / 扫描去重 / 工作区探测五处共用。
- 顺带补了两条此前抓不住的断言：同前缀兄弟目录（`/data/apple` 不属于 `/data/app`，把分隔符判断退化后会误放行），以及用 ghost 路径测 POSIX 大小写拒绝（不存在的路径会让 `canonical` 回退 `path.resolve`、保留原样）。
- **产物落到插件私有目录，而不是用户的工作区**：服务名取错。宿主服务叫 `workspaceRegistry`，`workspace` 只是它在 storages 里的**域名**（`workspace.json` 的 `unit.name`）—— 代码按域名去取，`ctx.get('workspace')` 恒为 `undefined`，工作区探测永远跳过这一级，产物一路退到 `~/.dsh-comfyui-workbench/outputs`，且没有任何报错。同时把 `workspaceRegistry` 加进包根 entry 的 `inject`：它不是"可见性"开关（`ctx.reflect.get` 本就不要求注入），而是**时序**——服务未就绪时 fiber 处于 INACTIVE、`apply` 不执行，探测会等它 ACTIVE 之后再跑。`GET /config` 的 `workspaceProbe` 可复核（`serviceCount` 应大于 0、`outputSource` 应为 `service`）。
- **同一工作区因路径大小写/分隔符不同而认不出来**：Windows 路径大小写不敏感、宿主给的 path 也可能是正斜杠，直接字符串比较会漏匹配、退回列表首项。比较前统一分隔符，并在 Windows 上折叠大小写（Unix 保持敏感，避免 `/srv/App` 与 `/srv/app` 撞在一起）；返回给调用方的仍是宿主原始形态。
- **多工作区时产物落到父工作区根下**：`related` 用 `paths.find` 取第一个前缀匹配，而 `D:\dsh` 与 `D:\dsh\notes` 可能都是 cwd 的祖先，靠前的先命中就返回。改为归一化分隔符后按路径长度降序取**最深**的那层。顺带修了正斜杠路径比不中的问题（Windows 下 `D:/x` 与 `D:\x` 直接比较永远不等）。
- **`comfyui_run` 的 `wait` / `waitMs` / `tags` 从未生效**：`execute` 一直在读这三个参数，但 schema 里没有声明，`additionalProperties:false` 下模型根本传不进来——「默认异步、可选同步等待」里的同步分支是死代码，产物索引的 tags 也恒为空。已补进 schema（`timeoutMs` 标为已弃用，语义并入 `waitMs`）。
- **出图通知可能重复投递**：`watchRun` 用 `setInterval` 轮询且不等上一轮 async 结束，`stop()` 又排在两个 `await` 之后 —— 响应稍慢时两个 tick 会同时读到 done，各投递一条通知（全量跑测试约 1/3 概率出现"收到 2 条"）。补 `settled`（只交付一次）与 `inflight`（防重入，`finally` 复位）守卫，完成 / 失败 / 超时三条路径语义一致；`settled` 只在真正投递前才置位，拼装通知文本若抛错仍会走失败通知而不是静默。另外两处 `logger.warn` 调用各自包了 `try` —— logger 是外部注入的，它自己抛错不该让通知丢失，更不该逃逸成 unhandledRejection（Node 默认因此结束宿主进程）。
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

- 测试覆盖：架构、静态、类名、宿主接口、客户端渲染、IO 面与变量、索引、执行链、HTTP 契约、服务托管、通知投递、组件隔离、目录解析。

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
