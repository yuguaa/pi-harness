import { computed, watch } from 'vue'
import { normalizeMascotStyle } from '@shared/constants/mascot'
import type { PetWindowSnapshot } from '@shared/pet/window'
import { getApi } from '@renderer/composables/useApi'
import { usePetStore } from '@renderer/stores/pet'
import { useSettingsStore } from '@renderer/stores/settings'

export function installPetWindowBridge(): () => void {
  const settings = useSettingsStore()
  const pet = usePetStore()
  const snapshot = computed<PetWindowSnapshot | null>(() => {
    const current = settings.settings
    if (!current) return null
    return {
      style: normalizeMascotStyle(current.mascotStyle),
      state: pet.state,
      currentTool: pet.currentTool,
      active: !['idle', 'review', 'sleeping'].includes(pet.state),
      enabled: Boolean(current.mascotUnlocked && current.petEnabled),
      animated: current.petAnimations,
      showStatus: current.petStatusText,
      theme: current.theme,
      accentColor: current.accentColor,
      customAccentColor: current.customAccentColor,
      language: current.language
    }
  })

  return watch(
    snapshot,
    (next) => {
      if (!next) return
      void getApi()
        .pet.updateWindow(next)
        .catch((error) => console.warn('[pet] desktop window sync failed', error))
    },
    { immediate: true }
  )
}
