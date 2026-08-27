import { describe, expect, it } from 'vitest'
import { installAuthorWatermark } from './author-watermark'

describe('installAuthorWatermark', () => {
  it('installs a hidden and idempotent yuguaa authorship marker', () => {
    const doc = document.implementation.createHTMLDocument('Pi-Harness')

    installAuthorWatermark(doc)
    installAuthorWatermark(doc)

    expect(doc.documentElement.dataset.authorWatermark).toBe('yuguaa')
    expect(
      doc.head.querySelector('meta[name="pi-harness-author-watermark"]')?.getAttribute('content')
    ).toBe('yuguaa')
    const markers = doc.querySelectorAll('#pi-harness-author-watermark')
    expect(markers).toHaveLength(1)
    expect((markers[0] as HTMLElement).hidden).toBe(true)
    expect(markers[0]?.textContent).toBe('yuguaa')
    expect((markers[0] as HTMLElement).dataset.author).toBe('yuguaa')
  })
})
