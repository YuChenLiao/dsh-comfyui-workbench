/**
 * 角色库：目录结构、五槽位、路径白名单与取图改名。
 *
 * 与姿势库、衣装库的测试分工一致：这里只测**角色库独有的东西**——
 * 一个角色挂五个固定槽位、catalog 里的每条路径必须被运行时白名单放行、
 * 以及 basename 全库相同所以落盘必须改名。
 *
 * ## 为什么值钱
 *
 * `data/characters/catalog.json` 记的是**上游**的相对路径，图一张都不在仓库里。
 * 于是有几处会安静地坏、而且坏在用户手上：
 *
 * 1. `entries/characters.ts` 的取图配置漏传 `pathPattern`、或把 `cacheSubdirs`
 *    写成 `['img']` → 每条角色图 502 / 缓存上限与 `/characters/cache` 双双失效。
 * 2. catalog 里两个角色指向同一个文件（复制粘贴错）→ 某个角色永远显示别人的图。
 * 3. 落盘不按 `<id>_<slot>` 改名 → 20 个角色的三视图互相覆盖，工作流里那条旧路径
 *    悄悄指向另一张图。
 * 4. 运行时 origin 与 catalog.origin 各拼一份 → 上游迁移后体检全绿、生产全 502。
 *
 * 白名单、取图参数、origin 拼法**全部从生产代码导入**，不在这里抄一份：抄一份
 * 等于给闸门配一把假钥匙（entries 那边把这几个参数删掉，抄出来的测试照样全绿）。
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'

import {
  bundledCharacterCatalogPath,
  characterTool,
  createCharacterRoutes,
  createCharactersIndex,
  createImageCache,
} from '../lib/index.js'
// 五个都从生产那份导入：白名单、上限、origin 拼法、取图参数。
import {
  CHARACTER_MAX_BYTES,
  CHARACTER_PATH,
  characterImageOptions,
  characterOrigin,
} from '../lib/entries/characters.js'

const ORIGIN = 'https://example.invalid'

const BUNDLED = bundledCharacterCatalogPath(new URL('../lib/index.js', import.meta.url).href)

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cwf-characters-'))
}

/** 最小合法 JPEG（FF D8 FF，后面补到 32 字节以上）。 */
function tinyJpeg(size = 64, fill = 0) {
  const buffer = Buffer.alloc(size, fill)
  buffer[0] = 0xff
  buffer[1] = 0xd8
  buffer[2] = 0xff
  return buffer
}

function readCatalog() {
  return JSON.parse(fs.readFileSync(BUNDLED, 'utf8'))
}

/** 一个角色的全部可寻址路径：preview 加上五个槽位。 */
function pathsOf(character) {
  return [
    ['preview', character.preview],
    ...Object.entries(character.slots).map(([slot, info]) => [slot, info.path]),
  ]
}

/** catalog 里出现过的槽位键集合（用于与工具的 view enum 对账）。 */
function catalogViews() {
  const views = new Set()
  for (const character of readCatalog().characters) {
    for (const slot of Object.keys(character.slots)) views.add(slot)
  }
  return [...views].sort()
}

/** 一份能过 `readCatalog` 的最小目录，用来测"缺槽位"与"热更新"这类合成场景。 */
function miniCatalog(name, slots) {
  return {
    version: 1,
    source: 'test',
    upstream: '',
    commit: '0'.repeat(40),
    origin: '',
    license: 'CC BY-NC-SA 4.0',
    attribution: '',
    note: '',
    characterCount: 1,
    categories: { 测试品牌: 1 },
    characters: [{
      id: 'c01',
      dir: '设定图/t01',
      name,
      subtitle: 't01',
      alt: name,
      brand: '测试品牌',
      preview: 'docs/previews/01.webp',
      slots,
    }],
  }
}

/** 最小 ServerResponse 替身：只提供 sendJson 与图代理真正会碰到的那几个成员。 */
function fakeRes() {
  const box = { status: 0, headers: {}, body: '' }
  const res = {
    writeHead(code, headers) {
      box.status = code
      if (headers !== undefined) Object.assign(box.headers, headers)
    },
    end(chunk) {
      if (chunk !== undefined) box.body += Buffer.isBuffer(chunk) ? chunk.toString('binary') : String(chunk)
    },
  }
  return { box, res }
}

test('随包目录：20 个角色 / 15 个品牌 / 五槽齐全，元数据自洽', () => {
  const raw = readCatalog()

  assert.equal(raw.version, 1)
  assert.equal(raw.characterCount, 20, '库内 20 个角色')
  assert.equal(raw.characterCount, raw.characters.length, 'characterCount 必须与数组长度一致')
  assert.equal(raw.license, 'CC BY-NC-SA 4.0')

  // origin 必须与**运行时那份拼法**一致：运行时根本不读 catalog.origin，
  // 两条各拼一份时，上游迁移后体检全绿、生产全 502。
  assert.equal(raw.origin, characterOrigin(raw.commit), 'catalog.origin 必须与 characterOrigin(commit) 相等')
  assert.match(raw.commit, /^[0-9a-f]{40}$/, 'commit 必须是 40 位十六进制')
  assert.ok(raw.note.includes('元数据') || raw.note.includes('不预取'), '元数据里要写清"只代理不分发"这条边界')

  const byBrand = {}
  for (const character of raw.characters) byBrand[character.brand] = (byBrand[character.brand] ?? 0) + 1
  assert.equal(Object.keys(byBrand).length, 15, '15 个品牌')
  assert.deepEqual(raw.categories, byBrand, 'categories 必须与角色实际品牌分布一致')

  const ids = new Set()
  for (const character of raw.characters) {
    assert.match(character.id, /^c\d{2}[a-z]?$/, `${character.id} 的 id 形状不对`)
    assert.equal(ids.has(character.id), false, `id 重复：${character.id}`)
    ids.add(character.id)

    for (const field of ['dir', 'name', 'subtitle', 'alt', 'brand', 'preview']) {
      assert.equal(typeof character[field], 'string', `${character.id}.${field} 必须是字符串`)
      assert.notEqual(character[field].trim(), '', `${character.id}.${field} 不能为空`)
    }

    // 五槽齐全不是"最好有"：面板按槽位数决定显示几个按钮，工具按槽位取图。
    assert.deepEqual(
      Object.keys(character.slots).sort(),
      ['expression', 'outfit', 'props', 'sheet', 'turnaround'],
      `${character.id}（${character.name}）五槽必须齐全`,
    )
    for (const [slot, info] of Object.entries(character.slots)) {
      assert.notEqual(info.label.trim(), '', `${character.id}.${slot} 缺 label`)
      assert.match(info.path, /\.(png|jpe?g|webp)$/i, `${character.id}.${slot} 不像图片路径`)
    }
  }
})

test('catalog 的 120 条路径全部通过运行时白名单，且无重复 / 无穿越 / 无越界', () => {
  const raw = readCatalog()
  const seen = new Map()
  let checked = 0

  for (const character of raw.characters) {
    for (const [slot, rel] of pathsOf(character)) {
      const where = `${character.id}.${slot}`
      checked += 1

      // 白名单不放行就是「导入成功、运行时 502」，而且 502 只出现在用户点开的那一刻。
      assert.match(rel, CHARACTER_PATH, `${where} 不在 CHARACTER_PATH 里：${rel}`)

      // 重复：两个角色指向同一个文件时，其中一个角色会安静地显示别人的图。
      const firstOwner = seen.get(rel)
      assert.equal(firstOwner, undefined, `${where} 与 ${firstOwner} 指向同一文件：${rel}`)
      seen.set(rel, where)

      // 穿越与绝对路径：白名单里 `..` 那段负向断言是唯一的闸，这里再独立核一次。
      assert.equal(rel.includes('..'), false, `${where} 含 ..：${rel}`)
      assert.equal(/^[A-Za-z]:/.test(rel), false, `${where} 是 Windows 绝对路径：${rel}`)
      assert.equal(rel.startsWith('/'), false, `${where} 是绝对路径：${rel}`)

      // 越界：槽位图必须在本角色的目录下，preview 必须在上游的 docs/previews/ 下。
      const expectedPrefix = slot === 'preview' ? 'docs/previews/' : `${character.dir}/`
      assert.ok(rel.startsWith(expectedPrefix), `${where} 不在 ${expectedPrefix} 下：${rel}`)
    }
  }

  // 20 角色 × 5 槽 + 20 张 preview —— 数量变了说明 catalog 被动过，值得有人看一眼。
  assert.equal(checked, 120, `可寻址路径该有 120 条，实际 ${checked}`)
  assert.equal(seen.size, 120, '120 条路径必须互不相同')
})

test('白名单反向：穿越 / 绝对路径 / 外站 / 非图片扩展名必须被拒', () => {
  // 字符类里含 `.` 与 `/`，所以两条 `.png` 结尾的穿越形状只能靠 `(?!.*\.\.\/)`
  // 拦住 —— 少了它，落盘时 `path.join(cacheDir, rel)` 会写到缓存目录之外。
  const rejected = [
    '设定图/../../etc/passwd.png',
    '设定图/a/../../../x.png',
    'https://evil.example/a.png',
    'http://evil.example/a.png',
    '/etc/passwd.png',
    '设定图/a/evil.exe',
    'docs/previews/01.svg',
    'thumbs/full_single_P001_front.jpg',
  ]
  for (const one of rejected) {
    assert.equal(CHARACTER_PATH.test(one), false, `不该通过白名单：${one}`)
  }

  // 正向：上游真实的两种形状必须能过，否则整块数据都取不到。
  assert.equal(CHARACTER_PATH.test('设定图/01_智谱GLM娘_阔耳狐娘/便于查看/横版完整设定图_01_三视图_查看用.jpg'), true)
  assert.equal(CHARACTER_PATH.test('docs/previews/01.webp'), true)
})

test('字符集：characterOrigin 只认 40 位十六进制 commit', () => {
  // commit 会直接拼进 URL。只认十六进制：塞 `#` / `?` / `/../` 改不了主机
  // （authority 在域名处就闭合了），但能把全部取图悄悄指向另一个 ref。
  assert.match(characterOrigin('a'.repeat(40)), /^https:\/\/raw\.githubusercontent\.com\/lmy414\/ai-chan-sheets\/a{40}$/)
  assert.throws(() => characterOrigin('x'.repeat(8)), /40 位十六进制/)
  assert.throws(() => characterOrigin('main'), /40 位十六进制/)
  assert.throws(() => characterOrigin('../' + 'a'.repeat(37)), /40 位十六进制/)
})

test('取图参数来自生产工厂：白名单 / 缓存子树 / 递归 / 上限一处都不能漏', async () => {
  const cacheDir = tempDir()
  const options = characterImageOptions(cacheDir, ORIGIN)

  // 这四条是 entries 那边"漏了就安静坏掉"的那几个参数。测试若自己写一份 options，
  // 就等于给闸门配假钥匙 —— 实测：entries 不传 pathPattern、cacheSubdirs 写成 ['img']，
  // 自己配 options 的测试全绿。
  assert.equal(options.pathPattern, CHARACTER_PATH, 'pathPattern 必须来自生产常量')
  assert.deepEqual(options.cacheSubdirs, ['设定图', 'docs'], "写成 ['img'] 会让缓存上限与 /characters/cache 双双失效")
  assert.equal(options.recursiveCache, true, '角色图是多级目录，不递归扫等于不统计')
  assert.equal(options.maxBytes, CHARACTER_MAX_BYTES, '上限要从生产常量来，不跟着 images 的默认值漂')

  const index = createCharactersIndex(tempDir(), BUNDLED)
  const images = createImageCache({ ...options, fetchImpl: async () => new Response(tinyJpeg(), { status: 200 }) })
  const rel = index.get('c01').slots.turnaround.path
  await images.fetch(rel)

  // 落盘位置就是 `cacheDir/设定图/…`；统计必须看得见它 —— 这条同时钉住
  // cacheSubdirs 与 recursiveCache（任一写错，diskFiles 就是 0）。
  assert.ok(fs.existsSync(path.join(cacheDir, ...rel.split('/'))), '缓存该落在 设定图/ 子树下')
  const stats = images.stats()
  assert.ok(stats.diskFiles > 0, 'diskFiles 为 0 说明 cacheSubdirs 或 recursiveCache 配错了')
  assert.ok(stats.diskBytes > 0)
})

test('槽位表对账：工具的 view enum 与 catalog 的槽位键一致，且不提供 preview', () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  const tool = characterTool({
    index,
    images: createImageCache({ cacheDir: tempDir(), origin: ORIGIN, fetchImpl: async () => new Response(tinyJpeg(), { status: 200 }) }),
    uploadsDir: () => tempDir(),
  })

  // `tools.ts` 的 VIEWS 与 `routes.ts` 的 SLOTS 是两份手写清单，注释写着"保持一致"。
  // 这里对着工具的公开规格验：catalog 有哪类图，模型就必须能取到哪类图。
  const views = tool.parameters.properties.view.enum
  assert.deepEqual([...views].sort(), catalogViews(), 'view enum 必须覆盖 catalog 里出现的全部槽位键')
  assert.equal(views.includes('preview'), false, 'preview 是面板缩略图，不是模型的取图视图')
  assert.deepEqual(tool.parameters.properties.view.enum, ['turnaround', 'expression', 'outfit', 'props', 'sheet'])
})

test('字节数与取图上限互锁：最大的那张也必须能过 maxBytes', () => {
  const raw = readCatalog()
  let max = 0
  let at = ''
  for (const character of raw.characters) {
    for (const [slot, info] of Object.entries(character.slots)) {
      if (info.bytes > max) {
        max = info.bytes
        at = `${character.id}.${slot}`
      }
    }
  }
  assert.ok(max > 0, 'catalog 该记着字节数')
  // 超上限的图会被取图器按"大小异常"拒掉 —— 那个角色就永远取不到图，而导入脚本不会有任何反应。
  assert.ok(max < CHARACTER_MAX_BYTES, `${at} 的 ${max} 字节超过 CHARACTER_MAX_BYTES（${CHARACTER_MAX_BYTES}）`)
  // preview 在 catalog 里只有路径，没有字节数可核对。
  assert.ok(raw.characters.every(character => typeof character.preview === 'string' && character.preview !== ''))
})

test('取图 URL 逐段编码：目录名含中文，整串编码会把斜杠编掉', async () => {
  const urls = []
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    fetchImpl: async url => {
      urls.push(String(url))
      return new Response(tinyJpeg(), { status: 200 })
    },
  })

  const rel = '设定图/01_智谱GLM娘_阔耳狐娘/便于查看/横版完整设定图_01_三视图_查看用.jpg'
  await images.fetch(rel)
  assert.equal(urls.length, 1)

  const url = urls[0]
  assert.ok(url.startsWith(`${ORIGIN}/`), `URL 必须以固定 origin 开头：${url}`)
  assert.equal(url.includes('设定图'), false, '中文必须被百分号编码（上游受不了裸中文与空格）')
  // 层级不能被编码掉：整串 encodeURIComponent 会把 `/` 变成 `%2F`，上游一律 404。
  const slashes = (url.match(/\//g) ?? []).length
  assert.equal(slashes, (ORIGIN.match(/\//g) ?? []).length + rel.split('/').length, `斜杠数与目录层级不符：${url}`)
})

test('取图落盘按 <id>_<slot>.<ext> 改名：basename 全库相同，不改名会互相覆盖', async () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  const uploads = tempDir()
  // 按路径回不同的字节，才能验出"第二次覆盖了第一次"。
  // URL 里的目录名是中文，所以拿编码后的路径当标记（裸 `01_智谱` 在 URL 里匹配不到）。
  const encodePath = rel => rel.split('/').map(segment => encodeURIComponent(segment)).join('/')
  const firstPath = encodePath(index.get('c01').slots.turnaround.path)
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    fetchImpl: async url => new Response(tinyJpeg(64, String(url).includes(firstPath) ? 1 : 2), { status: 200 }),
  })
  const tool = characterTool({ index, images, uploadsDir: () => uploads })

  const first = await tool.execute({ id: 'c01', view: 'turnaround' })
  const second = await tool.execute({ id: 'c02', view: 'turnaround' })
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)

  assert.equal(path.basename(first.file), 'c01_turnaround.jpg')
  assert.equal(path.basename(second.file), 'c02_turnaround.jpg')
  assert.equal(path.dirname(first.file), path.dirname(second.file), '两边该落进同一个 uploads')
  assert.ok(fs.existsSync(first.file) && fs.existsSync(second.file), '两张都必须还在')
  assert.notEqual(
    fs.readFileSync(first.file).toString('base64'),
    fs.readFileSync(second.file).toString('base64'),
    'c02 的三视图不能覆盖掉 c01 的 —— 这正是 basename 全库相同埋的雷',
  )
})

test('工具的默认 view 是 turnaround（只给 id 时模型最常见的那条路）', async () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    fetchImpl: async () => new Response(tinyJpeg(), { status: 200 }),
  })
  const tool = characterTool({ index, images, uploadsDir: () => tempDir() })

  const out = await tool.execute({ id: 'c01' })
  assert.equal(out.ok, true)
  assert.equal(out.view, 'turnaround', '默认值改成别的会让默认行为整体漂移')
  assert.equal(path.basename(out.file), 'c01_turnaround.jpg')
})

test('工具错误路径：bad_input / not_found（不打网络）/ no_view', async () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  let hits = 0
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    fetchImpl: async () => {
      hits += 1
      return new Response(tinyJpeg(), { status: 200 })
    },
  })
  const tool = characterTool({ index, images, uploadsDir: () => tempDir() })

  // 1) view 不在白名单：直接拒，且要说清可选值（模型下一步要用）
  const badView = await tool.execute({ id: 'c01', view: 'banner' })
  assert.equal(badView.ok, false)
  assert.equal(badView.code, 'bad_input')
  assert.match(badView.error, /turnaround/)

  // 2) 角色不存在：指向 query，且不该打上游
  const missing = await tool.execute({ id: 'c99' })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'not_found')
  assert.match(missing.error, /query/)
  assert.equal(hits, 0, '找不到角色时不该打网络')

  // 3) 角色存在但缺槽：要报 no_view 并列出可用槽位。
  //    随包目录五槽齐全，所以造一份只有三视图的合成目录 —— 上游将来缺切片时就是这种形状。
  const dataDir = tempDir()
  fs.mkdirSync(path.join(dataDir, 'characters'), { recursive: true })
  fs.writeFileSync(
    path.join(dataDir, 'characters', 'catalog.json'),
    JSON.stringify(miniCatalog('测试角色', { turnaround: { path: '设定图/t01/a.jpg', bytes: 1024, label: '三视图' } })),
    'utf8',
  )
  const sparseTool = characterTool({ index: createCharactersIndex(dataDir), images, uploadsDir: () => tempDir() })
  const noView = await sparseTool.execute({ id: 'c01', view: 'sheet' })
  assert.equal(noView.ok, false)
  assert.equal(noView.code, 'no_view')
  assert.match(noView.error, /turnaround/, '缺槽时要把可用槽位报出来')
})

test('工具返回能无损 JSON 往返：宿主对返回值做校验，undefined 会让整次调用作废', async () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    fetchImpl: async () => new Response(tinyJpeg(), { status: 200 }),
  })
  const tool = characterTool({ index, images, uploadsDir: () => tempDir() })

  // 搜索：结果形状是模型挑角色的唯一依据，空数组也要有 hint。
  const searched = await tool.execute({ query: '狐娘' })
  assert.ok(searched.total >= 1, '副标题与 alt 里的词也要能命中')
  assert.ok(searched.items.length >= 1)
  assert.equal(searched.items[0].views.length, 5, 'views 缺席时模型不知道该要哪张图')
  assert.deepEqual(JSON.parse(JSON.stringify(searched)), searched, '搜索返回不能带 undefined')

  const none = await tool.execute({ query: '绝不可能存在的角色' })
  assert.equal(none.total, 0)
  assert.match(none.hint, /换个词/, '查不到时要给出改写建议')

  const fetched = await tool.execute({ id: 'c01', view: 'sheet' })
  assert.deepEqual(JSON.parse(JSON.stringify(fetched)), fetched, '取图返回不能带 undefined')
  assert.equal(fetched.mediaType, 'image/jpeg')
  assert.ok(fetched.license.includes('CC BY-NC-SA'), '取图返回要带许可，模型在对话里会转述')
})

test('路由：六个槽位都能取，响应体与头一致，/fetch 落盘按 <id>_<slot> 改名', async () => {
  const index = createCharactersIndex(tempDir(), BUNDLED)
  const uploads = tempDir()
  const images = createImageCache({
    cacheDir: tempDir(),
    origin: ORIGIN,
    pathPattern: CHARACTER_PATH,
    // 三视图的路径里有「三视图」，整板那张是「完整设定图_浏览预览」—— 用它区分两份字节，
    // 才能验出"两个槽位落成两个文件、而不是互相覆盖"。
    fetchImpl: async url => new Response(tinyJpeg(64, String(url).includes(encodeURIComponent('三视图')) ? 1 : 2), { status: 200 }),
  })
  const routes = createCharacterRoutes({ index, images, uploadsDir: () => uploads })

  const callImage = async query => {
    const { box, res } = fakeRes()
    await routes.exact['/characters/image'](new URL(`http://127.0.0.1/characters/image${query}`), res, {})
    return box
  }

  // `routes.ts` 的 SLOTS 是第二份手写清单（第一份是工具的 VIEWS）。逐个取，
  // 摘掉任何一档（例如 props）都会让面板上的那个按钮与 /characters/fetch 一起坏。
  for (const slot of ['turnaround', 'expression', 'outfit', 'props', 'sheet', 'preview']) {
    const box = await callImage(`?id=c01&slot=${slot}`)
    assert.equal(box.status, 200, `${slot} 该能取`)
    assert.equal(box.headers['Content-Type'], 'image/jpeg')
  }

  // 只断言头不够：`res.end()` 不写体时缩略图全白、"入对话"会传 0 字节 blob。
  const preview = await callImage('?id=c01&slot=preview')
  assert.equal(Buffer.byteLength(preview.body, 'binary'), 64, '响应体必须真的写出去')
  assert.equal(Number(preview.headers['Content-Length']), 64, '声明长度要与实际体一致')
  assert.deepEqual([...preview.body.slice(0, 3)].map(ch => ch.charCodeAt(0)), [0xff, 0xd8, 0xff], '体得是那张 JPEG')

  // /characters/fetch 是面板「落盘 / 入对话」走的路，命名逻辑是 routes.ts 里第二份实现
  // （工具那边是内联模板串）。同一角色两个槽位必须落成两个文件、内容不同。
  const post = async (id, slot) => {
    const { box, res } = fakeRes()
    await routes.exact['/characters/fetch'](new URL(`http://127.0.0.1/characters/fetch?id=${id}&slot=${slot}`), res, { method: 'POST' })
    return JSON.parse(box.body)
  }
  const turn = await post('c01', 'turnaround')
  const sheet = await post('c01', 'sheet')
  assert.equal(turn.ok, true)
  assert.equal(sheet.ok, true)
  assert.equal(path.basename(turn.file), 'c01_turnaround.jpg')
  assert.equal(path.basename(sheet.file), 'c01_sheet.jpg', '丢 slot 的话五槽会互相覆盖')
  assert.notEqual(fs.readFileSync(turn.file).toString('base64'), fs.readFileSync(sheet.file).toString('base64'))
})

test('catalog 换了要能看见：面板常驻，重跑导入脚本后不该还是旧数据', () => {
  const dataDir = tempDir()
  fs.mkdirSync(path.join(dataDir, 'characters'), { recursive: true })
  const file = path.join(dataDir, 'characters', 'catalog.json')
  const write = name => fs.writeFileSync(file, JSON.stringify(miniCatalog(name, { turnaround: { path: '设定图/t01/a.jpg', bytes: 1024, label: '三视图' } })), 'utf8')

  // 名字长度不同 → 文件 size 变 → 索引的 mtime+size 指纹一定会变（不依赖 mtime 精度）
  write('旧名字')
  const index = createCharactersIndex(dataDir)
  assert.equal(index.get('c01').name, '旧名字')
  assert.equal(index.search({ query: '旧名字' }).total, 1)

  write('改过之后的名字')
  assert.equal(index.get('c01').name, '改过之后的名字', '文件变了还返回旧数据，面板就会一直显示上一版')
  assert.equal(index.search({ query: '改过之后的名字' }).total, 1)
  assert.equal(index.search({ query: '旧名字' }).total, 0)
})
