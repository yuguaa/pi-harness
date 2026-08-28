<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CloudDownload,
  GitCommitHorizontal,
  ChevronRight,
  CircleDot,
  File,
  GitBranch,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw
} from '@lucide/vue'
import Button from '@renderer/components/ui/Button.vue'
import Input from '@renderer/components/ui/Input.vue'
import IconButton from '@renderer/components/ui/IconButton.vue'
import Select from '@renderer/components/ui/Select.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi, getErrorPayload } from '@renderer/composables/useApi'
import type { GitBranchState, GitFileStatus, WorktreeInfo } from '@shared/types/workspace'
import { toast } from 'vue-sonner'
import { askConfirm } from '@renderer/composables/useConfirmDialog'
import { STATUS_COLORS, STATUS_LABELS } from '@renderer/utils/git-decoration'

/**
 * Git 面板 —— worktree 管理 + 分区变更列表。
 * 参考 VS Code 的 Source Control 面板：
 *  - 按 git 区域分区：已暂存 / 未暂存 / 未跟踪 / 冲突，每区可折叠
 *  - 文件以扁平列表展示，文件名为主信息，相对目录为辅助信息
 *  - 文件按 git 状态着色，右侧显示 M/A/D/R/U/C 徽标
 *  - 点击文件在右侧预览子面板打开左右 diff
 */

type GitArea = 'conflicts' | 'staged' | 'unstaged' | 'untracked'

const { t } = useI18n()
const workspace = useWorkspaceStore()
const worktrees = ref<WorktreeInfo[]>([])
const branch = ref('')
const collapsedSections = ref<Set<string>>(new Set())
const commitMessage = ref('')
const activeMutation = ref<string | null>(null)
const branchState = ref<GitBranchState | null>(null)
const branchLoading = ref(false)

/* ---------- 按区域分区 ---------- */

/** 文件所属 git 区域：冲突 / 已暂存 / 未暂存 / 未跟踪（同文件可同时暂存+未暂存）。 */
function splitByArea(files: GitFileStatus[]): Record<GitArea, GitFileStatus[]> {
  const result: Record<GitArea, GitFileStatus[]> = {
    conflicts: [],
    staged: [],
    unstaged: [],
    untracked: []
  }
  for (const file of files) {
    if (file.status === 'conflict') {
      result.conflicts.push(file)
      continue
    }
    if (file.indexStatus === '?' && file.worktreeStatus === '?') {
      result.untracked.push(file)
      continue
    }
    if (file.indexStatus !== ' ' && file.indexStatus !== '?') result.staged.push(file)
    if (file.worktreeStatus !== ' ' && file.worktreeStatus !== '?') result.unstaged.push(file)
    // 兜底：index 与 worktree 均无变更标记时归入未暂存
    if (file.indexStatus === ' ' && file.worktreeStatus === ' ') result.unstaged.push(file)
  }
  return result
}

const areas: GitArea[] = ['conflicts', 'staged', 'unstaged', 'untracked']

interface AreaSection {
  id: GitArea
  label: string
  files: GitFileStatus[]
}

const sections = computed<AreaSection[]>(() => {
  const status = workspace.gitStatus
  if (!status?.repositoryRoot) return []
  const byArea = splitByArea(status?.files ?? [])
  return areas.map((area) => ({
    id: area,
    label: areaLabel(area),
    files: [...byArea[area]].sort((left, right) =>
      relativeFilePath(left.filePath).localeCompare(relativeFilePath(right.filePath))
    )
  }))
})

const totalChanges = computed(() => workspace.gitStatus?.files.length ?? 0)
const hasChanges = computed(() => sections.value.some((section) => section.files.length > 0))
const stagedFileCount = computed(
  () => sections.value.find((section) => section.id === 'staged')?.files.length ?? 0
)
const canCommit = computed(
  () => stagedFileCount.value > 0 && commitMessage.value.trim().length > 0 && !activeMutation.value
)
const branchOptions = computed(() =>
  (branchState.value?.branches ?? []).map((branch) => ({
    value: `${branch.remote ? 'remote' : 'local'}:${branch.name}`,
    label: branch.name
  }))
)
const branchValue = computed({
  get: () => (branchState.value?.currentBranch ? `local:${branchState.value.currentBranch}` : ''),
  set: (value: string) => switchBranch(value)
})
const gitOperationBusy = computed(() => Boolean(activeMutation.value) || branchLoading.value)

function areaLabel(area: GitArea): string {
  switch (area) {
    case 'staged':
      return t('workspace.stagedChanges')
    case 'unstaged':
      return t('workspace.changes')
    case 'untracked':
      return t('workspace.untrackedFiles')
    case 'conflicts':
      return t('workspace.conflicts')
  }
}

function toggleSection(id: string): void {
  const next = new Set(collapsedSections.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  collapsedSections.value = next
}

function relativeFilePath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const normalizedRoot = workspace.gitStatus?.repositoryRoot
    ?.replace(/\\/g, '/')
    .replace(/\/+$/, '')
  if (normalizedRoot && normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1)
  }
  return normalizedPath
}

function fileName(filePath: string): string {
  const relativePath = relativeFilePath(filePath)
  return relativePath.split('/').pop() ?? relativePath
}

function fileDirectory(filePath: string): string {
  const relativePath = relativeFilePath(filePath)
  const separator = relativePath.lastIndexOf('/')
  return separator > 0 ? relativePath.slice(0, separator) : ''
}

function isDiffSelected(filePath: string): boolean {
  return workspace.inspectorPreview === 'diff' && workspace.inspectorDiffPath === filePath
}

function openDiff(filePath: string): void {
  workspace.showInspectorDiff(filePath)
}

function refreshGit(): void {
  void Promise.all([workspace.loadGit(), loadBranchState()])
}

function sectionActionKind(area: GitArea): 'stage' | 'unstage' | null {
  if (area === 'staged') return 'unstage'
  if (area === 'unstaged' || area === 'untracked') return 'stage'
  return null
}

function actionLabel(action: 'stage' | 'unstage'): string {
  return t(action === 'stage' ? 'workspace.stage' : 'workspace.unstage')
}

function sectionActionLabel(area: GitArea): string {
  const action = sectionActionKind(area)
  if (!action) return ''
  return t(action === 'stage' ? 'workspace.stageAll' : 'workspace.unstageAll')
}

type GitMutation = 'stage' | 'unstage' | 'commit' | 'fetch' | 'pull' | 'push' | 'switch'

function mutationKey(action: GitMutation, scope: string): string {
  return `${action}:${scope}`
}

function isMutationActive(key: string): boolean {
  return activeMutation.value === key
}

function mutateFiles(action: 'stage' | 'unstage', filePaths: string[], scope: string): void {
  const cwd = workspace.currentCwd
  if (!cwd || !filePaths.length || activeMutation.value) return

  const key = mutationKey(action, scope)
  activeMutation.value = key
  callApi(() =>
    action === 'stage' ? getApi().git.stage(cwd, filePaths) : getApi().git.unstage(cwd, filePaths)
  )
    .then(() => workspace.loadGit())
    .then(() =>
      toast.success(
        t(action === 'stage' ? 'workspace.filesStaged' : 'workspace.filesUnstaged', {
          count: filePaths.length
        })
      )
    )
    .catch((error) => toast.error(getErrorPayload(error).message))
    .finally(() => {
      if (activeMutation.value === key) activeMutation.value = null
    })
}

function mutateSection(section: AreaSection): void {
  const action = sectionActionKind(section.id)
  if (!action) return
  mutateFiles(
    action,
    section.files.map((file) => file.filePath),
    `section:${section.id}`
  )
}

function mutateFile(area: GitArea, filePath: string): void {
  const action = sectionActionKind(area)
  if (!action) return
  mutateFiles(action, [filePath], `file:${filePath}`)
}

function commitChanges(): void {
  const cwd = workspace.currentCwd
  const message = commitMessage.value.trim()
  if (!cwd || !message || !stagedFileCount.value || activeMutation.value) return

  const key = mutationKey('commit', 'workspace')
  activeMutation.value = key
  callApi(() => getApi().git.commit(cwd, message))
    .then(() => {
      commitMessage.value = ''
      return Promise.all([workspace.loadGit(), loadBranchState()])
    })
    .then(() => toast.success(t('workspace.commitCreated')))
    .catch((error) => toast.error(getErrorPayload(error).message))
    .finally(() => {
      if (activeMutation.value === key) activeMutation.value = null
    })
}

function loadBranchState(): Promise<void> {
  const cwd = workspace.currentCwd
  if (!cwd) {
    branchState.value = null
    return Promise.resolve()
  }
  branchLoading.value = true
  return callApi(() => getApi().git.branches(cwd))
    .then((state) => {
      if (workspace.currentCwd === cwd) branchState.value = state
    })
    .catch(() => {
      if (workspace.currentCwd === cwd) branchState.value = null
    })
    .finally(() => {
      if (workspace.currentCwd === cwd) branchLoading.value = false
    })
}

function refreshRepositoryState(): Promise<unknown> {
  return Promise.all([workspace.loadGit(), loadBranchState(), refreshWorktrees()])
}

function switchBranch(value: string): void {
  const cwd = workspace.currentCwd
  if (!cwd || activeMutation.value) return
  const separator = value.indexOf(':')
  if (separator <= 0) return
  const kind = value.slice(0, separator)
  const branchName = value.slice(separator + 1)
  if (!branchName || (kind !== 'local' && kind !== 'remote')) return
  if (kind === 'local' && branchName === branchState.value?.currentBranch) return

  const key = mutationKey('switch', branchName)
  activeMutation.value = key
  callApi(() => getApi().git.switchBranch(cwd, branchName, kind === 'remote'))
    .then(() => {
      workspace.inspectorPreview = null
      workspace.inspectorDiffPath = null
      return refreshRepositoryState()
    })
    .then(() => toast.success(t('workspace.branchSwitched', { branch: branchName })))
    .catch((error) => toast.error(getErrorPayload(error).message))
    .finally(() => {
      if (activeMutation.value === key) activeMutation.value = null
    })
}

function runRemoteAction(action: 'fetch' | 'pull' | 'push'): void {
  const cwd = workspace.currentCwd
  if (!cwd || activeMutation.value) return
  const key = mutationKey(action, 'repository')
  activeMutation.value = key
  callApi(() => getApi().git[action](cwd))
    .then(() => refreshRepositoryState())
    .then(() => toast.success(t(`workspace.${action}Done`)))
    .catch((error) => toast.error(getErrorPayload(error).message))
    .finally(() => {
      if (activeMutation.value === key) activeMutation.value = null
    })
}

function onCommitKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') commitChanges()
}

/* ---------- worktree 管理 ---------- */

async function refreshWorktrees() {
  const cwd = workspace.currentCwd
  if (!cwd) {
    worktrees.value = []
    return
  }
  try {
    worktrees.value = await callApi(() => getApi().worktrees.list(cwd))
  } catch {
    worktrees.value = []
  }
}

async function createWorktree() {
  const cwd = workspace.currentCwd
  if (!cwd || !branch.value.trim()) return
  await callApi(() => getApi().worktrees.create(cwd, branch.value.trim()))
  branch.value = ''
  toast.success(t('workspace.worktreeCreated'))
  await refreshWorktrees()
}

async function removeWorktree(path: string) {
  const cwd = workspace.currentCwd
  if (!cwd) return
  const ok = await askConfirm({
    title: t('workspace.removeWorktreeTitle'),
    description: t('workspace.removeWorktreeConfirm'),
    confirmLabel: t('common.delete'),
    tone: 'danger'
  })
  if (!ok) return
  await callApi(() => getApi().worktrees.remove(cwd, path, false))
  await refreshWorktrees()
}

onMounted(() => {
  void Promise.all([refreshWorktrees(), loadBranchState()])
})

watch(
  () => workspace.currentCwd,
  () => {
    commitMessage.value = ''
    branchState.value = null
    void Promise.all([refreshWorktrees(), loadBranchState()])
  }
)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-2 overflow-y-auto px-2 py-2">
    <!-- 提交区：只有已暂存变更才能提交，快捷键为 Cmd/Ctrl+Enter。 -->
    <div
      v-if="workspace.gitStatus?.isGitRepository"
      class="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border-subtle)] pb-2"
    >
      <label for="git-commit-message" class="sr-only">
        {{ $t('workspace.commitMessage') }}
      </label>
      <textarea
        id="git-commit-message"
        v-model="commitMessage"
        data-testid="git-commit-message"
        rows="2"
        :placeholder="$t('workspace.commitMessagePlaceholder')"
        class="min-h-[52px] w-full resize-none rounded-[var(--radius-sm)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2.5 py-2 text-[12px] leading-snug text-[var(--text-primary)] shadow-[var(--control-shadow)] placeholder:text-[var(--control-placeholder)] transition-[background-color,border-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-out)] hover:border-[var(--control-border-hover)] hover:bg-[var(--control-bg-hover)] focus:border-[var(--accent)] focus:bg-[var(--control-bg-hover)] focus:outline-none focus:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
        @keydown.meta.enter.prevent="onCommitKeydown"
        @keydown.ctrl.enter.prevent="onCommitKeydown"
      />
      <div class="flex items-center justify-between gap-2">
        <span class="min-w-0 truncate text-[10.5px] text-[var(--text-tertiary)]">
          {{ $t('workspace.stagedCount', { count: stagedFileCount }) }}
        </span>
        <div class="flex shrink-0 items-center gap-1">
          <IconButton
            data-testid="git-refresh"
            :label="$t('workspace.refreshGit')"
            :disabled="Boolean(activeMutation) || workspace.gitLoading"
            @click="refreshGit"
          >
            <RefreshCw
              class="size-3.5"
              :class="workspace.gitLoading ? 'animate-spin' : ''"
              :stroke-width="1.75"
            />
          </IconButton>
          <Button
            data-testid="git-commit"
            variant="primary"
            size="sm"
            :disabled="!canCommit"
            :loading="isMutationActive(mutationKey('commit', 'workspace'))"
            :title="!stagedFileCount ? $t('workspace.commitRequiresStaged') : undefined"
            @click="commitChanges"
          >
            <GitCommitHorizontal class="size-3.5" :stroke-width="1.75" />
            {{ $t('workspace.commit') }}
          </Button>
        </div>
      </div>
    </div>

    <!-- 分支与远端同步 -->
    <div
      v-if="workspace.gitStatus?.isGitRepository"
      data-testid="git-sync-controls"
      class="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border-subtle)] pb-2"
    >
      <div class="flex min-w-0 items-center gap-1">
        <Select
          v-model="branchValue"
          data-testid="git-branch-select"
          :options="branchOptions"
          :placeholder="
            branchState?.detached ? $t('workspace.detachedHead') : $t('workspace.branch')
          "
          :disabled="gitOperationBusy || !branchOptions.length"
          mono
          class="min-w-0 flex-1"
        />
        <IconButton
          data-testid="git-fetch"
          :label="$t('workspace.fetch')"
          :disabled="gitOperationBusy || !branchState?.remotes.length"
          @click="runRemoteAction('fetch')"
        >
          <LoaderCircle
            v-if="isMutationActive(mutationKey('fetch', 'repository'))"
            class="size-3.5 animate-spin"
            :stroke-width="1.75"
          />
          <CloudDownload v-else class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton
          data-testid="git-pull"
          :label="$t('workspace.pullFastForwardOnly')"
          :disabled="gitOperationBusy || !branchState?.upstream"
          @click="runRemoteAction('pull')"
        >
          <LoaderCircle
            v-if="isMutationActive(mutationKey('pull', 'repository'))"
            class="size-3.5 animate-spin"
            :stroke-width="1.75"
          />
          <ArrowDownToLine v-else class="size-3.5" :stroke-width="1.75" />
        </IconButton>
        <IconButton
          data-testid="git-push"
          :label="$t('workspace.push')"
          :disabled="gitOperationBusy || !branchState?.currentBranch || !branchState.remotes.length"
          @click="runRemoteAction('push')"
        >
          <LoaderCircle
            v-if="isMutationActive(mutationKey('push', 'repository'))"
            class="size-3.5 animate-spin"
            :stroke-width="1.75"
          />
          <ArrowUpFromLine v-else class="size-3.5" :stroke-width="1.75" />
        </IconButton>
      </div>
      <div
        v-if="branchState?.currentBranch"
        class="flex min-w-0 items-center gap-2 px-1 text-[10.5px] text-[var(--text-tertiary)]"
      >
        <GitBranch class="size-3 shrink-0" :stroke-width="1.75" />
        <span class="min-w-0 flex-1 truncate">
          {{ branchState.upstream || $t('workspace.noUpstream') }}
        </span>
        <span v-if="branchState.ahead" class="shrink-0 tabular-nums text-[var(--accent)]">
          ↑{{ branchState.ahead }}
        </span>
        <span v-if="branchState.behind" class="shrink-0 tabular-nums text-[var(--warning)]">
          ↓{{ branchState.behind }}
        </span>
      </div>
    </div>

    <!-- worktree 管理 -->
    <div class="flex shrink-0 gap-1">
      <Input v-model="branch" :placeholder="$t('workspace.branchPlaceholder')" />
      <Button size="sm" @click="createWorktree">{{ $t('workspace.addWorktree') }}</Button>
    </div>
    <button
      v-for="wt in worktrees"
      :key="wt.path"
      type="button"
      class="flex items-center justify-between rounded-[var(--radius-sm)] px-2 py-1 text-left text-[12px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <GitBranch class="size-3.5 shrink-0 text-[var(--text-tertiary)]" :stroke-width="1.75" />
        <span class="truncate">{{ wt.branch || wt.path }}</span>
        <span v-if="wt.isMain" class="shrink-0 text-[10px] text-[var(--text-tertiary)]">
          (main)
        </span>
      </span>
      <span
        v-if="!wt.isMain"
        class="shrink-0 text-[11px] text-[var(--danger)]"
        @click.stop="removeWorktree(wt.path)"
      >
        {{ $t('common.delete') }}
      </span>
    </button>

    <!-- 变更摘要 -->
    <div v-if="totalChanges" class="mt-1 flex shrink-0 items-center gap-2">
      <p class="text-[10.5px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)]">
        {{ $t('workspace.changes') }} · {{ totalChanges }}
      </p>
      <span
        v-if="(workspace.gitStatus?.additions ?? 0) > 0"
        class="text-[10.5px] tabular-nums text-[var(--git-decoration-added)]"
      >
        +{{ workspace.gitStatus?.additions }}
      </span>
      <span
        v-if="(workspace.gitStatus?.deletions ?? 0) > 0"
        class="text-[10.5px] tabular-nums text-[var(--git-decoration-deleted)]"
      >
        −{{ workspace.gitStatus?.deletions }}
      </span>
    </div>

    <!-- 分区变更列表 -->
    <div v-if="hasChanges" data-testid="git-change-list" class="flex flex-col gap-2">
      <div v-for="section in sections" :key="section.id" :data-testid="`git-section-${section.id}`">
        <!-- 分区 header -->
        <div v-if="section.files.length" class="flex items-center gap-1">
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[11px] font-medium uppercase tracking-[0.06em] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-secondary)]"
            :aria-expanded="!collapsedSections.has(section.id)"
            @click="toggleSection(section.id)"
          >
            <ChevronRight
              class="size-3 shrink-0 text-[var(--text-tertiary)] transition-transform duration-100"
              :class="!collapsedSections.has(section.id) ? 'rotate-90' : ''"
              :stroke-width="1.75"
            />
            <span class="min-w-0 flex-1 truncate">{{ section.label }}</span>
            <span
              v-if="section.id === 'conflicts'"
              class="shrink-0 text-[10px] tabular-nums text-[var(--error)]"
            >
              {{ section.files.length }}
            </span>
            <span v-else class="shrink-0 text-[10px] tabular-nums">
              {{ section.files.length }}
            </span>
          </button>
          <IconButton
            v-if="sectionActionKind(section.id)"
            data-testid="git-section-action"
            :data-section="section.id"
            :data-action="sectionActionKind(section.id)"
            :label="sectionActionLabel(section.id)"
            :disabled="Boolean(activeMutation)"
            @click="mutateSection(section)"
          >
            <LoaderCircle
              v-if="
                isMutationActive(
                  mutationKey(sectionActionKind(section.id)!, `section:${section.id}`)
                )
              "
              class="size-3.5 animate-spin"
              :stroke-width="1.75"
            />
            <component
              :is="sectionActionKind(section.id) === 'stage' ? Plus : Minus"
              v-else
              class="size-3.5"
              :stroke-width="1.75"
            />
          </IconButton>
        </div>

        <!-- 分区内容 -->
        <div v-if="!collapsedSections.has(section.id)" class="flex flex-col gap-0.5">
          <div
            v-for="file in section.files"
            :key="`${section.id}:${file.filePath}`"
            data-testid="git-change-file"
            class="group flex w-full items-center gap-1 rounded-[var(--radius-sm)] pr-1 text-left text-[var(--text-secondary)] transition-colors"
            :class="
              isDiffSelected(file.filePath)
                ? 'bg-[var(--accent-tint)]'
                : 'hover:bg-[var(--bg-hover)]'
            "
          >
            <button
              type="button"
              class="grid min-w-0 flex-1 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-1.5 px-2 py-1.5 text-left active:scale-[0.99]"
              :title="relativeFilePath(file.filePath)"
              :aria-pressed="isDiffSelected(file.filePath)"
              @click="openDiff(file.filePath)"
            >
              <File
                class="size-3.5 shrink-0"
                :stroke-width="1.75"
                :style="{ color: STATUS_COLORS[file.status] }"
              />
              <span class="min-w-0">
                <span
                  class="block truncate text-[12px] leading-4"
                  :style="{ color: STATUS_COLORS[file.status] }"
                >
                  {{ fileName(file.filePath) }}
                </span>
                <span
                  v-if="fileDirectory(file.filePath)"
                  class="block truncate text-[10.5px] leading-3.5 text-[var(--text-tertiary)]"
                >
                  {{ fileDirectory(file.filePath) }}
                </span>
              </span>
              <span
                class="shrink-0 text-[10px] font-semibold tracking-wide"
                :style="{ color: STATUS_COLORS[file.status] }"
              >
                {{ STATUS_LABELS[file.status] }}
              </span>
            </button>
            <IconButton
              v-if="sectionActionKind(section.id)"
              data-testid="git-file-action"
              :data-path="file.filePath"
              :data-action="sectionActionKind(section.id)"
              :label="actionLabel(sectionActionKind(section.id)!)"
              :show-label="true"
              :disabled="Boolean(activeMutation)"
              @click="mutateFile(section.id, file.filePath)"
            >
              <LoaderCircle
                v-if="
                  isMutationActive(
                    mutationKey(sectionActionKind(section.id)!, `file:${file.filePath}`)
                  )
                "
                class="size-3.5 animate-spin"
                :stroke-width="1.75"
              />
              <component
                :is="sectionActionKind(section.id) === 'stage' ? Plus : Minus"
                v-else
                class="size-3.5"
                :stroke-width="1.75"
              />
            </IconButton>
          </div>
        </div>
      </div>
    </div>

    <!-- 空态 / 非 git 仓库 -->
    <div
      v-else
      class="flex flex-col items-center gap-1 px-2 py-6 text-center text-[11px] text-[var(--text-tertiary)]"
    >
      <CircleDot class="size-4" :stroke-width="1.75" />
      <span>{{ $t('workspace.noChanges') }}</span>
    </div>
  </div>
</template>
