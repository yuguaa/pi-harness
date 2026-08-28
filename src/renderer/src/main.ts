import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { VueQueryPlugin } from '@tanstack/vue-query'
import App from './App.vue'
import PetDesktopApp from '@renderer/components/pet/PetDesktopApp.vue'
import router from './router'
import { i18n } from './i18n'
import './styles/main.css'

import { usePiStore } from '@renderer/stores/pi'
import { useProvidersStore } from '@renderer/stores/providers'
import { useModelsStore } from '@renderer/stores/models'
import { useSettingsStore } from '@renderer/stores/settings'
import { useAgentStore } from '@renderer/stores/agent'
import { getApi } from '@renderer/composables/useApi'
import { toast } from 'vue-sonner'
import { applyTheme, applyAccent } from '@renderer/utils/theme'
import { installAuthorWatermark } from '@renderer/utils/author-watermark'
import type { AppUpdateState } from '@shared/ipc/api-types'
import { usePetStore } from '@renderer/stores/pet'
import { installPetRuntimeAdapter } from '@renderer/pet/install-runtime-adapter'
import { installPetWindowBridge } from '@renderer/pet/install-window-bridge'

applyTheme('dark')
applyAccent('blue')
installAuthorWatermark()

function mountPetWindow(): void {
  document.documentElement.dataset.window = 'pet'
  const app = createApp(PetDesktopApp)
  app.use(i18n)
  app.mount('#app')
}

function mountMainWindow(): void {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(i18n)
  app.use(VueQueryPlugin, {
    queryClientConfig: {
      defaultOptions: {
        queries: { retry: 1, refetchOnWindowFocus: false }
      }
    }
  })

  const piStore = usePiStore()
  const providersStore = useProvidersStore()
  const modelsStore = useModelsStore()
  const settingsStore = useSettingsStore()
  const agentStore = useAgentStore()
  const petStore = usePetStore()

  const unsubscribers: Array<() => void> = [
    piStore.setupListeners(),
    providersStore.setupListeners(),
    modelsStore.setupListeners(),
    agentStore.setupListeners(),
    installPetRuntimeAdapter(),
    installPetWindowBridge()
  ]

  unsubscribers.push(
    getApi().on('notification', (payload) => {
      const event = payload as { level?: string; title?: string; message?: string }
      const title = event.title ?? 'Pi-Harness'
      const message = event.message
      switch (event.level) {
        case 'success':
          toast.success(title, { description: message })
          break
        case 'warning':
          petStore.handleEvent({ type: 'WARNING' })
          toast.warning(title, { description: message })
          break
        case 'error':
          toast.error(title, { description: message })
          break
        default:
          toast.info(title, { description: message })
      }
    })
  )

  let notifiedUpdateVersion: string | null = null
  unsubscribers.push(
    getApi().on('updater-state', (payload) => {
      const state = payload as Partial<AppUpdateState>
      if (
        state.status !== 'downloaded' ||
        !state.latestVersion ||
        state.latestVersion === notifiedUpdateVersion
      ) {
        return
      }
      notifiedUpdateVersion = state.latestVersion
      toast.success(i18n.global.t('settings.updateReadyTitle'), {
        description: i18n.global.t('settings.updateReady', { version: state.latestVersion })
      })
    })
  )

  void settingsStore
    .fetch()
    .then(() =>
      Promise.all([piStore.detect(), providersStore.fetchList(), modelsStore.fetchList()])
    )

  app.mount('#app')

  if (import.meta.hot) {
    import.meta.hot.dispose(() => {
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    })
  }
}

const isPetWindow = new URLSearchParams(window.location.search).get('window') === 'pet'
if (isPetWindow) mountPetWindow()
else mountMainWindow()
