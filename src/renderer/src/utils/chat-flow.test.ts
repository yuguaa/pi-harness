import { describe, expect, it } from 'vitest'
import type { AgentMessage, ConversationChangeStep } from '@shared/types/workspace'
import { buildChatFlow } from './chat-flow'

describe('buildChatFlow', () => {
  it('anchors a banner after the assistant reply when timestamps are ISO strings', () => {
    const messages = [
      { role: 'user', content: 'change it', timestamp: '2026-08-27T13:00:00.000Z' },
      { role: 'assistant', content: [], timestamp: '2026-08-27T13:00:01.000Z' }
    ] as unknown as AgentMessage[]
    const step = createStep('step-1', Date.parse('2026-08-27T13:00:02.000Z'), false)

    const result = buildChatFlow(messages, [], [step])

    expect(result.flow[0]?.steps).toEqual([])
    expect(result.flow[1]?.steps).toEqual([step])
  })

  it('keeps failure and success banners attached to their own turns', () => {
    const messages = [
      { role: 'user', content: 'first', timestamp: '2026-08-27T13:00:00.000Z' },
      { role: 'assistant', content: [], timestamp: '2026-08-27T13:00:01.000Z' },
      { role: 'user', content: 'second', timestamp: '2026-08-27T13:00:03.000Z' },
      { role: 'assistant', content: [], timestamp: '2026-08-27T13:00:04.000Z' }
    ] as unknown as AgentMessage[]
    const first = createStep('first', Date.parse('2026-08-27T13:00:02.000Z'), false)
    const second = createStep('second', Date.parse('2026-08-27T13:00:05.000Z'), true)

    const result = buildChatFlow(messages, [], [second, first])

    expect(result.flow[1]?.steps).toEqual([first])
    expect(result.flow[3]?.steps).toEqual([second])
  })

  it('filters hidden system entries without shifting branch entry ids', () => {
    const messages = [
      { role: 'custom', customType: 'internal', content: 'hidden', display: false },
      { role: 'user', content: 'visible', timestamp: 100 }
    ] as unknown as AgentMessage[]

    const result = buildChatFlow(messages, ['hidden-id', 'user-id'], [])

    expect(result.flow).toHaveLength(1)
    expect(result.flow[0]?.entryId).toBe('user-id')
  })

  it('shows role metadata only when a message lane changes', () => {
    const messages = [
      { role: 'assistant', content: [], timestamp: 100 },
      { role: 'assistant', content: [], timestamp: 200 },
      { role: 'toolResult', toolCallId: 'tool-1', content: [], timestamp: 300 },
      { role: 'assistant', content: [], timestamp: 400 }
    ] as unknown as AgentMessage[]

    const result = buildChatFlow(messages, [], [])

    expect(result.flow.map((item) => item.showMeta)).toEqual([true, false, true, true])
  })
})

function createStep(stepId: string, createdAt: number, failed: boolean): ConversationChangeStep {
  return {
    stepId,
    sessionId: 'session-1',
    files: [],
    additions: 0,
    deletions: 0,
    createdAt,
    failed
  }
}
