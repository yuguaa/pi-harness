<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { ChevronDown, FileText, RotateCcw, Undo2 } from '@lucide/vue'
import type {
  ConversationChangeStep,
  ConversationFileChange,
  GitFileStatusKind
} from '@shared/types/workspace'
import { useConversationChangesStore } from '@renderer/stores/conversation-changes'
import { useWorkspaceStore } from '@renderer/stores/workspace'

const props = defineProps<{ step: ConversationChangeStep }>()
const emit = defineEmits<{ (e: 'preview', filePath: string): void }>()

const { t } = useI18n()
const changes = useConversationChangesStore()
const workspace = useWorkspaceStore()
const open = ref(false)
const busy = ref<string | null>(null)

const fileCount = computed(() => props.step.files.length)

function fileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function statusTone(status: GitFileStatusKind): string {
  if (status === 'deleted' || status === 'conflict') return 'text-[var(--error)]'
  if (status === 'modified' || status === 'renamed') return 'text-[var(--warning)]'
  return 'text-[var(--success)]'
}

function statusLabel(status: GitFileStatusKind): string {
  return { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U', conflict: 'C' }[
    status
  ]
}

async function revert(change: ConversationFileChange): Promise<void> {
  if (busy.value) return
  busy.value = change.filePath
  try {
    await changes.revertFile(change)
    await workspace.refreshContent()
    toast.success(t('workspace.changeReverted'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    busy.value = null
  }
}

async function reapply(change: ConversationFileChange): Promise<void> {
  if (busy.value) return
  busy.value = change.filePath
  try {
    await changes.reapplyFile(change)
    await workspace.refreshContent()
    toast.success(t('workspace.changeReapplied'))
  } catch (e) {
    toast.error((e as { message?: string }).message ?? t('common.failed'))
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div
    class="mx-auto mt-2 w-full max-w-[var(--conversation-max-width)] rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <button
      type="button"
      class="flex w-full items-center justify-between px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)]"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span class="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--text-secondary)]">
        <FileText class="size-3.5 shrink-0" :stroke-width="1.75" />
        <span class="truncate">
          {{ t('workspace.conversationChangedFiles', { count: fileCount }) }}
        </span>
        <span v-if="step.failed" class="shrink-0 text-[var(--warning)]">
          {{ t('workspace.conversationFailed') }}
        </span>
      </span>
      <ChevronDown
        class="size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150"
        :class="open && 'rotate-180'"
        :stroke-width="1.75"
      />
    </button>
    <ul
      v-if="open"
      class="divide-y divide-[var(--border-subtle)] border-t border-[var(--border-subtle)]"
    >
      <li
        v-for="change in step.files"
        :key="change.filePath"
        class="flex items-center gap-2 px-2.5 py-1"
      >
        <span
          class="w-4 shrink-0 text-center font-[family-name:var(--font-mono)] text-[10px] font-semibold"
          :class="statusTone(change.status)"
        >
          {{ statusLabel(change.status) }}
        </span>
        <button
          type="button"
          class="min-w-0 flex-1 truncate text-left text-[11.5px] text-[var(--text-primary)] transition-colors hover:text-[var(--accent)]"
          :title="change.filePath"
          @click="emit('preview', change.filePath)"
        >
          {{ fileName(change.filePath) }}
        </button>
        <template v-if="change.revertible">
          <button
            v-if="!change.reverted"
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] disabled:opacity-40"
            :disabled="busy === change.filePath"
            :title="t('workspace.changeRevert')"
            :aria-label="t('workspace.changeRevert')"
            @click="revert(change)"
          >
            <Undo2 class="size-3" :stroke-width="1.75" />
          </button>
          <button
            v-else
            type="button"
            class="flex size-5 shrink-0 items-center justify-center rounded text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint)] disabled:opacity-40"
            :disabled="busy === change.filePath"
            :title="t('workspace.changeReapply')"
            :aria-label="t('workspace.changeReapply')"
            @click="reapply(change)"
          >
            <RotateCcw class="size-3" :stroke-width="1.75" />
          </button>
        </template>
      </li>
    </ul>
  </div>
</template>
