# 衣装库的数据来源与版权

本目录下的 `catalog.json` 是**元数据**，不是图片。它只有 1407 套衣装的编号、中文描述、
中文标签、**英文关键词**与图片地址。一张服装图都不在仓库里。

## 谁的数据

| | |
|---|---|
| 衣装集 COSTUME-DB-01 的制作者 | **ギア**（[@giaaibusi](https://x.com/giaaibusi)），原站 <https://ai-costume-gallery.pages.dev> |
| 中文名称、标签与英文关键词 | **Anhao**（[anhao/ai-pose-gallery-zh](https://github.com/anhao/ai-pose-gallery-zh)），镜像站 <https://ai-pose-gallery.anhao.app> |
| 本目录的整理产物 | 本插件，由 `scripts/import-costumes.mjs` 从上游 `data/costume-zh.json` 生成 |

1407 套按八类分开：春季穿搭 215、夏季穿搭 254、秋季穿搭 244、冬季穿搭 253、
内衣・睡衣 199、性感穿搭 140、泳装・度假 54、派对・礼服 48。

## 图片怎么用

**运行时不随包分发图片。** 需要时经本插件的服务端代理按需读取
`https://ai-pose-gallery.anhao.app/{thumbs,img}/costume/<编号>.webp`，落盘到
`<插件数据目录>/cache/costumes/`（本机缓存，不再分发）。

代理的白名单与姿势库**不是同一条**：服装多一层 `costume/`、编号带连字符、格式是 webp。
三条闸照样都在（路径白名单、host 固定为 https 图床、大小与字节头校验）。

## 使用限制

上游的授权是：这些图可以**用作创作参考**（包括编辑与商业作品中的参考），
但**禁止再分发、转载或转售图像数据本身**，原尺寸和加工后的图都一样。

本插件的 MIT 许可只覆盖它自己的代码（导入脚本、索引、代理、面板、工具），
**不覆盖**任何一张服装图。

## 怎么更新

```sh
npm run costumes:import   # 从上游拉 costume-zh.json，重写 catalog.json
npm run costumes:check    # 只校验现有 catalog，不写盘
```

导入脚本会校验：总数（1407 下界 1000）、必填字段（分类、名称）、图路径白名单、
id 不重复、以及**英文关键词是否缺失**（那是这套数据的核心价值，缺了要当场说出来）。

成人向标记写在脚本里：内衣・睡衣、泳装・度假、性感穿搭三类共 393 套。这个标记
**只用于显示与可选收窄** —— 1407 套全部默认可见，勾「只看常规」才剩下 1014 套。
