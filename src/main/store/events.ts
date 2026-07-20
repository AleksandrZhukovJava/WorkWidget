import Store from 'electron-store'
import { getSettings } from './settings'
import type { NotificationEvent } from '@shared/types'

// Notification history — capped, newest first. Persists across restarts (lives in the
// pinned ~/.jira-widget dir like the other stores).
const CAP = 100
const store = new Store<{ events: NotificationEvent[] }>({
  name: 'jira-events',
  defaults: { events: [] }
})

/** Drop events older than the configured retention window; returns the surviving list. */
function prune(): NotificationEvent[] {
  const days = Math.max(1, getSettings().notifications.retentionDays || 7)
  const cutoff = Date.now() - days * 86_400_000
  const all = store.get('events')
  const kept = all.filter((e) => new Date(e.at).getTime() >= cutoff)
  if (kept.length !== all.length) store.set('events', kept)
  return kept
}

export function listEvents(): NotificationEvent[] {
  return prune()
}

export function unreadCount(): number {
  return prune().filter((e) => !e.read).length
}

/** Prepend new events (already newest-first within the batch), dedupe, cap. */
export function addEvents(events: NotificationEvent[]): void {
  if (events.length === 0) return
  const existing = store.get('events')
  const seen = new Set(existing.map((e) => `${e.type}:${e.issueKey}:${e.at}`))
  const fresh = events.filter((e) => !seen.has(`${e.type}:${e.issueKey}:${e.at}`))
  if (fresh.length === 0) return
  store.set('events', [...fresh, ...existing].slice(0, CAP))
}

export function markAllRead(): void {
  store.set(
    'events',
    store.get('events').map((e) => (e.read ? e : { ...e, read: true }))
  )
}

export function clearEvents(): void {
  store.set('events', [])
}
