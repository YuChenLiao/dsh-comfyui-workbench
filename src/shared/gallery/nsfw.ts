/**
 * NSFW 判定（启发式）。
 *
 * 这不是分类器，是一张词表加阈值 —— 目的只是让用户能一键把明显不该在公共场合
 * 出现的东西从列表里藏掉。
 *
 * 三条设计约束，都是踩过之后改的：
 *
 * ① **存词根，不存复数**。判定是子串匹配，存 `breasts` 就漏 `breast`。所以词表里
 *    全是 `breast` / `nipple` / `panty` 这样的词根，复数自然被包含。
 * ② **不用下划线做词边界**。ComfyUI 的 tag 里 `lewd` 与 `lewd_pose` 都会出现，
 *    写成 `lewd_` 就漏掉裸写的那种。
 * ③ **负向提示词不参与判定**。Danbooru 系底模（AnimagineXL / Pony）的官方推荐
 *    负向模板里就写着 `nsfw` —— 拿它判定会让用户一整库图都被藏掉，而实际上
 *    那正是在"排除"成人内容。
 *
 * 误伤比漏判更烦：用户不知道为什么少了一张图。所以中信号要凑够两个才算。
 */

/** 命中即判定的词根。正常向的图几乎不会写这些。 */
const STRONG = [
  'nsfw',
  'explicit',
  'hentai',
  'r18',
  'rule34',
  'ahegao',
  'pussy',
  'pussies',
  'penis',
  'vagina',
  'areola',
  'genital',
  'semen',
  'sexual',
  'bdsm',
  'erotic',
  'nudity',
  'cameltoe',
  'oppai',
  // 中文：这几个词不会出现在正常描述里
  '色情',
  '裸体',
  '完全裸露',
  '完整裸露',
  '赤裸',
  '全裸',
  '半裸',
  '性交',
  '露点',
]

/**
 * 需要凑够 {@link MEDIUM_THRESHOLD} 个才判定的词根。
 *
 * `breast` / `nipple` 这类是解剖练习与泳装图的标配，单命中绝不能算 —— 动漫 tag
 * 里它们和 SFW 高度重叠。
 */
const MEDIUM = [
  'nude',
  'naked',
  'topless',
  'breast',
  'nipple',
  'lingerie',
  'bondage',
  'underwear',
  'panty',
  'cleavage',
  'seductive',
  'lewd',
  'ecchi',
  'booty',
  'cum',
  'sex',
  // 「裸露」单独出现太常见（“肩头裸露”“背部裸露”都是正常穿着描述），
  // 363 张真实语料里它单命中会误伤 4 张 SFW 插画。降级后要配一个别的才判。
  '裸露',
  // 「乳房」是明确指向，配上「赤裸」就能接住兔女郎那类描述。
  '乳房',
]

/** 中信号要几个才算。取 2 是在"挡住明显的"与"别把泳装藏了"之间的折中。 */
const MEDIUM_THRESHOLD = 2

/** 参与判定的字段。 */
export interface NsfwSource {
  name?: string | undefined
  prompt?: string | undefined
  /** 保留字段但**不参与判定** —— 见文件头第 ③ 条。 */
  negativePrompt?: string | undefined
  checkpoint?: string | undefined
  /** 工作流 id 或备注里可能直接写着 nsfw。 */
  workflowId?: string | undefined
}

/** 判定结果：`why` 只用于诊断，不进界面。 */
export interface NsfwVerdict {
  nsfw: boolean
  why: string[]
}

/**
 * 判定一条资产是不是 NSFW。
 *
 * 只扫名字、正向提示词、底模名与工作流 id —— 都是已经在列表数据里的字段，不额外读盘。
 *
 * @param item - 列表项（字段可缺）。
 * @returns 判定与命中原因。
 */
export function nsfwVerdictOf(item: NsfwSource): NsfwVerdict {
  const text = [
    item.name ?? '',
    item.prompt ?? '',
    item.checkpoint ?? '',
    item.workflowId ?? '',
  ].join(' ').toLowerCase()

  if (text.trim() === '') return { nsfw: false, why: [] }

  const strong = STRONG.filter(word => text.includes(word))
  if (strong.length > 0) return { nsfw: true, why: strong }

  const medium = MEDIUM.filter(word => text.includes(word))
  if (medium.length >= MEDIUM_THRESHOLD) return { nsfw: true, why: medium }

  return { nsfw: false, why: medium }
}

/** 布尔版，调用方多数时候不需要原因。 */
export function isNsfw(item: NsfwSource): boolean {
  return nsfwVerdictOf(item).nsfw
}
