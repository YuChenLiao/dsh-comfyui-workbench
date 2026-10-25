/**
 * 构建入口：把 src/ 打成产物。
 *
 *   src/index.ts  → lib/index.js  （宿主侧，ESM，node 平台）
 *   src/client/   → lib/client.js （浏览器侧，__ModuleLoader__ 形态；随客户端组件一起接入）
 *
 * 源码按组件拆分，产物各自打包成单文件：DSH 的 loader 只加载单入口，
 * 多文件产物只会多一层相对路径与模块解析风险，没有收益。
 */
import { build, context } from 'esbuild'
import fs from 'node:fs'

const watch = process.argv.includes('--watch')

/** 宿主侧：sharp 是可选动态 import（未安装时插件回退原图），必须 external。 */
const hostJob = {
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*', 'sharp'],
  sourcemap: false,
  logLevel: 'info',
}

/** 客户端：React 由宿主注入（factory 的 require），必须 external。
 *  产物用 cjs 打底再由 banner/footer 包成 __ModuleLoader__ 的 factory ——
 *  这样文件里没有任何 import，既能在浏览器里跑，也能被 node 直接 import 做 SSR 自检。 */
const clientJob = {
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'chrome120',
  jsx: 'automatic',
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "dsh-comfyui-workbench", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  },
  footer: { js: 'return module.exports; } });' },
  sourcemap: false,
  logLevel: 'info',
}

/**
 * 测试与调试用的域产物：ESM 单文件，便于 node 直接 import（不经过宿主入口）。
 *
 * 产物名与源码目录解耦 —— 重构后 `workflow` 在 `shared/` 下、`store` 在相册组件里，
 * 但测试与外部脚本仍按 `lib/workflow.js` 这类稳定名字引用。
 */
const domainJob = (name, dir = name) => ({
  entryPoints: [`src/${dir}/index.ts`],
  outfile: `lib/${name}.js`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*'],
  sourcemap: false,
  logLevel: 'info',
})

/** 四个组件各自一个入口：宿主按 entry 分别加载，才能单独开关。 */
const entryJob = name => ({
  entryPoints: [`src/entries/${name}.ts`],
  outfile: `lib/${name}.js`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  external: ['node:*', 'sharp'],
  sourcemap: false,
  logLevel: 'info',
})

const jobs = [
  entryJob('gallery'),
  entryJob('workflow'),
  entryJob('generate'),
  entryJob('edit'),
  hostJob,
  clientJob,
  domainJob('workflow', 'shared/workflow'),
  domainJob('store', 'components/panel-gallery/server/store'),
  domainJob('run', 'shared/run'),
  domainJob('comfy', 'shared/comfy'),
]

fs.mkdirSync('lib', { recursive: true })

if (watch) {
  for (const job of jobs) {
    const ctx = await context(job)
    await ctx.watch()
    console.log(`[build] watching ${job.entryPoints[0]}`)
  }
} else {
  for (const job of jobs) await build(job)
}
