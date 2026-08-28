import { describe, expect, it } from 'vitest'
import { toMonacoThemeColor, toMonacoTokenColor } from './monaco-colors'

describe('Monaco token colors', () => {
  it('converts rgba colors to opaque hex values over the editor background', () => {
    expect(toMonacoTokenColor('rgba(255, 255, 255, 0.9)', '#1d1f23', '#ffffff')).toBe('#E8E9E9')
  })

  it('preserves opaque hex colors', () => {
    expect(toMonacoTokenColor('#78b995', '#1d1f23', '#ffffff')).toBe('#78B995')
  })

  it('uses the fallback when a CSS color cannot be parsed', () => {
    expect(toMonacoTokenColor('var(--missing)', '#1d1f23', '#d46a6a')).toBe('#D46A6A')
  })
})

describe('Monaco theme colors', () => {
  it('preserves rgba transparency as eight-digit hex', () => {
    expect(toMonacoThemeColor('rgba(91, 145, 245, 0.08)', '#000000')).toBe('#5B91F514')
  })

  it('normalizes opaque rgb colors to six-digit hex', () => {
    expect(toMonacoThemeColor('rgb(91, 145, 245)', '#000000')).toBe('#5B91F5')
  })

  it('uses the fallback when the source color is invalid', () => {
    expect(toMonacoThemeColor('not-a-color', 'rgba(1, 2, 3, 0.5)')).toBe('#01020380')
  })
})
