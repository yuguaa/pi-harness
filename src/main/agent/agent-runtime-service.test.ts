import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionLike, PiSessionManagerLike } from './pi-sdk'

const loadPiCodingAgent = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({ BrowserWindow: class BrowserWindow {} }))
vi.mock('./pi-sdk', () => ({ loadPiCodingAgent }))

import { AgentRuntimeService, AgentSessionWrapper } from './agent-runtime-service'
import type { SessionService } from '../sessions/session-service'

describe('AgentRuntimeService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the initial message without exposing an unpersisted JSONL path', async () => {
    const manager = createSessionManager()
    const inner = createAgentSession(manager)
    const cachePath = vi.fn()
    loadPiCodingAgent.mockResolvedValue({
      SessionManager: { create: () => manager },
      createAgentSessionServices: async () => ({}),
      createAgentSessionFromServices: async () => ({ session: inner }),
      getAgentDir: () => '/tmp/agent'
    })
    const sessions = {
      cachePath,
      invalidate: vi.fn(),
      resolvePath: vi.fn()
    } as unknown as SessionService

    const result = await new AgentRuntimeService(sessions).start({
      cwd: '/tmp/project',
      message: 'hello'
    })

    expect(result).toEqual({ sessionId: 'session-new', cwd: '/tmp/project' })
    expect(inner.prompt).toHaveBeenCalledWith('hello', expect.objectContaining({ source: 'rpc' }))
    expect(cachePath).not.toHaveBeenCalled()
  })

  it('treats a short-session compaction as a normal no-op', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.compact = vi.fn().mockRejectedValue(new Error('Nothing to compact (session too small)'))

    const result = await new AgentSessionWrapper(inner).send({ type: 'compact' })

    expect(result).toEqual({ cancelled: true, reason: 'session-too-small' })
  })

  it('uses prompt streaming behavior so an idle steer starts a normal run', async () => {
    const inner = createAgentSession(createSessionManager())
    const wrapper = new AgentSessionWrapper(inner)
    const events: string[] = []
    wrapper.onEvent((event) => events.push(event.type))

    await wrapper.send({ type: 'prompt', message: 'guide', streamingBehavior: 'steer' })
    await vi.waitFor(() => expect(events).toContain('prompt_done'))

    expect(inner.prompt).toHaveBeenCalledWith(
      'guide',
      expect.objectContaining({ streamingBehavior: 'steer', source: 'rpc' })
    )
  })

  it.each(['steer', 'followUp'] as const)(
    'emits one completion event when %s joins an active prompt',
    async (streamingBehavior) => {
      const inner = createAgentSession(createSessionManager())
      let finishFirst: (() => void) | undefined
      const firstPrompt = new Promise<void>((resolve) => {
        finishFirst = resolve
      })
      inner.prompt = vi
        .fn()
        .mockImplementationOnce((_message: string, options?: Record<string, unknown>) => {
          const preflight = options?.preflightResult as ((success: boolean) => void) | undefined
          preflight?.(true)
          return firstPrompt
        })
        .mockImplementationOnce((_message: string, options?: Record<string, unknown>) => {
          const preflight = options?.preflightResult as ((success: boolean) => void) | undefined
          preflight?.(true)
          return Promise.resolve()
        })
      const wrapper = new AgentSessionWrapper(inner)
      const events: string[] = []
      wrapper.onEvent((event) => events.push(event.type))

      await wrapper.send({ type: 'prompt', message: 'first' })
      await wrapper.send({ type: 'prompt', message: 'guide', streamingBehavior })
      await Promise.resolve()
      expect(events).not.toContain('prompt_done')

      finishFirst?.()
      await vi.waitFor(() =>
        expect(events.filter((event) => event === 'prompt_done')).toHaveLength(1)
      )
    }
  )

  it('accepts steer while a shell tool is running', async () => {
    const inner = createAgentSession(createSessionManager())
    inner.isBashRunning = true
    const wrapper = new AgentSessionWrapper(inner)

    await expect(
      wrapper.send({ type: 'prompt', message: 'stop the command', streamingBehavior: 'steer' })
    ).resolves.toBeNull()
    expect(inner.prompt).toHaveBeenCalledWith(
      'stop the command',
      expect.objectContaining({ streamingBehavior: 'steer' })
    )
  })
})

function createSessionManager(): PiSessionManagerLike {
  return {
    getCwd: () => '/tmp/project',
    getSessionFile: () => '/tmp/deferred.jsonl',
    getSessionId: () => 'session-new',
    getSessionName: () => undefined,
    getEntries: () => [],
    getEntry: () => undefined,
    getHeader: () => null,
    getLeafId: () => null,
    getBranch: () => [],
    getSessionDir: () => '/tmp',
    isPersisted: () => true,
    newSession: () => undefined,
    createBranchedSession: () => null
  }
}

function createAgentSession(manager: PiSessionManagerLike): AgentSessionLike {
  const prompt = vi.fn(async (_message: string, options?: Record<string, unknown>) => {
    const preflightResult = options?.preflightResult as ((success: boolean) => void) | undefined
    preflightResult?.(true)
  })
  return {
    sessionId: 'session-new',
    sessionFile: '/tmp/deferred.jsonl',
    sessionManager: manager,
    isStreaming: false,
    isBashRunning: false,
    isCompacting: false,
    autoCompactionEnabled: true,
    model: { id: 'model', provider: 'provider' },
    agent: { state: { thinkingLevel: 'off' } },
    modelRuntime: { getModel: () => undefined, refresh: async () => undefined },
    subscribe: () => () => undefined,
    prompt,
    abort: async () => undefined,
    compact: async () => undefined,
    navigateTree: async () => ({ cancelled: false }),
    setModel: async () => undefined,
    setThinkingLevel: () => undefined,
    setSessionName: () => undefined,
    setAutoCompactionEnabled: () => undefined,
    setActiveToolsByName: () => undefined,
    getAllTools: () => [],
    getActiveToolNames: () => [],
    getContextUsage: () => null,
    dispose: () => undefined
  }
}
