# 工具瘦身方案（16 → 12）

> 结论先行：**该合的是「同一对象的读操作」，不合的是「失败后下一步不同」的。**
> 16 个工具减到 12 个，另外把 `comfyui_run` 的参数从 9 个减到 6 个。

## 判据

两个工具可以合并，当且仅当三条同时成立：

1. 操作**同一个对象**（同一个名词）
2. **失败后的下一步相同**（错误信息能合并成一句有用的话）
3. **互斥关系天然清晰**（给了 A 就不该给 B，且模型自己能判断）

第三条最卡人：把三个工具塞进一个带 `mode` 的大 schema，工具数是少了，但模型要在更大的参数空间里猜——不比多一次选择轻松。

## 一、素材库：4 → 2（建议先做，风险最低）

`comfyui_pose_search` + `comfyui_pose_fetch` → `comfyui_pose`
`comfyui_costume_search` + `comfyui_costume_fetch` → `comfyui_costume`

```ts
comfyui_pose { query?, system?, category?, onlySafe?, limit?, id?, size? }
comfyui_costume { query?, category?, onlySafe?, limit?, id?, size? }
```

- `query` 与 `id` 互斥：给 `query` 是搜，给 `id` 是取图。写进描述第一句。
- **顺带带上缩略图路径**：搜索结果每项加 `thumb`（可直接当参考图），这样「搜 → 挑一个 → 用」从两次调用变成一次，`fetch` 退化成「要原图或别的尺寸时才用」。
- **减少调用次数比减少工具数更有价值**：工具数是看目录的负担，调用次数是每一步的实际成本。

改动点：`panel-poses/server/tools.ts`、`panel-costumes/server/tools.ts`、skill 正文四句话、README 工具表、`tests/api.test.mjs` 名字清单、`tests/components.test.mjs` 计数、`compose.ts` 两处报错文案（`comfyui_pose_search` / `comfyui_costume_search` → 新名）。

**不做 4 → 1**：姿势多一个 `system`（衣装没有对应概念，合并后是噪声）；`category` 是两套完全不同的词表（动作分类 vs 穿搭场景）；返回值一个是多角度、一个带英文关键词；最根本的是两者用途不同——姿势控构图（ControlNet 吃线稿），衣装控外观（IPAdapter + 关键词）。模型选哪个是**意图判断**，不该降级成一个 `kind` 参数。

## 二、工作流查询：2 → 1

`comfyui_workflow_list` + `comfyui_workflow_inspect` → `comfyui_workflow`

```ts
comfyui_workflow { workflowId?, nodeId?, q?, inputs?, includeDisabled? }
```

不给 `workflowId` 是列表，给了是详情，`nodeId` 再细到节点。参数总数不变（现在 2+3=5），但模型不用再决定「该调 list 还是 inspect」。

**顺带把「体检」挂进来**（不新增第 17 个工具）：`comfyui_workflow { audit: true }` 扫全部模板，逐个拿 `/object_info` 对一遍，报「哪些 `class_type` 已不存在、哪些输入槽名变了、哪些模型名查不到」，按「必然跑不起来 / 可能跑偏 / 健康」分三档。

## 三、`comfyui_run` 参数瘦身：9 → 6（比合并工具更直接）

- 删掉已废弃的 `timeoutMs`、`returnImages`（描述里自己写着 deprecated）
- `wait` 与 `waitMs` 合成一个：`wait` 收 `true | false | 毫秒数`

影响的是每一步都要读的那个 schema，**比合并工具更能降低模型看错的概率**。

## 四、不合并的（理由存下来，免得明天再犹豫）

**run 家族（`run` / `run_batch` / `rerun` / `compose`）保持四个。** 名字确实都带 run，但它们失败的下一步完全不同：`run` 失败看 `comfyui_runs` 的失败分类；`run_batch` 失败要回答「哪一条、为什么」；`rerun` 失败多半是 sidecar 指向的模板变了，下一步是查 sidecar；`compose` 失败根本没提交。合并后错误信息退化成「某模式某阶段出错」，模型要多花一轮定位。

**`compose` 与 `run` 的分离尤其不能动**：compose 无副作用，可以安全重试、可以先看 assumptions 再决定跑不跑。合并等于把「预备」和「开火」混成一个动作。

**`comfyui_runs` 不能并进 `run` 的 `promptId` 续查分支**：一个有副作用的提交，一个纯查询，副作用边界不同。

run 家族的混淆用**引导**解决，成本远低于合并：每个工具描述第一句改成自解释的差异（「这条是复现一张已经出过的图，不是新跑一批」）；失败返回里直接写下一步；skill 里给一张「想干什么 → 用哪个」的四行表。

## 五、验证

每组做完都要：

1. `npx tsc --noEmit`
2. `npm test`（现在能从第一步跑到最后，528 条）
3. `node tests/arch.mjs`
4. 改名的组额外确认：`grep -r 'comfyui_pose_search\|comfyui_costume_search\|comfyui_workflow_list\|comfyui_workflow_inspect' src tests README.md` 无残留
5. 数字断言同步：工具数 16 → 12（`tests/api.test.mjs`、`tests/components.test.mjs`、skill 正文「十六个工具」）
6. 走一遍审查再提交（项目硬规则）

## 六、顺序

1. 素材库 4 → 2（纯只读，失败后下一步本来相同，风险最低）
2. 工作流查询 2 → 1 + 体检
3. `comfyui_run` 参数瘦身
4. 最后统一改数字断言与文档

## 七、兼容性

工具名是 DSH 侧的契约，改名会让旧对话里的调用失效。我们还在 0.6.x、用户少，现在改代价最小，再攒两个版本就不好动了。

版本建议：这批改动合并后发 **0.7.0**（有破坏性重命名，按语义化版本不该是 patch）。
