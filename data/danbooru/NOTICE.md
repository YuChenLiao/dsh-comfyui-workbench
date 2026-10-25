# 第三方数据说明

本目录下的 `characters.jsonl` 与 `artists.jsonl` 来自：

- **danbooru-tags-data-zh** — https://github.com/amenorira/danbooru-tags-data-zh
- 作者：amenorira
- 许可：MIT（见同目录 `LICENSE`，版权声明与许可全文随数据一同保留）

## 内容

Danbooru 标签的中文翻译数据库，收录时图片数 > 50 的标签：

| 分类 | 条数 | 有中文名或别名 |
| --- | --- | --- |
| 角色 character | 35384 | 99.7% |
| 画师 artist | 24881 | 95.8% |

每个标签含：标准 tag 名、Danbooru 帖子数、中文名（排在首位）、常用别名（含社区昵称与旧译名）、一句注释。

## 我们做了什么转换

原仓库发布的是 CSV（`tags/*.csv`，表头 `tag,category,aliases,zh,count,notes`）。本目录的 JSONL 由 `scripts/import-danbooru-zh.mjs` 转换而来：

- `zh` 放进 `names[0]`（查询时中文名优先），`aliases`（`|` 分隔）按序附后
- `count` → `postCount`
- `notes` → `note`（只入库、不进查询输出）
- 字段名做了本地化映射，除此之外**未改动内容**

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
