import { Tray, Menu, nativeImage, app } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import { toggleWidget, openSettings, openPanel } from './windows'
import { refreshNow } from './poller'

let tray: Tray | null = null

/**
 * resources/** is asarUnpack'd, so in production the real file sits at
 * <resources>/app.asar.unpacked/resources/tray.png — NOT <resources>/resources/tray.png
 * (the old path, which never existed → empty/transparent tray icon). Try the known
 * candidates and use the first that exists.
 */
function trayIcon(): Electron.NativeImage {
  const candidates = [
    join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'tray.png'),
    join(app.getAppPath(), 'resources', 'tray.png'), // dev (project root)
    join(process.resourcesPath, 'resources', 'tray.png')
  ]
  for (const p of candidates) {
    if (existsSync(p)) {
      const img = nativeImage.createFromPath(p)
      if (!img.isEmpty()) return img
    }
  }
  return nativeImage.createEmpty()
}

export function createTray(): void {
  if (tray) return
  tray = new Tray(trayIcon())
  tray.setToolTip('Jira Widget')

  const menu = Menu.buildFromTemplate([
    { label: 'Открыть задачи', click: () => openPanel() },
    { label: 'Показать / скрыть виджет', click: () => toggleWidget() },
    { label: 'Обновить задачи', click: () => void refreshNow() },
    { type: 'separator' },
    { label: 'Настройки…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Выход', click: () => app.quit() }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => openPanel())
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
