import { jiraRequest, restApi, JiraError } from './client'
import { getApiVersion, getMyIdentity } from '../store/credentials'
import { getSettings } from '../store/settings'

interface JiraField {
  id: string
  name: string
}

// In-memory only — resolved once per configured label per app session. Custom field ids
// almost never change, and re-resolving costs one cheap GET, so no need to persist this.
const fieldIdCache = new Map<string, string>()

/** Resolve a custom-field label (as shown on the Jira form) to its `customfield_XXXXX` id. */
export async function resolveFieldId(label: string): Promise<string | null> {
  const key = label.trim().toLowerCase()
  if (!key) return null
  const cached = fieldIdCache.get(key)
  if (cached) return cached
  try {
    const fields = await jiraRequest<JiraField[]>(`${restApi()}/field`)
    const match = fields.find((f) => f.name.trim().toLowerCase() === key)
    if (!match) return null
    fieldIdCache.set(key, match.id)
    return match.id
  } catch {
    return null
  }
}

/** Identity payload shape Jira expects — differs between Cloud v3 (accountId) and Server/DC v2 (name). */
export function myIdentityPayload(): Record<string, string> | null {
  const { accountId, username } = getMyIdentity()
  if (getApiVersion() === '2') return username ? { name: username } : null
  return accountId ? { accountId } : null
}

/**
 * Assign an issue to the current user: sets the standard Jira Assignee field, and — if an
 * "Implementer" field label is configured in settings — best-effort sets that custom field
 * too (its own failure doesn't undo the Assignee change, which already succeeded).
 */
export async function assignToMe(issueKey: string): Promise<{ ok: boolean; error?: string }> {
  const identity = myIdentityPayload()
  if (!identity) {
    return {
      ok: false,
      error: 'Не удалось определить вашего пользователя Jira — переподключитесь в настройках'
    }
  }

  try {
    await jiraRequest<void>(`${restApi()}/issue/${encodeURIComponent(issueKey)}/assignee`, {
      method: 'PUT',
      body: identity
    })
  } catch (err) {
    return { ok: false, error: err instanceof JiraError ? err.message : String(err) }
  }

  const label = getSettings().implementerFieldLabel.trim()
  if (label) {
    const fieldId = await resolveFieldId(label)
    if (fieldId) {
      await jiraRequest<void>(`${restApi()}/issue/${encodeURIComponent(issueKey)}`, {
        method: 'PUT',
        body: { fields: { [fieldId]: identity } }
      }).catch(() => {
        /* best-effort — Assignee already succeeded, don't fail the whole action */
      })
    }
  }

  return { ok: true }
}

/**
 * After a transition: if the issue is now in the configured "Testing" status and the QA user
 * field is still empty, put the current user into it. Best-effort — a transition already
 * succeeded, so this never throws and never blocks. No-op when no QA field label is configured.
 */
export async function fillQaIfTesting(issueKey: string): Promise<void> {
  const { qaFieldLabel, qaTriggerStatus } = getSettings()
  const label = qaFieldLabel.trim()
  const trigger = (qaTriggerStatus.trim() || 'Testing').toLowerCase()
  if (!label) return
  const identity = myIdentityPayload()
  if (!identity) return
  try {
    const fieldId = await resolveFieldId(label)
    if (!fieldId) return
    const r = await jiraRequest<{ fields?: Record<string, unknown> & { status?: { name?: string } } }>(
      `${restApi()}/issue/${encodeURIComponent(issueKey)}`,
      { query: { fields: `status,${fieldId}` } }
    )
    const statusName = (r.fields?.status?.name ?? '').trim().toLowerCase()
    if (statusName !== trigger) return
    const currentQa = r.fields?.[fieldId]
    if (currentQa != null && currentQa !== '') return // already filled — leave it
    await jiraRequest<void>(`${restApi()}/issue/${encodeURIComponent(issueKey)}`, {
      method: 'PUT',
      body: { fields: { [fieldId]: identity } }
    })
  } catch {
    /* best-effort; the transition itself already succeeded */
  }
}
