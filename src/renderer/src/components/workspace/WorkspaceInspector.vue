<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { File, FolderTree, GitBranch, X } from '@lucide/vue'
import {
  monaco,
  syncMonacoTheme,
  detectMonacoLanguage,
  parseUnifiedDiff
} from '@renderer/utils/monaco'
import FileExplorer from '@renderer/components/files/FileExplorer.vue'
import GitPanel from '@renderer/components/git/GitPanel.vue'
import FileViewer from '@renderer/components/files/FileViewer.vue'
import EmptyState from '@renderer/components/ui/EmptyState.vue'
import { useWorkspaceStore } from '@renderer/stores/workspace'
import { callApi, getApi } from '@renderer/composables/useApi'

useI18n()
const workspace = useWorkspaceStore()

const width = ref(320)
const diffPatch = ref<string | null>(null)
const diffLoading = ref(false)
const preview = computed(() => workspace.inspectorPreview)
const hasPreview = computed(() => preview.value !== null)
const previewPath = computed(() =>
  preview.value === 'diff' ? workspace.inspectorDiffPath : workspace.inspectorFilePath
)
const MIN_INSPECTOR_WIDTH = 240
const MIN_PREVIEW_WIDTH = 760
const MAX_INSPECTOR_WIDTH = 1100
let widthBeforePreview: number | null = null
let diffRequestVersion = 0
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
  const minimum = hasPreview.value ? MIN_PREVIEW_WIDTH : MIN_INSPECTOR_WIDTH
  width.value = Math.min(MAX_INSPECTOR_WIDTH, Math.max(minimum, dragStartWidth + delta))
}

function endResize(): void {
  document.removeEventListener('pointermove', onResize)
  document.removeEventListener('pointerup', endResize)
}

const tab = computed({
  get: () => workspace.inspectorTab,
  set: (value: 'files' | 'git') => {
    workspace.inspectorTab = value
  }
})

watch(
  [() => workspace.inspectorDiffPath, preview, () => workspace.currentCwd],
  ([path, currentPreview, cwd]) => {
    const requestVersion = ++diffRequestVersion
    if (currentPreview !== 'diff' || !path || !cwd) {
      diffPatch.value = null
      diffLoading.value = false
      return
    }

    diffLoading.value = true
    diffPatch.value = null
    callApi(() => getApi().git.diff(cwd, path))
      .then((result) => {
        if (
          requestVersion !== diffRequestVersion ||
          workspace.inspectorPreview !== 'diff' ||
          workspace.inspectorDiffPath !== path ||
          workspace.currentCwd !== cwd
        ) {
          return
        }
        diffPatch.value = result.patch ?? null
      })
      .catch(() => {
        if (requestVersion === diffRequestVersion) diffPatch.value = null
      })
      .finally(() => {
        if (requestVersion === diffRequestVersion) diffLoading.value = false
      })
  },
  { immediate: true }
)

watch(preview, (next, previous) => {
  if (next && !previous) {
    widthBeforePreview = width.value
    width.value = Math.max(width.value, MIN_PREVIEW_WIDTH)
    return
  }
  if (!next && previous && widthBeforePreview !== null) {
    width.value = widthBeforePreview
    widthBeforePreview = null
  }
})

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

function backToPanel(): void {
  destroyDiffEditor()
  diffPatch.value = null
  workspace.inspectorDiffPath = null
  workspace.inspectorFilePath = null
  workspace.inspectorPreview = null
}

/* ---------- Monaco DiffEditor ---------- */

const diffHost = ref<HTMLElement | null>(null)
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null
let originalModel: monaco.editor.ITextModel | null = null
let modifiedModel: monaco.editor.ITextModel | null = null

function destroyDiffEditor(): void {
  diffEditor?.dispose()
  diffEditor = null
  originalModel?.dispose()
  originalModel = null
  modifiedModel?.dispose()
  modifiedModel = null
}

watch(
  [diffPatch, diffLoading, preview],
  async ([patch, loading, currentPreview]) => {
    destroyDiffEditor()
    if (!patch || loading || currentPreview !== 'diff') return
    await nextTick()
    if (
      diffPatch.value !== patch ||
      diffLoading.value ||
      preview.value !== 'diff' ||
      !diffHost.value
    ) {
      return
    }
    const fileName = workspace.inspectorDiffPath ?? ''
    const language = detectMonacoLanguage(fileName)
    const parsed = parseUnifiedDiff(patch)
    const original = parsed?.original ?? ''
    const modified = parsed?.modified ?? ''
    syncMonacoTheme()
    originalModel = monaco.editor.createModel(original, language)
    modifiedModel = monaco.editor.createModel(modified, language)
    diffEditor = monaco.editor.createDiffEditor(diffHost.value, {
      readOnly: true,
      originalEditable: false,
      fontSize: 11.5,
      fontFamily: 'var(--font-mono)',
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: false,
      renderIndicators: true,
      scrollbar: { verticalScrollbarSize: 10, horizontalScrollbarSize: 10 }
    })
    diffEditor.setModel({ original: originalModel, modified: modifiedModel })
  },
  { flush: 'post' }
)

watch(
  () => workspace.currentCwd,
  () => {
    if (workspace.inspectorPreview) backToPanel()
  }
)

onBeforeUnmount(() => {
  endResize()
  destroyDiffEditor()
})
</script>

<template>
  <aside
    data-testid="workspace-inspector"
    class="relative flex min-w-0 shrink-0 flex-col overflow-hidden border-l border-[var(--border-subtle)] bg-[var(--bg-sidebar)]"
    :style="{ width: `${width}px` }"
  >
    <!-- 拖拽调整宽度 -->
    <div
      class="absolute left-0 top-0 z-10 h-full w-1 cursor-col-resize"
      @pointerdown="startResize"
    />

    <div class="min-h-0 flex-1 overflow-hidden">
      <div class="flex h-full min-h-0 overflow-hidden">
        <section
          data-testid="workspace-inspector-main"
          class="flex min-h-0 shrink-0 flex-col"
          :class="
            hasPreview ? 'w-[256px] border-r border-[var(--border-subtle)]' : 'min-w-0 flex-1'
          "
        >
          <header
            class="flex h-9 shrink-0 items-center border-b border-[var(--border-subtle)] px-2.5"
          >
            <div class="flex gap-1">
              <button
                v-for="item in [
                  { id: 'files', label: $t('workspace.files'), icon: FolderTree },
                  { id: 'git', label: $t('workspace.git'), icon: GitBranch }
                ] as const"
                :key="item.id"
                type="button"
                class="flex h-7 items-center gap-1 rounded-[var(--radius-sm)] px-2 text-[11px] font-medium transition-colors active:scale-95"
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
          </header>

          <div class="min-h-0 flex-1 overflow-hidden">
            <FileExplorer v-if="tab === 'files'" />
            <GitPanel v-else />
          </div>
        </section>

        <section
          v-if="hasPreview"
          data-testid="workspace-inspector-preview"
          class="flex min-w-0 flex-1 flex-col bg-[var(--bg-workspace)]"
        >
          <header
            class="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2.5"
          >
            <div class="flex min-w-0 items-center gap-2">
              <component
                :is="preview === 'diff' ? GitBranch : File"
                class="size-3.5 shrink-0 text-[var(--text-tertiary)]"
                :stroke-width="1.75"
              />
              <div class="flex min-w-0 items-baseline gap-1.5">
                <span
                  class="shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-[var(--text-tertiary)]"
                >
                  {{ preview === 'diff' ? $t('workspace.changes') : $t('workspace.filePreview') }}
                </span>
                <span
                  v-if="previewPath"
                  class="truncate font-mono text-[11.5px] text-[var(--text-secondary)]"
                  :title="previewPath"
                >
                  {{ fileName(previewPath) }}
                </span>
              </div>
            </div>
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] active:scale-95"
              :aria-label="$t('common.close')"
              :title="$t('common.close')"
              @click="backToPanel"
            >
              <X class="size-3.5" :stroke-width="1.75" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-hidden">
            <FileViewer v-if="preview === 'file'" :file-path="workspace.inspectorFilePath" />
            <div v-else class="flex h-full min-h-0 flex-col overflow-hidden">
              <p v-if="diffLoading" class="p-3 text-[11.5px] text-[var(--text-tertiary)]">
                {{ $t('workspace.loadingDiff') }}
              </p>
              <EmptyState
                v-else-if="!diffPatch"
                :title="$t('workspace.noDiff')"
                :icon="GitBranch"
              />
              <!-- Monaco DiffEditor：git 预览文件染色 diff，始终保留左右对比视图。 -->
              <div v-else ref="diffHost" data-testid="git-diff-editor" class="min-h-0 flex-1" />
            </div>
          </div>
        </section>
      </div>
    </div>
  </aside>
</template>
