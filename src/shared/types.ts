export type AuthMode = 'token' | 'oauth' | 'server'

export interface OAuthPublicConfig {
  /** redirect URI the user must register in their Atlassian OAuth app */
  redirectUri: string
  hasClientId: boolean
  /** secret stored (flag only — never returned to renderer) */
  hasSecret: boolean
  /** refresh token present = browser login completed */
  connected: boolean
  /** human site url, e.g. https://your.atlassian.net (for browse links) */
  siteUrl: string
  cloudId: string
  /** display name of the logged-in user */
  displayName: string
}

export interface ServerPublicConfig {
  /** self-hosted Jira base url, e.g. https://jira.company.com */
  baseUrl: string
  /** Personal Access Token stored (flag only) */
  hasPat: boolean
  /** connected = base url + PAT present */
  connected: boolean
  displayName: string
}

export interface JiraConfig {
  authMode: AuthMode
  /** token-mode site url; in oauth mode mirrors oauth.siteUrl for display */
  baseUrl: string
  email: string
  /** token-mode API token present (flag only) */
  hasToken: boolean
  oauth: OAuthPublicConfig
  server: ServerPublicConfig
}

export interface OAuthCredentialsInput {
  clientId: string
  clientSecret: string
}

export interface ServerCredentialsInput {
  baseUrl: string
  pat: string
}

export interface ArchivedItem {
  key: string
  summary: string
  status: string
  url: string
  /** ISO timestamp when archived */
  archivedAt: string
}

/**
 * A completed task — local or Jira-sourced. Completion here is a purely local overlay:
 * marking a Jira issue done here never calls Jira, and Jira's own status is never read
 * back to un-complete it. If a tracked Jira issue is separately found to have actually
 * transitioned to Done in Jira, it is auto-added here too (see main/jira/issues.ts) so it
 * doesn't just vanish from the app — but that's a one-way mirror, not a live link.
 */
export interface DoneItem {
  key: string
  summary: string
  /** status label captured at completion time, for display only */
  status: string
  url: string
  isLocal: boolean
  /** ISO timestamp when marked done */
  doneAt: string
}

/** Task views shown in the panel's dropdown menu. 'archive' is reachable but never a default. */
export type PanelView =
  | 'inbox'
  | 'prioritized'
  | 'blocked'
  | 'local'
  | 'completed'
  | 'history'
  | 'dashboard'
  | 'archive'
  | 'create'
  | 'notifications'
  | 'agent'
  | 'gitlab'
  | 'blocks'

export interface AppSettings {
  pollIntervalMinutes: number
  jql: string
  /** view opened when the panel starts (e.g. clicking the widget); never 'archive' */
  defaultView: PanelView
  /** default project key new issues are created in, e.g. "OSE" */
  jiraProjectKey: string
  /**
   * Display label of the optional custom "Исполнитель"/Implementer field, exactly as it's
   * labeled on the Jira issue form. Empty = the field is never touched. Resolved to a
   * customfield_XXXXX id at runtime via /field.
   */
  implementerFieldLabel: string
  /**
   * Label of a "QA" user field. When a task transitions into `qaTriggerStatus`, the current user
   * is put into this field if it's still empty. Empty label = feature off.
   */
  qaFieldLabel: string
  /** Status name that triggers the QA auto-fill (default "Testing"). */
  qaTriggerStatus: string
  /**
   * Which field makes a task "mine" in the task list. Empty = standard Assignee.
   * Otherwise a custom field label used in JQL (e.g. "Исполнитель" or "QA") — it becomes
   * the primary criterion; `myFieldIncludeAssignee` additionally ORs in Assignee.
   * Local overlays (priorities/blocked/archive/done) are keyed by issue key and are NEVER
   * pruned, so switching this back and forth loses nothing.
   */
  myFieldLabel: string
  myFieldIncludeAssignee: boolean
  /** first-run role questionnaire completed (or skipped) — gates the onboarding window */
  onboardingDone: boolean
  /** how to address the user, from onboarding; empty = no personal greeting */
  userName: string
  /** UI color theme for panel/settings/onboarding windows */
  theme: 'dark' | 'light'
  /** notification preferences */
  notifications: NotificationSettings
  /** locally archived (hidden) issues, with a snapshot for display/search */
  archived: ArchivedItem[]
  /** local per-issue priority overrides: issueKey -> level (1..5); absent = none(0) */
  priorities: Record<string, number>
  /** local block notes: issueKey -> reason; presence = blocked */
  blocked: Record<string, string>
  /** local per-task progress checklists: issueKey -> items; absent/empty = none */
  checklists: Record<string, ChecklistItem[]>
  /** user-created tasks that are not from Jira */
  localTasks: LocalTask[]
  /** local completion overlay — never reflects or drives Jira's own status */
  doneItems: DoneItem[]
  widgetPosition: { x: number; y: number } | null
  /** persisted panel window size (legacy popup) */
  panelSize: { w: number; h: number } | null
  /** persisted main application window size */
  mainSize: { w: number; h: number } | null
  /** dashboard indicator toggles */
  dashboard: { stats: boolean; statuses: boolean; vpn: boolean }
  /** widget skin, glow effect and color thresholds */
  widgetAppearance: WidgetAppearance
  /**
   * Unsent form drafts, autosaved while typing so closing the panel (it's destroyed on
   * close) or quitting the app never loses written text. Cleared on successful submit.
   */
  drafts: {
    createAiText: string
    createSummary: string
    createDescription: string
    localTask: string
  }
  /**
   * AI assistant for drafting issue descriptions. Any OpenAI-compatible endpoint:
   * LM Studio local server (default, keyless) or OpenAI/OpenRouter/etc. The API key is
   * NOT here — it lives in the secret store, renderer only ever sees a has-key flag.
   */
  llm: { baseUrl: string; model: string; promptTemplate: string }
  /**
   * Coder-agent model + local project context (Настройки → Кодер-агент). Separate from the
   * task-drafting assistant: a dedicated code model (e.g. Qwen2.5-Coder-7B), the local git
   * repo it works against, and the IntelliJ IDEA launcher used to open files. The API key
   * (if any) lives in the secret store, not here.
   */
  coder: {
    baseUrl: string
    model: string
    repoPath: string
    ideaPath: string
    /** base branch for feature work (e.g. develop) and for hotfixes (e.g. main) */
    featureBase: string
    hotfixBase: string
    /** new-branch name templates; {key} = Jira issue key */
    branchFormat: string
    hotfixFormat: string
    /** git remote name for fetch/update */
    remote: string
  }
  /**
   * Optional feature toggles (Настройки → Функции). Turning one off hides its section from
   * the sidebar, command palette and widget — data/config is kept, so re-enabling restores it.
   */
  features: FeatureToggles
  /** Jira status automation driven by GitLab MR events (all off by default) */
  gitlabAutomation: GitlabAutomation
  /** warn this many days before the GitLab token expires (0 = don't warn) */
  gitlabTokenWarnDays: number
  /**
   * How approved MRs behave in «Ждут моего ревью»:
   *  - 'has'     — hide once I've approved at least once (stays hidden even if the approval later drops);
   *  - 'current' — hide only while my approval currently stands (returns if it's reset);
   *  - 'always'  — always show, even when approved.
   */
  gitlabReviewApprovalMode: 'has' | 'current' | 'always'
  /** favorite GitLab reviewers, persisted for quick selection when opening an MR */
  gitlabFavoriteReviewers: GitlabUser[]
  /** reviewers auto-selected on every new MR when available in the project */
  gitlabAutoReviewers: GitlabUser[]
  /** favorite GitLab projects, persisted for quick selection when opening an MR */
  gitlabFavoriteProjects: GitlabProject[]
  /**
   * Configurable status blocks for the «Задачи» section. Empty = legacy behavior
   * (priority/inbox/blocked tabs; counter = active non-blocked). When set, the «Блоки» view
   * groups issues by these blocks in order, and the widget counter sums the `counted` blocks.
   */
  taskBlocks: TaskBlock[]
  /** whether blocked issues are included in the widget task counter (default: excluded) */
  countBlocked: boolean
  /** issue keys marked as «текущая» (green highlight); auto-pruned when blocked/done */
  current: string[]
  /**
   * «Дополнительные поля» pinned as always-filled in the create form: field id → default
   * value (string, or string[] for multiselect). Key present = the field is shown by default
   * and pre-filled; the value can still be edited (edits update the saved default).
   */
  createFieldDefaults: Record<string, string | string[]>
  autostart: boolean
}

/** A named group of Jira statuses in the «Задачи» section. */
export interface TaskBlock {
  id: string
  name: string
  /** Jira status names in this block; the literal 'Своя задача' matches local tasks */
  statuses: string[]
  /** whether issues in this block count toward the widget task counter */
  counted: boolean
}

/** Which optional sections are enabled. Defaults to all true. */
export interface FeatureToggles {
  agent: boolean
  notifications: boolean
  history: boolean
  gitlab: boolean
}

/** Current git state of the chosen project folder. */
export interface GitInfo {
  ok: boolean
  isGit: boolean
  branch: string
  /** working tree has uncommitted changes */
  dirty: boolean
  error?: string
}

/** Result of creating a branch. Local only — never pushed. */
export interface BranchResult {
  ok: boolean
  branch?: string
  base?: string
  /** informational note, e.g. remote unavailable → used local base */
  note?: string
  error?: string
}

export interface AgentPatchResult {
  ok: boolean
  /** repo-relative files the retrieval step fed to the model */
  files?: string[]
  /** proposed unified diff (applied to the working tree only on explicit user action) */
  diff?: string
  error?: string
}

/** Result of applying the generated diff to the working tree. */
export interface ApplyResult {
  ok: boolean
  /** repo-relative files that were changed/created */
  files?: string[]
  error?: string
}

/** Result of a local commit. */
export interface CommitResult {
  ok: boolean
  /** short commit hash */
  hash?: string
  branch?: string
  error?: string
}

/** Uncommitted working-tree changes shown to the user (the "dirty" state). */
export interface GitDiffResult {
  ok: boolean
  /** unified diff of tracked staged+unstaged changes vs HEAD */
  diff?: string
  /** repo-relative untracked files (not in the diff) */
  untracked?: string[]
  error?: string
}

/** Result of pushing the branch to the remote (explicit-confirmation only). */
export interface PushResult {
  ok: boolean
  remote?: string
  branch?: string
  error?: string
}

export type WidgetSkin =
  | 'classic'
  | 'minimal'
  | 'neon'
  | 'gauge'
  | 'hex'
  | 'card'
  | 'image'
  | 'glass'
  | 'crt'
  | 'pixel'
  | 'gem'
  | 'donut'
  | 'mood'
  | 'weather'
  | 'particles'
  | 'digits'

/** Widget look & feel, configurable in Настройки → Виджет. */
export interface WidgetAppearance {
  skin: WidgetSkin
  /** color glow + pulse animations on the ring */
  glow: boolean
  /** active-task count at which each ring color starts (green below yellow) */
  thresholds: { yellow: number; orange: number; red: number }
  /** bumped whenever a new custom image is picked — tells the widget to refetch it */
  imageVersion: number
}

export interface CreateFieldOption {
  id: string
  label: string
}

/** A fillable field from Jira's create metadata, reduced to a renderable control. */
export interface CreateField {
  id: string
  name: string
  required: boolean
  control: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'multiselect' | 'labels'
  /** allowed values for select/multiselect, straight from Jira */
  options?: CreateFieldOption[]
}

export type NotificationType = 'new' | 'status' | 'due' | 'comment' | 'review' | 'token' | 'mr'

/** A single detected Jira event, shown in the «Уведомления» tab and (optionally) as a toast. */
export interface NotificationEvent {
  id: string
  type: NotificationType
  issueKey: string
  issueSummary: string
  /** human text, e.g. "To Do → In Progress" or "новый комментарий от Ivan" */
  text: string
  url: string
  /** ISO timestamp when detected */
  at: string
  read: boolean
}

/** Which events to surface, whether to collect at all, and whether to also push OS toasts. */
export interface NotificationSettings {
  /** master: collect events + blinking widget dot */
  enabled: boolean
  /** also show Windows toast notifications (off by default) */
  push: boolean
  newTasks: boolean
  statusChanges: boolean
  dueSoon: boolean
  comments: boolean
  /** hours-before-due that counts as "soon" */
  dueSoonHours: number
  /** auto-delete events older than this many days */
  retentionDays: number
}

export interface LlmGenerateResult {
  ok: boolean
  summary?: string
  description?: string
  error?: string
}

export interface DashboardData {
  vpn: boolean
  stats: {
    total: number
    byPriority: Record<number, number>
    blocked: number
    local: number
    doneToday: number
  }
  statuses: { name: string; count: number }[]
}

export type SlaLevel = 'none' | 'ok' | 'warn' | 'breach'

export interface SlaInfo {
  /** display name of the SLA, e.g. "Time to resolution" */
  name: string
  /** remaining time in milliseconds; negative means breached */
  remainingMs: number | null
  breached: boolean
  /** fraction of remaining goal time, 0..1; null if unknown */
  remainingFraction: number | null
  level: SlaLevel
}

export interface JiraTransition {
  id: string
  name: string
  toStatus: string
  /** statusCategory.key of the target: 'new' | 'indeterminate' | 'done' */
  toCategory?: string
  /** the configured QA field is required on this transition's screen — must be filled to proceed */
  requiresQa?: boolean
}

export interface JiraIssue {
  key: string
  summary: string
  status: string
  statusCategory: string
  issueType: string
  priority: string | null
  assignee: string | null
  dueDate: string | null
  updated: string
  url: string
  sla: SlaInfo | null
  /** user-assigned local priority (0 none .. 5 critical); display + sort only */
  localPriority: number
  /** locally marked as blocked */
  blocked: boolean
  /** local note describing what blocks it (shown on hover) */
  blockReason: string
  /** true for user-created local tasks (not from Jira) */
  isLocal: boolean
  /** true once locally marked done (see DoneItem — never reflects Jira's real status) */
  done: boolean
  /** ISO timestamp when marked done; null while active */
  doneAt: string | null
  /** locally marked as the current task (green highlight); auto-cleared when blocked/done */
  current?: boolean
  /** local, personal checklist for tracking progress; never synced to Jira/GitLab */
  checklist: ChecklistItem[]
}

/** One endpoint's result in the reviewer-lookup diagnostic. count === -1 means the call errored. */
export interface ReviewerDiag {
  source: string
  count: number
  found: boolean
  sample: string[]
  error?: string
}

/** Auto-update status pushed from main to the renderer (drives the update banner/button). */
export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'none' | 'error'
  /** version of the pending update (available/downloading/downloaded) */
  version?: string
  /** download progress 0..100 (downloading) */
  percent?: number
  /** error message (state === 'error') */
  error?: string
}

/** A single local progress item attached to a task. Purely local — never leaves the app. */
export interface ChecklistItem {
  id: string
  text: string
  done: boolean
  createdAt: string
}

export interface LocalTask {
  id: string
  summary: string
  createdAt: string
}

export interface HistoryItem {
  key: string
  summary: string
  isLocal: boolean
  url: string
  /** ISO timestamp when completed/resolved */
  doneAt: string
}

export interface ConnectionResult {
  ok: boolean
  displayName?: string
  accountId?: string
  error?: string
}

export interface SaveCredentialsInput {
  baseUrl: string
  email: string
  apiToken: string
}

// ---------------- GitLab integration ----------------

/** Public (secret-free) GitLab connection state for the renderer. */
export interface GitlabConfig {
  baseUrl: string
  /** Personal Access Token stored (flag only) */
  hasPat: boolean
  /** connected = base url + PAT present */
  connected: boolean
  displayName: string
  /** optional token expiry (YYYY-MM-DD); empty = not tracked */
  tokenExpiry: string
}

export interface GitlabCredentialsInput {
  baseUrl: string
  pat: string
  /** optional token expiry date (YYYY-MM-DD) */
  expiry?: string
}

/** A GitLab user reference (author / reviewer / member). */
export interface GitlabUser {
  id: number
  username: string
  name: string
}

/** A GitLab project the user is a member of. */
export interface GitlabProject {
  id: number
  pathWithNamespace: string
  webUrl: string
  defaultBranch: string
}

/** A merge request, in the app's normalized shape. Never carries merge/force actions. */
export interface GitlabMR {
  iid: number
  projectId: number
  title: string
  sourceBranch: string
  targetBranch: string
  webUrl: string
  author: string
  reviewers: string[]
  /** Jira key parsed from the title/source branch, or null if none found */
  jiraKey: string | null
  /** true once at least one approval is recorded (best-effort; may be undefined if unknown) */
  approved?: boolean
  updatedAt: string
}

export interface CreateMrInput {
  projectId: number
  sourceBranch: string
  targetBranch: string
  title: string
  description?: string
  reviewerIds: number[]
  assignSelf: boolean
}

export interface CreateMrResult {
  ok: boolean
  iid?: number
  webUrl?: string
  /** optional note, e.g. a Jira auto-transition outcome */
  note?: string
  error?: string
}

/**
 * Optional Jira status automation driven by GitLab MR events. Both off by default; the
 * status names are matched against the issue's workflow (multi-hop) so they must exist there.
 */
export interface GitlabAutomation {
  /** on MR creation, move the linked Jira issue to `readyToReviewStatus` */
  onMrCreated: boolean
  readyToReviewStatus: string
  /** on MR approval, move the linked Jira issue to `readyForTestStatus` */
  onMrApproved: boolean
  readyForTestStatus: string
}

export interface ActionResult {
  ok: boolean
  error?: string
  /** transition result: the issue was already in the target status, so nothing was changed */
  skipped?: boolean
}
