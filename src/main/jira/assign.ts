import { jiraRequest, restApi, JiraError } from './client'
import { getApiVersion, getMyIdentity } from '../store/credentials'
import { getSettings } from '../store/settings'

interface JiraField {
  id: string
  name: string
}

// In-memory only — resolved once per configured label per app session. Custom field ids
// almost never change, and re-resolving costs one cheap GET, so no need to persist this.
let cachedField: { label: string; id: string } | null = null

async function resolveImplementerFieldId(label: string): Promise<string | null> {
  if (cachedField?.label === label) return cachedField.id
  try {
    const fields = await jiraRequest<JiraField[]>(`${restApi()}/field`)
    const match = fields.find((f) => f.name.trim().toLowerCase() === label.trim().toLowerCase())
    if (!match) return null
    cachedField = { label, id: match.id }
    return match.id
  } catch {
    return null
  }
}

/** Identity payload shape Jira expects — differs between Cloud v3 (accountId) and Server/DC v2 (name). */
function myIdentityPayload(): Record<string, string> | null {
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
    const fieldId = await resolveImplementerFieldId(label)
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
