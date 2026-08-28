import type { AgentMessage, ConversationChangeStep } from '@shared/types/workspace'

export interface ChatFlowItem {
  key: string
  message: AgentMessage
  entryId: string | undefined
  isLast: boolean
  showMeta: boolean
  steps: ConversationChangeStep[]
}

export interface ChatFlow {
  flow: ChatFlowItem[]
  orphanSteps: ConversationChangeStep[]
}

export function buildChatFlow(
  messages: AgentMessage[],
  entryIds: string[],
  steps: ConversationChangeStep[]
): ChatFlow {
  const visibleEntries = messages
    .map((message, index) => ({ message, entryId: entryIds[index] }))
    .filter(({ message }) => message.role !== 'custom' || message.display)
  const visibleMessages = visibleEntries.map(({ message }) => message)
  const orderedSteps = [...steps].sort((a, b) => a.createdAt - b.createdAt)
  const stepsByAnchor = new Map<number, ConversationChangeStep[]>()
  const orphanSteps: ConversationChangeStep[] = []

  for (const step of orderedSteps) {
    let anchor = -1
    for (let index = 0; index < visibleMessages.length; index++) {
      const timestamp = messageTimestamp(visibleMessages[index]?.timestamp)
      if (timestamp <= step.createdAt) anchor = index
      else break
    }
    if (anchor === -1) orphanSteps.push(step)
    else stepsByAnchor.set(anchor, [...(stepsByAnchor.get(anchor) ?? []), step])
  }

  return {
    flow: visibleEntries.map(({ message, entryId }, index) => ({
      key: `m-${index}`,
      message,
      entryId,
      isLast: index === visibleEntries.length - 1,
      showMeta: index === 0 || visibleEntries[index - 1]?.message.role !== message.role,
      steps: stepsByAnchor.get(index) ?? []
    })),
    orphanSteps
  }
}

function messageTimestamp(timestamp: AgentMessage['timestamp']): number {
  if (typeof timestamp === 'number') return timestamp
  const parsed = Date.parse(timestamp ?? '')
  return Number.isFinite(parsed) ? parsed : 0
}
