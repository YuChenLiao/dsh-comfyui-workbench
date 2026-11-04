/**
 * `.css` 文件在源码里是**按文本导入**的（见 `scripts/build.mjs` 的
 * `loader: { '.css': 'text' }`）：拿到的是原始 CSS 字符串，运行时由面板
 * `<style>{...}</style>` 注入。
 *
 * 为什么不是"构建出独立 css 文件、由 HTML 引用"：客户端 bundle 是 esbuild 打成单文件、
 * 经 `__ModuleLoader__` 加载的，没有 HTML 入口可挂 `<link>`。但样式内容本身照样留在
 * 独立的 `.css` 里 —— 不写成 TS 字符串常量。
 */
declare module '*.css' {
  const css: string
  export default css
}
