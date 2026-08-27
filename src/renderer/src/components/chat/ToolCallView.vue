<script setup lang="ts">
import { computed, ref } from 'vue'
import { Loader2 } from '@lucide/vue'
import type { ToolCallContent } from '@shared/types/workspace'
import { useAgentStore } from '@renderer/stores/agent'

const props = defineProps<{
  block: ToolCallContent
  running?: boolean
  result?: string
  isError?: boolean
}>()

const agent = useAgentStore()
const open = ref(false)
const args = computed(() => JSON.stringify(props.block.input, null, 2))

/* 执行状态优先取 props，否则从 agent 的实时执行状态里按 toolCallId 关联。 */
const execution = computed(() => agent.toolExecutions.get(props.block.toolCallId))
const running = computed(() => props.running ?? execution.value?.running ?? false)
const resultText = computed(() => props.result ?? execution.value?.result ?? '')
const failed = computed(() => props.isError ?? execution.value?.isError ?? false)
const displayText = computed(() => {
  const argsText = props.block.rawInput || args.value
  return resultText.value ? `${argsText}\n---\n${resultText.value}` : argsText
})
</script>

<template>
  <div
    class="rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left"
      @click="open = !open"
    >
      <span
        class="min-w-0 truncate font-[family-name:var(--font-mono)] text-[11.5px] text-[var(--text-primary)]"
      >
        {{ block.toolName || $t('workspace.unknownTool') }}
      </span>
      <span
        class="flex shrink-0 items-center gap-1 text-[10.5px]"
        :class="
          running
            ? 'text-[var(--warning)]'
            : failed
              ? 'text-[var(--error)]'
              : 'text-[var(--success)]'
        "
      >
        <Loader2 v-if="running" class="size-3 animate-spin" :stroke-width="1.75" />
        {{ running ? $t('workspace.running') : failed ? $t('common.failed') : $t('common.valid') }}
      </span>
    </button>
    <pre
      v-if="open"
      class="max-h-64 overflow-auto border-t border-[var(--border-subtle)] px-2.5 py-2 font-[family-name:var(--font-mono)] text-[11px] text-[var(--text-secondary)]"
      :class="failed && 'text-[var(--error)]'"
      v-text="displayText"
    />
  </div>
</template>
