<script setup lang="ts">
import { computed, ref } from 'vue'
import { CheckCircle2, ChevronDown, CircleAlert, Loader2 } from '@lucide/vue'
import type { ToolCallContent } from '@shared/types/workspace'
import { useAgentStore } from '@renderer/stores/agent'

const props = defineProps<{
  block: ToolCallContent
  running?: boolean
  isError?: boolean
}>()

const agent = useAgentStore()
const open = ref(false)
const args = computed(() => JSON.stringify(props.block.input, null, 2))

/* 执行状态优先取 props，否则从 agent 的实时执行状态里按 toolCallId 关联。 */
const execution = computed(() => agent.toolExecutions.get(props.block.toolCallId))
const running = computed(() => props.running ?? execution.value?.running ?? false)
const failed = computed(() => props.isError ?? execution.value?.isError ?? false)
const toolLabel = computed(() => {
  const name = props.block.toolName.trim()
  if (!name) return 'tool'
  return name.replace(/[_-]+/g, ' ')
})
const displayText = computed(() => {
  const argsText = props.block.rawInput || args.value
  return argsText
})
</script>

<template>
  <div
    data-testid="tool-call-view"
    class="tool-call rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-surface)]"
  >
    <button
      type="button"
      class="flex min-h-[38px] w-full items-center gap-2 px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--bg-hover)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
      :aria-expanded="open"
      @click="open = !open"
    >
      <span
        class="tool-call-icon"
        :class="
          running
            ? 'tool-call-icon--running'
            : failed
              ? 'tool-call-icon--error'
              : 'tool-call-icon--success'
        "
        aria-hidden="true"
      >
        <Loader2 v-if="running" class="size-3 animate-spin" :stroke-width="1.75" />
        <CircleAlert v-else-if="failed" class="size-3" :stroke-width="1.75" />
        <CheckCircle2 v-else class="size-3" :stroke-width="1.75" />
      </span>
      <span class="tool-call-copy min-w-0 flex-1">
        <span class="tool-call-kicker">{{ $t('workspace.roleTool') }}</span>
        <span class="tool-call-name">{{ toolLabel }}</span>
      </span>
      <span
        class="tool-call-status shrink-0"
        :class="
          running
            ? 'text-[var(--warning)]'
            : failed
              ? 'text-[var(--error)]'
              : 'text-[var(--success)]'
        "
      >
        {{
          running
            ? $t('workspace.running')
            : failed
              ? $t('common.failed')
              : $t('workspace.completed')
        }}
      </span>
      <ChevronDown
        class="size-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform duration-150"
        :class="open && 'rotate-180'"
        :stroke-width="1.75"
        aria-hidden="true"
      />
    </button>
    <pre
      v-if="open"
      class="max-h-64 overflow-auto border-t border-[var(--border-subtle)] px-2.5 py-2 font-[family-name:var(--font-mono)] text-[11px] leading-relaxed text-[var(--text-secondary)]"
      :class="failed && 'text-[var(--error)]'"
      v-text="displayText"
    />
  </div>
</template>

<style scoped>
.tool-call-copy {
  display: flex;
  min-width: 0;
  align-items: baseline;
  gap: 7px;
}

.tool-call-icon {
  display: inline-flex;
  width: 19px;
  height: 19px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
}

.tool-call-icon--running {
  background: var(--warning-tint);
  color: var(--warning);
}

.tool-call-icon--success {
  background: var(--success-tint);
  color: var(--success);
}

.tool-call-icon--error {
  background: var(--error-tint);
  color: var(--error);
}

.tool-call-kicker {
  flex: none;
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 550;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.tool-call-name {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-call-status {
  font-size: 10px;
  font-weight: 600;
}
</style>
