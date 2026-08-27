import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { describe, expect, it } from 'vitest'
import ToolCallView from './ToolCallView.vue'
import type { ToolCallContent } from '@shared/types/workspace'

describe('ToolCallView', () => {
  it('collapses tool details by default and allows expanding them', async () => {
    const block: ToolCallContent = {
      type: 'toolCall',
      toolCallId: 'tool-1',
      toolName: 'read',
      input: { path: '/tmp/example.txt' }
    }
    const wrapper = mount(ToolCallView, {
      props: { block },
      global: { plugins: [createPinia()], mocks: { $t: (key: string) => key } }
    })

    expect(wrapper.find('pre').exists()).toBe(false)

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('pre').isVisible()).toBe(true)
  })
})
