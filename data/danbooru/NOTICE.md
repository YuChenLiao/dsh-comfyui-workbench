# 第三方数据说明

本目录下的 `characters.jsonl`、`artists.jsonl`、`copyrights.jsonl`、`general.jsonl` 来自：

- **danbooru-tags-data-zh** — https://github.com/amenorira/danbooru-tags-data-zh
- 作者：amenorira
- 许可：MIT（见同目录 `LICENSE`，版权声明与许可全文随数据一同保留）

## 内容

Danbooru 标签的中文翻译数据库，收录时图片数 > 50 的标签，共 **99372** 条：

| 分类 | 条数 | 上游 CSV 有中文名或别名 | 随包（去重后） |
| --- | --- | --- | --- |
| 角色 character | 35384 | 99.7% | 98.7% |
| 画师 artist | 24881 | 95.8% | 94.9% |
| 作品 copyright | 8414 | 96.6% | 96.6% |
| 通用 general | 30693 | 98.9% | 98.9% |

`general` 是动作、服装、外貌、构图这些既不是角色也不是画师的标签；`copyright` 是作品名（`touhou` → 东方Project）。

每个标签含：标准 tag 名、Danbooru 帖子数、中文名（排在首位）、常用别名（含社区昵称与旧译名）、一句注释。

## 我们做了什么转换

原仓库发布的是 CSV（`tags/*.csv`，表头 `tag,category,aliases,zh,count,notes`）。本目录的 JSONL 由 `scripts/import-danbooru-zh.mjs` 转换而来，真正的解析在 `src/components/tool-danbooru/server/upstream.ts`（面板上的「更新标签」按钮走同一段代码）：

- 按 `category` 分流：`0 → general`、`1 → artist`、`3 → copyright`、`4 → character`（`2` deprecated 与 `5` meta 不导入）
- `zh` 放进 `names[0]`（查询时中文名优先），`aliases`（`|` 分隔）按序附后
- `count` → `postCount`
- `notes` → `note`（只入库、不进查询输出）
- 字段名做了本地化映射；另做了三项整理（剔除与 tag 同名的项、去重、跳过空串），最后**逐类**去掉被多条记录共用的别名（CP 名等，同一别名只留在热度最高的那条记录上）

注意「逐类」：跨类的同名别名（如 `miku` 同时是 `hatsune_miku` 与某画师的别名）不会被去掉，查询时靠档位与热度决胜。

## 为什么不直接引用上游

数据随包内聚，是为了让 `danbooru_lookup` 装好即可用、不必先联网同步。上游更新后可以重新导入：

```sh
# 拉上游最新数据到插件数据目录（不动本目录）
npm run danbooru:zh

# 想把随包数据也更新，再把它同步过来
cp ~/.dsh-comfyui-workbench/danbooru/*.jsonl data/danbooru/
```

## 许可合规

MIT 要求「在软件的所有副本或实质部分中包含上述版权声明与许可声明」。本目录保留上游 `LICENSE` 原文，且 README 标注了来源与作者。若你要再分发本插件，请一并保留这三个文件。
