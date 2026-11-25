/**
 * 为本地开发仓库启用 `.githooks`（ESLint 契约检查、类型检查、架构门禁）。
 *
 * 注意：故意不挂在 `package.json` 的 `prepare` 生命周期里 ——
 * 本包 `lib/` 已预编译入仓，一旦声明 `prepare`，`pnpm add github:...` 会在无 `.git`
 * 的临时目录里强行跑 `npm install` 拉全量 `devDependencies`（并在 Windows cmd 下翻车，
 * 见 issue #6）。本地开发者克隆后按需运行 `npm run hooks:install` 即可。
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const gitMarker = path.join(repoRoot, '.git')

if (!fs.existsSync(gitMarker)) {
  console.log('[hooks:install] 未检测到 .git（非源码仓库目录），已跳过 git hooks 配置。')
  process.exit(0)
}

execFileSync('git', ['config', 'core.hooksPath', '.githooks'], { cwd: repoRoot, stdio: 'inherit' })
console.log('[hooks:install] 已启用仓库原生 hooks：core.hooksPath = .githooks')
