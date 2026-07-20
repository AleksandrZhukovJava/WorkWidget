import http from 'node:http'
import { randomBytes } from 'node:crypto'
import { shell } from 'electron'
import {
  OAUTH_REDIRECT_PORT,
  OAUTH_REDIRECT_URI,
  getOAuthClientId,
  getOAuthSecret,
  getOAuthRefreshToken,
  setOAuthRefreshToken,
  saveOAuthClient,
  saveOAuthSession,
  getApiBase
} from '../store/credentials'
import type { ConnectionResult } from '@shared/types'

const AUTH_HOST = 'https://auth.atlassian.com'
const API_HOST = 'https://api.atlassian.com'
// Note: JSM scope (read:servicedesk-request) is intentionally omitted — requesting it
// blocks login for accounts without Jira Service Management. SLA simply won't be available.
const SCOPES = ['read:jira-work', 'write:jira-work', 'read:jira-user', 'offline_access'].join(
  ' '
)

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
  scope?: string
}

interface AccessibleResource {
  id: string
  url: string
  name: string
  scopes: string[]
}

// In-memory cache; the durable secret is the refresh token in Credential Manager.
let cachedAccess: { token: string; expiresAt: number } | null = null

function buildAuthorizeUrl(clientId: string, state: string): string {
  const url = new URL(`${AUTH_HOST}/authorize`)
  url.searchParams.set('audience', 'api.atlassian.com')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('redirect_uri', OAUTH_REDIRECT_URI)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('prompt', 'consent')
  return url.toString()
}

/** Run the full browser login: open Atlassian auth, capture the code, exchange, pick site. */
export async function startLoginFlow(
  clientId: string,
  clientSecret: string
): Promise<ConnectionResult> {
  saveOAuthClient(clientId, clientSecret)
  const state = randomBytes(16).toString('hex')

  let code: string
  try {
    code = await waitForCallback(state)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }

  try {
    const tokens = await exchangeCode(code, clientId, clientSecret)
    if (!tokens.refresh_token) {
      return { ok: false, error: 'Atlassian не вернул refresh token (нужен scope offline_access)' }
    }
    cacheAccess(tokens)

    const resources = await getAccessibleResources(tokens.access_token)
    if (resources.length === 0) {
      return { ok: false, error: 'Нет доступных Jira-сайтов для этого аккаунта' }
    }
    const site = resources[0]

    const me = await fetchMyself(`${API_HOST}/ex/jira/${site.id}`, tokens.access_token)

    saveOAuthSession({
      cloudId: site.id,
      siteUrl: site.url,
      displayName: me,
      refreshToken: tokens.refresh_token
    })
    return { ok: true, displayName: me, accountId: site.url }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Return a valid access token, refreshing via the stored refresh token when needed. */
export async function getValidAccessToken(): Promise<string> {
  if (cachedAccess && cachedAccess.expiresAt > Date.now() + 60_000) {
    return cachedAccess.token
  }
  const clientId = getOAuthClientId()
  const clientSecret = getOAuthSecret()
  const refreshToken = getOAuthRefreshToken()
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Не выполнен вход через браузер (OAuth)')
  }
  const tokens = await refreshTokens(refreshToken, clientId, clientSecret)
  // Atlassian rotates refresh tokens — persist the new one.
  if (tokens.refresh_token) setOAuthRefreshToken(tokens.refresh_token)
  cacheAccess(tokens)
  return tokens.access_token
}

export function clearAccessCache(): void {
  cachedAccess = null
}

function cacheAccess(tokens: TokenResponse): void {
  cachedAccess = {
    token: tokens.access_token,
    expiresAt: Date.now() + tokens.expires_in * 1000
  }
}

function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const reqUrl = new URL(req.url ?? '/', OAUTH_REDIRECT_URI)
      if (reqUrl.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const error = reqUrl.searchParams.get('error')
      const code = reqUrl.searchParams.get('code')
      const state = reqUrl.searchParams.get('state')

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(
        `<html><body style="font-family:Segoe UI,sans-serif;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h2>${
          error || !code ? 'Вход не выполнен' : 'Готово ✓'
        }</h2><p>Можно закрыть эту вкладку и вернуться в Jira Widget.</p></div></body></html>`
      )

      cleanup()
      if (error) reject(new Error(`Atlassian: ${error}`))
      else if (!code) reject(new Error('Не получен код авторизации'))
      else if (state !== expectedState) reject(new Error('Несовпадение state (возможна подмена)'))
      else resolve(code)
    })

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Время ожидания входа истекло'))
    }, 180_000)

    function cleanup(): void {
      clearTimeout(timer)
      server.close()
    }

    server.on('error', (err) => {
      clearTimeout(timer)
      reject(
        new Error(
          `Не удалось открыть порт ${OAUTH_REDIRECT_PORT}: ${err.message}. Закройте приложение, занявшее порт, и повторите.`
        )
      )
    })

    server.listen(OAUTH_REDIRECT_PORT, '127.0.0.1', () => {
      void shell.openExternal(buildAuthorizeUrl(getOAuthClientId(), expectedState))
    })
  })
}

async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  return postToken({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: OAUTH_REDIRECT_URI
  })
}

async function refreshTokens(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<TokenResponse> {
  return postToken({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken
  })
}

async function postToken(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(`${AUTH_HOST}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OAuth token error (${res.status}): ${text.slice(0, 200)}`)
  }
  return (await res.json()) as TokenResponse
}

async function getAccessibleResources(accessToken: string): Promise<AccessibleResource[]> {
  const res = await fetch(`${API_HOST}/oauth/token/accessible-resources`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })
  if (!res.ok) throw new Error(`accessible-resources error: ${res.status}`)
  return (await res.json()) as AccessibleResource[]
}

async function fetchMyself(apiBase: string, accessToken: string): Promise<string> {
  const res = await fetch(`${apiBase}/rest/api/3/myself`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  })
  if (!res.ok) return 'OAuth user'
  const me = (await res.json()) as { displayName?: string }
  return me.displayName ?? 'OAuth user'
}

/** Disconnect: drop the cached access token (caller clears the stored session). */
export function disconnect(): void {
  clearAccessCache()
}

/** Convenience for the client: api base for OAuth requests. */
export function oauthApiBase(): string {
  return getApiBase()
}
