import { jiraRequest, restApi } from './client'
import { getApiVersion, getSiteUrl } from '../store/credentials'
import {
  getSettings,
  getPriority,
  getBlocked,
  getChecklist,
  isArchived,
  isKeyDone,
  getTrackedJiraKeys,
  setTrackedJiraKeys,
  markKeyDone
} from '../store/settings'
import { getSla } from './sla'
import { sortByPriority } from '@shared/priority'
import type { HistoryItem, JiraIssue } from '@shared/types'

interface JiraSearchResponse {
  issues: RawIssue[]
}

/** Flatten an ADF (Cloud v3) description node tree to plain text. */
function flattenAdf(node: unknown): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(flattenAdf).join('')
  const n = node as { text?: string; content?: unknown; type?: string }
  let s = n.text ?? ''
  if (n.content) s += flattenAdf(n.content)
  if (n.type === 'paragraph' || n.type === 'heading') s += '\n'
  return s
}

/** Fetch an issue's description as plain text (Server v2 = string, Cloud v3 = ADF). */
export async function getIssueDescription(key: string): Promise<string> {
  const r = await jiraRequest<{ fields?: { description?: unknown } }>(
    `${restApi()}/issue/${encodeURIComponent(key)}`,
    { query: { fields: 'description' } }
  )
  const d = r.fields?.description
  if (!d) return ''
  return (typeof d === 'string' ? d : flattenAdf(d)).trim()
}

/** Summary/title of a Jira issue. Empty string if it doesn't exist or isn't accessible. */
export async function getIssueSummary(key: string): Promise<string> {
  try {
    const r = await jiraRequest<{ fields?: { summary?: string } }>(
      `${restApi()}/issue/${encodeURIComponent(key)}`,
      { query: { fields: 'summary' } }
    )
    return (r.fields?.summary ?? '').trim()
  } catch {
    return '' // not found / no access — caller falls back to the branch commit title
  }
}

interface ResolvedSearchResponse {
  issues: { key: string; fields: { summary: string; resolutiondate?: string | null } }[]
}

interface RawIssue {
  key: string
  fields: {
    summary: string
    status: { name: string; statusCategory: { key: string } }
    issuetype: { name: string }
    priority?: { name: string } | null
    assignee?: { displayName: string } | null
    duedate?: string | null
    updated: string
  }
}

const FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'duedate', 'updated']

/**
 * Ownership clause driven by the "my field" setting: standard Assignee by default, a
 * custom field (Исполнитель/QA/…) when configured — optionally OR'd with Assignee. It is
 * substituted into the user's JQL in place of the `{{mine}}` token or the default
 * `assignee = currentUser()` clause; a fully custom JQL without either stays untouched.
 */
function effectiveJql(): string {
  const { jql, myFieldLabel, myFieldIncludeAssignee } = getSettings()
  const label = myFieldLabel.trim().replace(/"/g, '')
  let clause = 'assignee = currentUser()'
  if (label) {
    clause = myFieldIncludeAssignee
      ? `("${label}" = currentUser() OR assignee = currentUser())`
      : `"${label}" = currentUser()`
  }
  if (jql.includes('{{mine}}')) return jql.replace('{{mine}}', clause)
  if (jql.includes('assignee = currentUser()')) {
    return jql.replace('assignee = currentUser()', clause)
  }
  return jql
}

/**
 * Fetch "my" issues via JQL, enrich Cloud issues with JSM SLA, drop locally-archived/done
 * keys. Also detects issues we were tracking that quietly transitioned to Done in Jira
 * (they'd otherwise just vanish because the JQL excludes Done) and mirrors that completion
 * into our local overlay — read-only on our side, we never write anything back to Jira here.
 */
export async function getMyIssues(): Promise<JiraIssue[]> {
  const baseUrl = getSiteUrl()
  const isServer = getApiVersion() === '2'

  // Server/DC: POST /rest/api/2/search. Cloud: POST /rest/api/3/search/jql.
  const searchPath = isServer ? '/rest/api/2/search' : '/rest/api/3/search/jql'

  const resp = await jiraRequest<JiraSearchResponse>(searchPath, {
    method: 'POST',
    body: { jql: effectiveJql(), maxResults: 50, fields: FIELDS }
  })

  const currentKeys = (resp.issues ?? []).map((i) => i.key)
  const missing = getTrackedJiraKeys().filter(
    (k) => !currentKeys.includes(k) && !isArchived(k) && !isKeyDone(k)
  )
  await mirrorNewlyDoneIssues(missing, searchPath, baseUrl)
  // Carry forward whatever's still unresolved (lookup failed, or genuinely not Done yet —
  // e.g. reassigned away) so the next poll gets another chance to catch a real transition.
  const stillMissing = missing.filter((k) => !isKeyDone(k))
  setTrackedJiraKeys([...currentKeys, ...stillMissing])

  const visible = (resp.issues ?? []).filter((i) => !isArchived(i.key) && !isKeyDone(i.key))

  const mapped = await Promise.all(
    visible.map(async (raw) => {
      // SLA is a Jira Service Management (Cloud) feature only.
      const sla = isServer ? null : await getSla(raw.key).catch(() => null)
      return mapIssue(raw, baseUrl, sla)
    })
  )

  // Local priority overrides the JQL order (highest first).
  return sortByPriority(mapped)
}

/**
 * Targeted lookup for keys that dropped out of the main fetch: if Jira really does show
 * them as Done now, mirror that into the local completion overlay so the task keeps
 * showing up (in "Завершённые") instead of disappearing. Purely a read — no status is
 * ever written back to Jira.
 */
async function mirrorNewlyDoneIssues(
  missing: string[],
  searchPath: string,
  baseUrl: string
): Promise<void> {
  if (missing.length === 0) return

  try {
    const jql = `key in (${missing.map((k) => `"${k}"`).join(',')}) AND statusCategory = Done`
    const resp = await jiraRequest<{
      issues: { key: string; fields: { summary: string; status: { name: string }; resolutiondate?: string | null } }[]
    }>(searchPath, {
      method: 'POST',
      body: { jql, maxResults: missing.length, fields: ['summary', 'status', 'resolutiondate'] }
    })
    for (const i of resp.issues ?? []) {
      markKeyDone({
        key: i.key,
        summary: i.fields.summary,
        status: i.fields.status.name,
        url: `${baseUrl}/browse/${i.key}`,
        isLocal: false,
        doneAt: i.fields.resolutiondate ?? new Date().toISOString()
      })
    }
  } catch {
    // Best-effort — if this lookup fails, the issue simply drops out this cycle and we
    // retry the check on the next poll (it stays in "missing" until archived/found).
  }
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Jira issues the user resolved on a given local date (YYYY-MM-DD). */
export async function getDoneOnDate(date: string): Promise<HistoryItem[]> {
  const isServer = getApiVersion() === '2'
  const searchPath = isServer ? '/rest/api/2/search' : '/rest/api/3/search/jql'
  const jql = `assignee = currentUser() AND resolved >= "${date}" AND resolved < "${nextDay(
    date
  )}" ORDER BY resolved DESC`

  const resp = await jiraRequest<ResolvedSearchResponse>(searchPath, {
    method: 'POST',
    body: { jql, maxResults: 100, fields: ['summary', 'resolutiondate'] }
  })
  const baseUrl = getSiteUrl()
  return (resp.issues ?? []).map((i) => ({
    key: i.key,
    summary: i.fields.summary,
    isLocal: false,
    url: `${baseUrl}/browse/${i.key}`,
    doneAt: i.fields.resolutiondate ?? `${date}T00:00:00.000Z`
  }))
}

function mapIssue(
  raw: RawIssue,
  baseUrl: string,
  sla: JiraIssue['sla']
): JiraIssue {
  const f = raw.fields
  return {
    key: raw.key,
    summary: f.summary,
    status: f.status.name,
    statusCategory: f.status.statusCategory.key,
    issueType: f.issuetype.name,
    priority: f.priority?.name ?? null,
    assignee: f.assignee?.displayName ?? null,
    dueDate: f.duedate ?? null,
    updated: f.updated,
    url: `${baseUrl}/browse/${raw.key}`,
    sla,
    localPriority: getPriority(raw.key),
    blocked: getBlocked(raw.key) !== null,
    blockReason: getBlocked(raw.key) ?? '',
    isLocal: false,
    done: false,
    doneAt: null,
    checklist: getChecklist(raw.key)
  }
}
