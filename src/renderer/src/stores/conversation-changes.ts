import { defineStore } from 'pinia'
import { reactive } from 'vue'
import type { ConversationChangeStep, ConversationFileChange } from '@shared/types/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'

/** 对话开始时的快照：记录当前已脏文件的内容，用于对比本轮的增量变更。 */
interface Snapshot {
  cwd: string
  dirtyBefore: Map<string, string | null>
}

const EMPTY_REVISION = '0'.repeat(64)

export const useConversationChangesStore = defineStore('conversation-changes', () => {
  const stepsBySession = reactive(new Map<string, ConversationChangeStep[]>())
  const snapshots = new Map<string, Snapshot>()
  const pending = new Map<string, Promise<void>>()
  let stepSeq = 0

  function stepsFor(sessionId: string): ConversationChangeStep[] {
    return stepsBySession.get(sessionId) ?? []
  }

  async function readText(filePath: string): Promise<string | null> {
    try {
      const preview = await callApi(() => getApi().files.read(filePath))
      if (preview.kind === 'text' && typeof preview.text === 'string' && !preview.truncated) {
        return preview.text
      }
      return null
    } catch {
      /* 文件可能已被删除，返回 null 交由删除态处理 */
      return null
    }
  }

  async function beginConversation(sessionId: string, cwd: string | null): Promise<void> {
    if (!sessionId || !cwd) return
    const task = snapshotConversation(sessionId, cwd)
    pending.set(sessionId, task)
    try {
      await task
    } finally {
      if (pending.get(sessionId) === task) pending.delete(sessionId)
    }
  }

  async function snapshotConversation(sessionId: string, cwd: string): Promise<void> {
    const snapshot: Snapshot = { cwd, dirtyBefore: new Map() }
    snapshots.set(sessionId, snapshot)
    try {
      const status = await callApi(() => getApi().git.status(cwd))
      if (!status.isGitRepository) return
      await Promise.all(
        status.files.map(async (file) => {
          const text = await readText(file.filePath)
          if (text !== null) {
            snapshot.dirtyBefore.set(file.filePath, text)
            return
          }
          if (file.status === 'deleted') snapshot.dirtyBefore.set(file.filePath, null)
        })
      )
    } catch {
      /* 保留占位快照 */
    }
  }

  async function finishConversation(sessionId: string | null, failed: boolean): Promise<void> {
    if (!sessionId) return
    const pendingSnapshot = pending.get(sessionId)
    if (pendingSnapshot) await pendingSnapshot
    const snapshot = snapshots.get(sessionId)
    if (!snapshot) return
    snapshots.delete(sessionId)
    try {
      const status = await callApi(() => getApi().git.status(snapshot.cwd))
      if (!status.isGitRepository) return
      const filesAfter = new Map(status.files.map((file) => [file.filePath, file]))
      const candidatePaths = new Set([...filesAfter.keys(), ...snapshot.dirtyBefore.keys()])
      const changes = (
        await Promise.all(
          [...candidatePaths].map(async (filePath): Promise<ConversationFileChange | null> => {
            const file = filesAfter.get(filePath)
            const after = await readText(filePath)
            const hadDirtyBefore = snapshot.dirtyBefore.has(filePath)
            const dirtyBefore = snapshot.dirtyBefore.get(filePath)
            let before: string | null
            if (hadDirtyBefore) {
              before = dirtyBefore ?? null
            } else {
              const head = await callApi(() => getApi().git.showFile(snapshot.cwd, filePath))
              before = head.content
            }
            /* before/after 相同说明本轮没有动它；无法读文本则不追踪内容。 */
            if (before !== null && after !== null && before === after) return null
            if (before === null && after === null) return null
            const revertible = before !== null || after !== null
            return {
              filePath,
              status: file?.status ?? (after === null ? 'deleted' : 'modified'),
              additions: 0,
              deletions: 0,
              before,
              after,
              reverted: false,
              revertible
            }
          })
        )
      ).filter((change): change is ConversationFileChange => change !== null)
      if (!changes.length) return
      const step: ConversationChangeStep = {
        stepId: `step-${Date.now()}-${++stepSeq}`,
        sessionId,
        files: changes,
        additions: status.additions,
        deletions: status.deletions,
        createdAt: Date.now(),
        failed
      }
      const list = stepsBySession.get(sessionId) ?? []
      stepsBySession.set(sessionId, [...list, step])
    } catch {
      /* 追踪失败不应影响对话流程 */
    }
  }

  async function applyContent(filePath: string, content: string | null): Promise<void> {
    if (content === null) {
      await callApi(() => getApi().files.delete(filePath))
    } else {
      await callApi(() => getApi().files.write(filePath, content, EMPTY_REVISION, true))
    }
  }

  async function revertFile(change: ConversationFileChange): Promise<void> {
    if (!change.revertible) return
    await applyContent(change.filePath, change.before)
    change.reverted = true
  }

  async function reapplyFile(change: ConversationFileChange): Promise<void> {
    if (!change.revertible) return
    await applyContent(change.filePath, change.after)
    change.reverted = false
  }

  function cancelConversation(sessionId: string): void {
    snapshots.delete(sessionId)
    pending.delete(sessionId)
  }

  function clearSession(sessionId: string): void {
    stepsBySession.delete(sessionId)
    cancelConversation(sessionId)
  }

  return {
    stepsFor,
    beginConversation,
    finishConversation,
    cancelConversation,
    revertFile,
    reapplyFile,
    clearSession
  }
})
