import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import ToolCallView from './ToolCallView.vue'
import type { ToolCallContent } from '@shared/types/workspace'
import { useAgentStore } from '@renderer/stores/agent'

describe('ToolCallView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

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

  it('leaves the completed result to the dedicated tool-result message', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const agent = useAgentStore()
    agent.toolExecutions.set('tool-1', {
      toolName: 'write_file',
      running: false,
      result: 'completed output'
    })
    const block: ToolCallContent = {
      type: 'toolCall',
      toolCallId: 'tool-1',
      toolName: 'write_file',
      input: { path: '/tmp/example.txt' }
    }

    const wrapper = mount(ToolCallView, {
      props: { block },
      global: { plugins: [pinia], mocks: { $t: (key: string) => key } }
    })

    await wrapper.get('button').trigger('click')
    expect(wrapper.get('pre').text()).not.toContain('completed output')
    expect(wrapper.get('button').text()).toContain('write file')
  })
})
