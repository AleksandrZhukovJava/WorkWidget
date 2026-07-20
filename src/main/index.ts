// Must be first: pins userData to ~/.jira-widget before any electron-store module loads.
import './paths'
import { app, BrowserWindow } from 'electron'
import { registerIpc } from './ipc'
import { createWidget, openMain, showWidget } from './windows'
import { createTray } from './tray'
import { startPolling, stopPolling } from './poller'
import { initAutoUpdate } from './updater'
import { hasCompleteCredentials, getMyIdentity } from './store/credentials'
import { refreshMyIdentity } from './jira/auth'
import { getSettings } from './store/settings'

// Single-instance lock — a desktop widget must never run twice.
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWidget())

  app.whenReady().then(() => {
    // Must match electron-builder appId so Windows attributes toasts to this app.
    app.setAppUserModelId('com.aleksandrjukovjava.jirawidget')

    // Never from dev runs — in dev, process.execPath is the raw electron.exe, and
    // registering it produced a junk "electron.app.Electron" login item that opened a
    // stray Electron window at every Windows logon.
    if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: getSettings().autostart })
    }

    registerIpc()
    createWidget()
    createTray()
    startPolling()
    initAutoUpdate() // packaged-only; checks GitHub Releases for updates

    // First run: open the main window — it shows the onboarding gate (if not done) or the
    // connection settings (if there are no credentials yet).
    const s = getSettings()
    if (!s.onboardingDone) {
      openMain()
    } else if (!hasCompleteCredentials()) {
      openMain('settings')
    } else {
      // Backfill the current-user identity for sessions connected before the
      // "assign to me" feature existed (identity is otherwise only saved on re-auth).
      const { accountId, username } = getMyIdentity()
      if (!accountId && !username) void refreshMyIdentity()
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWidget()
    })
  })

  // Keep running in the tray when all windows are closed.
  app.on('window-all-closed', () => {
    /* no-op: tray keeps the app alive */
  })

  app.on('before-quit', () => stopPolling())
}
