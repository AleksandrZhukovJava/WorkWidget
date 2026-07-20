import { safeStorage } from 'electron'
import { Entry } from '@napi-rs/keyring'
import Store from 'electron-store'
import type { AuthMode, GitlabConfig, JiraConfig } from '@shared/types'

// Secret keys inside the encrypted secrets store.
const ACC_TOKEN = 'token'
const ACC_OAUTH_SECRET = 'oauthSecret'
const ACC_OAUTH_REFRESH = 'oauthRefresh'
const ACC_SERVER_PAT = 'serverPat'
const ACC_LLM_KEY = 'llmApiKey'
const ACC_CODER_KEY = 'coderApiKey'
const ACC_GITLAB_PAT = 'gitlabPat'

const KEYRING_SERVICE = 'JiraWidget'

// Account names the first (keyring-only) version of the app stored secrets under —
// checked as a last-resort fallback so nothing that's still sitting in Credential
// Manager from that era is ever lost.
const LEGACY_KEYRING_ACCOUNTS: Record<string, string> = {
  [ACC_TOKEN]: 'jira-api-token',
  [ACC_OAUTH_SECRET]: 'oauth-client-secret',
  [ACC_OAUTH_REFRESH]: 'oauth-refresh-token',
  [ACC_SERVER_PAT]: 'server-pat'
}

/** Loopback redirect for the OAuth flow — must be registered in the Atlassian app. */
export const OAUTH_REDIRECT_PORT = 53682
export const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`

const ATLASSIAN_API_BASE = 'https://api.atlassian.com'

interface ConfigShape {
  authMode: AuthMode
  baseUrl: string
  email: string
  oauthClientId: string
  oauthCloudId: string
  oauthSiteUrl: string
  oauthDisplayName: string
  serverBaseUrl: string
  serverDisplayName: string
  /** Cloud/OAuth identity for API calls (e.g. assignee) — Jira Cloud uses accountId. */
  myAccountId: string
  /** Server/DC identity for API calls — classic Jira uses the username, not an accountId. */
  myUsername: string
  // GitLab (separate provider, PAT auth).
  gitlabBaseUrl: string
  gitlabDisplayName: string
  gitlabUserId: number
  gitlabUsername: string
  /** optional token expiry date (YYYY-MM-DD) for the expiry-warning notification */
  gitlabTokenExpiry: string
}

const configStore = new Store<ConfigShape>({
  name: 'jira-config',
  defaults: {
    authMode: 'token',
    baseUrl: '',
    email: '',
    oauthClientId: '',
    oauthCloudId: '',
    oauthSiteUrl: '',
    oauthDisplayName: '',
    serverBaseUrl: '',
    serverDisplayName: '',
    myAccountId: '',
    myUsername: '',
    gitlabBaseUrl: '',
    gitlabDisplayName: '',
    gitlabUserId: 0,
    gitlabUsername: '',
    gitlabTokenExpiry: ''
  }
})

/**
 * Secrets live in THREE layers, because each has a failure mode the others cover:
 *  1. In-memory cache — immune to everything for the rest of the session.
 *  2. Windows Credential Manager (keyring) — survives reboots and, critically, is readable
 *     from the very first second after Windows login. This is the primary read source.
 *  3. safeStorage-encrypted file (DPAPI via Chromium's os_crypt) — works, but has been
 *     observed to fail TRANSIENTLY when the app autostarts right at login (os_crypt not
 *     initialized yet), which made the app wrongly conclude the PAT was gone.
 * Reads self-heal: whichever layer serves the value rewrites the missing ones.
 */
const secretsStore = new Store<Record<string, string>>({ name: 'jira-secrets', defaults: {} })
const secretCache = new Map<string, string>()

function keyringSet(key: string, value: string): void {
  try {
    new Entry(KEYRING_SERVICE, key).setPassword(value)
  } catch (err) {
    console.error(`keyring write failed for ${key}:`, err)
  }
}

function keyringGet(service: string, account: string): string | null {
  try {
    return new Entry(service, account).getPassword()
  } catch {
    return null
  }
}

function fileSet(key: string, value: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) {
      secretsStore.set(key, 'enc:' + safeStorage.encryptString(value).toString('base64'))
    } else {
      secretsStore.set(key, 'raw:' + Buffer.from(value, 'utf8').toString('base64'))
    }
  } catch (err) {
    console.error(`secrets-file write failed for ${key}:`, err)
  }
}

function fileGet(key: string): string | null {
  const v = secretsStore.get(key)
  if (!v) return null
  try {
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString('utf8')
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'))
    return null
  } catch (err) {
    console.error(`secrets-file decrypt failed for ${key}:`, err)
    return null
  }
}

function setSecret(key: string, value: string): void {
  secretCache.set(key, value)
  keyringSet(key, value)
  fileSet(key, value)
}

function readSecretKey(key: string): string | null {
  const cached = secretCache.get(key)
  if (cached !== undefined) return cached

  // Credential Manager first — dependable even at early login, when safeStorage isn't.
  const fromKeyring = keyringGet(KEYRING_SERVICE, key)
  if (fromKeyring !== null) {
    secretCache.set(key, fromKeyring)
    fileSet(key, fromKeyring)
    return fromKeyring
  }

  const fromFile = fileGet(key)
  if (fromFile !== null) {
    secretCache.set(key, fromFile)
    keyringSet(key, fromFile)
    return fromFile
  }

  const legacyAccount = LEGACY_KEYRING_ACCOUNTS[key]
  const fromLegacy = legacyAccount ? keyringGet(KEYRING_SERVICE, legacyAccount) : null
  if (fromLegacy !== null) {
    setSecret(key, fromLegacy)
    return fromLegacy
  }

  return null
}

function deleteSecretKey(key: string): void {
  secretCache.delete(key)
  secretsStore.delete(key)
  try {
    new Entry(KEYRING_SERVICE, key).deletePassword()
  } catch {
    /* nothing stored */
  }
  const legacyAccount = LEGACY_KEYRING_ACCOUNTS[key]
  if (legacyAccount) {
    try {
      new Entry(KEYRING_SERVICE, legacyAccount).deletePassword()
    } catch {
      /* nothing stored */
    }
  }
}

// ---------------- auth mode ----------------
export function getAuthMode(): AuthMode {
  return configStore.get('authMode')
}

// ---------------- token mode ----------------
export function saveCredentials(baseUrl: string, email: string, apiToken: string): void {
  configStore.set('authMode', 'token')
  configStore.set('baseUrl', normalizeBaseUrl(baseUrl))
  configStore.set('email', email.trim())
  setSecret(ACC_TOKEN, apiToken)
}

export function clearCredentials(): void {
  configStore.set('baseUrl', '')
  configStore.set('email', '')
  deleteSecretKey(ACC_TOKEN)
  clearMyIdentity()
}

export function getToken(): string | null {
  return readSecretKey(ACC_TOKEN)
}

export function getEmail(): string {
  return configStore.get('email')
}

// ---------------- oauth mode ----------------
export function saveOAuthClient(clientId: string, clientSecret: string): void {
  configStore.set('oauthClientId', clientId.trim())
  setSecret(ACC_OAUTH_SECRET, clientSecret)
}

export function getOAuthClientId(): string {
  return configStore.get('oauthClientId')
}

export function getOAuthSecret(): string | null {
  return readSecretKey(ACC_OAUTH_SECRET)
}

export function getOAuthRefreshToken(): string | null {
  return readSecretKey(ACC_OAUTH_REFRESH)
}

export function setOAuthRefreshToken(token: string): void {
  setSecret(ACC_OAUTH_REFRESH, token)
}

/** Persist the connected site after a successful browser login. */
export function saveOAuthSession(opts: {
  cloudId: string
  siteUrl: string
  displayName: string
  refreshToken: string
}): void {
  configStore.set('authMode', 'oauth')
  configStore.set('oauthCloudId', opts.cloudId)
  configStore.set('oauthSiteUrl', normalizeBaseUrl(opts.siteUrl))
  configStore.set('oauthDisplayName', opts.displayName)
  setOAuthRefreshToken(opts.refreshToken)
}

export function clearOAuthSession(): void {
  configStore.set('oauthCloudId', '')
  configStore.set('oauthSiteUrl', '')
  configStore.set('oauthDisplayName', '')
  deleteSecretKey(ACC_OAUTH_REFRESH)
  clearMyIdentity()
}

export function getOAuthCloudId(): string {
  return configStore.get('oauthCloudId')
}

// ---------------- server (self-hosted / DC) mode ----------------
export function saveServerCredentials(baseUrl: string, pat: string, displayName: string): void {
  configStore.set('authMode', 'server')
  configStore.set('serverBaseUrl', normalizeBaseUrl(baseUrl))
  configStore.set('serverDisplayName', displayName)
  setSecret(ACC_SERVER_PAT, pat)
}

export function clearServerCredentials(): void {
  configStore.set('serverBaseUrl', '')
  configStore.set('serverDisplayName', '')
  deleteSecretKey(ACC_SERVER_PAT)
  clearMyIdentity()
}

export function getServerPat(): string | null {
  return readSecretKey(ACC_SERVER_PAT)
}

export function getServerBaseUrl(): string {
  return configStore.get('serverBaseUrl')
}

// ---------------- GitLab (separate provider, PAT auth) ----------------
export function saveGitlabCredentials(baseUrl: string, pat: string, expiry = ''): void {
  configStore.set('gitlabBaseUrl', normalizeBaseUrl(baseUrl))
  configStore.set('gitlabTokenExpiry', expiry.trim())
  setSecret(ACC_GITLAB_PAT, pat)
}

export function clearGitlabCredentials(): void {
  configStore.set('gitlabBaseUrl', '')
  configStore.set('gitlabDisplayName', '')
  configStore.set('gitlabUserId', 0)
  configStore.set('gitlabUsername', '')
  configStore.set('gitlabTokenExpiry', '')
  deleteSecretKey(ACC_GITLAB_PAT)
}

export function getGitlabTokenExpiry(): string {
  return configStore.get('gitlabTokenExpiry')
}

/** Update just the expiry date (without re-entering the token). */
export function setGitlabTokenExpiry(date: string): void {
  configStore.set('gitlabTokenExpiry', date.trim())
}

export function getGitlabPat(): string | null {
  return readSecretKey(ACC_GITLAB_PAT)
}

export function getGitlabBaseUrl(): string {
  return configStore.get('gitlabBaseUrl')
}

/** Persist the resolved GitLab identity after a successful auth (for reviewer-id monitoring). */
export function saveGitlabIdentity(id: { userId: number; username: string; displayName: string }): void {
  configStore.set('gitlabUserId', id.userId)
  configStore.set('gitlabUsername', id.username)
  configStore.set('gitlabDisplayName', id.displayName)
}

export function getGitlabUser(): { id: number; username: string; displayName: string } {
  return {
    id: configStore.get('gitlabUserId'),
    username: configStore.get('gitlabUsername'),
    displayName: configStore.get('gitlabDisplayName')
  }
}

export function hasGitlab(): boolean {
  return Boolean(getGitlabBaseUrl() && getGitlabPat())
}

export function getGitlabPublicConfig(): GitlabConfig {
  return {
    baseUrl: getGitlabBaseUrl(),
    hasPat: getGitlabPat() !== null,
    connected: hasGitlab(),
    displayName: configStore.get('gitlabDisplayName'),
    tokenExpiry: configStore.get('gitlabTokenExpiry')
  }
}

// ---------------- LLM assistant API key ----------------
/** Empty string clears the key (LM Studio local server needs none). */
export function setLlmApiKey(key: string): void {
  if (key.trim()) setSecret(ACC_LLM_KEY, key.trim())
  else deleteSecretKey(ACC_LLM_KEY)
}

export function getLlmApiKey(): string | null {
  return readSecretKey(ACC_LLM_KEY)
}

/** Coder-agent model API key (empty clears; local LM Studio needs none). */
export function setCoderApiKey(key: string): void {
  if (key.trim()) setSecret(ACC_CODER_KEY, key.trim())
  else deleteSecretKey(ACC_CODER_KEY)
}

export function getCoderApiKey(): string | null {
  return readSecretKey(ACC_CODER_KEY)
}

// ---------------- current-user identity (for "assign to me") ----------------
/** Persist the resolved identity after a successful auth — best-effort, never throws. */
export function saveMyIdentity(id: { accountId?: string; username?: string }): void {
  if (id.accountId) configStore.set('myAccountId', id.accountId)
  if (id.username) configStore.set('myUsername', id.username)
}

export function getMyIdentity(): { accountId: string; username: string } {
  return { accountId: configStore.get('myAccountId'), username: configStore.get('myUsername') }
}

/** Wipe the cached identity — called on disconnect so a later account switch can't leak
 * into "assign to me" assigning the wrong person. */
function clearMyIdentity(): void {
  configStore.set('myAccountId', '')
  configStore.set('myUsername', '')
}

// ---------------- shared accessors ----------------
/** Self-hosted Jira Server/DC uses REST v2; Cloud (token/oauth) uses v3. */
export function getApiVersion(): '2' | '3' {
  return getAuthMode() === 'server' ? '2' : '3'
}

/** Human-facing site url for /browse links. */
export function getSiteUrl(): string {
  const mode = getAuthMode()
  if (mode === 'oauth') return configStore.get('oauthSiteUrl')
  if (mode === 'server') return configStore.get('serverBaseUrl')
  return configStore.get('baseUrl')
}

/** Base url for REST requests (differs per auth mode). */
export function getApiBase(): string {
  const mode = getAuthMode()
  if (mode === 'oauth') return `${ATLASSIAN_API_BASE}/ex/jira/${getOAuthCloudId()}`
  if (mode === 'server') return configStore.get('serverBaseUrl')
  return configStore.get('baseUrl')
}

export function getPublicConfig(): JiraConfig {
  return {
    authMode: getAuthMode(),
    baseUrl: getSiteUrl(),
    email: getEmail(),
    hasToken: getToken() !== null,
    oauth: {
      redirectUri: OAUTH_REDIRECT_URI,
      hasClientId: getOAuthClientId() !== '',
      hasSecret: getOAuthSecret() !== null,
      connected: getOAuthRefreshToken() !== null && getOAuthCloudId() !== '',
      siteUrl: configStore.get('oauthSiteUrl'),
      cloudId: getOAuthCloudId(),
      displayName: configStore.get('oauthDisplayName')
    },
    server: {
      baseUrl: configStore.get('serverBaseUrl'),
      hasPat: getServerPat() !== null,
      connected: getServerBaseUrl() !== '' && getServerPat() !== null,
      displayName: configStore.get('serverDisplayName')
    }
  }
}

export function hasCompleteCredentials(): boolean {
  const mode = getAuthMode()
  if (mode === 'oauth') {
    return Boolean(getOAuthClientId() && getOAuthSecret() && getOAuthRefreshToken() && getOAuthCloudId())
  }
  if (mode === 'server') {
    return Boolean(getServerBaseUrl() && getServerPat())
  }
  return Boolean(configStore.get('baseUrl') && getEmail() && getToken())
}

function normalizeBaseUrl(url: string): string {
  let u = url.trim()
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`
  return u.replace(/\/+$/, '')
}
