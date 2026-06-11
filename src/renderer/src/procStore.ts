import { create } from 'zustand'
import type { ProcStatsSnapshot } from '../../shared/types'

/** Live external-process resource stats for the status-bar monitor. */

interface ProcStore {
  snapshot: ProcStatsSnapshot | null
  popupVisible: boolean
  init: () => void
  togglePopup: () => void
}

export const useProcStore = create<ProcStore>((set, get) => ({
  snapshot: null,
  popupVisible: false,

  init: () => {
    window.api.onProcStats((snapshot) => set({ snapshot }))
  },

  togglePopup: () => set({ popupVisible: !get().popupVisible })
}))
