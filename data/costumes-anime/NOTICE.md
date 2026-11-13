# 动画版衣装库的数据来源与版权

本目录下的 `catalog.json` 是**元数据**，不是图片。它只有 1320 套衣装的编号、分类、中文标签、
**英文关键词**与图片地址。一张服装图都不在仓库里。

## 谁的数据

| | |
|---|---|
| 衣装集 アニメ版 COSTUME-ANIME-DB 的制作者 | **ギア**（[@giaaibusi](https://x.com/giaaibusi)），原站 <https://ai-costume-anime-gallery.pages.dev> |
| 中文索引与整理 | **Deeyu**，[ai-costume-gallery-zh](https://github.com/Deeyu/ai-costume-gallery-zh) 的 `costume-anime/` |
| 本目录的整理产物 | 本插件，由 `scripts/import-costumes-anime.mjs` 生成 |

1320 套按八类分开：春装 197、夏装 237、秋装 230、冬装 232、内衣 197、派对 36、泳装 52、性感 139。
其中内衣 / 性感 / 泳装三类共 388 套标为 `adult: true` —— **只标注，不做默认过滤**，要不要排除由调用方传 `onlySafe` 决定。

与 `data/costumes/`（写实版 1407 套）是**同一个作者、同一套规格**：都是不含人物的衣装搭配、
带中文标签与英文关键词。区别是画风 —— 那个是实拍照，这个是二次元。

## 图片怎么用

**运行时不随包分发图片。** 需要时经本插件的服务端代理按需读取
`https://ai-costume-anime-gallery.pages.dev/{thumbs,img,png}/<编号>.<webp|png>`，
落盘到 `<插件数据目录>/cache/costumes-anime/`（本机缓存，不再分发）。

代理的白名单与写实版**不是同一条**：动画版的路径少一层 `costume/`，而且原图是 **png** 不是 webp。

## 使用限制

上游的授权是：这些图可以**用作创作参考**（包括编辑与商业作品中的参考），署名可选。但：

- **禁止再分发、转载或转售图像数据本身** —— 原尺寸和加工后的版本一样算
- **禁止批量下载（含工具自动获取）**

所以本插件只做**逐张按需取**：用户或模型明确要某一套时取那一张。**不做预取、不做镜像、
不提供批量打包**。这条不是我们的选择，是上游的条件。

本插件的 MIT 许可只覆盖它自己的代码（导入脚本、索引、代理、面板、工具），**不覆盖**任何一张服装图。

## 怎么更新

```sh
npm run costumes-anime:import     # 从上游拉最新快照并重新生成 catalog.json
npm run costumes-anime:check      # 只校验，不写盘
```

上游快照日期见产物里的 `generatedAt`。
