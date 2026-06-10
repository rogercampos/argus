import type { ElectronAPI } from '@electron-toolkit/preload'
import type { ArgusApi } from '../shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: ArgusApi
  }
}
