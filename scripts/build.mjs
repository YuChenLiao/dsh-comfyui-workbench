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

/** 客户端：React 由宿主提供（__ModuleLoader__ 的 require），必须 external。 */
const clientJob = fs.existsSync('src/client/index.tsx')
  ? {
      entryPoints: ['src/client/index.tsx'],
      outfile: 'lib/client.js',
      bundle: true,
      format: 'iife',
      globalName: '__DSH_WORKBENCH_CLIENT__',
      platform: 'browser',
      target: 'chrome120',
      jsx: 'automatic',
      external: ['react', 'react-dom', 'react/jsx-runtime'],
      sourcemap: false,
      logLevel: 'info',
    }
  : null

const jobs = clientJob === null ? [hostJob] : [hostJob, clientJob]

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
