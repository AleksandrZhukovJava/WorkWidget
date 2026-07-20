// Auto-update from GitHub Releases via electron-updater. The release workflow publishes the
// installer + latest.yml on each `v*` tag; electron-builder's `publish: github` config bakes an
// app-update.yml into the package that points the updater at the same repo.
//
// Besides the native OS toast, the update state is broadcast to the renderer so the UI can show
// an in-app banner with an "Обновить" button (see UpdateBanner.tsx). Guarded to packaged builds:
// a dev run has no app-update.yml and process.execPath is the raw electron.exe.
import { app, BrowserWindow, Notification } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC } from '@shared/ipc'
import type { UpdateStatus } from '@shared/types'

let started = false
let status: UpdateStatus = { state: 'idle' }
const SIX_HOURS = 6 * 60 * 60 * 1000

function set(next: UpdateStatus): void {
  status = next
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(IPC.updateStatus, status)
  }
}

/** Current status — a newly-opened window queries this on mount, then subscribes to changes. */
export function getUpdateStatus(): UpdateStatus {
  return status
}

export function initAutoUpdate(): void {
  if (started || !app.isPackaged) return
  started = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true // also lands on a normal quit, even without the button

  autoUpdater.on('checking-for-update', () => set({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => set({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => set({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    set({ state: 'downloading', version: status.version, percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'downloaded', version: info.version })
    // The "push": a native toast even if no window is open right now.
    new Notification({
      title: 'Доступно обновление',
      body: `Версия ${info.version} загружена. Откройте виджет и нажмите «Обновить».`
    }).show()
  })
  autoUpdater.on('error', (err) =>
    set({ state: 'error', error: err instanceof Error ? err.message : String(err) })
  )

  void check() // check on startup
  setInterval(() => void check(), SIX_HOURS)
}

/** Manual/startup check. No-op (resolves) in dev. Result arrives via the status events. */
export function check(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  return autoUpdater
    .checkForUpdates()
    .then(() => undefined)
    .catch(() => undefined) // errors surface via the 'error' event
}

/** Install the downloaded update now: quit, run the installer silently, relaunch. */
export function installUpdate(): void {
  if (!app.isPackaged || status.state !== 'downloaded') return
  autoUpdater.quitAndInstall(true, true) // isSilent, isForceRunAfter (relaunch the app)
}
