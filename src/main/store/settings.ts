import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { AppSettings, ArchivedItem, ChecklistItem, DoneItem, LocalTask } from '@shared/types'

const DEFAULT_JQL = 'assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC'

export const DEFAULT_LLM_TEMPLATE = `*Цель:*
(зачем это нужно, какую проблему решает)

*Контекст:*
(что известно, где происходит, ссылки/системы)

*Что сделать:*
(конкретные шаги или изменения)

*Критерии приёмки:*
(как поймём, что задача выполнена)`

const DEFAULT_FEATURES: AppSettings['features'] = {
  agent: true,
  notifications: true,
  history: true,
  gitlab: true
}

const DEFAULT_GITLAB_AUTOMATION: AppSettings['gitlabAutomation'] = {
  onMrCreated: false,
  readyToReviewStatus: 'Ready to Review',
  onMrApproved: false,
  readyForTestStatus: 'Ready for Test'
}

const DEFAULT_CODER: AppSettings['coder'] = {
  baseUrl: 'http://localhost:1234/v1',
  model: 'qwen2.5-coder-7b-instruct',
  repoPath: '',
  ideaPath: '',
  featureBase: 'develop',
  hotfixBase: 'main',
  branchFormat: 'feature/{key}',
  hotfixFormat: 'hotfix/{key}',
  remote: 'origin'
}

const store = new Store<AppSettings>({
  name: 'jira-settings',
  defaults: {
    pollIntervalMinutes: 3,
    jql: DEFAULT_JQL,
    defaultView: 'prioritized',
    jiraProjectKey: '',
    implementerFieldLabel: '',
    qaFieldLabel: 'QA',
    qaTriggerStatus: 'Testing',
    myFieldLabel: '',
    myFieldIncludeAssignee: true,
    onboardingDone: false,
    userName: '',
    theme: 'dark',
    notifications: {
      enabled: true,
      push: false,
      newTasks: true,
      statusChanges: true,
      dueSoon: true,
      comments: true,
      dueSoonHours: 24,
      retentionDays: 7
    },
    archived: [],
    priorities: {},
    blocked: {},
    checklists: {},
    localTasks: [],
    doneItems: [],
    widgetPosition: null,
    panelSize: null,
    mainSize: null,
    dashboard: { stats: true, statuses: true, vpn: true },
    widgetAppearance: {
      skin: 'classic',
      glow: true,
      thresholds: { yellow: 3, orange: 6, red: 9 },
      imageVersion: 0
    },
    drafts: { createAiText: '', createSummary: '', createDescription: '', localTask: '' },
    llm: { baseUrl: 'http://localhost:1234/v1', model: '', promptTemplate: DEFAULT_LLM_TEMPLATE },
    coder: DEFAULT_CODER,
    features: DEFAULT_FEATURES,
    gitlabAutomation: DEFAULT_GITLAB_AUTOMATION,
    gitlabTokenWarnDays: 7,
    gitlabReviewApprovalMode: 'current',
    gitlabFavoriteReviewers: [],
    gitlabAutoReviewers: [],
    gitlabFavoriteProjects: [],
    taskBlocks: [],
    countBlocked: false,
    current: [],
    createFieldDefaults: {},
    autostart: false
  }
})

// Internal bookkeeping (not part of AppSettings / never exposed to the renderer): the set of
// Jira keys we've seen in the last successful "my issues" fetch, so we can notice when one
// silently drops out because it transitioned to Done in Jira (see markKeyDone callers).
const trackedStore = new Store<{ keys: string[] }>({ name: 'jira-tracked-keys', defaults: { keys: [] } })

export function getTrackedJiraKeys(): string[] {
  return trackedStore.get('keys')
}

export function setTrackedJiraKeys(keys: string[]): void {
  // Hard cap as a safety net against unbounded growth.
  trackedStore.set('keys', keys.slice(0, 300))
}

// GitLab MRs whose approval we've already acted on (auto-transition + notification). Persisted
// so a restart doesn't re-fire the same event over and over. Keyed "projectId:iid".
const gitlabStateStore = new Store<{ approvedMrs: string[]; reviewApproved: string[] }>({
  name: 'gitlab-state',
  defaults: { approvedMrs: [], reviewApproved: [] }
})

export function getHandledApprovedMrs(): string[] {
  return gitlabStateStore.get('approvedMrs')
}

export function addHandledApprovedMr(key: string): void {
  const set = new Set(gitlabStateStore.get('approvedMrs'))
  set.add(key)
  gitlabStateStore.set('approvedMrs', [...set].slice(-500))
}

// Review MRs I've approved at least once (keyed "projectId:iid") — for the 'has' review mode,
// so they stay hidden even if the approval is later reset.
export function getReviewApprovedSeen(): string[] {
  return gitlabStateStore.get('reviewApproved') ?? []
}

export function addReviewApprovedSeen(keys: string[]): void {
  if (keys.length === 0) return
  const set = new Set(gitlabStateStore.get('reviewApproved') ?? [])
  for (const k of keys) set.add(k)
  gitlabStateStore.set('reviewApproved', [...set].slice(-500))
}

export function getSettings(): AppSettings {
  return {
    pollIntervalMinutes: store.get('pollIntervalMinutes'),
    jql: store.get('jql'),
    defaultView: store.get('defaultView'),
    jiraProjectKey: store.get('jiraProjectKey'),
    implementerFieldLabel: store.get('implementerFieldLabel'),
    qaFieldLabel: store.get('qaFieldLabel') ?? 'QA',
    qaTriggerStatus: store.get('qaTriggerStatus') ?? 'Testing',
    myFieldLabel: store.get('myFieldLabel'),
    myFieldIncludeAssignee: store.get('myFieldIncludeAssignee'),
    onboardingDone: store.get('onboardingDone'),
    userName: store.get('userName'),
    theme: store.get('theme'),
    notifications: store.get('notifications'),
    archived: store.get('archived'),
    priorities: store.get('priorities'),
    blocked: store.get('blocked'),
    checklists: store.get('checklists') ?? {},
    localTasks: store.get('localTasks'),
    doneItems: store.get('doneItems'),
    widgetPosition: store.get('widgetPosition'),
    panelSize: store.get('panelSize'),
    mainSize: store.get('mainSize'),
    dashboard: store.get('dashboard'),
    widgetAppearance: store.get('widgetAppearance'),
    drafts: store.get('drafts'),
    llm: store.get('llm'),
    // Merge defaults so older stored `coder` objects (without the branch fields) stay valid.
    coder: { ...DEFAULT_CODER, ...store.get('coder') },
    // Merge defaults so settings saved before feature toggles existed default to "all on".
    features: { ...DEFAULT_FEATURES, ...store.get('features') },
    gitlabAutomation: { ...DEFAULT_GITLAB_AUTOMATION, ...store.get('gitlabAutomation') },
    gitlabTokenWarnDays: store.get('gitlabTokenWarnDays') ?? 7,
    gitlabReviewApprovalMode: store.get('gitlabReviewApprovalMode') ?? 'current',
    gitlabFavoriteReviewers: store.get('gitlabFavoriteReviewers') ?? [],
    gitlabAutoReviewers: store.get('gitlabAutoReviewers') ?? [],
    gitlabFavoriteProjects: store.get('gitlabFavoriteProjects') ?? [],
    taskBlocks: store.get('taskBlocks') ?? [],
    countBlocked: store.get('countBlocked') ?? false,
    current: store.get('current') ?? [],
    createFieldDefaults: store.get('createFieldDefaults') ?? {},
    autostart: store.get('autostart')
  }
}

export function getLocalTasks(): LocalTask[] {
  return store.get('localTasks')
}

export function addLocalTask(summary: string, priority: number): LocalTask {
  const task: LocalTask = {
    id: `local-${randomUUID()}`,
    summary: summary.trim(),
    createdAt: new Date().toISOString()
  }
  store.set('localTasks', [task, ...store.get('localTasks')])
  if (priority > 0) setPriority(task.id, priority)
  return task
}

export function updateLocalTask(id: string, summary: string): void {
  store.set(
    'localTasks',
    store.get('localTasks').map((t) => (t.id === id ? { ...t, summary: summary.trim() } : t))
  )
}

export function deleteLocalTask(id: string): void {
  store.set(
    'localTasks',
    store.get('localTasks').filter((t) => t.id !== id)
  )
  store.set(
    'doneItems',
    store.get('doneItems').filter((d) => d.key !== id)
  )
  // Clean up the associated local state.
  setPriority(id, 0)
  setBlocked(id, '')
  setChecklist(id, [])
}

// ---------------- completion overlay (local-only, never touches Jira) ----------------

export function getDoneItems(): DoneItem[] {
  return store.get('doneItems')
}

export function isKeyDone(key: string): boolean {
  return store.get('doneItems').some((d) => d.key === key)
}

/** Mark a key done (local task or Jira issue). Local tasks move out of the active list. */
export function markKeyDone(item: DoneItem): AppSettings {
  const rest = store.get('doneItems').filter((d) => d.key !== item.key)
  store.set('doneItems', [item, ...rest])
  if (item.isLocal) {
    store.set(
      'localTasks',
      store.get('localTasks').filter((t) => t.id !== item.key)
    )
  }
  return getSettings()
}

/** Undo a completion. For a local task this re-creates it as an active task. */
export function unmarkKeyDone(key: string): AppSettings {
  const item = store.get('doneItems').find((d) => d.key === key)
  store.set(
    'doneItems',
    store.get('doneItems').filter((d) => d.key !== key)
  )
  if (item?.isLocal) {
    store.set('localTasks', [
      { id: item.key, summary: item.summary, createdAt: new Date().toISOString() },
      ...store.get('localTasks')
    ])
  }
  return getSettings()
}

// ---------------- «текущая» overlay (local-only) ----------------
export function getCurrentKeys(): string[] {
  return store.get('current')
}

/** Overwrite the set of current keys (used by the auto-prune of blocked/done tasks). */
export function setCurrentKeys(keys: string[]): void {
  store.set('current', keys)
}

/** Toggle a task's «current» mark. */
export function setCurrent(key: string, on: boolean): AppSettings {
  const set = new Set(store.get('current'))
  if (on) set.add(key)
  else set.delete(key)
  store.set('current', [...set])
  return getSettings()
}

/** Local day (YYYY-MM-DD) of an ISO timestamp, in the machine's timezone. */
export function localDayOf(iso: string): string {
  const d = new Date(iso)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Locally-completed items (local tasks or locally-marked Jira issues) for a given date. */
export function doneItemsOn(date: string): DoneItem[] {
  return store.get('doneItems').filter((d) => localDayOf(d.doneAt) === date)
}

export function getPriority(key: string): number {
  return store.get('priorities')[key] ?? 0
}

/** Set a local priority (0 removes the override). */
export function setPriority(key: string, level: number): AppSettings {
  const map = { ...store.get('priorities') }
  if (level <= 0) delete map[key]
  else map[key] = level
  store.set('priorities', map)
  return getSettings()
}

export function getBlocked(key: string): string | null {
  return store.get('blocked')[key] ?? null
}

/** Mark/unmark blocked with a reason. Empty reason clears the block. */
export function setBlocked(key: string, reason: string): AppSettings {
  const map = { ...store.get('blocked') }
  const trimmed = reason.trim()
  if (!trimmed) delete map[key]
  else map[key] = trimmed
  store.set('blocked', map)
  return getSettings()
}

// ---------------- checklist overlay (local-only, never touches Jira/GitLab) ----------------

export function getChecklist(key: string): ChecklistItem[] {
  return (store.get('checklists') ?? {})[key] ?? []
}

/** Replace a task's whole checklist. An empty array removes the entry entirely. */
export function setChecklist(key: string, items: ChecklistItem[]): AppSettings {
  const map = { ...(store.get('checklists') ?? {}) }
  if (!items.length) delete map[key]
  else map[key] = items
  store.set('checklists', map)
  return getSettings()
}

export function updateSettings(patch: Partial<AppSettings>): AppSettings {
  for (const [k, v] of Object.entries(patch)) {
    store.set(k as keyof AppSettings, v as never)
  }
  return getSettings()
}

/** Archive an issue with a snapshot for later display/search (newest first, deduped by key). */
export function archiveItem(item: ArchivedItem): AppSettings {
  const rest = store.get('archived').filter((a) => a.key !== item.key)
  store.set('archived', [item, ...rest])
  return getSettings()
}

export function unarchiveKey(key: string): AppSettings {
  store.set(
    'archived',
    store.get('archived').filter((a) => a.key !== key)
  )
  return getSettings()
}

export function isArchived(key: string): boolean {
  return store.get('archived').some((a) => a.key === key)
}
