import { create } from 'zustand'
import type { BackgroundTaskUpdate } from '../../shared/types'

/** Background tasks UI state (spec 10). */

export interface TaskEntry {
  id: number
  name: string
  message?: string
  percentage?: number
  state: 'queued' | 'active'
}

interface TasksStore {
  tasks: TaskEntry[]
  popupVisible: boolean
  init: () => void
  togglePopup: () => void
}

export const useTasksStore = create<TasksStore>((set, get) => ({
  tasks: [],
  popupVisible: false,

  init: () => {
    window.api.onTaskUpdate((update: BackgroundTaskUpdate) => {
      const tasks = [...get().tasks]
      const index = tasks.findIndex((t) => t.id === update.id)
      if (update.status === 'finished') {
        if (index !== -1) tasks.splice(index, 1)
        set({ tasks, popupVisible: tasks.length > 0 ? get().popupVisible : false })
        return
      }
      const entry: TaskEntry = {
        id: update.id,
        name: update.name,
        message: update.message,
        percentage: update.percentage,
        state: update.status === 'queued' ? 'queued' : 'active'
      }
      if (index === -1) tasks.push(entry)
      else tasks[index] = { ...tasks[index], ...entry }
      set({ tasks })
    })
  },

  togglePopup: () => set({ popupVisible: !get().popupVisible })
}))
