<script setup lang="ts">
import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { Check, Pencil, SendHorizontal, X } from '@lucide/vue'

interface QueuedMessageItem {
  id: string
  message: string
  hasImages: boolean
}

const props = defineProps<{
  items: QueuedMessageItem[]
}>()

const emit = defineEmits<{
  'edit-start': [queueId: string]
  'edit-change': [queueId: string, message: string]
  'edit-cancel': [queueId: string, message: string]
  edit: [queueId: string, message: string]
  steer: [queueId: string]
  remove: [queueId: string]
}>()

const editingId = shallowRef<string | null>(null)
const editingMessage = shallowRef('')
const editingOriginalMessage = shallowRef('')

function startEditing(item: QueuedMessageItem) {
  if (editingId.value === item.id) return
  cancelEditing()
  editingId.value = item.id
  editingOriginalMessage.value = item.message
  editingMessage.value = item.message
  emit('edit-start', item.id)
}

function cancelEditing() {
  const queueId = editingId.value
  if (queueId) emit('edit-cancel', queueId, editingOriginalMessage.value)
  editingId.value = null
  editingMessage.value = ''
  editingOriginalMessage.value = ''
}

function finishEditing() {
  editingId.value = null
  editingMessage.value = ''
  editingOriginalMessage.value = ''
}

function canSave(item: QueuedMessageItem): boolean {
  return item.hasImages || Boolean(editingMessage.value.trim())
}

function saveEditing(item: QueuedMessageItem) {
  if (!canSave(item)) return
  emit('edit', item.id, editingMessage.value.trim())
  finishEditing()
}

function onEditInput() {
  if (editingId.value) emit('edit-change', editingId.value, editingMessage.value)
}

function onEditKeydown(event: KeyboardEvent, item: QueuedMessageItem) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelEditing()
    return
  }
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault()
    saveEditing(item)
  }
}

watch(
  () => props.items,
  (items) => {
    if (editingId.value && !items.some((item) => item.id === editingId.value)) cancelEditing()
  }
)

onBeforeUnmount(cancelEditing)
</script>

<template>
  <div v-if="items.length" class="mb-2 space-y-1.5" data-testid="composer-queue">
    <div
      v-for="item in items"
      :key="item.id"
      :data-testid="`queued-message-item-${item.id}`"
      class="flex gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2.5 py-1.5"
      :class="editingId === item.id ? 'items-start' : 'items-center'"
    >
      <span
        class="shrink-0 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-tertiary)]"
      >
        {{ $t('workspace.queued') }}
      </span>
      <template v-if="editingId === item.id">
        <textarea
          v-model="editingMessage"
          rows="2"
          data-testid="queued-message-edit-input"
          class="min-h-10 min-w-0 flex-1 resize-y rounded-[var(--radius-xs)] border border-[var(--control-border)] bg-[var(--control-bg)] px-2 py-1 text-[12px] leading-relaxed text-[var(--text-primary)] outline-none transition-colors focus:border-[var(--accent-border)] focus:bg-[var(--control-bg-hover)] focus:shadow-[var(--focus-ring)]"
          :aria-label="$t('workspace.editQueued')"
          @input="onEditInput"
          @keydown="onEditKeydown($event, item)"
        />
        <div class="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            data-testid="queued-message-save"
            class="flex size-6 items-center justify-center rounded text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint)] disabled:cursor-not-allowed disabled:opacity-40"
            :title="$t('workspace.saveQueuedEdit')"
            :aria-label="$t('workspace.saveQueuedEdit')"
            :disabled="!canSave(item)"
            @click="saveEditing(item)"
          >
            <Check aria-hidden="true" class="size-3.5" :stroke-width="2" />
          </button>
          <button
            type="button"
            data-testid="queued-message-cancel"
            class="flex size-6 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
            :title="$t('workspace.cancelQueuedEdit')"
            :aria-label="$t('workspace.cancelQueuedEdit')"
            @click="cancelEditing"
          >
            <X aria-hidden="true" class="size-3.5" :stroke-width="1.75" />
          </button>
        </div>
      </template>
      <template v-else>
        <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
          {{ item.message || $t('workspace.imageOnlyMessage') }}
        </span>
        <button
          type="button"
          data-testid="queued-message-edit"
          class="flex size-6 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          :title="$t('workspace.editQueued')"
          :aria-label="$t('workspace.editQueued')"
          @click="startEditing(item)"
        >
          <Pencil aria-hidden="true" class="size-3" :stroke-width="1.75" />
        </button>
        <button
          type="button"
          data-testid="queued-message-steer"
          class="inline-flex shrink-0 items-center gap-1 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--accent)] transition-colors hover:bg-[var(--accent-tint)]"
          :title="$t('workspace.steerQueued')"
          :aria-label="$t('workspace.steerQueued')"
          @click="emit('steer', item.id)"
        >
          <SendHorizontal aria-hidden="true" class="size-3" :stroke-width="1.75" />
          {{ $t('workspace.steerQueued') }}
        </button>
        <button
          type="button"
          data-testid="queued-message-remove"
          class="flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
          :title="$t('common.delete')"
          :aria-label="$t('common.delete')"
          @click="emit('remove', item.id)"
        >
          <X aria-hidden="true" class="size-3" :stroke-width="1.75" />
        </button>
      </template>
    </div>
  </div>
</template>
