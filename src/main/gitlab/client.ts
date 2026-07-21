import { getGitlabBaseUrl, getGitlabPat, saveGitlabIdentity } from '../store/credentials'
import type { ConnectionResult, GitlabCredentialsInput } from '@shared/types'

export class GitlabError extends Error {
  constructor(
    message: string,
    public status?: number
  ) {
    super(message)
    this.name = 'GitlabError'
  }
}

interface RequestOptions {
  method?: string
  body?: unknown
  query?: Record<string, string | number | boolean | undefined>
  /** override creds (used by the connection test before anything is saved) */
  auth?: { baseUrl: string; pat: string }
  /** hit a path relative to the host root (no /api/v4 prefix), e.g. /-/autocomplete/users.json */
  raw?: boolean
}

// Same rationale as the Jira client: a stalled tunnel must fail fast, not hang forever.
const REQUEST_TIMEOUT_MS = 20_000

function normalizeBase(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/+$/, '')
}

function resolveAuth(opts: RequestOptions): { base: string; token: string } {
  if (opts.auth) return { base: normalizeBase(opts.auth.baseUrl), token: opts.auth.pat }
  const base = getGitlabBaseUrl()
  const pat = getGitlabPat()
  if (!base || !pat) throw new GitlabError('GitLab не настроен (base URL + PAT)')
  return { base, token: pat }
}

function buildUrl(base: string, path: string, query?: RequestOptions['query'], raw = false): string {
  const url = new URL(raw ? `${base}${path}` : `${base}/api/v4${path}`)
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v))
    }
  }
  return url.toString()
}

/** Low-level GitLab API request. Bearer-style PRIVATE-TOKEN auth from the store unless overridden. */
export async function glRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { base, token } = resolveAuth(opts)
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetch(buildUrl(base, path, opts.query, opts.raw), {
      method: opts.method ?? 'GET',
      headers: {
        'PRIVATE-TOKEN': token,
        Accept: 'application/json',
        ...(opts.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new GitlabError(`GitLab не ответил за ${REQUEST_TIMEOUT_MS / 1000}с — проверьте подключение/VPN`)
    }
    throw new GitlabError(`Network error: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeoutId)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new GitlabError(extractError(text, res.status), res.status)
  }
  if (res.status === 204) return undefined as T
  const ct = res.headers.get('content-type') ?? ''
  if (!ct.includes('application/json')) return undefined as T
  return (await res.json()) as T
}

function extractError(text: string, status: number): string {
  try {
    const json = JSON.parse(text)
    // GitLab errors: { message: ... } (string | object) or { error: ... }
    if (typeof json.message === 'string') return json.message
    if (json.message) return JSON.stringify(json.message)
    if (typeof json.error === 'string') return json.error
  } catch {
    /* not json */
  }
  if (status === 401) return 'Unauthorized — проверьте GitLab PAT'
  if (status === 403) return 'Forbidden — у токена недостаточно прав (нужен scope api)'
  if (status === 404) return 'Not found'
  return `HTTP ${status}`
}

interface GlUser {
  id: number
  username: string
  name: string
}

/** Verify a base url + PAT via GET /user. Accepts explicit creds so it can run before saving. */
export async function testGitlab(input: GitlabCredentialsInput): Promise<ConnectionResult> {
  try {
    const me = await glRequest<GlUser>('/user', { auth: { baseUrl: input.baseUrl, pat: input.pat } })
    return { ok: true, displayName: me.name || me.username }
  } catch (err) {
    return { ok: false, error: err instanceof GitlabError ? err.message : String(err) }
  }
}

/** Resolve and persist the current GitLab identity — best-effort, never throws. */
export async function refreshGitlabIdentity(): Promise<void> {
  try {
    const me = await glRequest<GlUser>('/user')
    saveGitlabIdentity({ userId: me.id, username: me.username, displayName: me.name || me.username })
  } catch {
    /* best effort */
  }
}
