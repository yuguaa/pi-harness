<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { SquareTerminal } from '@lucide/vue'

const route = useRoute()
const { t } = useI18n()

const navItems = computed(() => [
  {
    name: 'workspace',
    to: '/workspace',
    icon: SquareTerminal,
    label: t('nav.workspace'),
    short: t('navShort.workspace')
  }
])

function isActive(path: string): boolean {
  return route.path.startsWith(path)
}
</script>

<template>
  <!-- 50px icon rail. Labels live in title + sr-only so hover / a11y / e2e still work. -->
  <aside
    class="flex w-[var(--sidebar-width)] shrink-0 flex-col items-center bg-[var(--bg-sidebar)]"
  >
    <nav class="flex w-full flex-1 flex-col items-center gap-1 px-1 pt-2">
      <RouterLink
        v-for="item in navItems"
        :key="item.name"
        :to="item.to"
        :title="item.label"
        class="group relative flex w-full flex-col items-center justify-center gap-1.5 rounded-[var(--radius-sm)] py-2.5 transition-colors duration-[var(--motion-fast)] ease-[var(--ease-out)] no-drag"
        :class="
          isActive(item.to)
            ? 'bg-[var(--accent-tint)] text-[var(--text-primary)]'
            : 'text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]'
        "
      >
        <component
          :is="item.icon"
          class="size-4 shrink-0"
          :stroke-width="1.75"
          :class="
            isActive(item.to)
              ? 'text-[var(--accent)]'
              : 'text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)]'
          "
        />
        <span
          class="text-[10px] leading-none tracking-tight"
          :class="isActive(item.to) ? 'font-medium' : 'font-normal'"
        >
          {{ item.short }}
        </span>
      </RouterLink>
    </nav>
  </aside>
</template>
