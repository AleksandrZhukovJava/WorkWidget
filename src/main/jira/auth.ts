import { jiraRequest, restApi, JiraError } from './client'
import { saveMyIdentity } from '../store/credentials'
import type { ConnectionResult, SaveCredentialsInput, ServerCredentialsInput } from '@shared/types'

interface MyselfResponse {
  accountId?: string
  displayName: string
  name?: string
}

/** Verify credentials against /myself. Accepts explicit creds so it can run before saving. */
export async function testConnection(input: SaveCredentialsInput): Promise<ConnectionResult> {
  try {
    const me = await jiraRequest<MyselfResponse>('/rest/api/3/myself', {
      auth: {
        baseUrl: input.baseUrl,
        email: input.email,
        apiToken: input.apiToken
      }
    })
    return { ok: true, displayName: me.displayName, accountId: me.accountId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof JiraError ? err.message : String(err)
    }
  }
}

/** Verify a self-hosted Jira (Server/DC) base url + Personal Access Token via /rest/api/2/myself. */
export async function testServerConnection(
  input: ServerCredentialsInput
): Promise<ConnectionResult> {
  try {
    const me = await jiraRequest<MyselfResponse>('/rest/api/2/myself', {
      auth: { baseUrl: input.baseUrl, pat: input.pat }
    })
    return { ok: true, displayName: me.displayName || me.name || 'OK' }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof JiraError ? err.message : String(err)
    }
  }
}

/**
 * Resolve and persist the current user's identity (accountId for Cloud/OAuth, username for
 * Server/DC) so "assign to me" doesn't need a fresh /myself round-trip on every click.
 * Best-effort — never throws, called fire-and-forget right after a successful auth.
 */
export async function refreshMyIdentity(): Promise<void> {
  try {
    const me = await jiraRequest<MyselfResponse>(`${restApi()}/myself`)
    saveMyIdentity({ accountId: me.accountId, username: me.name })
  } catch {
    /* best effort — a later assign-to-me will surface a clear error if identity is missing */
  }
}
