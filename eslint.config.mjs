import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

const root = path.dirname(fileURLToPath(import.meta.url))

/** 与 tests/arch.mjs 保持一致的 shared 内部单向依赖白名单。 */
const SHARED_ALLOWED = {
  'shared/host': [],
  'shared/tools': ['shared/host', 'shared/comfy', 'shared/workflow'],
  'shared/http': [],
  'shared/authz': ['shared/host'],
  'shared/workflow': ['shared/host'],
  'shared/comfy': ['shared/host', 'shared/workflow'],
  'shared/media': [],
  'shared/run': ['shared/host', 'shared/comfy', 'shared/workflow', 'shared/media'],
}

/** 外壳里唯一允许组装组件的文件。 */
const SHELL_ASSEMBLY = new Set([
  'src/client/index.tsx',
  'src/client/components/Workbench.tsx',
])

const ALLOWED_EXTERNAL = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
])

function normalize(filePath) {
  return path.relative(root, filePath).split(path.sep).join('/')
}

function unitOf(rel) {
  const parts = rel.split('/')
  if (parts[0] !== 'src') return null
  if (parts[1] === 'shared') return `shared/${parts[2] ?? ''}`
  if (parts[1] === 'components') {
    return parts[3] === 'server' || parts[3] === 'client'
      ? `components/${parts[2]}/${parts[3]}`
      : `components/${parts[2]}`
  }
  if (parts[1] === 'client') return 'client'
  if (parts[1] === 'http') return 'http'
  return 'root'
}

/** 本地轻量插件：把 tests/arch.mjs 的模块分层与零依赖门禁前移到 IDE 实时报错。 */
const workbenchPlugin = {
  rules: {
    'module-boundaries': {
      meta: {
        type: 'problem',
        docs: {
          description: '强制执行 shared 单向分层、前后端隔离、外壳隔离与运行时零外部包依赖',
        },
        schema: [],
      },
      create(context) {
        const filename = context.filename
        if (!filename || filename === '<input>') return {}
        const rel = normalize(filename)
        const from = unitOf(rel)
        if (from === null) return {}

        function checkTarget(node, target) {
          if (typeof target !== 'string' || target.length === 0) return
          if (target.startsWith('node:') || ALLOWED_EXTERNAL.has(target)) return

          if (!target.startsWith('.')) {
            context.report({
              node,
              message: `禁止引入外部包 "${target}"（运行时必须零外部依赖；宿主能力请通过 shared/host 或 client/host 最小结构接口声明）`,
            })
            return
          }

          const resolved = path.resolve(path.dirname(filename), target)
          const to = unitOf(normalize(resolved))
          if (to === null || to === from) return

          if (from.startsWith('shared/') && to.startsWith('shared/')) {
            const allowed = SHARED_ALLOWED[from] ?? []
            if (!allowed.includes(to)) {
              context.report({
                node,
                message: `违反 shared 单向分层：${from} 不允许依赖 ${to}`,
              })
            }
            return
          }

          if (from.includes('/server') && (to.includes('/client') || to === 'client')) {
            context.report({
              node,
              message: `违反前后端隔离：后端单元（${from}）不允许依赖前端单元（${to}）`,
            })
            return
          }

          if (from === 'client' && to.startsWith('components/') && !SHELL_ASSEMBLY.has(rel)) {
            context.report({
              node,
              message: `违反外壳隔离：公共外壳模块（含 client/host）不允许依赖具体组件 ${to}（仅 SHELL_ASSEMBLY 允许装配）`,
            })
          }
        }

        return {
          ImportDeclaration(node) {
            checkTarget(node.source, node.source.value)
          },
          ExportNamedDeclaration(node) {
            if (node.source) checkTarget(node.source, node.source.value)
          },
          ExportAllDeclaration(node) {
            if (node.source) checkTarget(node.source, node.source.value)
          },
          ImportExpression(node) {
            if (node.source?.type === 'Literal' && typeof node.source.value === 'string') {
              checkTarget(node.source, node.source.value)
            }
          },
        }
      },
    },
  },
}

export default [
  {
    ignores: ['lib/**', 'node_modules/**', 'docs/**', 'data/**', 'comfyui-output/**'],
  },
  // 1. 全量 src/ 源码：模块依赖边界 + 零外部依赖
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      workbench: workbenchPlugin,
    },
    rules: {
      'workbench/module-boundaries': 'error',
    },
  },
  // 2. 宿主双向契约隔离：禁止业务层、入口层、run 域与非适配层前端直调 DSH 原始宿主 API
  {
    files: [
      'src/index.ts',
      'src/entries/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/shared/run/**/*.{ts,tsx}',
      'src/client/**/*.{ts,tsx}',
    ],
    ignores: ['src/client/host/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="ctx"][callee.property.name="get"]',
          message: '禁止直接调用 ctx.get()，应收口到 src/shared/host/adapter.ts 或 src/client/host/。',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="ctx"][callee.property.name="effect"]',
          message: '禁止直接调用 ctx.effect()，请改用 src/shared/host/adapter.ts 的 onHostDispose / mountHostRoutes。',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.object.name="slots"][callee.property.name=/^(register|inject)$/]',
          message: '禁止直接调用 slots.register() / slots.inject()，请改用 src/client/host/slots.ts。',
        },
        {
          selector: 'Identifier[name="betterSidebar"]',
          message: '禁止直接引用 betterSidebar，请收口到 src/client/host/slots.ts。',
        },
        {
          selector: 'Literal[value="betterSidebar"]',
          message: '禁止硬编码 "betterSidebar" 服务名，请收口到 src/client/host/slots.ts。',
        },
        {
          selector: 'Literal[value="plugin:dsh-comfyui-workbench"]',
          message: '禁止硬编码 "plugin:dsh-comfyui-workbench"，请复用 src/shared/host/session.ts 的 NOTICE_SOURCE_KIND / deliverSessionNotice。',
        },
        {
          selector: 'TemplateElement[value.raw="plugin:dsh-comfyui-workbench"]',
          message: '禁止硬编码 "plugin:dsh-comfyui-workbench"，请复用 src/shared/host/session.ts 的 NOTICE_SOURCE_KIND / deliverSessionNotice。',
        },
        {
          selector: 'CallExpression[callee.type="MemberExpression"][callee.property.name="followup"]',
          message: '禁止直接调用 .followup() 投递会话通知，请改用 src/shared/host/session.ts 的 deliverSessionNotice。',
        },
      ],
    },
  },
]
