import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { PiSwitchAPI } from '@shared/ipc/api-types'
import type { GitFileStatus, GitStatusResponse } from '@shared/types/workspace'
import { useConversationChangesStore } from './conversation-changes'

function textPreview(text: string): { kind: 'text'; text: string; truncated: boolean } {
  return { kind: 'text', text, truncated: false }
}

function statusResponse(files: GitFileStatus[]): GitStatusResponse {
  return {
    isGitRepository: true,
    repositoryRoot: '/r',
    files,
    additions: 1,
    deletions: 0
  }
}

function modifiedFile(filePath: string): GitFileStatus {
  return { filePath, status: 'modified', code: 'M', indexStatus: ' ', worktreeStatus: 'M' }
}

describe('conversation changes', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    delete window.piSwitch
  })

  it('captures a step when a clean file is modified', async () => {
    const read = vi.fn().mockResolvedValue(textPreview('after'))
    const showFile = vi.fn().mockResolvedValue({ content: 'before' })
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([]))
      .mockResolvedValueOnce(statusResponse([modifiedFile('/a.ts')]))
    window.piSwitch = {
      git: { status, showFile },
      files: { read }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    const steps = store.stepsFor('s1')
    expect(steps).toHaveLength(1)
    expect(steps[0].failed).toBe(false)
    expect(steps[0].files).toHaveLength(1)
    expect(steps[0].files[0].before).toBe('before')
    expect(steps[0].files[0].after).toBe('after')
    expect(steps[0].files[0].revertible).toBe(true)
    expect(showFile).toHaveBeenCalledWith('/r', '/a.ts')
  })

  it('reuses the pre-conversation snapshot for already-dirty files', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(textPreview('dirty-before'))
      .mockResolvedValueOnce(textPreview('after'))
    const showFile = vi.fn().mockResolvedValue({ content: 'head' })
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([modifiedFile('/a.ts')]))
      .mockResolvedValueOnce(statusResponse([modifiedFile('/a.ts')]))
    window.piSwitch = {
      git: { status, showFile },
      files: { read }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    const steps = store.stepsFor('s1')
    expect(steps).toHaveLength(1)
    expect(steps[0].files[0].before).toBe('dirty-before')
    expect(showFile).not.toHaveBeenCalled()
  })

  it('skips a step when nothing changed', async () => {
    const read = vi.fn().mockResolvedValue(textPreview('same'))
    const showFile = vi.fn().mockResolvedValue({ content: 'same' })
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([]))
      .mockResolvedValueOnce(statusResponse([modifiedFile('/a.ts')]))
    window.piSwitch = {
      git: { status, showFile },
      files: { read }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    expect(store.stepsFor('s1')).toHaveLength(0)
  })

  it('captures an initially dirty file that becomes clean during the conversation', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce(textPreview('dirty-before'))
      .mockResolvedValueOnce(textPreview('head'))
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([modifiedFile('/r/a.ts')]))
      .mockResolvedValueOnce(statusResponse([]))
    window.piSwitch = {
      git: { status },
      files: { read }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    expect(store.stepsFor('s1')[0]?.files[0]).toMatchObject({
      filePath: '/r/a.ts',
      status: 'modified',
      before: 'dirty-before',
      after: 'head'
    })
  })

  it('does not report a file that was already deleted before the conversation', async () => {
    const deleted: GitFileStatus = {
      filePath: '/r/a.ts',
      status: 'deleted',
      code: 'D',
      indexStatus: ' ',
      worktreeStatus: 'D'
    }
    const read = vi.fn().mockRejectedValue(new Error('missing'))
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([deleted]))
      .mockResolvedValueOnce(statusResponse([deleted]))
    window.piSwitch = {
      git: { status },
      files: { read }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    expect(store.stepsFor('s1')).toHaveLength(0)
  })

  it('does not track changes outside a git repository', async () => {
    const status = vi.fn().mockResolvedValue({
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0
    })
    window.piSwitch = { git: { status } } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    expect(store.stepsFor('s1')).toHaveLength(0)
  })

  it('reverts by writing the before content and reapplies by writing after', async () => {
    const write = vi.fn().mockResolvedValue({ path: '/a.ts', size: 1, revision: 'x'.repeat(64) })
    const read = vi.fn().mockResolvedValue(textPreview('after'))
    const showFile = vi.fn().mockResolvedValue({ content: 'before' })
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([]))
      .mockResolvedValueOnce(statusResponse([modifiedFile('/a.ts')]))
    window.piSwitch = {
      git: { status, showFile },
      files: { read, write }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    const change = store.stepsFor('s1')[0].files[0]
    await store.revertFile(change)
    expect(change.reverted).toBe(true)
    expect(write).toHaveBeenLastCalledWith('/a.ts', 'before', '0'.repeat(64), true)

    await store.reapplyFile(change)
    expect(change.reverted).toBe(false)
    expect(write).toHaveBeenLastCalledWith('/a.ts', 'after', '0'.repeat(64), true)
  })

  it('deletes an untracked file on revert', async () => {
    const remove = vi.fn().mockResolvedValue(undefined)
    const read = vi.fn().mockResolvedValue(textPreview('new content'))
    const showFile = vi.fn().mockResolvedValue({ content: null })
    const untracked: GitFileStatus = {
      filePath: '/new.ts',
      status: 'untracked',
      code: 'U',
      indexStatus: '?',
      worktreeStatus: '?'
    }
    const status = vi
      .fn()
      .mockResolvedValueOnce(statusResponse([]))
      .mockResolvedValueOnce(statusResponse([untracked]))
    window.piSwitch = {
      git: { status, showFile },
      files: { read, delete: remove }
    } as unknown as PiSwitchAPI

    const store = useConversationChangesStore()
    await store.beginConversation('s1', '/r')
    await store.finishConversation('s1', false)

    const change = store.stepsFor('s1')[0].files[0]
    expect(change.before).toBeNull()
    expect(change.after).toBe('new content')

    await store.revertFile(change)
    expect(remove).toHaveBeenCalledWith('/new.ts')
  })
})
