import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_EVENT } from '../shared/ipc/channels'
import { PET_API_NAMESPACE } from '../shared/constants/index'
import type { PetWindowAPI, PetWindowSnapshot } from '../shared/ipc/api-types'

const api: PetWindowAPI = {
  onState(listener) {
    const handler = (_event: IpcRendererEvent, payload: unknown) =>
      listener(payload as PetWindowSnapshot)
    ipcRenderer.on(IPC_EVENT.petWindowState, handler)
    return () => ipcRenderer.removeListener(IPC_EVENT.petWindowState, handler)
  }
}

contextBridge.exposeInMainWorld(PET_API_NAMESPACE, api)
