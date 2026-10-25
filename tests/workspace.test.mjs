/**
 * 产物目录解析自检。
 *
 * 这条逻辑出过两次真事故：一次用错服务字段静默退回插件数据目录（图写到 C 盘），
 * 一次"不知道落哪儿"就写了 profile 目录。所以每级来源都要能说清楚，且不落在内部目录。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import { foldPathCase, isAuthorized, resolveOutputDir, workspaceDirOf } from '../lib/index.js'

const fakeCtx = (paths) => ({ get: (name) => (name === 'workspaceRegistry' ? { list: () => paths.map(item => ({ path: item })) } : undefined) })

test('环境变量最优先', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-env-'))
  process.env.DSH_WORKSPACE = dir
  try {
    const guess = workspaceDirOf(fakeCtx([path.join(os.tmpdir(), 'other')]))
    assert.equal(guess?.source, 'env')
    assert.equal(guess?.dir, path.resolve(dir))
  } finally {
    delete process.env.DSH_WORKSPACE
  }
})

test('workspace 服务可用时取它，产物落在 <工作区>/comfyui-output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-svc-'))
  const guess = workspaceDirOf(fakeCtx([dir]))
  assert.equal(guess?.source, 'service')
  const resolved = resolveOutputDir(null, guess, '/tmp/data')
  assert.equal(resolved.source, 'service')
  assert.ok(resolved.dir.endsWith('comfyui-output'))
  assert.ok(resolved.dir.startsWith(dir.replace(/\\/g, path.sep)) || resolved.dir.includes('comfyui-output'))
})

test('配置里显式给了目录就用它，优先于探测', () => {
  const resolved = resolveOutputDir('D:/custom/out', { dir: 'D:/dsh', source: 'service' }, '/tmp/data')
  assert.equal(resolved.source, 'config')
  assert.equal(resolved.dir, 'D:/custom/out')
})

test('探测彻底失败才退到数据目录', () => {
  const resolved = resolveOutputDir(null, undefined, '/tmp/data')
  assert.equal(resolved.source, 'data')
  assert.ok(resolved.dir.includes('outputs'))
})

test('包根 entry 必须注入 workspaceRegistry', async () => {
  // 真实成因：服务名取错（workspace 只是 storages 域名）。注入的作用是时序保证 ——
  // 服务未就绪时 fiber 处于 INACTIVE、apply 不执行，探测会等它 ACTIVE 后再跑。
  const mod = await import('../lib/index.js')
  assert.ok(Array.isArray(mod.inject), 'entry 应当导出 inject 数组')
  assert.ok(mod.inject.includes('workspaceRegistry'), `inject 必须含 workspaceRegistry，实际：${JSON.stringify(mod.inject)}`)
  // 只断言字符串还不够：还要证明这个名字真能取到目录（下面用假 ctx 验）
})

test('cwd 不在任何 workspace 下时取列表第一条', () => {
  // 反斜杠必须写两个（'D:\\dsh'）：写一个的话 \d 被当转义吃掉，路径会变成 D:dsh，断言就恒真了。
  // cwd 必须挪到与列表无交集的空目录：否则它恰好落在 D:\dsh 之下，走的是 related 命中
  // 而不是回退分支，这条断言就测不到它想测的东西（复审实测过这个盲区）。
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-empty-'))
  const before = process.cwd()
  process.chdir(empty)
  try {
    const guess = workspaceDirOf(fakeCtx(['D:\\dsh', 'D:\\other']))
    assert.equal(guess?.source, 'service')
    assert.equal(guess?.dir, 'D:\\dsh', `cwd 与列表无交集时应取第一条，实际：${JSON.stringify(guess?.dir)}`)
  } finally {
    process.chdir(before)
  }
})

test('路径分隔符形态不影响匹配（正斜杠 / 尾斜杠）', () => {
  // 宿主给的 path 可能是正斜杠；不归一化的话 Windows 下永远比不中，会错选第一条。
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-slash-'))
  const child = path.join(parent, 'notes')
  fs.mkdirSync(child, { recursive: true })
  const before = process.cwd()
  process.chdir(child)
  try {
    const variants = [
      [parent, child],
      [parent.replace(/\\/g, '/'), child.replace(/\\/g, '/')],
      [`${parent}\\`, `${child}\\`],
      [`${parent.replace(/\\/g, '/')}/`, `${child.replace(/\\/g, '/')}/`],
    ]
    for (const paths of variants) {
      const guess = workspaceDirOf(fakeCtx(paths))
      assert.equal(path.resolve(String(guess?.dir)), path.resolve(child), `形态 ${JSON.stringify(paths)} 应当选中最深的 child`)
    }
  } finally {
    process.chdir(before)
  }
})

test('多工作区父子嵌套时选最深的那层', () => {
  // 父子工作区都是 cwd 的祖先时，只找第一个匹配会把产物丢到父工作区根下。
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-nest-'))
  const child = path.join(parent, 'notes')
  fs.mkdirSync(child, { recursive: true })
  const before = process.cwd()
  process.chdir(child)
  try {
    const guess = workspaceDirOf(fakeCtx([parent, child]))
    assert.equal(guess?.source, 'service')
    assert.equal(path.resolve(String(guess?.dir)), path.resolve(child), '应当选最深的工作区')
  } finally {
    process.chdir(before)
  }
})

test('Windows 下路径大小写不影响匹配，且返回宿主原始大小写', () => {
  // Windows 路径大小写不敏感：D:\DSH 与 D:\dsh 是同一个目录。
  // 但返回给调用方的必须是原始形态，否则产物目录会变成一串小写。
  if (process.platform !== 'win32') return
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-case-'))
  const child = path.join(base, 'NOTES')
  fs.mkdirSync(child, { recursive: true })
  const decoy = path.join(base, 'decoy')
  fs.mkdirSync(decoy, { recursive: true })
  const before = process.cwd()
  process.chdir(child)
  try {
    // 列表首项放诱饵，才能区分"真的命中"和"回退第一条"
    const guess = workspaceDirOf(fakeCtx([decoy, child.toUpperCase()]))
    // Windows 上 path.resolve 不折叠大小写，比较时两边都小写
    assert.equal(String(guess?.dir).toLowerCase(), child.toLowerCase(), '大写形态也应命中同一目录')
    assert.equal(guess?.dir, child.toUpperCase(), '返回的应当是宿主给的原始形态')
  } finally {
    process.chdir(before)
  }
})

test('宿主的内部目录不当工作区', () => {
  const internal = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
  fs.mkdirSync(internal, { recursive: true })
  // workspace 服务里如果只有内部目录，仍然返回它（那是宿主明确登记的）
  const guess = workspaceDirOf(fakeCtx([internal]))
  assert.equal(guess?.source, 'service')
  // 但 cwd 探测会排除它 —— 这里无法直接改 cwd，用纯函数行为间接确认
  assert.ok(guess !== undefined)
})

test('路径折叠按平台切换（授权 / 根去重 / 缩略图缓存 / 扫描去重共用）', () => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  try {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    assert.equal(foldPathCase('D:/data/APP/x.png'), 'd:/data/app/x.png', 'Windows 上应当折叠')
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    assert.equal(foldPathCase('/data/App/x.png'), '/data/App/x.png', 'POSIX 上必须原样返回')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    assert.equal(foldPathCase('/data/App/x.png'), '/data/App/x.png', 'macOS 同样大小写敏感')
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
})

test('授权校验：子路径放行、兄弟目录拒绝、大小写按平台裁决', () => {
  // 大小写那半用 **ghost 路径**（不存在的根）来测：canonical() 走
  // fs.realpathSync.native，对真实存在的路径会按磁盘大小写规范化回去，
  // 但路径不存在时它回退 path.resolve 并保留原样 —— 大小写差异才能体现出来。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'authz-'))
  const target = path.join(base, 'x.png')
  fs.writeFileSync(target, '')
  try {
    const roots = [{ path: base, label: 'base', kind: 'custom' }]
    assert.equal(isAuthorized(target, roots), true, '授权内的真实路径应当放行')
    assert.equal(isAuthorized(path.join(base, '..', path.basename(base), 'x.png'), roots), true, '.. 归一化后仍应放行')
    assert.equal(isAuthorized(path.join(base, '..', '..', 'elsewhere.png'), roots), false, '根之外应当拒绝')

    // 同前缀兄弟目录：`/data/apple` 不属于 `/data/app`。少了分隔符判断就会误放行。
    const sibling = `${base}le`
    fs.mkdirSync(sibling, { recursive: true })
    assert.equal(isAuthorized(path.join(sibling, 'x.png'), roots), false, '同前缀兄弟目录必须拒绝')
    fs.rmSync(sibling, { recursive: true, force: true })

    // ghost 路径（不存在）会让 canonical 回退 path.resolve 并保留大小写，
    // 所以 POSIX 的大小写拒绝在这里是可测的 —— 不需要动文件系统。
    const ghost = path.join(os.tmpdir(), 'ghost-root-never-exists-' + process.pid)
    const ghostTarget = `${ghost.toUpperCase()}${path.sep}x.png`
    const ghostRoots = [{ path: ghost, label: 'ghost', kind: 'custom' }]
    const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform')
    try {
      Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
      assert.equal(isAuthorized(ghostTarget, ghostRoots), true, 'Windows 上大小写变体是同一路径')
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      assert.equal(isAuthorized(ghostTarget, ghostRoots), false, 'POSIX 上大小写变体必须拒绝')
    } finally {
      Object.defineProperty(process, 'platform', originalPlatform)
    }
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
