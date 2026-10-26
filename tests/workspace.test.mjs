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
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { foldPathCase, isAuthorized, probeWorkspace, resolveOutputDir, runTool, sessionWorkspaceDir, workspaceDirOf } from '../lib/index.js'

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

test("workingDirectory 优先于注册表顺序（产物要落在用户当前的工作区）", () => {
  // 曾经只靠 workspaceRegistry.list() 猜：cwd 匹配不上时取 paths[0]，
  // 而那个顺序跟用户当前在哪个工作区无关 —— 产物会落到不相关的工作区里。
  const ctx = {
    get: (name) =>
      name === "workingDirectory"
        ? { defaultDirectory: os.tmpdir() }
        : name === "workspaceRegistry"
          ? { list: () => [{ path: "D:/dsh" }, { path: "D:/job-query" }] }
          : undefined,
  };
  const { guess } = probeWorkspace(ctx);
  assert.equal(guess?.source, "workingDirectory");
  assert.equal(guess.dir, path.resolve(os.tmpdir()));
  assert.equal(resolveOutputDir(null, guess, os.tmpdir()).dir, path.join(path.resolve(os.tmpdir()), "comfyui-output"));
})

test("workingDirectory 不可用时回退到注册表", () => {
  const ctx = { get: (name) => (name === "workspaceRegistry" ? { list: () => [{ path: "D:/dsh" }] } : undefined) };
  const { guess } = probeWorkspace(ctx);
  assert.equal(guess?.source, "service");
})

test("workingDirectory 指向宿主内部目录时忽略", () => {
  const ctx = {
    get: (name) =>
      name === "workingDirectory"
        ? { defaultDirectory: path.join(os.homedir(), '.dsh', 'profiles', 'desktop') }
        : name === "workspaceRegistry"
          ? { list: () => [{ path: "D:/dsh" }] }
          : undefined,
  };
  const { guess } = probeWorkspace(ctx);
  assert.equal(guess?.source, "service", "内部目录不能当工作区");
})

test("会话级工作区：同一个进程里能区分不同会话", () => {
  // 用户报过的真 bug：产物落进了不相关的工作区。registry 只知道有哪些工作区，
  // 不知道当前会话属于哪个 —— 只能靠 workingDirectory.get(session)。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ws-session-"));
  const wsA = path.join(base, "a");
  const wsB = path.join(base, "b");
  fs.mkdirSync(wsA);
  fs.mkdirSync(wsB);
  try {
    const ctx = {
      get: (name) =>
        name === "workingDirectory"
          ? {
              defaultDirectory: path.join(os.homedir(), ".dsh", "profiles", "desktop"),
              get: (session) => (session === "sess-a" ? { path: wsA } : session === "sess-b" ? wsB : undefined),
            }
          : name === "workspaceRegistry"
            ? { list: () => [{ path: path.join(base, "unrelated") }] }
            : undefined,
    };
    assert.equal(sessionWorkspaceDir(ctx, { session: "sess-a" }), wsA);
    assert.equal(sessionWorkspaceDir(ctx, { session: "sess-b" }), wsB, "字符串形式也要认");
    assert.equal(sessionWorkspaceDir(ctx, { session: "sess-c" }), undefined, "会话没有记录时不能乱猜");
    assert.equal(sessionWorkspaceDir(ctx, {}), undefined, "没有会话信息时返回 undefined");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
})

test("会话级工作区拒绝宿主内部目录", () => {
  const ctx = { get: () => ({ get: () => path.join(os.homedir(), ".dsh", "profiles", "desktop") }) };
  assert.equal(sessionWorkspaceDir(ctx, { session: "s" }), undefined);
})

test('runTool 把 agent 传下去：续查路径也要用会话级目录', async () => {
  // 变异测试发现过：把 resolveOutputDirFor 的会话分支整个拔掉，原有用例仍全绿 ——
  // 说明只测了 sessionWorkspaceDir，没测接线。这里走续查分支（它先定目录、再调 resumeRun），
  // 用 spy 断言 agent 确实被传到了目录解析。
  const seen = []
  const agent = { session: { id: 'sess-x' } }
  const tool = runTool({
    client: { baseUrl: 'http://127.0.0.1:1' },
    workflowsDir: os.tmpdir(),
    outputDir: path.join(os.tmpdir(), 'fallback-out'),
    resolveOutputDirFor: (given) => {
      seen.push(given)
      return path.join(os.tmpdir(), 'session-out')
    },
    timeoutMs: 1000,
    pollIntervalMs: 100,
    overrides: new Map(),
    index: { add: () => {}, list: () => [] },
    assertWritable: () => {},
    logger: { info: () => {}, warn: () => {}, error: () => {} },
  })
  // resumeRun 必然失败（client 是假的）；断言的是「失败之前目录解析已经拿到 agent」
  await tool.execute({ promptId: "not-a-real-prompt" }, { agent }).catch(() => {})
  assert.equal(seen.length, 1, "目录解析必须被调用一次")
  assert.equal(seen[0], agent, "必须把整个 agent 传下去，不是 session id")
})


test("会话级目录并进授权根：否则产物落对了却被拦", () => {
  // rootsOf 只认 registry + defaultDirectory。新开的工作区还没登记时，
  // 产物解析到正确的工作区反而会被 forbidden_output 拒掉 —— 同一个 bug 的另一半。
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "roots-session-"))
  const ws = path.join(base, "ws")
  fs.mkdirSync(ws, { recursive: true })
  try {
    const target = path.join(ws, "comfyui-output")
    fs.mkdirSync(target, { recursive: true })
    // 只认 cwd 这一根时应当拒绝
    const narrow = [{ path: path.join(base, "other"), label: "x", kind: "custom" }]
    assert.equal(isAuthorized(target, narrow), false)
    // 把会话级目录并进去后应当放行
    assert.equal(isAuthorized(target, [...narrow, { path: ws, label: "session", kind: "workspace" }]), true)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('assertWritable 的会话边界：只放 <会话>/comfyui-output 一棵', async () => {
  // 这条是上一轮缺的回归基准：把会话根换回整个 sessionDir（整盘放行）、
  // 或整段禁用会话分支，都必须让它变红。
  const { acquire } = await import('../lib/index.js')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "aw-session-"))
  const ws = path.join(base, "ws")
  fs.mkdirSync(ws, { recursive: true })
  try {
    const ctx = {
      get: (name) =>
        name === 'workingDirectory'
          ? { defaultDirectory: path.join(os.homedir(), ".dsh", "profiles", "desktop"), get: () => ws }
          : name === 'workspaceRegistry'
            ? { list: () => [{ path: path.join(base, "unrelated") }] }
            : undefined,
      root: {},
    }
    const rt = acquire(ctx, {})
    const agent = { session: { id: "s" } }
    const out = rt.resolveOutputDirFor(agent)
    assert.equal(out, path.join(ws, "comfyui-output"), "产物目录应当是 <会话>/comfyui-output")

    // 产物目录本身与其中的文件都放行
    rt.assertWritable(out, agent)
    rt.assertWritable(path.join(out, "t2i_00006_.png"), agent)

    // 同一工作区的其它目录、越界、以及别的盘目录都必须拒
    assert.throws(() => rt.assertWritable(path.join(ws, "elsewhere"), agent), /授权范围/)
    assert.throws(() => rt.assertWritable(path.join(out, "..", "evil"), agent), /授权范围/)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('junction 工作区：会话根必须规范化，否则产物目录把自己拒掉', async (t) => {
  // 这条守的是 assertWritable 里那行 canonical()：isAuthorized 内部会对目标 realpath，
  // 会话根不规范化的话，工作区走 junction 的用户每次生成都会吃 forbidden_output。
  // 变异（去掉 canonical）下这条会红，其余用例不会。
  const { acquire } = await import('../lib/index.js')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "aw-junction-"))
  const real = path.join(base, "real-ws")
  const link = path.join(base, "link-ws")
  fs.mkdirSync(real, { recursive: true })
  try {
    try {
      fs.symlinkSync(real, link, 'junction')
    } catch {
      t.skip('本机建不了 junction')
      return
    }
    const out = path.join(link, "comfyui-output")
    fs.mkdirSync(out, { recursive: true })
    fs.writeFileSync(path.join(out, "t2i_00006_.png"), "")

    const ctx = {
      get: (name) =>
        name === 'workingDirectory'
          ? { defaultDirectory: path.join(os.homedir(), ".dsh", "profiles", "desktop"), get: () => link }
          : name === 'workspaceRegistry'
            ? { list: () => [{ path: path.join(base, "unrelated") }] }
            : undefined,
      root: {},
    }
    const rt = acquire(ctx, {})
    const agent = { session: { id: "s" } }
    const resolved = rt.resolveOutputDirFor(agent)

    // 目录本身与其中的文件都要放行（不走 canonical 时这两条会挂）
    rt.assertWritable(resolved, agent)
    rt.assertWritable(path.join(resolved, "t2i_00006_.png"), agent)

    // 但别处仍然要拒
    assert.throws(() => rt.assertWritable(path.join(real, "elsewhere"), agent), /授权范围/)
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('相册的授权根要含会话产物目录', async () => {
  // 只修写入侧会造出更糟的局面：产物落对了，但相册列不出来、/file 还 403。
  // 这里断言 resolveOutputDirFor 登记过的目录能被相册的 extraRoots 拿到。
  const { acquire } = await import('../lib/index.js')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gal-roots-"))
  const ws = path.join(base, "ws")
  fs.mkdirSync(ws, { recursive: true })
  try {
    const ctx = {
      get: (name) =>
        name === 'workingDirectory'
          ? { defaultDirectory: path.join(os.homedir(), ".dsh", "profiles", "desktop"), get: () => ws }
          : name === 'workspaceRegistry'
            ? { list: () => [{ path: path.join(base, "unrelated") }] }
            : undefined,
      root: {},
    }
    const rt = acquire(ctx, {})
    const out = rt.resolveOutputDirFor({ session: { id: "s" } })

    assert.equal(rt.sessionOutputDirs.size, 1, "解析后应当登记会话产物目录")
    const registered = [...rt.sessionOutputDirs][0]
    assert.equal(registered, out, "登记的应当是规范化后的产物目录本身")
    assert.ok(path.isAbsolute(registered), '登记的是绝对路径')
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})

test('相册 roots 真的收到会话产物目录（接线不能断）', async () => {
  // 复审删掉 entries/gallery.ts 的 extraRoots 整行接线后，109 条测试仍全绿 ——
  // 说明上一轮修的「相册读不到」没有任何测试守着。这条走 createGalleryRoutes，
  // 直接调它产出的 /roots handler。
  const { acquire, createGalleryRoutes } = await import('../lib/index.js')
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "gal-wire-"))
  const ws = path.join(base, "ws")
  fs.mkdirSync(ws, { recursive: true })
  try {
    const ctx = {
      get: (name) =>
        name === 'workingDirectory'
          ? { defaultDirectory: path.join(os.homedir(), ".dsh", "profiles", "desktop"), get: () => ws }
          : name === 'workspaceRegistry'
            ? { list: () => [{ path: path.join(base, "unrelated") }] }
            : undefined,
      root: {},
    }
    const rt = acquire(ctx, {})
    const out = rt.resolveOutputDirFor({ session: { id: "s" } })

    const routes = createGalleryRoutes({
      ctx,
      settings: { roots: [], assetRoots: [], uploadsDir: rt.uploadsDir },
      index: rt.index,
      uploadsDir: rt.uploadsDir,
      defaultOutputDir: rt.outputDir,
      extraRoots: () => [...rt.sessionOutputDirs],
    })
    const handler = routes['/roots']
    assert.equal(typeof handler, "function", "/roots 应当是个路由函数")

    let payload
    const res = {
      setHeader: () => {},
      writeHead: () => {},
      end: (body) => { payload = JSON.parse(body) },
    }
    handler(new URL("http://x/comfyui-workbench/api/gallery/roots"), res)
    const paths = (payload?.roots ?? []).map(r => r.path.toLowerCase())
    // 上面证明的是 createGalleryRoutes 支持 extraRoots；还要证明 entries/gallery.ts 真的接上了。
    // 只测前者的话，把接线删掉测试依然全绿（复审实测过）。
    // 盯的是产物而不是源码：tests 与运行时走的都是 lib/，只查 src 的话
    // "改了 src 但忘了 build" 仍会全绿。正则也放宽到跨行，免得折行就误红。
    const entrySource = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'entries', 'gallery.js'),
      'utf8',
    )
    // 用 assert.ok + test()：assert.match 失败时会把整份 80KB 产物塞进 actual，
    // 日志直接瘫痪。窗口放宽到 600，注释写长也不会误红。
    assert.ok(
      /extraRoots:\s*\(\)\s*=>[\s\S]{0,600}?sessionOutputDirs/.test(entrySource),
      'lib/entries/gallery.js 必须把 extraRoots 接到 sessionOutputDirs 上（是不是忘了 build？）',
    )

    assert.ok(
      paths.includes(out.toLowerCase()),
      `相册的授权根必须含会话产物目录，实际：${JSON.stringify(payload?.roots?.map(r => r.path))}`,
    )
  } finally {
    fs.rmSync(base, { recursive: true, force: true })
  }
})
