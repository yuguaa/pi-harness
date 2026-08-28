<script setup lang="ts">
import { computed, onBeforeUnmount, shallowRef } from 'vue'
import MascotView from '@renderer/components/chat/MascotView.vue'
import { i18n, resolveLocale } from '@renderer/i18n'
import { applyAccent, applyTheme } from '@renderer/utils/theme'
import { DEFAULT_PET_WINDOW_SNAPSHOT, isPetWindowSnapshot } from '@shared/pet/window'

const snapshot = shallowRef(DEFAULT_PET_WINDOW_SNAPSHOT)
const visible = computed(() => snapshot.value.enabled && snapshot.value.style !== 'none')

const unsubscribeState =
  window.piHarnessPet?.onState((payload) => {
    if (!isPetWindowSnapshot(payload)) return
    const next = payload
    snapshot.value = next
    applyTheme(next.theme)
    applyAccent(next.accentColor, next.customAccentColor)
    i18n.global.locale.value = resolveLocale(next.language)
  }) ?? (() => {})

onBeforeUnmount(unsubscribeState)
</script>

<template>
  <main class="pet-desktop-window" :data-visible="visible ? 'true' : 'false'" aria-hidden="true">
    <MascotView
      v-if="visible"
      :style="snapshot.style"
      :state="snapshot.state"
      :current-tool="snapshot.currentTool"
      :active="snapshot.active"
      :animated="snapshot.animated"
      :show-status="snapshot.showStatus"
    />
  </main>
</template>

<style scoped>
.pet-desktop-window {
  display: flex;
  width: 100%;
  height: 100%;
  align-items: flex-end;
  justify-content: center;
  padding: 4px 8px;
  overflow: hidden;
  cursor: grab;
  user-select: none;
  -webkit-app-region: drag;
}

.pet-desktop-window:active {
  cursor: grabbing;
}

:global(:root[data-window='pet']),
:global(:root[data-window='pet'] body),
:global(:root[data-window='pet'] #app) {
  background: transparent;
}
</style>
