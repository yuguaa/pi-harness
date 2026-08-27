<script setup lang="ts">
import { SendHorizontal, X } from '@lucide/vue'

interface QueuedMessageItem {
  id: string
  message: string
}

defineProps<{
  items: QueuedMessageItem[]
}>()

const emit = defineEmits<{
  steer: [queueId: string]
  remove: [queueId: string]
}>()
</script>

<template>
  <div v-if="items.length" class="mb-2 space-y-1.5" data-testid="composer-queue">
    <div
      v-for="item in items"
      :key="item.id"
      class="flex items-center gap-2 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-2.5 py-1.5"
    >
      <span
        class="shrink-0 text-[10px] font-medium uppercase tracking-[0.05em] text-[var(--text-tertiary)]"
      >
        {{ $t('workspace.queued') }}
      </span>
      <span class="min-w-0 flex-1 truncate text-[12px] text-[var(--text-secondary)]">
        {{ item.message || $t('workspace.imageOnlyMessage') }}
      </span>
      <button
        type="button"
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
        class="flex size-5 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
        :title="$t('common.delete')"
        :aria-label="$t('common.delete')"
        @click="emit('remove', item.id)"
      >
        <X aria-hidden="true" class="size-3" :stroke-width="1.75" />
      </button>
    </div>
  </div>
</template>
