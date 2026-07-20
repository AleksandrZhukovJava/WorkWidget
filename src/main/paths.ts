import { app } from 'electron'
import { join } from 'path'
import fs from 'node:fs'

/**
 * Keep ALL app data in <home>/.jira-widget instead of %APPDATA%.
 *
 * Why: MSIX file virtualization can silently redirect a process's %APPDATA% writes into a
 * package's private LocalCache (observed on this machine when the app is spawned from an
 * MSIX-packaged parent process). That split the store into two diverging copies depending
 * on WHO launched the app — local tasks/priorities/PAT "disappearing" after reboots. The
 * user-profile root is not subject to that redirection, so one data dir serves every
 * launch context.
 *
 * This module must be imported FIRST in main/index.ts — the electron-store instances are
 * created at module load and capture userData at that moment.
 */
const dataDir = join(app.getPath('home'), '.jira-widget')

const MIGRATE_FILES = [
  'jira-config.json',
  'jira-secrets.json',
  'jira-settings.json',
  'jira-tracked-keys.json',
  // Chromium's os_crypt key file — must travel WITH jira-secrets.json, or the
  // safeStorage-encrypted values in it become undecryptable.
  'Local State'
]

try {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
    // One-time migration from the old default location (whichever copy this launch
    // context resolves — by the time this ships, the copies have been merged externally).
    const legacy = join(app.getPath('appData'), 'jira-widget')
    for (const f of MIGRATE_FILES) {
      const src = join(legacy, f)
      if (fs.existsSync(src)) fs.copyFileSync(src, join(dataDir, f))
    }
  }
} catch (err) {
  // A fresh empty dir is still fully functional (PAT recovers from Credential Manager).
  console.error('userData migration failed:', err)
}

app.setPath('userData', dataDir)
