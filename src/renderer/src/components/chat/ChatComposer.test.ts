import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/vue-3'

import type { PiSwitchAPI } from '@shared/ipc/api-types'
import ChatComposer from './ChatComposer.vue'
import { useAgentStore } from '@renderer/stores/agent'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { useSessionStore } from '@renderer/stores/sessions'
import { i18n } from '@renderer/i18n'

describe('ChatComposer', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    window.piSwitch = {} as unknown as PiSwitchAPI
  })

  it('uses a Tiptap editor and mirrors its plain text into the workspace draft', async () => {
    const workspace = useWorkspaceStore()
    workspace.draft = 'initial'
    const wrapper = mountComposer()
    await flushPromises()

    const editorElement = wrapper.get('[contenteditable="true"]')
    const editor = wrapper.findComponent({ name: 'EditorContent' }).props('editor') as Editor

    expect(editorElement.attributes('aria-label')).toBeTruthy()
    editor.commands.setContent({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'updated' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'next line' }] }
      ]
    })
    await flushPromises()

    expect(workspace.draft).toBe('updated\nnext line')
  })

  it('switches between send and abort based on draft content while busy', async () => {
    const workspace = useWorkspaceStore()
    const sessions = useSessionStore()
    const agent = useAgentStore()
    sessions.currentId = 'session-1'
    agent.runningIds = ['session-1']
    workspace.draft = 'queue this'
    const wrapper = mountComposer()
    await flushPromises()

    expect(wrapper.findAll('[data-testid="composer-action-send"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-testid="composer-action-abort"]')).toHaveLength(0)

    workspace.draft = ''
    await flushPromises()

    expect(wrapper.findAll('[data-testid="composer-action-send"]')).toHaveLength(0)
    expect(wrapper.findAll('[data-testid="composer-action-abort"]')).toHaveLength(1)
  })
})

function mountComposer() {
  return mount(ChatComposer, {
    props: { soundEnabled: false },
    global: {
      plugins: [i18n],
      mocks: { $t: (key: string) => key },
      stubs: {
        Button: true,
        ComposerOptionMenu: true,
        Dialog: true,
        QueuedMessageList: true,
        Select: true
      }
    }
  })
}
