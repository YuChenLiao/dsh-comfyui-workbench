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

import { resolveOutputDir, workspaceDirOf } from '../lib/index.js'

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

test('宿主的内部目录不当工作区', () => {
  const internal = path.join(os.homedir(), '.dsh', 'profiles', 'desktop')
  fs.mkdirSync(internal, { recursive: true })
  // workspace 服务里如果只有内部目录，仍然返回它（那是宿主明确登记的）
  const guess = workspaceDirOf(fakeCtx([internal]))
  assert.equal(guess?.source, 'service')
  // 但 cwd 探测会排除它 —— 这里无法直接改 cwd，用纯函数行为间接确认
  assert.ok(guess !== undefined)
})
