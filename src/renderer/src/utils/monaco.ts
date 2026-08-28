import * as monaco from 'monaco-editor/editor/editor.api'
import 'monaco-editor/basic-languages/monaco.contribution'
import 'monaco-editor/features/find/register'

import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import { toMonacoThemeColor, toMonacoTokenColor } from './monaco-colors'

/**
 * Monaco 编辑器集成：
 *  - 配置基础编辑器 worker
 *  - 注册 Pi-Harness Graphite 主题（深浅主题各一套，随 CSS 变量实时同步）
 *  - 文件名 → languageId 检测
 *  - unified diff patch 解析（供 DiffEditor 使用）
 */

self.MonacoEnvironment = {
  getWorker() {
    return new editorWorker()
  }
} as monaco.Environment

/** 仅注册 JSON/JSONC 词法高亮，不启用语言服务。 */
monaco.languages.register({
  id: 'json',
  extensions: ['.json', '.jsonc'],
  aliases: ['JSON', 'json'],
  mimetypes: ['application/json']
})
monaco.languages.setMonarchTokensProvider('json', {
  defaultToken: '',
  tokenPostfix: '.json',
  brackets: [
    { open: '{', close: '}', token: 'delimiter.bracket' },
    { open: '[', close: ']', token: 'delimiter.array' }
  ],
  tokenizer: {
    root: [
      [/[{}[\]]/, '@brackets'],
      [/[,:]/, 'delimiter'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'],
      [/"(?:\\.|[^"\\])*"(?=\s*:)/, 'string.key'],
      [/"(?:\\.|[^"\\])*"/, 'string.value'],
      [/\/\/.*$/, 'comment'],
      [/\/\*/, 'comment', '@comment']
    ],
    comment: [
      [/[^/*]+/, 'comment'],
      [/\*\//, 'comment', '@pop'],
      [/[/*]/, 'comment']
    ]
  }
})

const THEME_NAME = 'pi-graphite'

/** 读取 CSS 变量实际颜色值（随深浅主题切换）。 */
function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/** 根据当前主题变量重建并应用 monaco 主题。 */
export function syncMonacoTheme(): void {
  const isLight = document.documentElement.dataset.theme === 'light'
  const tokenBackground = cssVar('--bg-workspace', isLight ? '#F5F5F6' : '#1D1F23')
  const tokenColor = (name: string, fallback: string) =>
    toMonacoTokenColor(cssVar(name, fallback), tokenBackground, fallback)
  const themeColor = (name: string, fallback: string) =>
    toMonacoThemeColor(cssVar(name, fallback), fallback)
  monaco.editor.defineTheme(THEME_NAME, {
    base: isLight ? 'vs' : 'vs-dark',
    inherit: true,
    rules: [
      {
        token: 'comment',
        foreground: tokenColor('--syntax-comment', isLight ? '#8C8C8C' : '#7F8C98'),
        fontStyle: 'italic'
      },
      { token: 'keyword', foreground: tokenColor('--syntax-keyword', '#94A9CE') },
      { token: 'keyword.control', foreground: tokenColor('--syntax-keyword', '#94A9CE') },
      { token: 'string', foreground: tokenColor('--syntax-string', '#78B995') },
      { token: 'string.escape', foreground: tokenColor('--syntax-string', '#78B995') },
      { token: 'number', foreground: tokenColor('--syntax-number', '#C99A67') },
      { token: 'constant', foreground: tokenColor('--syntax-constant', '#A995CF') },
      { token: 'constant.language', foreground: tokenColor('--syntax-constant', '#A995CF') },
      { token: 'type', foreground: tokenColor('--syntax-property', '#87AEE9') },
      { token: 'type.identifier', foreground: tokenColor('--syntax-property', '#87AEE9') },
      { token: 'variable', foreground: tokenColor('--syntax-property', '#87AEE9') },
      { token: 'variable.name', foreground: tokenColor('--syntax-property', '#87AEE9') },
      { token: 'property', foreground: tokenColor('--syntax-property', '#87AEE9') },
      { token: 'identifier', foreground: tokenColor('--syntax-property', '#87AEE9') },
      {
        token: 'heading',
        foreground: tokenColor('--syntax-heading', '#9BB9EC'),
        fontStyle: 'bold'
      },
      {
        token: 'emphasis',
        foreground: tokenColor('--syntax-emphasis', '#B7A4D6'),
        fontStyle: 'italic'
      },
      { token: 'link', foreground: tokenColor('--syntax-link', '#78ADB8') },
      { token: 'invalid', foreground: tokenColor('--error', '#D46A6A') }
    ],
    colors: {
      'editor.background': themeColor('--bg-workspace', '#1D1F23'),
      /* Monaco 会把 editor.foreground 复用为 token 默认色，同样必须是十六进制。 */
      'editor.foreground': tokenColor('--text-primary', isLight ? '#333333' : '#BBBBBB'),
      'editor.lineHighlightBackground': themeColor(
        '--editor-active-line',
        isLight ? 'rgba(42,111,224,0.07)' : 'rgba(91,145,245,0.08)'
      ),
      'editor.lineHighlightBorder': themeColor(
        '--editor-active-line-border',
        isLight ? 'rgba(42,111,224,0.2)' : 'rgba(91,145,245,0.22)'
      ),
      'editorLineNumber.foreground': themeColor('--text-tertiary', 'rgba(255,255,255,0.4)'),
      'editorLineNumber.activeForeground': themeColor('--text-secondary', 'rgba(255,255,255,0.62)'),
      'editorCursor.foreground': themeColor('--accent', '#5B91F5'),
      'editor.selectionBackground': themeColor('--accent-tint-strong', 'rgba(91,145,245,0.22)'),
      'editor.inactiveSelectionBackground': themeColor('--accent-tint', 'rgba(91,145,245,0.13)'),
      'editorGutter.background': themeColor('--bg-surface', '#212429'),
      'editorWidget.background': themeColor('--bg-surface-raised', '#25282E'),
      'editorWidget.border': themeColor('--border-subtle', 'rgba(255,255,255,0.055)'),
      'editor.findMatchBackground': themeColor('--accent-tint-strong', 'rgba(91,145,245,0.22)'),
      // Diff 编辑器：新增绿、删除红（低饱和，对齐 tokens 的 --diff-* 变量）。
      'diffEditor.insertedTextBackground': themeColor('--diff-added-bg', 'rgba(90,191,138,0.1)'),
      'diffEditor.removedTextBackground': themeColor('--diff-removed-bg', 'rgba(212,106,106,0.1)'),
      'diffEditor.insertedLineBackground': themeColor('--diff-added-bg', 'rgba(90,191,138,0.1)'),
      'diffEditor.removedLineBackground': themeColor('--diff-removed-bg', 'rgba(212,106,106,0.1)'),
      'diffEditor.diagonalFill': toMonacoThemeColor('rgba(128,128,128,0.15)', '#80808026')
    }
  })
  monaco.editor.setTheme(THEME_NAME)
}

/** 扩展名 / 文件名 → monaco languageId。 */
const LANGUAGE_BY_EXT: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescript',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  sass: 'scss',
  less: 'less',
  html: 'html',
  htm: 'html',
  vue: 'html',
  svelte: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  java: 'java',
  go: 'go',
  rs: 'rust',
  rb: 'ruby',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin',
  kts: 'kotlin',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  yml: 'yaml',
  yaml: 'yaml',
  xml: 'xml',
  svg: 'xml',
  sql: 'sql',
  toml: 'toml',
  ini: 'ini',
  env: 'ini',
  conf: 'ini',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  psd1: 'powershell',
  psm1: 'powershell',
  dockerfile: 'dockerfile',
  graphql: 'graphql',
  gql: 'graphql',
  lua: 'lua',
  r: 'r',
  dart: 'dart',
  zig: 'zig',
  nix: 'nix',
  tex: 'latex',
  rst: 'rst',
  diff: 'diff',
  patch: 'diff',
  txt: 'plaintext',
  text: 'plaintext'
}

const LANGUAGE_BY_FILE: Record<string, string> = {
  Dockerfile: 'dockerfile',
  Makefile: 'makefile',
  '.gitignore': 'plaintext',
  '.env': 'ini',
  '.npmrc': 'ini',
  '.yarnrc': 'ini'
}

/** 根据文件名检测 monaco languageId。 */
export function detectMonacoLanguage(fileName: string): string {
  const base =
    fileName
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? fileName
  if (LANGUAGE_BY_FILE[base]) return LANGUAGE_BY_FILE[base]
  if (base.endsWith('Dockerfile')) return 'dockerfile'
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return 'plaintext'
  return LANGUAGE_BY_EXT[base.slice(dot + 1).toLowerCase()] ?? 'plaintext'
}

/* ---------- unified diff patch 解析（DiffEditor 用） ---------- */

export interface UnifiedDiff {
  original: string
  modified: string
}

/**
 * 解析 unified diff patch，重建 original / modified 两侧内容。
 * 支持新增（/dev/null 原始）、删除（/dev/null 修改）、重命名、上下文与多 hunk。
 */
export function parseUnifiedDiff(patch: string): UnifiedDiff | null {
  const original: string[] = []
  const modified: string[] = []
  let inHunk = false

  for (const rawLine of patch.split('\n')) {
    if (rawLine.startsWith('@@')) {
      inHunk = true
      continue
    }
    if (!inHunk) continue // meta 行（diff --git / index / --- / +++ / new file …）
    if (rawLine.startsWith('\\ No newline')) continue

    const marker = rawLine.charAt(0)
    const content = rawLine.slice(1)
    if (marker === ' ') {
      original.push(content)
      modified.push(content)
    } else if (marker === '+') {
      modified.push(content)
    } else if (marker === '-') {
      original.push(content)
    }
    // 其他未知行忽略
  }

  return { original: original.join('\n'), modified: modified.join('\n') }
}

export { monaco }
