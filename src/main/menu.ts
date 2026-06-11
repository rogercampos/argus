import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'
import { showOpenFolderDialog } from './ipc'
import { listRecentWorkspaces } from './state'
import { findWorkspaceWindow, openWorkspaceWindow } from './windows'

/** Native macOS menu bar (spec 02). All commands reachable; no command palette. */

function send(command: MenuCommand): void {
  BrowserWindow.getFocusedWindow()?.webContents.send('menu', command)
}

function item(
  label: string,
  command: MenuCommand,
  accelerator?: string
): MenuItemConstructorOptions {
  return { label, accelerator, click: () => send(command) }
}

export async function rebuildApplicationMenu(): Promise<void> {
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
        item('Settings…', 'open-settings', 'Cmd+,'),
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
          accelerator: 'Cmd+Shift+N',
          click: () => void showOpenFolderDialog()
        },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        item('New File', 'new-file', 'Cmd+N'),
        item('Save', 'save', 'Cmd+S'),
        item('Save All', 'save-all', 'Cmd+Alt+S'),
        { type: 'separator' },
        item('Close Tab', 'close-tab', 'Cmd+W'),
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
        item('Find', 'find', 'Cmd+F'),
        item('Replace', 'replace', 'Cmd+R'),
        item('Find in Files', 'global-search', 'Cmd+Shift+F'),
        item('Replace in Files', 'global-replace', 'Cmd+Shift+R'),
        { type: 'separator' },
        item('Copy Relative Path', 'copy-relative-path', 'Cmd+Shift+C')
      ]
    },
    {
      label: 'View',
      submenu: [
        item('Toggle File Tree', 'toggle-file-tree', 'Cmd+1'),
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
        item('Next Tab', 'next-tab', 'Cmd+Shift+]'),
        item('Previous Tab', 'previous-tab', 'Cmd+Shift+['),
        { type: 'separator' },
        { role: 'toggleDevTools' }
      ]
    },
    {
      label: 'Navigate',
      submenu: [
        item('Go to File…', 'go-to-file', 'Cmd+Shift+O'),
        item('Go to Symbol…', 'go-to-symbol', 'Cmd+O'),
        item('Recent Files…', 'recent-files', 'Cmd+E'),
        item('Go to Line…', 'go-to-line', 'Cmd+L'),
        { type: 'separator' },
        item('Back', 'jump-back', 'Cmd+Alt+Left'),
        item('Forward', 'jump-forward', 'Cmd+Alt+Right')
      ]
    },
    {
      label: 'Code',
      submenu: [
        item('Go to Definition', 'go-to-definition', 'Cmd+B'),
        item('Go to Type Definition', 'go-to-type-definition'),
        { type: 'separator' },
        item('Show Hover Info', 'show-hover'),
        item('Show Quick Fixes', 'quick-fixes', 'Alt+Enter'),
        { type: 'separator' },
        item('Rename Symbol', 'rename-symbol', 'Shift+F6'),
        item('Format Document', 'format-document'),
        { type: 'separator' },
        item('Comment Line', 'comment-line', 'Cmd+/'),
        item('Duplicate Line', 'duplicate-line', 'Cmd+D'),
        item('Move Line Up', 'move-line-up', 'Alt+Shift+Up'),
        item('Move Line Down', 'move-line-down', 'Alt+Shift+Down')
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
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
