/**
 * Browser-only mock of the preload `window.api`, used by `npm run dev:web` to preview the
 * renderer UI without Electron. Never bundled into the Electron build.
 */
import type { JiraWidgetApi, IssuesPayload } from '../../preload'
import type { AppSettings, ChecklistItem, JiraIssue } from '@shared/types'

const now = Date.now()

let checklistSeq = 0
function ci(text: string, done: boolean): ChecklistItem {
  return { id: `ci-${++checklistSeq}`, text, done, createdAt: new Date(now).toISOString() }
}

const issues: JiraIssue[] = [
  {
    key: 'OPS-1421',
    summary: 'Падает синхронизация платежей в проде после деплоя',
    status: 'In Progress',
    statusCategory: 'indeterminate',
    issueType: 'Bug',
    priority: 'Highest',
    assignee: 'Aleksandr',
    dueDate: null,
    updated: new Date(now).toISOString(),
    url: 'https://example.atlassian.net/browse/OPS-1421',
    sla: { name: 'Time to resolution', remainingMs: 18 * 60000, breached: false, remainingFraction: 0.06, level: 'breach' },
    localPriority: 5,
    blocked: false,
    blockReason: '',
    isLocal: false,
    done: false,
    doneAt: null,
    checklist: [
      ci('Поднять стенд', true),
      ci('Воспроизвести баг', true),
      ci('Починить ретраи', false),
      ci('Написать тест', false),
      ci('Проверить на проде', false)
    ]
  },
  {
    key: 'OPS-1390',
    summary: 'Клиент не получает письмо со сбросом пароля',
    status: 'Waiting for support',
    statusCategory: 'new',
    issueType: 'Service Request',
    priority: 'High',
    assignee: 'Aleksandr',
    dueDate: null,
    updated: new Date(now).toISOString(),
    url: 'https://example.atlassian.net/browse/OPS-1390',
    sla: { name: 'Time to first response', remainingMs: 95 * 60000, breached: false, remainingFraction: 0.32, level: 'warn' },
    localPriority: 3,
    blocked: true,
    blockReason: 'Ждём доступ к почтовому шлюзу от админов',
    isLocal: false,
    done: false,
    doneAt: null,
    checklist: []
  },
  {
    key: 'OPS-1355',
    summary: 'Добавить экспорт отчёта в CSV',
    status: 'To Do',
    statusCategory: 'new',
    issueType: 'Task',
    priority: 'Medium',
    assignee: 'Aleksandr',
    dueDate: null,
    updated: new Date(now).toISOString(),
    url: 'https://example.atlassian.net/browse/OPS-1355',
    sla: { name: 'Time to resolution', remainingMs: 26 * 3600000, breached: false, remainingFraction: 0.78, level: 'ok' },
    localPriority: 0,
    blocked: false,
    blockReason: '',
    isLocal: false,
    done: false,
    doneAt: null,
    checklist: []
  },
  {
    key: 'local-demo',
    summary: 'Позвонить подрядчику по договору',
    status: 'Своя задача',
    statusCategory: 'new',
    issueType: 'Local',
    priority: null,
    assignee: null,
    dueDate: null,
    updated: new Date(now).toISOString(),
    url: '',
    sla: null,
    localPriority: 4,
    blocked: false,
    blockReason: '',
    isLocal: true,
    done: false,
    doneAt: null,
    checklist: [ci('Найти номер договора', true), ci('Согласовать сумму', false)]
  },
  {
    key: 'local-done-demo',
    summary: 'Отправил отчёт за неделю',
    status: 'Выполнено',
    statusCategory: 'done',
    issueType: 'Local',
    priority: null,
    assignee: null,
    dueDate: null,
    updated: new Date(now).toISOString(),
    url: '',
    sla: null,
    localPriority: 0,
    blocked: false,
    blockReason: '',
    isLocal: true,
    done: true,
    doneAt: new Date(now - 3600000).toISOString(),
    checklist: []
  },
  {
    // Demonstrates a Jira issue completed via the local "Завершить" overlay — it never
    // touched Jira's real status; it's just mirrored here so it doesn't vanish from view.
    key: 'OPS-1290',
    summary: 'Обновить сертификат для внутреннего API',
    status: 'Done',
    statusCategory: 'done',
    issueType: 'Task',
    priority: null,
    assignee: null,
    dueDate: null,
    updated: new Date(now - 1800000).toISOString(),
    url: 'https://example.atlassian.net/browse/OPS-1290',
    sla: null,
    localPriority: 0,
    blocked: false,
    blockReason: '',
    isLocal: false,
    done: true,
    doneAt: new Date(now - 1800000).toISOString(),
    checklist: []
  }
]

const settings: AppSettings = {
  pollIntervalMinutes: 3,
  jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC',
  defaultView: 'prioritized',
  jiraProjectKey: 'OSE',
  implementerFieldLabel: 'Исполнитель',
  myFieldLabel: 'Исполнитель',
  myFieldIncludeAssignee: true,
  onboardingDone: true,
  userName: 'Александр',
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
  archived: [
    {
      key: 'OPS-1101',
      summary: 'Старый тикет про миграцию логов',
      status: 'Done',
      url: 'https://example.atlassian.net/browse/OPS-1101',
      archivedAt: new Date(now - 86400000).toISOString()
    }
  ],
  priorities: { 'OPS-1421': 5, 'OPS-1390': 3 },
  blocked: { 'OPS-1390': 'Ждём доступ к почтовому шлюзу от админов' },
  checklists: {},
  localTasks: [
    {
      id: 'local-demo',
      summary: 'Позвонить подрядчику по договору',
      createdAt: new Date(now).toISOString()
    }
  ],
  doneItems: [
    {
      key: 'local-done-demo',
      summary: 'Отправил отчёт за неделю',
      status: 'Выполнено',
      url: '',
      isLocal: true,
      doneAt: new Date(now - 3600000).toISOString()
    },
    {
      key: 'OPS-1290',
      summary: 'Обновить сертификат для внутреннего API',
      status: 'Done',
      url: 'https://example.atlassian.net/browse/OPS-1290',
      isLocal: false,
      doneAt: new Date(now - 1800000).toISOString()
    }
  ],
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
  llm: {
    baseUrl: 'http://localhost:1234/v1',
    model: '',
    promptTemplate: '*Цель:*\n…\n\n*Критерии приёмки:*\n…'
  },
  coder: {
    baseUrl: 'http://localhost:1234/v1',
    model: 'qwen2.5-coder-7b-instruct',
    repoPath: 'C:/work/my-project',
    ideaPath: '',
    featureBase: 'develop',
    hotfixBase: 'main',
    branchFormat: 'feature/{key}',
    hotfixFormat: 'hotfix/{key}',
    remote: 'origin'
  },
  features: { agent: true, notifications: true, history: true, gitlab: true },
  gitlabAutomation: {
    onMrCreated: false,
    readyToReviewStatus: 'Ready to Review',
    onMrApproved: false,
    readyForTestStatus: 'Ready for Test'
  },
  gitlabTokenWarnDays: 7,
  gitlabReviewApprovalMode: 'current' as const,
  gitlabFavoriteReviewers: [{ id: 12, username: 'a.smirnova', name: 'Анна Смирнова' }],
  gitlabAutoReviewers: [{ id: 12, username: 'a.smirnova', name: 'Анна Смирнова' }],
  gitlabFavoriteProjects: [
    { id: 101, pathWithNamespace: 'demo/web-app', webUrl: 'https://gitlab.example.com/demo/web-app', defaultBranch: 'develop' }
  ],
  taskBlocks: [],
  countBlocked: false,
  current: [],
  createFieldDefaults: {},
  autostart: false
}

let mockEvents = [
  { id: 'e1', type: 'new' as const, issueKey: 'OPS-1500', issueSummary: 'Настроить алерты в Grafana', text: 'новая задача', url: 'https://example.atlassian.net/browse/OPS-1500', at: new Date(now - 60000).toISOString(), read: false },
  { id: 'e2', type: 'comment' as const, issueKey: 'OPS-1421', issueSummary: 'Падает синхронизация платежей в проде после деплоя', text: 'новый комментарий от Ivan', url: 'https://example.atlassian.net/browse/OPS-1421', at: new Date(now - 900000).toISOString(), read: false },
  { id: 'e3', type: 'status' as const, issueKey: 'OPS-1390', issueSummary: 'Клиент не получает письмо со сбросом пароля', text: 'To Do → In Progress', url: 'https://example.atlassian.net/browse/OPS-1390', at: new Date(now - 3600000).toISOString(), read: true },
  { id: 'e4', type: 'due' as const, issueKey: 'OPS-1355', issueSummary: 'Добавить экспорт отчёта в CSV', text: 'срок просрочен', url: 'https://example.atlassian.net/browse/OPS-1355', at: new Date(now - 7200000).toISOString(), read: true }
]

function unreadEventCount(): number {
  return settings.notifications.enabled ? mockEvents.filter((e) => !e.read).length : 0
}

// Dev-only: simulate a connectivity failure to exercise the widget's "no network" glyph.
let mockNetError = false

function currentPayload(): IssuesPayload {
  const marked = new Set(settings.current)
  const withCurrent = issues.map((i) => ({
    ...i,
    current: marked.has(i.key) && !i.blocked && !i.done && i.statusCategory !== 'done'
  }))
  return {
    issues: withCurrent,
    error: null,
    vpn: true,
    showStats: true,
    appearance: settings.widgetAppearance,
    unreadEvents: unreadEventCount(),
    countedStatuses: (() => {
      const c = settings.taskBlocks.filter((b) => b.counted).flatMap((b) => b.statuses)
      return c.length ? [...new Set(c)] : null
    })(),
    countBlocked: settings.countBlocked,
    netError: mockNetError
  }
}

// Live subscribers (the widget) — notified on settings changes so appearance edits apply
// in the preview just like the real rebroadcast does.
const issueSubs = new Set<(p: IssuesPayload) => void>()

// Dev-only test hook: window.__mockSetNetError(true/false) to preview the widget's net-error state.
;(globalThis as unknown as Record<string, unknown>).__mockSetNetError = (v: boolean): void => {
  mockNetError = v
  issueSubs.forEach((cb) => cb(currentPayload()))
}

let mockWidgetImage: string | null = null

const api: JiraWidgetApi = {
  getConfig: async () => ({
    authMode: 'oauth',
    baseUrl: 'https://example.atlassian.net',
    email: 'you@example.com',
    hasToken: true,
    oauth: {
      redirectUri: 'http://localhost:53682/callback',
      hasClientId: true,
      hasSecret: true,
      connected: false,
      siteUrl: '',
      cloudId: '',
      displayName: ''
    },
    server: {
      baseUrl: 'https://jira.example.com',
      hasPat: true,
      connected: true,
      displayName: 'Aleksandr Z.'
    }
  }),
  saveCredentials: async () => ({ ok: true, displayName: 'Aleksandr Z.' }),
  clearCredentials: async () => ({ ok: true }),
  testConnection: async () => ({ ok: true, displayName: 'Aleksandr Z.', accountId: '123' }),
  startOAuth: async () => ({ ok: true, displayName: 'Aleksandr Z.' }),
  oauthDisconnect: async () => ({ ok: true }),
  testServer: async () => ({ ok: true, displayName: 'Aleksandr Z.' }),
  saveServer: async () => ({ ok: true, displayName: 'Aleksandr Z.' }),
  serverDisconnect: async () => ({ ok: true }),
  getSettings: async () => settings,
  updateSettings: async (patch) => {
    Object.assign(settings, patch)
    const p = currentPayload()
    issueSubs.forEach((cb) => cb(p))
    // Fresh object each call — matches the real main process (getSettings()) so React
    // re-renders on every change (the same-reference return suppressed updates).
    return { ...settings }
  },
  getIssues: async () => currentPayload(),
  refreshIssues: async () => currentPayload(),
  getTransitions: async () => [
    { id: '21', name: 'Start Progress', toStatus: 'In Progress' },
    { id: '31', name: 'Resolve', toStatus: 'Done' }
  ],
  doTransition: async () => ({ ok: true }),
  getStatuses: async () => ['To Do', 'In Progress', 'In Review', 'Done'],
  // Pretend the issue is already "In Progress" so picking it exercises the skip path.
  transitionTo: async (_key: string, status: string) =>
    status === 'In Progress' ? { ok: true, skipped: true } : { ok: true },
  addComment: async () => ({ ok: true }),
  openInBrowser: async () => ({ ok: true }),
  copyText: async () => ({ ok: true }),
  archive: async () => ({ ok: true }),
  unarchive: async () => ({ ok: true }),
  setPriority: async () => ({ ok: true }),
  setBlocked: async () => ({ ok: true }),
  setCurrent: async (key: string, on: boolean) => {
    const set = new Set(settings.current)
    if (on) set.add(key)
    else set.delete(key)
    settings.current = [...set]
    issueSubs.forEach((cb) => cb(currentPayload()))
    return { ok: true }
  },
  setChecklist: async (key: string, items: ChecklistItem[]) => {
    const issue = issues.find((i) => i.key === key)
    if (issue) issue.checklist = items
    issueSubs.forEach((cb) => cb(currentPayload()))
    return { ok: true }
  },
  addLocalTask: async () => ({ ok: true }),
  updateLocalTask: async () => ({ ok: true }),
  deleteLocalTask: async () => ({ ok: true }),
  setLocalDone: async () => ({ ok: true }),
  getDashboard: async () => ({
    vpn: true,
    stats: { total: 4, byPriority: { 0: 1, 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 }, blocked: 1, local: 1, doneToday: 2 },
    statuses: [
      { name: 'In Progress', count: 1 },
      { name: 'To Do', count: 1 },
      { name: 'Waiting for support', count: 1 },
      { name: 'Своя задача', count: 1 }
    ]
  }),
  getHistory: async () => [
    { key: 'OPS-1300', summary: 'Починил выгрузку отчётов', isLocal: false, url: 'https://example.atlassian.net/browse/OPS-1300', doneAt: new Date(now).toISOString() },
    { key: 'local-x', summary: 'Сходил на встречу с командой', isLocal: true, url: '', doneAt: new Date(now).toISOString() }
  ],
  openSettings: async () => {},
  closeOnboarding: async () => {},
  getEvents: async () => mockEvents,
  markEventsRead: async () => {
    mockEvents = mockEvents.map((e) => ({ ...e, read: true }))
    const p = currentPayload()
    issueSubs.forEach((cb) => cb(p))
    return { ok: true }
  },
  clearEvents: async () => {
    mockEvents = []
    const p = currentPayload()
    issueSubs.forEach((cb) => cb(p))
    return { ok: true }
  },
  openPanel: async () => {},
  getProjects: async () => ({
    ok: true,
    projects: [
      { key: 'OSE', name: 'Operations & Support' },
      { key: 'DEV', name: 'Development' },
      { key: 'INFRA', name: 'Infrastructure' }
    ]
  }),
  getProjectIssueTypes: async () => ({
    ok: true,
    project: { key: 'OSE', name: 'Operations & Support' },
    types: [
      { id: '10001', name: 'Task' },
      { id: '10002', name: 'Bug' },
      { id: '10003', name: 'Story' }
    ]
  }),
  getProjectStatuses: async () => [
    'New',
    'Backlog',
    'Needs Grooming',
    'In Progress',
    'Code Review',
    'Ready For Test',
    'Testing',
    'Ready To Release',
    'Merged',
    'Done',
    'Declined'
  ],
  getCreateFields: async () => ({
    ok: true,
    fields: [
      {
        id: 'priority',
        name: 'Priority',
        required: true,
        control: 'select' as const,
        options: [
          { id: '1', label: 'Highest' },
          { id: '3', label: 'Medium' },
          { id: '5', label: 'Lowest' }
        ]
      },
      {
        id: 'customfield_100',
        name: 'Компоненты',
        required: false,
        control: 'multiselect' as const,
        options: [
          { id: '10', label: 'Billing' },
          { id: '11', label: 'WMS' },
          { id: '12', label: 'Auth' }
        ]
      },
      { id: 'duedate', name: 'Due date', required: false, control: 'date' as const },
      { id: 'labels', name: 'Labels', required: false, control: 'labels' as const },
      { id: 'customfield_200', name: 'Story Points', required: false, control: 'number' as const },
      { id: 'customfield_300', name: 'Ссылка на дашборд', required: false, control: 'text' as const }
    ]
  }),
  createIssue: async () => ({ ok: true, key: 'OSE-9999' }),
  assignToMe: async () => ({ ok: true }),
  pickWidgetImage: async () => {
    mockWidgetImage =
      'data:image/svg+xml;base64,' +
      btoa(
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3b2f63"/><stop offset="1" stop-color="#0b3a4a"/></linearGradient></defs><rect width="120" height="120" fill="url(#g)"/><circle cx="90" cy="30" r="18" fill="#f2cd60" opacity="0.9"/></svg>'
      )
    settings.widgetAppearance = {
      ...settings.widgetAppearance,
      skin: 'image',
      imageVersion: settings.widgetAppearance.imageVersion + 1
    }
    const p = currentPayload()
    issueSubs.forEach((cb) => cb(p))
    return { ok: true }
  },
  clearWidgetImage: async () => {
    mockWidgetImage = null
    settings.widgetAppearance = {
      ...settings.widgetAppearance,
      skin: 'classic',
      imageVersion: settings.widgetAppearance.imageVersion + 1
    }
    const p = currentPayload()
    issueSubs.forEach((cb) => cb(p))
    return { ok: true }
  },
  getWidgetImage: async () => ({ dataUrl: mockWidgetImage }),
  llmGenerate: async (userText: string) => ({
    ok: true,
    summary: `Задача: ${userText.slice(0, 40)}`,
    description: `*Цель:*\n${userText}\n\n*Критерии приёмки:*\nуточнить`
  }),
  llmRefine: async (instruction: string, current: { summary: string; description: string }) => ({
    ok: true,
    summary: current.summary,
    description: `${current.description}\n\n[правка: ${instruction}]`
  }),
  llmSetKey: async () => ({ ok: true }),
  llmGetStatus: async () => ({ hasKey: false }),
  llmTest: async () => ({ ok: true }),
  agentGeneratePatch: async (taskText: string) => ({
    ok: true,
    files: ['src/main/billing/index.ts', 'src/shared/types.ts'],
    diff: `diff --git a/src/main/billing/index.ts b/src/main/billing/index.ts\n@@ -10,6 +10,9 @@\n   const rows = await db.query(sql)\n+  // ${taskText.slice(0, 40)}\n+  const idx = createIndex(rows)\n-  return rows\n+  return idx`
  }),
  agentOpenInIdea: async () => ({ ok: true }),
  agentSetCoderKey: async () => ({ ok: true }),
  agentTestCoder: async () => ({ ok: true }),
  agentPickRepo: async () => ({ ok: true, path: 'C:/work/picked-project' }),
  agentPickIdea: async () => ({ ok: true, path: 'C:/Program Files/JetBrains/idea64.exe' }),
  getIssueDescription: async (key: string) =>
    `h3. Проблема
После деплоя *падает* синхронизация платежей в _проде_. Ошибка в методе {{syncPayments()}}.

h3. Шаги воспроизведения
* Открыть сервис биллинга
* Запустить синхронизацию
* Увидеть ошибку в логах

Пример ошибки:
{code:java}
TimeoutException: payment gateway did not respond
    at BillingSync.run(BillingSync.java:42)
{code}

Задача ${key}. Подробнее: [тикет|https://example.atlassian.net/browse/${key}].`,
  getIssueSummary: async (key: string) =>
    key === 'OPS-1421' ? 'Падает синхронизация платежей в проде после деплоя' : '',
  gitlabBranchCommitTitle: async (_p: number, branch: string) =>
    `chore: работа над веткой ${branch}`,
  agentGitInfo: async () => ({ ok: true, isGit: true, branch: 'develop', dirty: true }),
  agentGitDiff: async () => ({
    ok: true,
    diff: [
      'diff --git a/src/config.ts b/src/config.ts',
      '--- a/src/config.ts',
      '+++ b/src/config.ts',
      '@@ -1,3 +1,3 @@',
      ' export const config = {',
      "-  timeout: 3000",
      "+  timeout: 5000",
      ' }'
    ].join('\n'),
    untracked: ['src/scratch.ts']
  }),
  agentCreateBranch: async (input: { name: string; base: string }) => ({
    ok: true,
    branch: input.name,
    base: `origin/${input.base}`
  }),
  agentApplyPatch: async () => ({
    ok: true,
    files: ['src/services/billing.ts', 'src/services/billing.test.ts']
  }),
  agentCommit: async (input: { message: string }) => ({
    ok: true,
    hash: 'a1b2c3d',
    branch: 'feature/OPS-1421',
    message: input.message
  }),
  agentPush: async (input: { remote: string; branch: string }) => ({
    ok: true,
    remote: input.remote,
    branch: input.branch
  }),

  // ---- GitLab mocks ----
  gitlabConfig: async () => ({
    baseUrl: 'https://gitlab.example.com',
    hasPat: true,
    connected: true,
    displayName: 'Пётр Иванов',
    tokenExpiry: '2026-08-12'
  }),
  gitlabTest: async () => ({ ok: true, displayName: 'Пётр Иванов' }),
  gitlabSave: async () => ({ ok: true, displayName: 'Пётр Иванов' }),
  gitlabSetExpiry: async () => ({ ok: true }),
  gitlabDisconnect: async () => ({ ok: true }),
  gitlabProjects: async () => [
    { id: 101, pathWithNamespace: 'demo/web-app', webUrl: 'https://gitlab.example.com/demo/web-app', defaultBranch: 'develop' },
    { id: 102, pathWithNamespace: 'demo/api', webUrl: 'https://gitlab.example.com/demo/api', defaultBranch: 'main' }
  ],
  gitlabBranches: async () => ['develop', 'main', 'feature/OPS-1421', 'release/2.4'],
  gitlabMembers: async (_projectId: number, search?: string) => {
    const base = [
      { id: 11, username: 'i.petrov', name: 'Иван Петров' },
      { id: 12, username: 'a.smirnova', name: 'Анна Смирнова' },
      { id: 13, username: 'd.kim', name: 'Дмитрий Ким' }
    ]
    // Simulates a colleague reachable only via a group search — absent from the default list.
    const groupOnly = [{ id: 14, username: 's.orlov', name: 'Сергей Орлов' }]
    const q = search?.trim().toLowerCase()
    if (!q) return base
    return [...base, ...groupOnly].filter(
      (u) => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
    )
  },
  gitlabResolveUser: async (username: string) => {
    // Simulates a colleague findable only by exact @login (not in any member list).
    const u = username.trim().replace(/^@/, '').toLowerCase()
    const known = [{ id: 15, username: 'a.vasilevskii', name: 'Anton Vasilevskii' }]
    return known.find((k) => k.username.toLowerCase() === u) ?? null
  },
  gitlabDiagnoseReviewer: async (_projectId: number, query: string) => {
    const q = query.trim().replace(/^@/, '').toLowerCase()
    const hit = q === 'a.vasilevskii'
    return [
      { source: 'members/all', count: 3, found: false, sample: ['Иван Петров @i.petrov'] },
      { source: 'project users', count: 3, found: false, sample: [] },
      { source: 'group members', count: 0, found: false, sample: [] },
      { source: 'autocomplete', count: -1, found: false, sample: [], error: 'HTTP 302 (non-JSON)' },
      { source: 'users?search', count: 0, found: false, sample: [] },
      {
        source: 'users?username',
        count: hit ? 1 : 0,
        found: hit,
        sample: hit ? ['Anton Vasilevskii @a.vasilevskii'] : []
      }
    ]
  },
  gitlabCreateMR: async () => {
    const auto = settings.gitlabAutomation
    let note: string | undefined
    if (auto.onMrCreated && auto.readyToReviewStatus.trim()) {
      const status = auto.readyToReviewStatus.trim()
      note = `OPS-1421 → «${status}» ✓`
      mockEvents = [
        {
          id: `auto-${Date.now()}`,
          type: 'status' as const,
          issueKey: 'OPS-1421',
          issueSummary: 'Автопереход: создание MR',
          text: `→ «${status}» (авто: создание MR)`,
          url: '',
          at: new Date().toISOString(),
          read: false
        },
        ...mockEvents
      ]
      const p = currentPayload()
      issueSubs.forEach((cb) => cb(p))
    }
    return {
      ok: true,
      iid: 42,
      webUrl: 'https://gitlab.example.com/demo/web-app/-/merge_requests/42',
      note
    }
  },
  gitlabMyReviews: async () => [
    { iid: 77, projectId: 101, title: 'feat(OPS-1390): reset-password email', sourceBranch: 'feature/OPS-1390', targetBranch: 'develop', webUrl: 'https://gitlab.example.com/demo/web-app/-/merge_requests/77', author: 'Иван Петров', reviewers: ['Пётр Иванов'], jiraKey: 'OPS-1390', approved: false, updatedAt: new Date(now - 3600000).toISOString() }
  ],
  gitlabMyMRs: async () => [
    { iid: 42, projectId: 101, title: 'feat(OPS-1421): fix billing sync', sourceBranch: 'feature/OPS-1421', targetBranch: 'develop', webUrl: 'https://gitlab.example.com/demo/web-app/-/merge_requests/42', author: 'Пётр Иванов', reviewers: ['Анна Смирнова'], jiraKey: 'OPS-1421', approved: true, updatedAt: new Date(now - 1800000).toISOString() }
  ],
  gitlabDetectProject: async () => ({ id: 101, pathWithNamespace: 'demo/web-app', webUrl: 'https://gitlab.example.com/demo/web-app', defaultBranch: 'develop' }),

  closePanel: async () => {},
  widgetDragStart: () => {},
  widgetDragMove: () => {},
  widgetDragEnd: () => {},
  widgetSetInteractive: () => {},
  hideWidget: async () => {},
  onIssuesUpdated: (cb) => {
    issueSubs.add(cb)
    return () => issueSubs.delete(cb)
  },
  onSwitchView: () => () => {},
  // auto-update (mock): pretend a new version is already downloaded so the banner shows.
  getUpdateStatus: async () => ({ state: 'downloaded' as const, version: '0.2.0' }),
  checkForUpdates: async () => ({ ok: true }),
  installUpdate: async () => {
    // eslint-disable-next-line no-alert
    alert('mock: quitAndInstall — приложение бы перезапустилось на новую версию')
    return { ok: true }
  },
  onUpdateStatus: () => () => {}
}

window.api = api
