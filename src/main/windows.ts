import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { getSettings, updateSettings } from './store/settings'
import { IPC } from '@shared/ipc'
import type { PanelView } from '@shared/types'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

// Fixed-size transparent window big enough for the fan-out orbit buttons. The ring sits
// centered; the surrounding transparent area is click-through (setIgnoreMouseEvents) so it
// never blocks the desktop — we only capture the mouse while the cursor is over the ring or
// an orbit button (Overwolf-style), driven from the renderer with hysteresis.
const WIDGET_W = 260
const WIDGET_H = 260
const MAIN_W = 1120
const MAIN_H = 720

let widgetWin: BrowserWindow | null = null
let mainWin: BrowserWindow | null = null

/** Load one of the multi-entry renderer html files in dev or prod. */
function loadRenderer(win: BrowserWindow, name: 'widget' | 'main'): void {
  if (isDev) {
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/${name}.html`)
  } else {
    void win.loadFile(join(__dirname, `../renderer/${name}.html`))
  }
}

const preload = join(__dirname, '../preload/index.js')

export function createWidget(): BrowserWindow {
  const { widgetPosition } = getSettings()
  const display = screen.getPrimaryDisplay().workArea
  const desired = widgetPosition ?? {
    x: display.x + display.width - WIDGET_W - 8,
    y: display.y + display.height - WIDGET_H - 8
  }
  // Clamp fully on-screen (also fixes older 132-based saved positions).
  const pos = {
    x: Math.min(Math.max(desired.x, display.x), display.x + display.width - WIDGET_W),
    y: Math.min(Math.max(desired.y, display.y), display.y + display.height - WIDGET_H)
  }

  widgetWin = new BrowserWindow({
    width: WIDGET_W,
    height: WIDGET_H,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    fullscreenable: false,
    webPreferences: { preload, sandbox: false }
  })
  widgetWin.setAlwaysOnTop(true, 'screen-saver')
  // Start click-through: the big transparent window must not eat desktop clicks. The
  // renderer flips this on when the cursor is actually over the ring / an orbit button.
  widgetWin.setIgnoreMouseEvents(true, { forward: true })

  widgetWin.on('moved', () => {
    if (!widgetWin || isDragging) return // during a drag we persist once, on drop
    const [x, y] = widgetWin.getPosition()
    updateSettings({ widgetPosition: { x, y } })
  })

  loadRenderer(widgetWin, 'widget')
  widgetWin.on('closed', () => (widgetWin = null))
  return widgetWin
}

/** Capture the mouse (interactive) vs let clicks pass through to the desktop below. */
export function setWidgetInteractive(interactive: boolean): void {
  if (!widgetWin || widgetWin.isDestroyed()) return
  widgetWin.setIgnoreMouseEvents(!interactive, { forward: true })
}

export function showWidget(): void {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.show()
  else createWidget()
}

export function hideWidget(): void {
  if (widgetWin && !widgetWin.isDestroyed()) widgetWin.hide()
}

export function toggleWidget(): void {
  if (widgetWin && !widgetWin.isDestroyed() && widgetWin.isVisible()) widgetWin.hide()
  else showWidget()
}

/**
 * The one full application window (sidebar + content). A normal framed, resizable,
 * taskbar-visible window — not the old always-on-top popup. `section` deep-links to a view.
 */
export function openMain(section?: string): void {
  if (mainWin && !mainWin.isDestroyed()) {
    if (mainWin.isMinimized()) mainWin.restore()
    mainWin.show()
    mainWin.focus()
    if (section) mainWin.webContents.send(IPC.switchView, section)
    return
  }
  const { mainSize } = getSettings()
  mainWin = new BrowserWindow({
    width: mainSize?.w ?? MAIN_W,
    height: mainSize?.h ?? MAIN_H,
    minWidth: 860,
    minHeight: 560,
    show: false,
    title: 'Jira Widget',
    autoHideMenuBar: true,
    backgroundColor: '#0d1117',
    webPreferences: { preload, sandbox: false }
  })
  loadRenderer(mainWin, 'main')

  mainWin.on('resize', () => {
    if (!mainWin || mainWin.isDestroyed()) return
    const [w, h] = mainWin.getSize()
    updateSettings({ mainSize: { w, h } })
  })

  mainWin.once('ready-to-show', () => {
    mainWin?.show()
    mainWin?.focus()
    if (section) mainWin?.webContents.send(IPC.switchView, section)
  })
  mainWin.on('closed', () => (mainWin = null))
}

// Back-compat aliases so existing call sites/IPC keep working while routing to the main window.
export function openPanel(section?: PanelView): void {
  openMain(section)
}
export function openSettings(): void {
  openMain('settings')
}
/** No-op: settings/onboarding are sections inside the main window now. */
export function closePanel(): void {}
export function openOnboarding(): void {
  openMain()
}
export function closeOnboarding(): void {}

// Drag by polling the real OS cursor in the main process. The renderer only signals
// start/end; movement is driven here so the window can never fall behind a fast flick.
// (When the renderer sends the moves, a fast drag outruns the window, the cursor leaves
// the ring, the hover logic marks the window click-through, and the drag is dropped.)
let grabOffset: { dx: number; dy: number } | null = null
let dragTimer: NodeJS.Timeout | null = null
let isDragging = false

export function beginWidgetDrag(): void {
  if (!widgetWin || widgetWin.isDestroyed()) return
  const [winX, winY] = widgetWin.getPosition()
  const c = screen.getCursorScreenPoint()
  // Where inside the window the cursor grabbed — kept constant for the whole drag, so the
  // cursor stays over the ring and pointerup reliably fires on it.
  grabOffset = { dx: c.x - winX, dy: c.y - winY }
  isDragging = true
  if (dragTimer) clearInterval(dragTimer)
  dragTimer = setInterval(() => {
    if (!widgetWin || widgetWin.isDestroyed() || !grabOffset) return
    const p = screen.getCursorScreenPoint()
    // setPosition requires integers — fractional coords (scaled displays) throw otherwise.
    widgetWin.setPosition(Math.round(p.x - grabOffset.dx), Math.round(p.y - grabOffset.dy))
  }, 8)
}

// Kept for IPC compatibility; movement is driven by the cursor poll above.
export function dragWidgetTo(): void {}

export function endWidgetDrag(): void {
  if (dragTimer) {
    clearInterval(dragTimer)
    dragTimer = null
  }
  grabOffset = null
  isDragging = false
  if (widgetWin && !widgetWin.isDestroyed()) {
    const [x, y] = widgetWin.getPosition()
    updateSettings({ widgetPosition: { x, y } })
  }
}
