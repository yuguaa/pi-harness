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

    await wrapper
      .get('[data-testid="queued-message-item-queue-1"]')
      .get('[data-testid="queued-message-steer"]')
      .trigger('click')
    await wrapper
      .get('[data-testid="queued-message-item-queue-2"]')
      .get('[data-testid="queued-message-remove"]')
      .trigger('click')

    expect(wrapper.emitted('steer')).toEqual([['queue-1']])
    expect(wrapper.emitted('remove')).toEqual([['queue-2']])
  })

  it('edits a queued message and trims the saved text', async () => {
    const wrapper = mount(QueuedMessageList, {
      props: {
        items: [queuedMessage('queue-1', 'first')]
      },
      global: {
        mocks: {
          $t: (key: string) => key
        }
      }
    })

    const row = wrapper.get('[data-testid="queued-message-item-queue-1"]')
    await row.get('[data-testid="queued-message-edit"]').trigger('click')
    await row.get('[data-testid="queued-message-edit-input"]').setValue('  updated  ')

    expect(row.find('[data-testid="queued-message-steer"]').exists()).toBe(false)
    await row.get('[data-testid="queued-message-save"]').trigger('click')

    expect(wrapper.emitted('edit')).toEqual([['queue-1', 'updated']])
  })

  it('keeps save disabled for an empty text-only message', async () => {
    const wrapper = mount(QueuedMessageList, {
      props: {
        items: [queuedMessage('queue-1', 'first')]
      },
      global: {
        mocks: {
          $t: (key: string) => key
        }
      }
    })

    const row = wrapper.get('[data-testid="queued-message-item-queue-1"]')
    await row.get('[data-testid="queued-message-edit"]').trigger('click')
    await row.get('[data-testid="queued-message-edit-input"]').setValue('   ')

    expect(row.get('[data-testid="queued-message-save"]').attributes('disabled')).toBeDefined()
    expect(wrapper.emitted('edit')).toBeUndefined()
  })

  it('allows saving an image-only queued message with empty text', async () => {
    const wrapper = mount(QueuedMessageList, {
      props: {
        items: [queuedMessage('queue-1', '', true)]
      },
      global: {
        mocks: {
          $t: (key: string) => key
        }
      }
    })

    const row = wrapper.get('[data-testid="queued-message-item-queue-1"]')
    await row.get('[data-testid="queued-message-edit"]').trigger('click')

    const save = row.get('[data-testid="queued-message-save"]')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')

    expect(wrapper.emitted('edit')).toEqual([['queue-1', '']])
  })

  it('restores an unfinished edit before switching to another queued message', async () => {
    const wrapper = mount(QueuedMessageList, {
      props: {
        items: [queuedMessage('queue-1', 'first'), queuedMessage('queue-2', 'second')]
      },
      global: {
        mocks: {
          $t: (key: string) => key
        }
      }
    })

    const first = wrapper.get('[data-testid="queued-message-item-queue-1"]')
    await first.get('[data-testid="queued-message-edit"]').trigger('click')
    await first.get('[data-testid="queued-message-edit-input"]').setValue('draft')

    await wrapper
      .get('[data-testid="queued-message-item-queue-2"]')
      .get('[data-testid="queued-message-edit"]')
      .trigger('click')

    expect(wrapper.emitted('edit-cancel')).toEqual([['queue-1', 'first']])
    expect(wrapper.emitted('edit-start')).toEqual([['queue-1'], ['queue-2']])
  })
})

function queuedMessage(id: string, message: string, hasImages = false) {
  return {
    id,
    message,
    hasImages
  }
}
