import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import QueuedMessageList from './queued-message-list.vue'

describe('queued message list', () => {
  it('renders multiple queued messages and emits queue actions', async () => {
    const wrapper = mount(QueuedMessageList, {
      props: {
        items: [queuedMessage('queue-1', 'first'), queuedMessage('queue-2', '')]
      },
      global: {
        mocks: {
          $t: (key: string) => key
        }
      }
    })

    expect(wrapper.findAll('[data-testid="composer-queue"] > div')).toHaveLength(2)
    expect(wrapper.text()).toContain('first')
    expect(wrapper.text()).toContain('workspace.imageOnlyMessage')

    await wrapper.findAll('button')[0]?.trigger('click')
    await wrapper.findAll('button')[3]?.trigger('click')

    expect(wrapper.emitted('steer')).toEqual([['queue-1']])
    expect(wrapper.emitted('remove')).toEqual([['queue-2']])
  })
})

function queuedMessage(id: string, message: string) {
  return {
    id,
    sessionId: 'session-1',
    cwd: '/code/project',
    message,
    images: [],
    preset: 'default' as const,
    thinkingLevel: 'auto'
  }
}
