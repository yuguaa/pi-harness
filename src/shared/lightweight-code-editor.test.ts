import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('lightweight code editor boundary', () => {
  it('excludes Monaco semantic language services from the renderer bundle', () => {
    const source = readFileSync(join(process.cwd(), 'src/renderer/src/utils/monaco.ts'), 'utf8')

    expect(source).toContain("from 'monaco-editor/editor/editor.api'")
    expect(source).toContain("from 'monaco-editor/editor/editor.worker?worker'")
    expect(source).toContain("import 'monaco-editor/basic-languages/monaco.contribution'")
    expect(source).toContain("import 'monaco-editor/features/find/register'")
    expect(source).toContain("monaco.languages.setMonarchTokensProvider('json'")
    expect(source).not.toMatch(/from ['"]monaco-editor['"]/)
    expect(source).not.toContain('monaco-editor/language/')
  })
})
