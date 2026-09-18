import { BrowserWindow } from 'electron'
import { IPC } from '@shared/ipc'
import { getMyIssues, getIssueByKey } from './jira/issues'
import { JiraError } from './jira/client'
import {
  getSettings,
  getPriority,
  getBlocked,
  getChecklist,
  getLocalTasks,
  getDoneItems,
  isArchived,
  getCurrentKeys,
  setCurrentKeys,
  getWatchedKeys
} from './store/settings'
import { hasCompleteCredentials } from './store/credentials'
import { vpnCached, refreshVpn } from './dashboard'
import { detectEvents, detectGitlabEvents, checkGitlabTokenExpiry, notifyVpnChange } from './notify'
import { unreadCount } from './store/events'
import { sortByPriority } from '@shared/priority'
import type { JiraIssue, WidgetAppearance } from '@shared/types'

let timer: NodeJS.Timeout | null = null
let vpnTimer: NodeJS.Timeout | null = null
let lastVpn: boolean | null = null
let lastIssues: JiraIssue[] = []
// Issues on the «Слежу» list that aren't among the user's own tasks — fetched by key so a
// watched task the user isn't assigned still shows up. Flagged `external` so it never leaks
// into other tabs or the widget counter.
let watchedExtra: JiraIssue[] = []
let lastError: string | null = null
// True when the last fetch failed due to connectivity (network/timeout), not an HTTP error —
// the widget shows a "no connection" glyph instead of a (stale) task count.
let lastNetError = false

/** Active (not-yet-done) user-created tasks, mapped into the same shape as Jira issues. */
function buildLocalIssues(): JiraIssue[] {
  return getLocalTasks()
    .filter((t) => !isArchived(t.id))
    .map((t) => ({
      key: t.id,
      summary: t.summary,
      status: 'Своя задача',
      statusCategory: 'new',
      issueType: 'Local',
      priority: null,
      assignee: null,
      dueDate: null,
      updated: t.createdAt,
      url: '',
      sla: null,
      localPriority: getPriority(t.id),
      blocked: getBlocked(t.id) !== null,
      blockReason: getBlocked(t.id) ?? '',
      isLocal: true,
      done: false,
      doneAt: null,
      checklist: getChecklist(t.id)
    }))
}

/**
 * Completed items — local tasks marked done, and Jira issues completed via the local
 * "Завершить" overlay (which never touches Jira itself). Feeds the "Завершённые" tab.
 */
function buildDoneIssues(): JiraIssue[] {
  return getDoneItems()
    .filter((d) => !isArchived(d.key))
    .map((d) => ({
      key: d.key,
      summary: d.summary,
      status: d.status || 'Выполнено',
      statusCategory: 'done',
      issueType: d.isLocal ? 'Local' : 'Jira',
      priority: null,
      assignee: null,
      dueDate: null,
      updated: d.doneAt,
      url: d.url,
      sla: null,
      localPriority: getPriority(d.key),
      blocked: false,
      blockReason: '',
      isLocal: d.isLocal,
      done: true,
      doneAt: d.doneAt,
      checklist: getChecklist(d.key)
    }))
}

export interface Payload {
  issues: JiraIssue[]
  error: string | null
  /** VPN status for the widget dot; null when the VPN indicator is disabled */
  vpn: boolean | null
  /** whether the stats indicator is enabled (drives the widget blocked badge) */
  showStats: boolean
  /** widget skin/glow/thresholds — rides along so appearance changes apply live */
  appearance: WidgetAppearance
  /** unread notification count — drives the blinking widget badge */
  unreadEvents: number
  /** statuses that count toward the widget task counter; null = legacy (active non-blocked) */
  countedStatuses: string[] | null
  /** whether blocked issues are included in the counter */
  countBlocked: boolean
  /** last fetch failed due to connectivity — widget shows a "no network" glyph, not a count */
  netError: boolean
}

/**
 * Refresh the pulled-in watched tasks: fetch (by key) every «Слежу» key that isn't already
 * one of the user's own issues / local tasks / done items. Keeps already-fetched ones,
 * fetches only the newly-added keys, and drops keys no longer watched. Best-effort — a key
 * that can't be resolved (no access / deleted / a local id) is simply skipped. No-op without
 * credentials.
 */
export async function refreshWatchedExtra(): Promise<void> {
  const watched = getWatchedKeys()
  if (watched.length === 0) {
    watchedExtra = []
    return
  }
  if (!hasCompleteCredentials()) return
  const known = new Set([
    ...lastIssues.map((i) => i.key),
    ...buildLocalIssues().map((i) => i.key),
    ...buildDoneIssues().map((i) => i.key)
  ])
  const need = watched.filter((k) => !known.has(k))
  const keep = watchedExtra.filter((i) => need.includes(i.key))
  const have = new Set(keep.map((i) => i.key))
  const toFetch = need.filter((k) => !have.has(k))
  const fetched = await Promise.all(toFetch.map((k) => getIssueByKey(k).catch(() => null)))
  watchedExtra = [...keep, ...fetched.filter((i): i is JiraIssue => i !== null)]
}

export function getCachedIssues(): Payload {
  // Jira issues + local tasks + completed items, sorted together by local priority.
  const { dashboard: dash, widgetAppearance, notifications, taskBlocks, countBlocked } =
    getSettings()
  const vpn = dash.vpn ? vpnCached() : null
  // If any block is marked "counted", the widget counter sums exactly those statuses;
  // otherwise fall back to the legacy "active, not blocked" count (null signal).
  const counted = taskBlocks.filter((b) => b.counted).flatMap((b) => b.statuses)

  const own = [...lastIssues, ...buildLocalIssues(), ...buildDoneIssues()]
  // Pulled-in watched tasks that aren't «mine» — marked external so they surface only in «Слежу».
  const ownKeys = new Set(own.map((i) => i.key))
  const extra = watchedExtra
    .filter((i) => !ownKeys.has(i.key))
    .map((i) => ({ ...i, external: true }))
  const built = sortByPriority([...own, ...extra])
  // «Текущая» auto-drops only when a marked task is PRESENT and has become blocked/done —
  // a key whose issue isn't loaded yet (e.g. before the first fetch) is kept, so the mark
  // survives restarts instead of being wiped by the empty startup list.
  const marked = getCurrentKeys()
  const byKey = new Map(built.map((i) => [i.key, i]))
  const kept = marked.filter((k) => {
    const i = byKey.get(k)
    return i ? !i.blocked && !i.done && i.statusCategory !== 'done' : true
  })
  if (kept.length !== marked.length) setCurrentKeys(kept)
  const currentSet = new Set(kept)
  // «Слежу» is a plain local set — never auto-pruned (a watched task stays until the user unmarks it).
  const watchedSet = new Set(getWatchedKeys())
  const issues = built.map((i) => ({
    ...i,
    current: currentSet.has(i.key),
    watched: watchedSet.has(i.key)
  }))

  return {
    issues,
    error: lastError,
    vpn,
    showStats: dash.stats,
    appearance: widgetAppearance,
    unreadEvents: notifications.enabled ? unreadCount() : 0,
    countedStatuses: counted.length ? [...new Set(counted)] : null,
    countBlocked,
    netError: lastNetError
  }
}

/** Fetch issues, cache them, and broadcast to every open window. */
export async function refreshNow(): Promise<Payload> {
  // GitLab monitoring runs independently of Jira credentials (fire-and-forget).
  void detectGitlabEvents().catch(() => {})
  // Token-expiry reminder (deduped to once per calendar day).
  checkGitlabTokenExpiry()
  if (!hasCompleteCredentials()) {
    lastIssues = []
    lastError = null
    lastNetError = false
    broadcast()
    return getCachedIssues()
  }
  try {
    const fresh = await getMyIssues()
    // Diff against the previous snapshot BEFORE replacing lastIssues.
    await detectEvents(fresh).catch(() => {})
    lastIssues = fresh
    lastError = null
    lastNetError = false
    // Refresh pulled-in watched tasks against the new own-issue list (best-effort).
    await refreshWatchedExtra().catch(() => {})
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    // Connectivity problem = network/timeout (JiraError without an HTTP status), or a
    // non-JiraError thrown before any response.
    lastNetError = err instanceof JiraError ? err.status === undefined : true
  }
  broadcast()
  return getCachedIssues()
}

/** Re-apply local state (priority + blocked + checklist) to cached issues and rebroadcast — no network. */
export function applyLocalState(): void {
  lastIssues = lastIssues.map((i) => ({
    ...i,
    localPriority: getPriority(i.key),
    blocked: getBlocked(i.key) !== null,
    blockReason: getBlocked(i.key) ?? '',
    checklist: getChecklist(i.key)
  }))
  broadcast()
}

/** Rebroadcast the current (merged) issue list — used after local-task CRUD. */
export function rebroadcast(): void {
  broadcast()
}

function broadcast(): void {
  const payload = getCachedIssues()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.issuesUpdated, payload)
  }
}

export function startPolling(): void {
  stopPolling()
  void refreshNow()
  const minutes = Math.max(1, getSettings().pollIntervalMinutes)
  timer = setInterval(() => void refreshNow(), minutes * 60_000)
  // Watch VPN state and rebroadcast (for the widget dot) only when it changes.
  void refreshVpn().then(() => broadcast())
  vpnTimer = setInterval(() => {
    void refreshVpn().then(() => {
      const vpn = getSettings().dashboard.vpn ? vpnCached() : null
      if (vpn !== lastVpn) {
        const prev = lastVpn
        lastVpn = vpn
        // Notify only on a real on↔off flip — not the initial null→value or when the
        // indicator gets toggled off (bool→null).
        if (typeof prev === 'boolean' && typeof vpn === 'boolean') notifyVpnChange(vpn)
        broadcast()
      }
    })
  }, 15_000)
}

export function stopPolling(): void {
  if (vpnTimer) clearInterval(vpnTimer)
  vpnTimer = null
  if (timer) clearInterval(timer)
  timer = null
}

/** Re-read interval from settings and restart the timer. */
export function restartPolling(): void {
  startPolling()
}
