import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef } from 'vue'
import type {
  AgentEvent,
  AgentImageAttachment,
  AgentMessage,
  AgentStateSnapshot,
  ImageContent,
  SessionDetail,
  SessionStats,
  TextContent,
  ToolEntry
} from '@shared/types/workspace'
import {
  INITIAL_STREAMING_STATE,
  streamReducer,
  type StreamingState
} from '@shared/workspace/streaming-message'
import { normalizeToolCalls } from '@shared/workspace/normalize'
import type { ClientAssistantMessageEvent } from '@shared/workspace/agent-event-wire'
import { callApi, getApi } from '@renderer/composables/useApi'
import {
  getPresetFromTools,
  getToolNamesForPreset,
  type ToolPreset
} from '@shared/workspace/tool-presets'
import { useSessionStore } from './sessions'
import { useConversationChangesStore } from './conversation-changes'

interface ToolExecution {
  toolName: string
  running: boolean
  result?: string
  isError?: boolean
}

interface QueuedMessage {
  id: string
  sessionId: string | null
  cwd: string | null
  message: string
  images: AgentImageAttachment[]
  preset: ToolPreset
  thinkingLevel: string
}

interface DispatchResult {
  accepted: boolean
  sessionId: string | null
}

export const useAgentStore = defineStore('agent', () => {
  const messages = shallowRef<AgentMessage[]>([])
  const entryIds = shallowRef<string[]>([])
  const entryParents = shallowRef<Record<string, string | null>>({})
  const streaming = shallowRef<StreamingState>(INITIAL_STREAMING_STATE)
  const state = shallowRef<AgentStateSnapshot | null>(null)
  const runningIds = ref<string[]>([])
  const tools = shallowRef<ToolEntry[]>([])
  /** 工具执行实时状态，按 toolCallId 关联到对话区的工具卡片。 */
  const toolExecutions = reactive(new Map<string, ToolExecution>())
  /** 等待执行的本地消息队列（Agent 忙时入队）。 */
  const pendingQueue = ref<QueuedMessage[]>([])
  const activePromptIds = reactive(new Set<string>())
  const thinkingLevel = ref('auto')
  const toolPreset = ref<ToolPreset>('default')
  const sessionStats = shallowRef<SessionStats | null>(null)
  const completionCount = ref(0)
  const error = ref<string | null>(null)
  const sendingCount = ref(0)
  const sending = computed(() => sendingCount.value > 0)
  let loadedDetail: SessionDetail | null = null
  let loadedStatsOverride: Partial<SessionStats> | null = null
  let loadedSessionId: string | null = null
  let loadGeneration = 0
  const composerSelections = new Map<string, { thinkingLevel: string; toolPreset: ToolPreset }>()
  const transientSessionIds = new Set<string>()
  const failedPromptIds = new Set<string>()
  const queueActionIds = new Set<string>()
  const settlingIds = reactive(new Set<string>())
  const settlementTails = new Map<string, Promise<void>>()
  let unsubEvent: (() => void) | null = null
  let unsubRunning: (() => void) | null = null

  function setupListeners() {
    unsubEvent?.()
    unsubRunning?.()
    unsubEvent = getApi().on('agent-event', (payload) => {
      const body = payload as { sessionId?: string; event?: AgentEvent }
      if (!body.sessionId || !body.event) return
      if (body.event.type === 'prompt_error') failedPromptIds.add(body.sessionId)
      if (body.event.type === 'prompt_done') {
        activePromptIds.delete(body.sessionId)
        settlePrompt(body.sessionId, failedPromptIds.delete(body.sessionId))
      }
      if (body.sessionId !== loadedSessionId) return
      if (body.event.type === 'prompt_done') completionCount.value += 1
      applyEvent(body.event)
    })
    unsubRunning = getApi().on('agent-running', (payload) => {
      const body = payload as { ids?: string[] }
      runningIds.value = body.ids ?? []
    })
    return () => {
      unsubEvent?.()
      unsubRunning?.()
    }
  }

  function applyEvent(event: AgentEvent) {
    switch (event.type) {
      case 'agent_start':
        streaming.value = streamReducer(streaming.value, { type: 'start' })
        break
      case 'message_start': {
        const msg = event.message as AgentMessage | undefined
        if (msg?.role === 'assistant') {
          streaming.value = streamReducer(streaming.value, { type: 'snapshot', message: msg })
        }
        break
      }
      case 'message_update': {
        const delta = event.assistantMessageEvent as ClientAssistantMessageEvent | undefined
        if (delta) streaming.value = streamReducer(streaming.value, { type: 'delta', event: delta })
        break
      }
      case 'tool_execution_start': {
        const id = String(event.toolCallId ?? '')
        if (id) {
          toolExecutions.set(id, { toolName: String(event.toolName ?? ''), running: true })
        }
        break
      }
      case 'tool_execution_update': {
        const id = String(event.toolCallId ?? '')
        const current = toolExecutions.get(id)
        if (current) {
          const partial = event.partialResult
          current.result =
            typeof partial === 'string'
              ? partial
              : partial == null
                ? current.result
                : JSON.stringify(partial)
        }
        break
      }
      case 'tool_execution_end': {
        const id = String(event.toolCallId ?? '')
        const current = toolExecutions.get(id)
        if (current) {
          current.running = false
          current.isError = event.isError === true
          if (event.result != null) {
            current.result =
              typeof event.result === 'string' ? event.result : JSON.stringify(event.result)
          }
        }
        break
      }
      case 'message_end': {
        const completed = event.message as AgentMessage | undefined
        if (completed && completed.role !== 'user') {
          messages.value = [...messages.value, normalizeToolCalls(completed)]
        } else if (completed?.role === 'user') {
          const last = messages.value.at(-1)
          if (!(last?.role === 'user' && userText(last) === userText(completed))) {
            messages.value = [...messages.value, completed]
          }
        }
        loadedStatsOverride = null
        refreshLocalStats()
        streaming.value = streamReducer(streaming.value, { type: 'end' })
        break
      }
      case 'prompt_error':
        error.value = String(event.errorMessage ?? 'Agent error')
        streaming.value = streamReducer(streaming.value, { type: 'end' })
        break
      case 'compaction_start':
      case 'auto_compaction_start':
      case 'compaction_end':
      case 'auto_compaction_end':
      case 'agent_end':
      case 'agent_settled':
        void reconcile(loadedSessionId)
        break
      default:
        break
    }
  }

  async function load(sessionId: string | null) {
    const generation = ++loadGeneration
    loadedSessionId = sessionId
    error.value = null
    streaming.value = INITIAL_STREAMING_STATE
    toolExecutions.clear()
    if (!sessionId) {
      messages.value = []
      entryIds.value = []
      entryParents.value = {}
      state.value = null
      tools.value = []
      sessionStats.value = null
      loadedDetail = null
      loadedStatsOverride = null
      thinkingLevel.value = 'auto'
      toolPreset.value = 'default'
      return
    }
    const savedSelection = composerSelections.get(sessionId)
    if (savedSelection) applyComposerSelection(savedSelection)
    else {
      thinkingLevel.value = 'auto'
      toolPreset.value = 'default'
    }
    if (transientSessionIds.has(sessionId)) {
      await reconcile(sessionId, !savedSelection, generation)
      if (isCurrentLoad(sessionId, generation) && !composerSelections.has(sessionId)) {
        rememberComposerSelection(sessionId)
      }
      return
    }
    const detail = await callApi(() => getApi().sessions.get(sessionId))
    if (!isCurrentLoad(sessionId, generation)) return
    loadedDetail = detail
    loadedStatsOverride = null
    messages.value = detail.context.messages
    entryIds.value = detail.context.entryIds
    entryParents.value = detail.context.entryParents ?? {}
    if (!savedSelection) thinkingLevel.value = detail.context.thinkingLevel
    refreshLocalStats()
    await reconcile(sessionId, !savedSelection, generation)
    if (isCurrentLoad(sessionId, generation) && !composerSelections.has(sessionId)) {
      rememberComposerSelection(sessionId)
    }
  }

  async function reconcile(
    sessionId: string | null,
    initializeComposer = false,
    generation = loadGeneration
  ) {
    if (!sessionId) return
    try {
      let snap = await callApi(() => getApi().agent.state(sessionId))
      const running = await callApi(() => getApi().agent.running())
      if (!isCurrentLoad(sessionId, generation)) return
      runningIds.value = running
      let listed: ToolEntry[] | null = null
      try {
        listed = (await callApi(() =>
          getApi().agent.command(sessionId, { type: 'get_tools' })
        )) as ToolEntry[]
        if (!isCurrentLoad(sessionId, generation)) return
        tools.value = listed
        const stats = (await callApi(() =>
          getApi().agent.command(sessionId, { type: 'get_session_stats' })
        )) as Partial<SessionStats>
        if (!isCurrentLoad(sessionId, generation)) return
        loadedStatsOverride = stats
        sessionStats.value = deriveSessionStats(
          sessionId,
          messages.value,
          loadedDetail,
          loadedStatsOverride
        )
        if (!snap) snap = await callApi(() => getApi().agent.state(sessionId))
      } catch {
        /* session may not be live yet */
      }
      if (!isCurrentLoad(sessionId, generation)) return
      state.value = snap
      if (snap?.isStreaming) {
        streaming.value = { ...streaming.value, isStreaming: true }
      } else if (!snap?.isPromptRunning) {
        streaming.value = INITIAL_STREAMING_STATE
      }
      if (initializeComposer && !composerSelections.has(sessionId)) {
        if (snap?.thinkingLevel) thinkingLevel.value = snap.thinkingLevel
        if (listed) toolPreset.value = getPresetFromTools(listed)
      }
    } catch {
      if (isCurrentLoad(sessionId, generation)) state.value = null
    }
  }

  function isSessionOccupied(sessionId: string): boolean {
    return (
      activePromptIds.has(sessionId) ||
      runningIds.value.includes(sessionId) ||
      settlingIds.has(sessionId) ||
      queueActionIds.has(sessionId) ||
      (loadedSessionId === sessionId &&
        (streaming.value.isStreaming || state.value?.isPromptRunning === true))
    )
  }

  function isBusy(sessionId: string | null): boolean {
    if (!sessionId) return sending.value
    return (
      isSessionOccupied(sessionId) ||
      pendingQueue.value.some((item) => item.sessionId === sessionId)
    )
  }

  async function send(
    sessionId: string | null,
    cwd: string | null,
    message: string,
    preset: ToolPreset,
    images: AgentImageAttachment[] = []
  ) {
    if (!message.trim() && !images.length) return
    error.value = null
    const sessionOccupied = sessionId ? isSessionOccupied(sessionId) : sending.value
    const hasQueuedMessages = Boolean(
      sessionId && pendingQueue.value.some((item) => item.sessionId === sessionId)
    )
    if (sessionOccupied || hasQueuedMessages) {
      pendingQueue.value = [
        ...pendingQueue.value,
        {
          id: crypto.randomUUID(),
          sessionId,
          cwd,
          message,
          images,
          preset,
          thinkingLevel: thinkingLevel.value
        }
      ]
      if (sessionId && !sessionOccupied) void drainQueue(sessionId)
      return sessionId
    }

    const result = await dispatch(sessionId, cwd, message, preset, thinkingLevel.value, images, {
      appendOptimistic: true
    })
    return result.sessionId
  }

  async function dispatch(
    sessionId: string | null,
    cwd: string | null,
    message: string,
    preset: ToolPreset,
    promptThinkingLevel: string,
    images: AgentImageAttachment[],
    options: { appendOptimistic?: boolean } = {}
  ): Promise<DispatchResult> {
    const optimistic = options.appendOptimistic ? appendOptimisticMessage(message, images) : null
    sendingCount.value += 1
    error.value = null
    let createdSessionId: string | null = null
    let trackedSessionId = sessionId
    if (sessionId) activePromptIds.add(sessionId)
    try {
      if (!sessionId) {
        if (!cwd) throw new Error('No project cwd')
        const started = await callApi(() =>
          getApi().agent.start({
            cwd,
            toolNames: getToolNamesForPreset(preset),
            ...(promptThinkingLevel !== 'auto' ? { thinkingLevel: promptThinkingLevel } : {})
          })
        )
        loadedSessionId = started.sessionId
        transientSessionIds.add(started.sessionId)
        composerSelections.set(started.sessionId, {
          thinkingLevel: thinkingLevel.value,
          toolPreset: preset
        })
        toolPreset.value = preset
        createdSessionId = started.sessionId
        trackedSessionId = started.sessionId
        activePromptIds.add(started.sessionId)
        bindPendingSession(cwd, started.sessionId)
        useSessionStore().addTransientSession(
          started.sessionId,
          started.cwd,
          message.trim() || '[image]'
        )
        await useConversationChangesStore().beginConversation(started.sessionId, started.cwd)
        await callApi(() =>
          getApi().agent.prompt({
            sessionId: started.sessionId,
            message,
            ...(images.length ? { images } : {})
          })
        )
        return { accepted: true, sessionId: started.sessionId }
      }
      const started = await callApi(() =>
        getApi().agent.start({
          sessionId,
          toolNames: getToolNamesForPreset(preset),
          ...(promptThinkingLevel !== 'auto' ? { thinkingLevel: promptThinkingLevel } : {})
        })
      )
      if (started.sessionId !== sessionId) activePromptIds.delete(sessionId)
      trackedSessionId = started.sessionId
      activePromptIds.add(started.sessionId)
      await useConversationChangesStore().beginConversation(started.sessionId, started.cwd)
      await callApi(() =>
        getApi().agent.prompt({
          sessionId: started.sessionId,
          message,
          ...(images.length ? { images } : {})
        })
      )
      return { accepted: true, sessionId: started.sessionId }
    } catch (e) {
      if (trackedSessionId) activePromptIds.delete(trackedSessionId)
      if (trackedSessionId) useConversationChangesStore().cancelConversation(trackedSessionId)
      error.value = (e as { message?: string }).message ?? String(e)
      if (optimistic) messages.value = messages.value.filter((entry) => entry !== optimistic)
      if (createdSessionId) {
        transientSessionIds.delete(createdSessionId)
        composerSelections.delete(createdSessionId)
        useSessionStore().removeTransientSession(createdSessionId)
      }
      return { accepted: false, sessionId }
    } finally {
      sendingCount.value = Math.max(0, sendingCount.value - 1)
    }
  }

  async function drainQueue(sessionId: string): Promise<void> {
    if (queueActionIds.has(sessionId)) return
    const index = pendingQueue.value.findIndex((item) => item.sessionId === sessionId)
    if (index === -1) return
    const next = pendingQueue.value[index]
    pendingQueue.value = pendingQueue.value.filter((_, itemIndex) => itemIndex !== index)
    const result = await dispatch(
      sessionId,
      next.cwd,
      next.message,
      next.preset,
      next.thinkingLevel,
      next.images,
      { appendOptimistic: loadedSessionId === sessionId }
    )
    if (!result.accepted) insertQueued(index, next)
  }

  async function steerQueued(queueId: string): Promise<void> {
    const index = pendingQueue.value.findIndex((item) => item.id === queueId)
    if (index === -1) return
    const item = pendingQueue.value[index]
    if (!item.sessionId || item.sessionId !== loadedSessionId) return
    const targetId = item.sessionId
    queueActionIds.add(targetId)
    pendingQueue.value = pendingQueue.value.filter((entry) => entry.id !== queueId)
    try {
      const snapshot = await callApi(() => getApi().agent.state(targetId))
      const runtimeBusy = Boolean(
        snapshot?.isStreaming || snapshot?.isPromptRunning || snapshot?.isBashRunning
      )
      if (runtimeBusy) {
        await callApi(() =>
          getApi().agent.prompt({
            sessionId: targetId,
            message: item.message,
            streamingBehavior: 'steer',
            ...(item.images.length ? { images: item.images } : {})
          })
        )
        return
      }
      const result = await dispatch(
        targetId,
        item.cwd,
        item.message,
        item.preset,
        item.thinkingLevel,
        item.images,
        { appendOptimistic: true }
      )
      if (!result.accepted) insertQueued(index, item)
    } catch (cause) {
      error.value = (cause as { message?: string }).message ?? String(cause)
      insertQueued(index, item)
    } finally {
      queueActionIds.delete(targetId)
    }
  }

  function removeQueued(queueId: string): void {
    pendingQueue.value = pendingQueue.value.filter((entry) => entry.id !== queueId)
  }

  function insertQueued(index: number, item: QueuedMessage): void {
    pendingQueue.value = [
      ...pendingQueue.value.slice(0, index),
      item,
      ...pendingQueue.value.slice(index)
    ]
  }

  function bindPendingSession(cwd: string | null, sessionId: string): void {
    pendingQueue.value = pendingQueue.value.map((item) =>
      item.sessionId === null && item.cwd === cwd ? { ...item, sessionId } : item
    )
  }

  function appendOptimisticMessage(message: string, images: AgentImageAttachment[]): AgentMessage {
    const imageBlocks: ImageContent[] = images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.data }
    }))
    const textBlocks: TextContent[] = message.trim() ? [{ type: 'text', text: message }] : []
    const optimistic: AgentMessage = {
      role: 'user',
      content: imageBlocks.length ? [...textBlocks, ...imageBlocks] : message,
      timestamp: Date.now()
    }
    messages.value = [...messages.value, optimistic]
    return optimistic
  }

  function settlePrompt(sessionId: string, failed: boolean): void {
    const previous = settlementTails.get(sessionId) ?? Promise.resolve()
    settlingIds.add(sessionId)
    const task = previous
      .catch(() => undefined)
      .then(() => useConversationChangesStore().finishConversation(sessionId, failed))
      .then(() => syncPersistedSession(sessionId).catch(() => undefined))
      .then(() => drainQueue(sessionId))
    settlementTails.set(sessionId, task)
    void task.finally(() => {
      if (settlementTails.get(sessionId) === task) {
        settlementTails.delete(sessionId)
        settlingIds.delete(sessionId)
      }
    })
  }

  async function abort(sessionId: string) {
    await callApi(() => getApi().agent.abort(sessionId))
  }

  async function compact(sessionId: string) {
    error.value = null
    try {
      return (await callApi(() => getApi().agent.command(sessionId, { type: 'compact' }))) as {
        cancelled?: boolean
        reason?: 'session-too-small' | 'already-compacted'
      } | null
    } catch (e) {
      error.value = (e as { message?: string }).message ?? String(e)
      return null
    }
  }

  async function syncPersistedSession(sessionId: string) {
    const sessions = useSessionStore()
    await sessions.refresh(true)
    if (!sessions.items.some((session) => session.id === sessionId && !session.transient)) return
    transientSessionIds.delete(sessionId)
    if (loadedSessionId === sessionId) await load(sessionId)
  }

  async function setThinking(sessionId: string, level: string) {
    const previous = composerSelections.get(sessionId) ?? {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    }
    thinkingLevel.value = level
    rememberComposerSelection(sessionId)
    if (level === 'auto') return
    try {
      await callApi(() => getApi().agent.command(sessionId, { type: 'set_thinking_level', level }))
    } catch (cause) {
      composerSelections.set(sessionId, previous)
      if (loadedSessionId === sessionId) applyComposerSelection(previous)
      throw cause
    }
  }

  async function setTools(sessionId: string, preset: ToolPreset) {
    const previous = composerSelections.get(sessionId) ?? {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    }
    toolPreset.value = preset
    rememberComposerSelection(sessionId)
    try {
      await callApi(() =>
        getApi().agent.command(sessionId, {
          type: 'set_tools',
          toolNames: getToolNamesForPreset(preset)
        })
      )
      const listed = (await callApi(() =>
        getApi().agent.command(sessionId, { type: 'get_tools' })
      )) as ToolEntry[]
      if (loadedSessionId === sessionId) tools.value = listed
    } catch (cause) {
      composerSelections.set(sessionId, previous)
      if (loadedSessionId === sessionId) applyComposerSelection(previous)
      throw cause
    }
  }

  async function setModel(sessionId: string, provider: string, modelId: string) {
    await callApi(() => getApi().agent.command(sessionId, { type: 'set_model', provider, modelId }))
  }

  async function navigate(sessionId: string, targetId: string) {
    await callApi(() => getApi().agent.command(sessionId, { type: 'navigate_tree', targetId }))
    await load(sessionId)
  }

  async function fork(sessionId: string, entryId: string) {
    const result = (await callApi(() =>
      getApi().agent.command(sessionId, { type: 'fork', entryId })
    )) as { cancelled?: boolean; newSessionId?: string }
    return result
  }

  const activePreset = () => toolPreset.value

  function rememberComposerSelection(sessionId: string) {
    composerSelections.set(sessionId, {
      thinkingLevel: thinkingLevel.value,
      toolPreset: toolPreset.value
    })
  }

  function applyComposerSelection(selection: { thinkingLevel: string; toolPreset: ToolPreset }) {
    thinkingLevel.value = selection.thinkingLevel
    toolPreset.value = selection.toolPreset
  }

  function isCurrentLoad(sessionId: string, generation: number) {
    return loadedSessionId === sessionId && loadGeneration === generation
  }

  function refreshLocalStats() {
    if (!loadedSessionId) {
      sessionStats.value = null
      return
    }
    sessionStats.value = deriveSessionStats(
      loadedSessionId,
      messages.value,
      loadedDetail,
      loadedStatsOverride ?? undefined
    )
  }

  return {
    messages,
    entryIds,
    entryParents,
    streaming,
    state,
    runningIds,
    tools,
    toolExecutions,
    thinkingLevel,
    toolPreset,
    sessionStats,
    completionCount,
    error,
    sending,
    pendingQueue,
    setupListeners,
    load,
    reconcile,
    isBusy,
    send,
    steerQueued,
    removeQueued,
    abort,
    compact,
    setThinking,
    setTools,
    setModel,
    navigate,
    fork,
    activePreset
  }
})

function userText(message: AgentMessage): string {
  if (message.role !== 'user') return ''
  return typeof message.content === 'string'
    ? message.content
    : message.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n')
}

function deriveSessionStats(
  sessionId: string,
  messages: AgentMessage[],
  detail: SessionDetail | null,
  raw?: Partial<SessionStats>
): SessionStats {
  const fallback = {
    userMessages: 0,
    assistantMessages: 0,
    toolCalls: 0,
    toolResults: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    cost: 0
  }
  for (const message of messages) {
    if (message.role === 'user') fallback.userMessages += 1
    if (message.role === 'toolResult') fallback.toolResults += 1
    if (message.role !== 'assistant') continue
    fallback.assistantMessages += 1
    fallback.toolCalls += message.content.filter((block) => block.type === 'toolCall').length
    const usage = message.usage
    if (!usage) continue
    fallback.tokens.input += usage.input ?? 0
    fallback.tokens.output += usage.output ?? 0
    fallback.tokens.cacheRead += usage.cacheRead ?? 0
    fallback.tokens.cacheWrite += usage.cacheWrite ?? 0
    fallback.cost += usage.cost?.total ?? 0
  }
  fallback.tokens.total =
    fallback.tokens.input +
    fallback.tokens.output +
    fallback.tokens.cacheRead +
    fallback.tokens.cacheWrite

  const rawTokens = raw?.tokens
  const numberOr = (value: unknown, defaultValue: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : defaultValue
  const tokens = {
    input: numberOr(rawTokens?.input, fallback.tokens.input),
    output: numberOr(rawTokens?.output, fallback.tokens.output),
    cacheRead: numberOr(rawTokens?.cacheRead, fallback.tokens.cacheRead),
    cacheWrite: numberOr(rawTokens?.cacheWrite, fallback.tokens.cacheWrite),
    total: 0
  }
  tokens.total = numberOr(
    rawTokens?.total,
    tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite
  )

  return {
    sessionFile: raw?.sessionFile || detail?.filePath || undefined,
    sessionId: raw?.sessionId || sessionId,
    sessionName: raw?.sessionName || detail?.info?.name || undefined,
    userMessages: numberOr(raw?.userMessages, fallback.userMessages),
    assistantMessages: numberOr(raw?.assistantMessages, fallback.assistantMessages),
    toolCalls: numberOr(raw?.toolCalls, fallback.toolCalls),
    toolResults: numberOr(raw?.toolResults, fallback.toolResults),
    totalMessages: numberOr(raw?.totalMessages, messages.length),
    tokens,
    cost: numberOr(raw?.cost, fallback.cost),
    totalActiveMs: numberOr(raw?.totalActiveMs, detail?.totalActiveMs ?? 0)
  }
}
