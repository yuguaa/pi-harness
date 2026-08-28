type RgbaColor = [red: number, green: number, blue: number, alpha: number]

/**
 * Monaco 的语法 token 颜色只接受六位/八位十六进制，不能直接接收 CSS rgba。
 * 这里把带透明度的 CSS 颜色合成到编辑器背景上，保证主题颜色合法且视觉一致。
 */
export function toMonacoTokenColor(value: string, background: string, fallback: string): string {
  const foreground = parseColor(value)
  const base = parseColor(background)
  if (!foreground || !base) return normalizeHex(fallback) ?? '#FFFFFF'

  const alpha = foreground[3]
  const red = Math.round(foreground[0] * alpha + base[0] * (1 - alpha))
  const green = Math.round(foreground[1] * alpha + base[1] * (1 - alpha))
  const blue = Math.round(foreground[2] * alpha + base[2] * (1 - alpha))
  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`
}

/** Monaco 主题 UI 颜色只接受十六进制；保留透明度为 #RRGGBBAA。 */
export function toMonacoThemeColor(value: string, fallback: string): string {
  const color = parseColor(value) ?? parseColor(fallback)
  if (!color) return '#FFFFFF'

  const red = toHex(Math.round(color[0]))
  const green = toHex(Math.round(color[1]))
  const blue = toHex(Math.round(color[2]))
  const alpha = color[3] < 1 ? toHex(Math.round(color[3] * 255)) : ''
  return `#${red}${green}${blue}${alpha}`
}

function parseColor(value: string): RgbaColor | null {
  const normalized = value.trim()
  const hex = normalizeHex(normalized)
  if (hex) {
    const red = Number.parseInt(hex.slice(1, 3), 16)
    const green = Number.parseInt(hex.slice(3, 5), 16)
    const blue = Number.parseInt(hex.slice(5, 7), 16)
    const alpha = hex.length === 9 ? Number.parseInt(hex.slice(7, 9), 16) / 255 : 1
    return [red, green, blue, alpha]
  }

  const match = normalized.match(
    /^rgba?\(\s*([\d.]+)(%?)\s*(?:,|\s)\s*([\d.]+)(%?)\s*(?:,|\s)\s*([\d.]+)(%?)(?:\s*(?:,|\/)\s*([\d.]+)(%?))?\s*\)$/i
  )
  if (!match) return null

  const red = parseChannel(match[1] ?? '', match[2] === '%')
  const green = parseChannel(match[3] ?? '', match[4] === '%')
  const blue = parseChannel(match[5] ?? '', match[6] === '%')
  const alpha = parseAlpha(match[7] ?? '1', match[8] === '%')
  if ([red, green, blue, alpha].some((channel) => channel === null)) return null
  return [red, green, blue, alpha] as RgbaColor
}

function normalizeHex(value: string): string | null {
  const match = value.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)
  if (!match) return null
  const raw = match[1] ?? ''
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((channel) => `${channel}${channel}`)
      .join('')}`.toUpperCase()
  }
  return `#${raw}`.toUpperCase()
}

function parseChannel(value: string, percentage: boolean): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(255, percentage ? (parsed / 100) * 255 : parsed))
}

function parseAlpha(value: string, percentage: boolean): number | null {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return null
  return Math.max(0, Math.min(1, percentage ? parsed / 100 : parsed))
}

function toHex(value: number): string {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, '0').toUpperCase()
}
