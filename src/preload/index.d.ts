import type { ArgusApi } from '../shared/types'

declare global {
  interface Window {
    api: ArgusApi
  }
}
