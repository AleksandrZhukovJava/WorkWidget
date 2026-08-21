import { randomUUID } from 'node:crypto'
import { Notification } from 'electron'
import { jiraRequest, restApi } from './jira/client'
import { getSettings, getHandledApprovedMrs, addHandledApprovedMr } from './store/settings'
import { getMyIdentity, hasGitlab, getGitlabTokenExpiry } from './store/credentials'
import { addEvents } from './store/events'
import { showWidget, openPanel } from './windows'
import { listMyReviewMRs, listMyAuthoredMRs, isMrApproved } from './gitlab/mr'
import { transitionToStatus } from './jira/transitions'
import type {
  ActionResult,
  GitlabMR,
  JiraIssue,
  NotificationEvent,
  NotificationType
} from '@shared/types'

interface Snap {
  status: string
  updated: string
  due: string | null
  commentCount: number
}

// Per-issue snapshot from the previous poll. Seeded (silently) on the first poll after
// launch so we don't fire "new task" for every existing issue at startup.
const prevSnapshot = new Map<string, Snap>()
let seeded = false
// Due-date events already fired (key -> the due value we notified for) — avoid repeats.
const notifiedDue = new Map<string, string>()

interface CommentField {
  fields?: {
    comment?: { total?: number; comments?: { author?: { displayName?: string } }[] }
  }
}

/** Latest comment count + last author for an issue (used only for changed issues). */
async function fetchCommentInfo(
  key: string
): Promise<{ count: number; lastAuthor: string } | null> {
  try {
    const r = await jiraRequest<CommentField>(
      `${restApi()}/issue/${encodeURIComponent(key)}`,
      { query: { fields: 'comment' } }
    )
    const c = r.fields?.comment
    const list = c?.comments ?? []
    return {
      count: c?.total ?? list.length,
      lastAuthor: list.length ? (list[list.length - 1].author?.displayName ?? '') : ''
    }
  } catch {
    return null
  }
}

function hoursUntil(due: string): number {
  const end = new Date(`${due}T23:59:59`).getTime()
  return (end - Date.now()) / 3_600_000
}

function mkEvent(
  type: NotificationType,
  issue: { key: string; summary: string; url: string },
  text: string
): NotificationEvent {
  return {
    id: randomUUID(),
    type,
    issueKey: issue.key,
    issueSummary: issue.summary,
    text,
    url: issue.url,
    at: new Date().toISOString(),
    read: false
  }
}

/**
 * Compare the freshly fetched issue list against the previous snapshot and record any
 * events (new task / status change / due soon / new comment), honoring the per-type
 * toggles. Optionally raises Windows toasts. Local and done issues are ignored.
 */
export async function detectEvents(current: JiraIssue[]): Promise<void> {
  const { notifications: n } = getSettings()
  if (!n.enabled) {
    // Keep the snapshot fresh so re-enabling later doesn't dump a backlog.
    reseed(current)
    return
  }

  const active = current.filter((i) => !i.isLocal && !i.done)

  if (!seeded) {
    reseed(active)
    seeded = true
    return
  }

  const myName = getMyIdentity().username
  const events: NotificationEvent[] = []
  const nextSnap = new Map<string, Snap>()

  for (const i of active) {
    const prev = prevSnapshot.get(i.key)
    const ref = { key: i.key, summary: i.summary, url: i.url }
    // -1 = comment baseline not established yet (never fire on the first observation).
    let commentCount = prev?.commentCount ?? -1

    if (!prev) {
      if (n.newTasks) events.push(mkEvent('new', ref, 'новая задача'))
    } else {
      if (n.statusChanges && i.status !== prev.status) {
        events.push(mkEvent('status', ref, `${prev.status} → ${i.status}`))
      }
      // A changed `updated` timestamp is the cheap signal that *something* happened — only
      // then do we spend an extra call to see if it was a new comment.
      if (n.comments && i.updated !== prev.updated) {
        const info = await fetchCommentInfo(i.key)
        if (info) {
          const isNewComment =
            prev.commentCount >= 0 &&
            info.count > prev.commentCount &&
            info.lastAuthor &&
            info.lastAuthor !== myName
          if (isNewComment) {
            events.push(mkEvent('comment', ref, `новый комментарий от ${info.lastAuthor}`))
          }
          commentCount = info.count // establish/refresh the baseline
        }
      }
    }

    if (n.dueSoon && i.dueDate) {
      const h = hoursUntil(i.dueDate)
      if (h <= n.dueSoonHours && notifiedDue.get(i.key) !== i.dueDate) {
        notifiedDue.set(i.key, i.dueDate)
        events.push(mkEvent('due', ref, h < 0 ? 'срок просрочен' : `срок ${i.dueDate}`))
      }
    }

    nextSnap.set(i.key, {
      status: i.status,
      updated: i.updated,
      due: i.dueDate,
      commentCount
    })
  }

  prevSnapshot.clear()
  for (const [k, v] of nextSnap) prevSnapshot.set(k, v)

  if (events.length === 0) return
  addEvents(events)
  if (n.push) events.forEach(raiseToast)
}

// ---------------- GitLab review monitoring ----------------
// MR iids already surfaced as "you were added as reviewer" (seeded silently on first poll).
const reviewSeen = new Set<number>()
let reviewSeeded = false
// MRs already approved + auto-transitioned (keyed "projectId:iid"). Seeded from the persisted
// store so a restart never re-fires the same auto-transition/notification.
const approvedHandled = new Set<string>(getHandledApprovedMrs())

/**
 * Poll GitLab for MRs where I'm a reviewer (fire a `review` event when newly assigned) and,
 * if enabled, move the linked Jira issue to "Ready for Test" once my authored MR is approved.
 * All best-effort; returns the current review list. Never throws.
 */
export async function detectGitlabEvents(): Promise<GitlabMR[]> {
  const { features, notifications: n, gitlabAutomation } = getSettings()
  if (!features.gitlab || !hasGitlab()) return []

  let reviews: GitlabMR[] = []
  try {
    reviews = await listMyReviewMRs()
  } catch {
    return []
  }

  // Review-request events — only for MRs we haven't seen before.
  const events: NotificationEvent[] = []
  if (!reviewSeeded) {
    for (const mr of reviews) reviewSeen.add(mr.iid)
    reviewSeeded = true
  } else {
    for (const mr of reviews) {
      if (reviewSeen.has(mr.iid)) continue
      reviewSeen.add(mr.iid)
      events.push({
        id: randomUUID(),
        type: 'review',
        issueKey: mr.jiraKey ?? `MR !${mr.iid}`,
        issueSummary: mr.title,
        text: 'вас назначили ревьювером',
        url: mr.webUrl,
        at: new Date().toISOString(),
        read: false
      })
    }
  }
  if (events.length && n.enabled) {
    addEvents(events)
    if (n.push) events.forEach(raiseToast)
  }

  // Approval → Jira "Ready for Test" (opt-in). Check only my authored MRs with a Jira key.
  if (gitlabAutomation.onMrApproved && gitlabAutomation.readyForTestStatus.trim()) {
    try {
      const authored = await listMyAuthoredMRs()
      for (const mr of authored) {
        const key = `${mr.projectId}:${mr.iid}`
        if (!mr.jiraKey || approvedHandled.has(key)) continue
        if (await isMrApproved(mr.projectId, mr.iid)) {
          approvedHandled.add(key)
          addHandledApprovedMr(key) // persist so a restart won't re-fire this
          const status = gitlabAutomation.readyForTestStatus.trim()
          const t = await transitionToStatus(mr.jiraKey, status).catch(
            (): ActionResult => ({ ok: false })
          )
          // Only notify on a real move — not when the issue was already in the target status.
          if (t.ok && !t.skipped) notifyAutoTransition(mr.jiraKey, status, 'апрув MR')
        }
      }
    } catch {
      /* ignore GitLab/Jira hiccups — never break the poll */
    }
  }
  return reviews
}

/**
 * Warn (once per day) when the GitLab token is within `gitlabTokenWarnDays` of expiring.
 * The event's `at` is stamped to the calendar day so repeated calls the same day dedupe —
 * i.e. exactly one reminder per day (fired at startup and on each poll). Best-effort.
 */
export function checkGitlabTokenExpiry(): void {
  const { gitlabTokenWarnDays: warnDays, notifications: n } = getSettings()
  const expiry = getGitlabTokenExpiry()
  if (!hasGitlab() || !expiry || warnDays <= 0) return

  const now = new Date()
  const end = new Date(`${expiry}T23:59:59`).getTime()
  if (Number.isNaN(end)) return
  const daysLeft = Math.ceil((end - now.getTime()) / 86_400_000)
  if (daysLeft > warnDays) return

  const text =
    daysLeft < 0
      ? 'токен GitLab истёк — сгенерируйте новый'
      : daysLeft === 0
        ? 'токен GitLab истекает сегодня — обновите'
        : `токен GitLab истекает через ${daysLeft} дн. — обновите`

  const pad = (x: number): string => String(x).padStart(2, '0')
  const dayStamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const event: NotificationEvent = {
    id: randomUUID(),
    type: 'token',
    issueKey: 'GitLab',
    issueSummary: `Токен истекает ${expiry}`,
    text,
    url: '',
    at: `${dayStamp}T09:00:00`, // day-stable → one reminder per calendar day
    read: false
  }
  addEvents([event]) // dedup on type:issueKey:at handles the once-per-day guarantee
  if (n.push) raiseToast(event)
}

/**
 * Record a notification that we auto-moved a Jira issue to a new status (triggered by a GitLab
 * MR event). Shown with the status icon; honors the notifications master toggle + toast pref.
 */
/** Notify when the VPN goes up or down (called only on a real on↔off transition). */
export function notifyVpnChange(on: boolean): void {
  const { notifications: n } = getSettings()
  if (!n.enabled) return
  const event: NotificationEvent = {
    id: randomUUID(),
    type: 'vpn',
    issueKey: 'VPN',
    issueSummary: on ? 'VPN включён' : 'VPN выключен',
    text: on ? 'соединение восстановлено' : 'соединение разорвано',
    url: '',
    at: new Date().toISOString(),
    read: false
  }
  addEvents([event])
  if (n.push) raiseToast(event)
}

/** A notification for an MR the user just created, with a clickable link to it. */
export function notifyMrCreated(
  jiraKey: string | null,
  title: string,
  webUrl: string,
  iid: number
): void {
  const { notifications: n } = getSettings()
  if (!n.enabled) return
  const event: NotificationEvent = {
    id: randomUUID(),
    type: 'mr',
    issueKey: jiraKey || `MR !${iid}`,
    issueSummary: title,
    text: `MR создан · !${iid}`,
    url: webUrl,
    at: new Date().toISOString(),
    read: false
  }
  addEvents([event])
  if (n.push) raiseToast(event)
}

export function notifyAutoTransition(jiraKey: string, toStatus: string, reason: string): void {
  const { notifications: n } = getSettings()
  if (!n.enabled) return
  const event: NotificationEvent = {
    id: randomUUID(),
    type: 'status',
    issueKey: jiraKey,
    issueSummary: `Автопереход: ${reason}`,
    text: `→ «${toStatus}» (авто: ${reason})`,
    url: '',
    at: new Date().toISOString(),
    read: false
  }
  addEvents([event])
  if (n.push) raiseToast(event)
}

function raiseToast(e: NotificationEvent): void {
  if (!Notification.isSupported()) return
  const toast = new Notification({ title: `${e.issueKey}: ${e.text}`, body: e.issueSummary })
  toast.on('click', () => {
    showWidget()
    openPanel('notifications')
  })
  toast.show()
}

function reseed(issues: JiraIssue[]): void {
  prevSnapshot.clear()
  for (const i of issues) {
    if (i.isLocal || i.done) continue
    prevSnapshot.set(i.key, {
      status: i.status,
      updated: i.updated,
      due: i.dueDate,
      commentCount: -1
    })
  }
}
