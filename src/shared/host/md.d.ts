/**
 * `.md` 文件同样按**文本**导入（见 `scripts/build.mjs` 的 `loader: { '.md': 'text' }`）。
 *
 * 用它是为了让 skill 正文保持一个真正的 Markdown 文件：能预览、能被 lint、不与代码混住 ——
 * 与样式表搬出 `.ts` 是同一条理由。
 */
declare module '*.md' {
  const content: string
  export default content
}
