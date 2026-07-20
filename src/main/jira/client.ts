import {
  getApiBase,
  getApiVersion,
  getAuthMode,
  getEmail,
  getServerPat,
  getToken
} from '../store/credentials'
import { getValidAccessToken } from './oauth'

export class JiraError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'JiraError'
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  /**
   * Override creds (used by connection tests before anything is saved):
   * `email`+`apiToken` → Basic (Cloud); `pat` → Bearer (Server/DC).
   */
  auth?: { baseUrl: string; email?: string; apiToken?: string; pat?: string }
  /** absolute path starting with /rest/... */
  query?: Record<string, string | number | undefined>
}

function basicHeader(email: string, token: string): string {
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64')
}

/** REST path prefix for the active mode — /rest/api/2 (Server/DC) or /rest/api/3 (Cloud). */
export function restApi(): string {
  return `/rest/api/${getApiVersion()}`
}

function buildUrl(baseUrl: string, path: string, query?: RequestOptions['query']): string {
  const url = new URL(baseUrl + path)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

interface ResolvedAuth {
  base: string
  authorization: string
}

/** Pick base url + Authorization header based on auth mode (or explicit token creds). */
async function resolveAuth(opts: RequestOptions): Promise<ResolvedAuth> {
  // Explicit creds: used by connection tests before anything is saved.
  if (opts.auth) {
    const base = normalizeBase(opts.auth.baseUrl)
    if (opts.auth.pat) return { base, authorization: `Bearer ${opts.auth.pat}` }
    return { base, authorization: basicHeader(opts.auth.email ?? '', opts.auth.apiToken ?? '') }
  }

  const mode = getAuthMode()

  if (mode === 'oauth') {
    const accessToken = await getValidAccessToken()
    const base = getApiBase()
    if (!base) throw new JiraError('OAuth: не выбран Jira-сайт')
    return { base, authorization: `Bearer ${accessToken}` }
  }

  if (mode === 'server') {
    const base = getApiBase()
    const pat = getServerPat()
    if (!base || !pat) throw new JiraError('Не настроен доступ к Jira Server (PAT)')
    return { base, authorization: `Bearer ${pat}` }
  }

  const base = getApiBase()
  const email = getEmail()
  const token = getToken()
  if (!base || !email || !token) {
    throw new JiraError('Jira credentials are not configured')
  }
  return { base, authorization: basicHeader(email, token) }
}

function normalizeBase(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/+$/, '')
}

/** Low-level Jira Cloud request. Resolves auth from the store unless `auth` is passed. */
// Without this, a stalled connection (dead VPN tunnel, firewall black-hole, unresponsive
// self-hosted server) hangs the request forever — no error, no timeout, the caller just
// waits indefinitely (this is exactly what caused the "Загрузка типов…" spinner to hang).
const REQUEST_TIMEOUT_MS = 20_000

export async function jiraRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { base, authorization } = await resolveAuth(opts)

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(buildUrl(base, path, opts.query), {
      method: opts.method ?? 'GET',
      headers: {
        Authorization: authorization,
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new JiraError(
        `Jira не ответила за ${REQUEST_TIMEOUT_MS / 1000}с — проверьте подключение/VPN`
      )
    }
    throw new JiraError(
      `Network error: ${err instanceof Error ? err.message : String(err)}`
    )
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new JiraError(extractError(text, res.status), res.status)
  }

  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

function extractError(text: string, status: number): string {
  try {
    const json = JSON.parse(text)
    const msgs: string[] = json.errorMessages ?? []
    const fieldErrs = json.errors ? Object.values(json.errors as Record<string, string>) : []
    const all = [...msgs, ...fieldErrs].filter(Boolean)
    if (all.length) return all.join('; ')
  } catch {
    /* not json */
  }
  if (status === 401) return 'Unauthorized — проверьте email и API token'
  if (status === 403) return 'Forbidden — недостаточно прав'
  if (status === 404) return 'Not found'
  return `HTTP ${status}`
}
