<script setup lang="ts">
import { Markdown } from '@comark/vue'
import security from '@comark/vue/plugins/security'
import taskList from '@comark/vue/plugins/task-list'
import { computed, ref } from 'vue'
import type { AgentMessage, AssistantMessage, ImageContent } from '@shared/types/workspace'
import ToolCallView from './ToolCallView.vue'
import BranchNavigator from './BranchNavigator.vue'
import Dialog from '@renderer/components/ui/Dialog.vue'
import Badge from '@renderer/components/ui/Badge.vue'
import { i18n } from '@renderer/i18n'

const markdownOptions = {
  registerDefaultPlugins: false
}
const markdownPlugins = [
  taskList(),
  security({
    allowedTags: [
      'p',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'strong',
      'em',
      's',
      'code',
      'pre',
      'blockquote',
      'hr',
      'br',
      'a',
      'img',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'input'
    ],
    allowedProtocols: ['http', 'https', 'mailto'],
    allowDataImages: false
  })
]

const props = withDefaults(
  defineProps<{
    message: AgentMessage
    entryId?: string
    streaming?: boolean
    showMeta?: boolean
  }>(),
  { entryId: undefined, showMeta: true, streaming: false }
)
const previewSrc = ref<string | null>(null)
const previewOpen = ref(false)

function imageSource(image: ImageContent): string | null {
  const source = (image as { source?: ImageContent['source'] }).source
  if (source?.type === 'base64' && source.data) {
    const mime = source.media_type?.startsWith('image/') ? source.media_type : 'image/png'
    return `data:${mime};base64,${source.data}`
  }
  if (source?.type === 'url' && source.url?.startsWith('data:image/')) {
    return source.url
  }
  const legacy = image as ImageContent & { data?: string; mimeType?: string }
  if (legacy.data) {
    const mime = legacy.mimeType?.startsWith('image/') ? legacy.mimeType : 'image/png'
    return `data:${mime};base64,${legacy.data}`
  }
  return null
}

function openPreview(src: string) {
  previewSrc.value = src
  previewOpen.value = true
}

function openImage(image: ImageContent) {
  const src = imageSource(image)
  if (src) openPreview(src)
}

const userText = computed(() => {
  const msg = props.message
  if (msg.role !== 'user') return ''
  return typeof msg.content === 'string'
    ? msg.content
    : msg.content
        .filter((b) => b.type === 'text')
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n')
})

const userImages = computed(() => {
  const msg = props.message
  if (msg.role !== 'user' || typeof msg.content === 'string') return []
  return msg.content.flatMap((block) => {
    if (block.type !== 'image') return []
    const src = imageSource(block)
    return src ? [src] : []
  })
})

const assistantBlocks = computed(() => {
  if (props.message.role !== 'assistant') return []
  const blocks: AssistantMessage['content'] = []
  for (const block of props.message.content) {
    const previous = blocks.at(-1)
    if (block.type === 'text' && previous?.type === 'text') {
      blocks[blocks.length - 1] = { ...previous, text: `${previous.text}\n\n${block.text}` }
    } else {
      blocks.push(block)
    }
  }
  return blocks
})

const toolResultText = computed(() => {
  const msg = props.message
  if (msg.role !== 'toolResult') return ''
  const text = msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('\n')
  if (text) return text
  /* 不少工具（如 edit/write）把结果放在 details 而非 content，这里回退展示。 */
  const details = msg.details
  if (details == null) return ''
  return typeof details === 'string' ? details : JSON.stringify(details, null, 2)
})

const bashText = computed(() => {
  const msg = props.message
  if (msg.role !== 'bashExecution') return ''
  return `$ ${msg.command}\n${msg.output}`
})

const thinkingBadgeTone = computed<'reasoning' | 'streaming' | 'muted'>(() => {
  const msg = props.message
  if (msg.role !== 'assistant') return 'muted'
  const thinking = msg.content.find((block) => block.type === 'thinking')
  if (!thinking || thinking.type !== 'thinking') return 'muted'
  if (thinking.deferred) return 'muted'
  return props.streaming ? 'streaming' : 'reasoning'
})

const thinkingBadgeText = computed(() => {
  const msg = props.message
  if (msg.role !== 'assistant') return ''
  const thinking = msg.content.find((block) => block.type === 'thinking')
  if (!thinking || thinking.type !== 'thinking') return ''
  if (thinking.deferred) return i18n.global.t('workspace.thinkingOmitted')
  if (props.streaming) return i18n.global.t('workspace.streaming')
  return i18n.global.t('workspace.completed')
})

const toolResultLabel = computed(() => {
  const msg = props.message
  return msg.role === 'toolResult' ? msg.toolName || '' : ''
})

const bashCommand = computed(() => {
  const msg = props.message
  return msg.role === 'bashExecution' ? msg.command : ''
})

const bashFailed = computed(() => {
  const msg = props.message
  return (
    msg.role === 'bashExecution' &&
    ((msg.exitCode !== undefined && msg.exitCode !== 0) || msg.cancelled)
  )
})

const bashStatus = computed(() => {
  const msg = props.message
  if (msg.role !== 'bashExecution') return ''
  if (msg.cancelled) return i18n.global.t('workspace.cancelled')
  if (msg.exitCode !== undefined && msg.exitCode !== 0) return `exit ${msg.exitCode}`
  if (msg.truncated) return i18n.global.t('workspace.outputTruncated')
  return i18n.global.t('workspace.completed')
})

const bashStatusClass = computed(() => {
  const msg = props.message
  if (msg.role !== 'bashExecution') return 'work-trace-status--success'
  if (bashFailed.value) return 'work-trace-status--error'
  return msg.truncated ? 'work-trace-status--warning' : 'work-trace-status--success'
})

const customText = computed(() => {
  const msg = props.message
  if (msg.role !== 'custom') return ''
  if (typeof msg.content === 'string') return msg.content
  return msg.content
    .filter((block) => block.type === 'text')
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('\n')
})

const customLabel = computed(() => {
  const msg = props.message
  if (msg.role !== 'custom') return ''
  if (msg.customType === 'compaction') return i18n.global.t('workspace.compaction')
  if (msg.customType === 'branch-summary') return i18n.global.t('workspace.branchSummary')
  return msg.customType
})
</script>

<template>
  <article
    v-if="message.role !== 'custom' || message.display"
    class="message-entry mx-auto flex w-full max-w-[72ch] flex-col py-4"
    :data-message-role="message.role"
    :class="[
      message.role === 'user' ? 'items-end' : 'items-start',
      /* 用户消息是新轮次开始，助手活动保持连续的消息流节奏。 */
      message.role === 'user' ? 'pt-6' : ''
    ]"
  >
    <template v-if="message.role === 'user'">
      <div
        class="message-bubble message-bubble--user max-w-[80%] rounded-[var(--radius-md)] border border-[var(--border-subtle)] bg-[var(--bg-surface-raised)] px-4 py-3 text-[13px] text-[var(--text-primary)]"
      >
        <p v-if="userText" class="whitespace-pre-wrap">{{ userText }}</p>
        <div v-if="userImages.length" class="flex flex-wrap gap-2" :class="userText ? 'mt-2' : ''">
          <button
            v-for="(src, index) in userImages"
            :key="index"
            type="button"
            class="block size-[72px] overflow-hidden rounded-[7px] border border-[var(--border-default)] bg-[var(--bg-surface-raised)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            :title="$t('workspace.previewImage')"
            @click="openPreview(src)"
          >
            <img :src="src" alt="" loading="lazy" class="size-full object-cover" />
          </button>
        </div>
      </div>
    </template>

    <template v-else-if="message.role === 'assistant'">
      <div class="message-assistant-row w-full max-w-[72ch]">
        <div v-if="showMeta && streaming" class="message-meta message-meta--assistant">
          <span class="message-streaming">· {{ $t('workspace.streaming') }}</span>
        </div>
        <div class="message-body--assistant space-y-2">
          <template v-for="(block, i) in assistantBlocks" :key="i">
            <Suspense v-if="block.type === 'text'">
              <Markdown
                :value="block.text"
                :options="markdownOptions"
                :plugins="markdownPlugins"
                :streaming="streaming"
                class="markdown-content"
              />
              <template #fallback>
                <p
                  class="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--text-primary)]"
                >
                  {{ block.text }}
                </p>
              </template>
            </Suspense>
            <details
              v-else-if="block.type === 'thinking'"
              data-testid="thinking-details"
              class="work-trace"
            >
              <summary class="work-trace-summary">
                <span class="work-trace-icon" aria-hidden="true">✦</span>
                <span class="work-trace-label">{{ $t('workspace.thinking') }}</span>
                <div class="work-trace-badge">
                  <Badge :tone="thinkingBadgeTone">{{ thinkingBadgeText }}</Badge>
                </div>
                <span class="work-trace-chevron" aria-hidden="true">⌄</span>
              </summary>
              <p
                class="work-trace-content whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]"
              >
                {{ block.thinking || (block.deferred ? $t('workspace.thinkingDeferred') : '') }}
              </p>
            </details>
            <ToolCallView v-else-if="block.type === 'toolCall'" :block="block" />
            <button
              v-else-if="block.type === 'image' && imageSource(block)"
              type="button"
              class="block max-w-[320px] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--border-default)] bg-[var(--bg-surface)] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
              :title="$t('workspace.previewImage')"
              @click="openImage(block)"
            >
              <img
                :src="imageSource(block) ?? ''"
                alt=""
                loading="lazy"
                class="max-h-[280px] w-full object-contain"
              />
            </button>
          </template>
        </div>
      </div>
    </template>

    <details
      v-else-if="message.role === 'toolResult'"
      data-testid="tool-result-details"
      class="work-trace message-body message-body--tool w-full max-w-[72ch]"
      :open="message.isError || undefined"
    >
      <summary class="work-trace-summary">
        <span
          class="work-trace-icon"
          :class="{ 'work-trace-icon--error': message.isError }"
          aria-hidden="true"
          data-glyph="↳"
        />
        <span class="work-trace-label">{{ $t('workspace.roleTool') }}</span>
        <span v-if="toolResultLabel" class="work-trace-preview">{{ toolResultLabel }}</span>
        <div class="work-trace-badge">
          <Badge :tone="message.isError ? 'error' : 'success'">
            {{ message.isError ? $t('common.failed') : $t('workspace.completed') }}
          </Badge>
        </div>
        <span class="work-trace-chevron" aria-hidden="true">⌄</span>
      </summary>
      <pre
        class="work-trace-content max-h-[32rem] overflow-auto whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[13px]"
        :class="message.isError ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'"
        v-text="toolResultText"
      />
    </details>

    <details
      v-else-if="message.role === 'bashExecution'"
      class="work-trace message-body message-body--tool w-full max-w-[72ch]"
    >
      <summary class="work-trace-summary">
        <span
          class="work-trace-icon"
          :class="{ 'work-trace-icon--error': bashFailed }"
          aria-hidden="true"
          data-glyph="$"
        />
        <span class="work-trace-label">bash</span>
        <span class="work-trace-preview">{{ bashCommand }}</span>
        <span class="work-trace-status work-trace-badge" :class="bashStatusClass">
          {{ bashStatus }}
        </span>
        <span class="work-trace-chevron" aria-hidden="true">⌄</span>
      </summary>
      <pre
        class="work-trace-content max-h-[32rem] overflow-auto whitespace-pre-wrap font-[family-name:var(--font-mono)] text-[13px]"
        :class="bashFailed ? 'text-[var(--danger)]' : 'text-[var(--text-secondary)]'"
        v-text="bashText"
      />
    </details>

    <div
      v-else-if="message.role === 'custom' && message.display"
      class="message-system message-body message-body--tool w-full max-w-[72ch]"
    >
      <div class="message-system-label">
        <span class="message-role-mark message-role-mark--system" aria-hidden="true">•</span>
        <span>{{ customLabel }}</span>
      </div>
      <p class="message-system-text whitespace-pre-wrap">{{ customText }}</p>
    </div>

    <p
      v-else
      class="message-body message-body--tool max-w-[72ch] whitespace-pre-wrap text-[13px] text-[var(--text-secondary)]"
    >
      {{ typeof message.content === 'string' ? message.content : '' }}
    </p>

    <BranchNavigator v-if="entryId" :entry-id="entryId" />

    <Dialog v-model:open="previewOpen" wide :title="$t('workspace.previewImage')">
      <img v-if="previewSrc" :src="previewSrc" alt="" class="max-h-[68vh] w-full object-contain" />
    </Dialog>
  </article>
</template>

<style scoped>
.message-entry {
  --message-gap: 6px;
  min-width: 0;
}

.message-meta {
  display: flex;
  width: 100%;
  max-width: 72ch;
  align-items: center;
  gap: var(--message-gap);
  margin-bottom: 5px;
  margin-inline: auto;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 550;
  letter-spacing: 0.02em;
}

.message-meta--assistant {
  margin-inline: 0;
}

.message-role-mark {
  display: inline-flex;
  width: 20px;
  height: 20px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-xs);
  background: var(--accent-tint);
  color: var(--accent);
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
}

.message-role-mark--system {
  background: var(--bg-surface);
  color: var(--text-tertiary);
}

.message-bubble--user {
  box-shadow: none;
}

.message-body--assistant {
  margin-inline: auto;
}

.message-body--tool {
  margin-inline: auto;
}

.message-streaming {
  color: var(--accent);
}

.work-trace {
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface-raised);
}

.work-trace summary {
  display: flex;
  min-height: 38px;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  cursor: pointer;
  list-style: none;
  color: var(--text-secondary);
}

.work-trace summary::-webkit-details-marker {
  display: none;
}

.work-trace summary:focus-visible {
  box-shadow: var(--focus-ring);
}

.work-trace-icon {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: none;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  background: var(--bg-surface-raised);
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
}

.work-trace-icon::before {
  content: attr(data-glyph);
}

.work-trace-icon--error {
  background: var(--error-tint);
  color: var(--error);
}

.work-trace-label {
  flex: none;
  font-size: 13px;
  font-weight: 600;
}

.work-trace-preview {
  min-width: 0;
  overflow: hidden;
  color: var(--text-tertiary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.work-trace-status {
  flex: none;
  font-size: 12px;
  font-weight: 600;
}

.work-trace-status--success {
  color: var(--success);
}

.work-trace-status--error {
  color: var(--error);
}

.work-trace-status--warning {
  color: var(--warning);
}

.work-trace-badge {
  margin-left: auto;
}

.work-trace-chevron {
  flex: none;
  color: var(--text-tertiary);
  font-size: 14px;
  line-height: 1;
  transition: transform 150ms var(--ease-out);
}

.work-trace[open] .work-trace-chevron {
  transform: rotate(180deg);
}

.work-trace-content {
  margin: 0;
  border-top: 1px solid var(--border-subtle);
  padding: 10px;
}

.message-system {
  padding: 9px 11px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
}

.message-system-label {
  display: flex;
  align-items: center;
  gap: 7px;
  color: var(--text-tertiary);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.message-system-text {
  margin: 6px 0 0;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

@media (prefers-reduced-motion: reduce) {
  .work-trace-chevron {
    transition: none;
  }
}

.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
  color: var(--text-primary);
  font-size: 13px;
  line-height: 1.65;
}

.markdown-content :deep(p),
.markdown-content :deep(ul),
.markdown-content :deep(ol),
.markdown-content :deep(pre),
.markdown-content :deep(blockquote),
.markdown-content :deep(table) {
  margin: 0 0 0.75em;
}

.markdown-content :deep(> :last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin: 1.15em 0 0.55em;
  color: var(--text-primary);
  font-weight: 600;
  line-height: 1.3;
}

.markdown-content :deep(h1:first-child),
.markdown-content :deep(h2:first-child),
.markdown-content :deep(h3:first-child),
.markdown-content :deep(h4:first-child),
.markdown-content :deep(h5:first-child),
.markdown-content :deep(h6:first-child) {
  margin-top: 0;
}

.markdown-content :deep(h1) {
  font-size: 1.45em;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.15em;
}

.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  font-size: 1em;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  padding-left: 1.5em;
}

.markdown-content :deep(ul) {
  list-style: disc;
}

.markdown-content :deep(ol) {
  list-style: decimal;
}

.markdown-content :deep(li) {
  margin: 0.2em 0;
}

.markdown-content :deep(li > ul),
.markdown-content :deep(li > ol) {
  margin: 0.2em 0;
}

.markdown-content :deep(strong) {
  font-weight: 650;
}

.markdown-content :deep(a) {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
}

.markdown-content :deep(code) {
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background: var(--bg-surface-raised);
  padding: 0.08em 0.35em;
  font-family: var(--font-mono);
  font-size: 0.92em;
}

.markdown-content :deep(pre) {
  overflow-x: auto;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background: var(--bg-surface);
  padding: 10px 12px;
  line-height: 1.55;
}

.markdown-content :deep(pre code) {
  border: 0;
  border-radius: 0;
  background: transparent;
  padding: 0;
  font-size: 12px;
}

.markdown-content :deep(blockquote) {
  border-left: 3px solid var(--border-strong);
  padding-left: 0.85em;
  color: var(--text-secondary);
}

.markdown-content :deep(hr) {
  margin: 1em 0;
  border: 0;
  border-top: 1px solid var(--border-subtle);
}

.markdown-content :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid var(--border-default);
  padding: 5px 8px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: var(--bg-surface);
  font-weight: 600;
}

.markdown-content :deep(img) {
  max-width: 100%;
  border-radius: var(--radius-sm);
}

.markdown-content :deep(.contains-task-list) {
  padding-left: 0;
  list-style: none;
}

.markdown-content :deep(.task-list-item) {
  list-style: none;
}

.markdown-content :deep(.task-list-item-checkbox) {
  width: 13px;
  height: 13px;
  margin: 0 0.45em 0 0;
  vertical-align: -2px;
  accent-color: var(--accent);
  appearance: auto;
}
</style>
