<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, FolderTree, GitBranch } from '@lucide/vue'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import WorktreeSwitcher from '@renderer/components/git/WorktreeSwitcher.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'

const { t } = useI18n()
const workspace = useWorkspaceStore()

const width = ref(320)
const diffPatch = ref<string | null>(null)
const diffLoading = ref(false)
let dragStartX = 0
let dragStartWidth = 0

function startResize(event: PointerEvent): void {
  dragStartX = event.clientX
  dragStartWidth = width.value
  document.addEventListener('pointermove', onResize)
  document.addEventListener('pointerup', endResize)
}

function onResize(event: PointerEvent): void {
  const delta = dragStartX - event.clientX
  width.value = Math.min(480, Math.max(240, dragStartWidth + delta))
}

function endResize(): void {
  document.removeEventListener('pointermove', onResize)
  document.removeEventListener('pointerup', endResize)
}

const tab = computed({
  get: () => workspace.inspectorTab,
  set: (value: 'files' | 'git' | 'diff') => {
    workspace.inspectorTab = value
  }
})

watch(
  [() => workspace.inspectorDiffPath, () => workspace.inspectorTab, () => workspace.currentCwd],
  async ([path, currentTab, cwd]) => {
    if (currentTab !== 'diff' || !path || !cwd) return
    diffLoading.value = true
    diffPatch.value = null
    try {
      const result = await callApi(() => getApi().git.diff(cwd, path))
      diffPatch.value = result.patch ?? null
    } catch {
      diffPatch.value = null
    } finally {
      diffLoading.value = false
    }
  },
  { immediate: true }
)

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function backToPanel(): void {
  workspace.inspectorDiffPath = null
  workspace.inspectorTab = 'files'
}
</script>

<template>
  <aside
    data-testid="workspace-inspector"
    class="relative flex shrink-0 flex-col border-l border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
    :style="{ width: `${width}px` }"
  >
    <!-- 拖拽调整宽度 -->
    <div
      class="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize"
      @pointerdown="startResize"
    />

    <header
      class="flex h-9 shrink-0 items-center justify-between border-b border-[var(--border-subtle)] px-2.5"
    >
      <template v-if="tab !== 'diff'">
        <div class="flex gap-1">
          <button
            v-for="item in [
              { id: 'files', label: $t('workspace.files'), icon: FolderTree },
              { id: 'git', label: $t('workspace.git'), icon: GitBranch }
            ] as const"
            :key="item.id"
            type="button"
            class="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium transition-colors"
            :class="
              tab === item.id
                ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
                : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]'
            "
            @click="tab = item.id"
          >
            <component :is="item.icon" class="size-3" :stroke-width="1.75" />
            {{ item.label }}
          </button>
        </div>
      </template>
      <template v-else>
        <button
          type="button"
          class="flex min-w-0 items-center gap-1 rounded-[var(--radius-sm)] px-1.5 py-1 text-left text-[11.5px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          @click="backToPanel"
        >
          <ArrowLeft class="size-3 shrink-0" :stroke-width="1.75" />
          <span class="truncate">{{ fileName(workspace.inspectorDiffPath ?? '') }}</span>
        </button>
      </template>
    </header>

    <div class="min-h-0 flex-1 overflow-hidden">
      <FileExplorer v-if="tab === 'files'" />
      <WorktreeSwitcher v-else-if="tab === 'git'" />
      <div v-else class="h-full overflow-auto p-3">
        <p v-if="diffLoading" class="text-[11.5px] text-[var(--text-tertiary)]">
          {{ $t('workspace.loadingDiff') }}
        </p>
        <EmptyState v-else-if="!diffPatch" :title="$t('workspace.noDiff')" :icon="GitBranch" />
        <pre
          v-else
          class="whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-secondary)]"
          v-text="diffPatch"
        />
      </div>
    </div>
  </aside>
</template>
