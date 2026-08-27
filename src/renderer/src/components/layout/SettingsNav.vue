<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ArrowLeft } from '@lucide/vue'

const route = useRoute()
const { t } = useI18n()

/** 设置域的子导航：概览/厂商/模型/技能/配置/诊断 + 返回工作区按钮。 */
const items = computed(() => [
  { to: '/settings', label: t('nav.settings') },
  { to: '/overview', label: t('nav.overview') },
  { to: '/providers', label: t('nav.providers') },
  { to: '/models', label: t('nav.models') },
  { to: '/skills', label: t('nav.skills') },
  { to: '/config', label: t('nav.config') },
  { to: '/diagnostics', label: t('nav.diagnostics') }
])

function isActive(to: string): boolean {
  return route.path === to || route.path.startsWith(`${to}/`)
}
</script>

<template>
  <nav
    class="flex shrink-0 items-center gap-1 border-b border-[var(--border-subtle)] px-3 py-1"
    aria-label="Settings"
  >
    <RouterLink
      to="/workspace"
      class="flex items-center gap-1 rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
      :title="$t('nav.workspace')"
    >
      <ArrowLeft class="size-3.5" :stroke-width="1.75" />
      {{ $t('nav.workspace') }}
    </RouterLink>
    <span class="mx-0.5 h-4 w-px bg-[var(--border-subtle)]" />
    <RouterLink
      v-for="item in items"
      :key="item.to"
      :to="item.to"
      class="rounded-[var(--radius-sm)] px-2.5 py-1 text-[11.5px] font-medium transition-colors"
      :class="
        isActive(item.to)
          ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
      "
    >
      {{ item.label }}
    </RouterLink>
  </nav>
</template>
