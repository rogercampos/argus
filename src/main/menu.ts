import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import {
  effectiveBindings,
  type ShortcutCommandId,
  toElectronAccelerator
} from '../shared/shortcuts'
import type { MenuCommand } from '../shared/types'
import { showOpenFolderDialog } from './ipc'
import { listRecentWorkspaces, loadKeymap } from './state'
import { findWorkspaceWindow, openWorkspaceWindow } from './windows'

/** Native macOS menu bar (spec 02). All commands reachable; no command palette.
 * Accelerators come from the user's keymap (Settings → Keyboard). */

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu', command)
}

export async function rebuildApplicationMenu(): Promise<void> {
  const bindings = effectiveBindings(await loadKeymap())
  const accel = (id: ShortcutCommandId): string | undefined => {
    const a = bindings[id]
    return a ? toElectronAccelerator(a) : undefined
  }
  const item = (label: string, command: MenuCommand): MenuItemConstructorOptions => ({
    label,
    accelerator: accel(command),
    click: () => send(command)
  })

  const recents = await listRecentWorkspaces(10)

  const recentItems: MenuItemConstructorOptions[] =
    recents.length === 0
      ? [{ label: 'No Recent Workspaces', enabled: false }]
      : recents.map((entry) => ({
          label: entry.path.replace(process.env.HOME ?? '', '~'),
          click: () => {
            const existing = findWorkspaceWindow(entry.path)
            if (existing) existing.focus()
            else openWorkspaceWindow(entry.path)
          }
        }))

  const template: MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        item('Settings…', 'open-settings'),
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'Open Folder…',
          accelerator: accel('open-folder'),
          click: () => void showOpenFolderDialog()
        },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        item('New File', 'new-file'),
        item('Save', 'save'),
        item('Save All', 'save-all'),
        { type: 'separator' },
        item('Close Tab', 'close-tab'),
        { label: 'Close Window', accelerator: 'Cmd+Shift+W', role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        item('Find', 'find'),
        item('Replace', 'replace'),
        item('Find in Files', 'global-search'),
        item('Replace in Files', 'global-replace'),
        { type: 'separator' },
        item('Copy Relative Path', 'copy-relative-path')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Toggle File Tree', 'toggle-file-tree'),
        item('Toggle Search Panel', 'toggle-search-panel'),
        item('Toggle Schema Panel', 'toggle-schema-panel'),
        { type: 'separator' },
        item('Show Projects', 'show-projects'),
        item('Reveal Active File in File Tree', 'reveal-active-file'),
        { type: 'separator' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { role: 'resetZoom' },
        { type: 'separator' },
        item('Toggle Inlay Hints', 'toggle-inlay-hints'),
        { type: 'separator' },
        item('Next Tab', 'next-tab'),
        item('Previous Tab', 'previous-tab'),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        item('Go to File…', 'go-to-file'),
        item('Go to Symbol…', 'go-to-symbol'),
        item('Recent Files…', 'recent-files'),
        item('Go to Line…', 'go-to-line'),
        { type: 'separator' },
        item('Back', 'jump-back'),
        item('Forward', 'jump-forward')
      ]
    },
    {
      label: 'Code',
      submenu: [
        item('Go to Definition', 'go-to-definition'),
        item('Go to Type Definition', 'go-to-type-definition'),
        { type: 'separator' },
        item('Show Hover Info', 'show-hover'),
        item('Show Quick Fixes', 'quick-fixes'),
        { type: 'separator' },
        item('Rename Symbol', 'rename-symbol'),
        item('Format Document', 'format-document'),
        { type: 'separator' },
        item('Comment Line', 'comment-line'),
        item('Duplicate Line', 'duplicate-line'),
        item('Move Line Up', 'move-line-up'),
        item('Move Line Down', 'move-line-down')
      ]
    },
    { role: 'window' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Open Logs Directory',
          click: () => {
            void import('electron').then(({ shell }) => shell.openPath(app.getPath('logs')))
          }
        },
        item('Show Slow Operations', 'show-slow-ops')
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
