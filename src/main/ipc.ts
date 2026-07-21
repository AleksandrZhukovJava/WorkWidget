import { ipcMain, shell, app, clipboard, dialog } from 'electron'
import { promises as fsp } from 'node:fs'
import { join, extname } from 'node:path'
import { IPC } from '@shared/ipc'
import {
  getPublicConfig,
  saveCredentials,
  clearCredentials,
  clearOAuthSession,
  saveServerCredentials,
  clearServerCredentials
} from './store/credentials'
import { startLoginFlow, disconnect as oauthDisconnectCache } from './jira/oauth'
import {
  getSettings,
  updateSettings,
  archiveItem,
  unarchiveKey,
  setPriority,
  setBlocked,
  setCurrent,
  setChecklist,
  addLocalTask,
  updateLocalTask,
  deleteLocalTask,
  markKeyDone,
  unmarkKeyDone
} from './store/settings'
import { testConnection, testServerConnection, refreshMyIdentity } from './jira/auth'
import {
  getTransitions,
  doTransition,
  getAllStatuses,
  getProjectStatuses,
  transitionToStatus
} from './jira/transitions'
import { getCompletionsForDate } from './history'
import { getIssueDescription, getIssueSummary } from './jira/issues'
import { listEvents, markAllRead, clearEvents } from './store/events'
import { refreshVpn } from './dashboard'
import { addComment } from './jira/comments'
import { getProjects, getIssueTypesForProject, getCreateFields, createIssue } from './jira/create'
import { assignToMe } from './jira/assign'
import { generateTaskDescription, refineTaskDescription, testLlm, testCoder } from './llm/client'
import { setLlmApiKey, getLlmApiKey, setCoderApiKey } from './store/credentials'
import { generatePatch } from './agent/coder'
import { openInIdea } from './agent/idea'
import {
  gitInfo,
  workingDiff,
  createBranch,
  applyPatch,
  commitChanges,
  pushBranch,
  originRemoteUrl,
  type CreateBranchInput
} from './agent/git'
import {
  saveGitlabCredentials,
  clearGitlabCredentials,
  getGitlabPublicConfig,
  setGitlabTokenExpiry,
  hasGitlab
} from './store/credentials'
import { testGitlab, refreshGitlabIdentity } from './gitlab/client'
import {
  listProjects,
  findProjectByPath,
  parseRepoPath,
  listBranches,
  getBranchCommitTitle,
  listProjectMembers,
  resolveGitlabUser,
  createMergeRequest,
  listMyReviewMRs,
  listMyAuthoredMRs
} from './gitlab/mr'
import type {
  CreateMrInput,
  CreateMrResult,
  GitlabCredentialsInput
} from '@shared/types'
import { getCachedIssues, refreshNow, restartPolling, applyLocalState, rebroadcast } from './poller'
import { getUpdateStatus, check as checkForUpdates, installUpdate } from './updater'
import { notifyAutoTransition } from './notify'
import {
  openPanel,
  closePanel,
  openSettings,
  closeOnboarding,
  beginWidgetDrag,
  dragWidgetTo,
  endWidgetDrag,
  hideWidget,
  setWidgetInteractive
} from './windows'
import type {
  ActionResult,
  AppSettings,
  ChecklistItem,
  DashboardData,
  HistoryItem,
  OAuthCredentialsInput,
  PanelView,
  SaveCredentialsInput,
  ServerCredentialsInput
} from '@shared/types'

/** Wrap an async action so the renderer always receives {ok,error} instead of a throw. */
async function guard(fn: () => Promise<void>): Promise<ActionResult> {
  try {
    await fn()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerIpc(): void {
  // ---- config / credentials ----
  ipcMain.handle(IPC.getConfig, () => getPublicConfig())

  ipcMain.handle(IPC.saveCredentials, async (_e, input: SaveCredentialsInput) => {
    const result = await testConnection(input)
    if (!result.ok) return result
    saveCredentials(input.baseUrl, input.email, input.apiToken)
    restartPolling()
    void refreshMyIdentity()
    return result
  })

  ipcMain.handle(IPC.clearCredentials, () => {
    clearCredentials()
    void refreshNow()
    return { ok: true }
  })

  ipcMain.handle(IPC.testConnection, (_e, input: SaveCredentialsInput) =>
    testConnection(input)
  )

  ipcMain.handle(IPC.startOAuth, async (_e, input: OAuthCredentialsInput) => {
    const result = await startLoginFlow(input.clientId, input.clientSecret)
    if (result.ok) {
      restartPolling()
      void refreshMyIdentity()
    }
    return result
  })

  ipcMain.handle(IPC.oauthDisconnect, () => {
    clearOAuthSession()
    oauthDisconnectCache()
    void refreshNow()
    return { ok: true }
  })

  // ---- server / data center (PAT) ----
  ipcMain.handle(IPC.testServer, (_e, input: ServerCredentialsInput) =>
    testServerConnection(input)
  )

  ipcMain.handle(IPC.saveServer, async (_e, input: ServerCredentialsInput) => {
    const result = await testServerConnection(input)
    if (!result.ok) return result
    saveServerCredentials(input.baseUrl, input.pat, result.displayName ?? '')
    restartPolling()
    void refreshMyIdentity()
    return result
  })

  ipcMain.handle(IPC.serverDisconnect, () => {
    clearServerCredentials()
    void refreshNow()
    return { ok: true }
  })

  // ---- settings ----
  ipcMain.handle(IPC.getSettings, () => getSettings())
  ipcMain.handle(IPC.updateSettings, (_e, patch: Partial<AppSettings>) => {
    const next = updateSettings(patch)
    if (
      patch.pollIntervalMinutes !== undefined ||
      patch.jql !== undefined ||
      patch.myFieldLabel !== undefined ||
      patch.myFieldIncludeAssignee !== undefined
    ) {
      restartPolling()
    }
    if (patch.autostart !== undefined && app.isPackaged) {
      // dev runs would register the raw electron.exe as a login item — never do that
      app.setLoginItemSettings({ openAtLogin: patch.autostart })
    }
    // Push the new look / counter rules to the widget immediately.
    if (
      patch.widgetAppearance !== undefined ||
      patch.dashboard !== undefined ||
      patch.taskBlocks !== undefined ||
      patch.countBlocked !== undefined
    ) {
      rebroadcast()
    }
    return next
  })

  // ---- issues ----
  ipcMain.handle(IPC.getIssues, () => getCachedIssues())
  ipcMain.handle(IPC.refreshIssues, () => refreshNow())
  ipcMain.handle(IPC.getTransitions, (_e, key: string) => getTransitions(key))

  ipcMain.handle(IPC.doTransition, (_e, key: string, transitionId: string) =>
    guard(async () => {
      await doTransition(key, transitionId)
      await refreshNow()
    })
  )

  ipcMain.handle(IPC.getStatuses, (_e, key: string) => getAllStatuses(key))

  ipcMain.handle(IPC.transitionTo, async (_e, key: string, status: string) => {
    const r = await transitionToStatus(key, status)
    if (r.ok && !r.skipped) await refreshNow() // nothing changed when already in the status
    return r
  })

  ipcMain.handle(IPC.addComment, (_e, key: string, text: string) =>
    guard(() => addComment(key, text))
  )

  ipcMain.handle(IPC.openInBrowser, (_e, url: string) => {
    void shell.openExternal(url)
    return { ok: true }
  })

  // Use Electron's clipboard — navigator.clipboard isn't available on file:// in production.
  ipcMain.handle(IPC.copyText, (_e, text: string) => {
    clipboard.writeText(String(text ?? ''))
    return { ok: true }
  })

  ipcMain.handle(IPC.archive, (_e, key: string) => {
    const issue = getCachedIssues().issues.find((i) => i.key === key)
    archiveItem({
      key,
      summary: issue?.summary ?? key,
      status: issue?.status ?? '',
      url: issue?.url ?? '',
      archivedAt: new Date().toISOString()
    })
    void refreshNow()
    return { ok: true }
  })

  ipcMain.handle(IPC.unarchive, (_e, key: string) => {
    unarchiveKey(key)
    void refreshNow()
    return { ok: true }
  })

  ipcMain.handle(IPC.setPriority, (_e, key: string, level: number) => {
    setPriority(key, level)
    applyLocalState() // re-sort cached issues without a network round-trip
    return { ok: true }
  })

  ipcMain.handle(IPC.setBlocked, (_e, key: string, reason: string) => {
    setBlocked(key, reason)
    applyLocalState()
    return { ok: true }
  })

  ipcMain.handle(IPC.setCurrent, (_e, key: string, on: boolean) => {
    setCurrent(key, on)
    rebroadcast() // «current» flag is recomputed in getCachedIssues
    return { ok: true }
  })

  // Purely local per-task checklist — never touches Jira/GitLab. Whole-array replace.
  ipcMain.handle(IPC.setChecklist, (_e, key: string, items: ChecklistItem[]) => {
    setChecklist(key, items)
    applyLocalState() // reflect checklist on cached issues without a network round-trip
    return { ok: true }
  })

  // auto-update
  ipcMain.handle(IPC.updateGet, () => getUpdateStatus())
  ipcMain.handle(IPC.updateCheck, () => {
    void checkForUpdates()
    return { ok: true }
  })
  ipcMain.handle(IPC.updateInstall, () => {
    installUpdate()
    return { ok: true }
  })

  ipcMain.handle(IPC.addLocalTask, (_e, summary: string, priority: number) => {
    addLocalTask(summary, priority)
    rebroadcast()
    return { ok: true }
  })

  ipcMain.handle(IPC.updateLocalTask, (_e, id: string, summary: string) => {
    updateLocalTask(id, summary)
    rebroadcast()
    return { ok: true }
  })

  ipcMain.handle(IPC.deleteLocalTask, (_e, id: string) => {
    deleteLocalTask(id)
    rebroadcast()
    return { ok: true }
  })

  // Purely local completion overlay — never calls Jira, for local tasks or Jira issues alike.
  ipcMain.handle(IPC.setLocalDone, (_e, key: string, done: boolean) => {
    if (done) {
      const issue = getCachedIssues().issues.find((i) => i.key === key)
      markKeyDone({
        key,
        summary: issue?.summary ?? key,
        status: issue?.status ?? '',
        url: issue?.url ?? '',
        isLocal: issue?.isLocal ?? key.startsWith('local-'),
        doneAt: new Date().toISOString()
      })
    } else {
      unmarkKeyDone(key)
    }
    rebroadcast()
    return { ok: true }
  })

  ipcMain.handle(IPC.getDashboard, async (): Promise<DashboardData> => {
    // Exclude already-completed items — the dashboard reflects active work.
    const issues = getCachedIssues().issues.filter((i) => !i.done)
    const byPriority: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
    const statusMap = new Map<string, number>()
    let blocked = 0
    let local = 0
    for (const i of issues) {
      byPriority[i.localPriority] = (byPriority[i.localPriority] ?? 0) + 1
      if (i.blocked) blocked++
      if (i.isLocal) local++
      statusMap.set(i.status, (statusMap.get(i.status) ?? 0) + 1)
    }
    const statuses = [...statusMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)

    const d = new Date()
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const doneToday = (await getCompletionsForDate(today)).length

    return {
      vpn: await refreshVpn(),
      stats: { total: issues.length, byPriority, blocked, local, doneToday },
      statuses
    }
  })

  ipcMain.handle(IPC.getHistory, (_e, date: string): Promise<HistoryItem[]> =>
    getCompletionsForDate(date)
  )

  // ---- notifications ----
  ipcMain.handle(IPC.getEvents, () => listEvents())
  ipcMain.handle(IPC.markEventsRead, () => {
    markAllRead()
    rebroadcast() // refresh unreadEvents on the widget
    return { ok: true }
  })
  ipcMain.handle(IPC.clearEvents, () => {
    clearEvents()
    rebroadcast()
    return { ok: true }
  })

  ipcMain.handle(IPC.getProjects, async () => {
    try {
      return { ok: true, projects: await getProjects() }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.getProjectIssueTypes, async () => {
    const { jiraProjectKey } = getSettings()
    if (!jiraProjectKey) return { ok: true, types: [] }
    try {
      const { project, types } = await getIssueTypesForProject(jiraProjectKey)
      return { ok: true, project, types }
    } catch (err) {
      // Without this catch, invoke() rejects and the renderer's un-try/catch'd await never
      // reaches setCreateTypes() — the state stays null forever, i.e. the exact
      // "Загрузка типов…" freeze this fixes.
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.getProjectStatuses, () =>
    getProjectStatuses(getSettings().jiraProjectKey).catch(() => [])
  )

  ipcMain.handle(IPC.getCreateFields, async (_e, issueTypeId: string) => {
    const { jiraProjectKey } = getSettings()
    if (!jiraProjectKey) return { ok: true, fields: [] }
    try {
      return { ok: true, fields: await getCreateFields(jiraProjectKey, issueTypeId) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(
    IPC.createIssue,
    async (
      _e,
      input: {
        issueTypeName: string
        summary: string
        description?: string
        assignToMe: boolean
        extraFields?: Record<string, unknown>
      }
    ) => {
      const { jiraProjectKey } = getSettings()
      if (!jiraProjectKey) {
        return { ok: false, error: 'Не указан проект для новых задач (см. Настройки)' }
      }
      const result = await createIssue({ projectKey: jiraProjectKey, ...input })
      if (result.ok) await refreshNow()
      return result
    }
  )

  ipcMain.handle(IPC.assignToMe, async (_e, key: string) => {
    const result = await assignToMe(key)
    if (result.ok) await refreshNow()
    return result
  })

  // ---- widget custom image skin ----
  // The picked image is stored as a ready-to-use data URL in userData; the widget fetches
  // it once per imageVersion bump, so the (possibly multi-MB) payload never rides along
  // with regular issue broadcasts.
  const widgetBgFile = (): string => join(app.getPath('userData'), 'widget-bg.dat')

  ipcMain.handle(IPC.pickWidgetImage, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Картинка для виджета',
      filters: [{ name: 'Изображения', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    try {
      const buf = await fsp.readFile(res.filePaths[0])
      if (buf.length > 8 * 1024 * 1024) {
        return { ok: false, error: 'Файл больше 8 МБ — выбери картинку поменьше' }
      }
      const ext = extname(res.filePaths[0]).slice(1).toLowerCase()
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
      await fsp.writeFile(widgetBgFile(), `data:${mime};base64,${buf.toString('base64')}`, 'utf8')
      const { widgetAppearance } = getSettings()
      updateSettings({
        widgetAppearance: {
          ...widgetAppearance,
          skin: 'image',
          imageVersion: widgetAppearance.imageVersion + 1
        }
      })
      rebroadcast()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.clearWidgetImage, async () => {
    await fsp.unlink(widgetBgFile()).catch(() => {})
    const { widgetAppearance } = getSettings()
    updateSettings({
      widgetAppearance: {
        ...widgetAppearance,
        skin: widgetAppearance.skin === 'image' ? 'classic' : widgetAppearance.skin,
        imageVersion: widgetAppearance.imageVersion + 1
      }
    })
    rebroadcast()
    return { ok: true }
  })

  ipcMain.handle(IPC.getWidgetImage, async () => {
    const dataUrl = await fsp.readFile(widgetBgFile(), 'utf8').catch(() => null)
    return { dataUrl }
  })

  // ---- LLM assistant ----
  ipcMain.handle(IPC.llmGenerate, (_e, userText: string) => generateTaskDescription(userText))

  ipcMain.handle(
    IPC.llmRefine,
    (_e, instruction: string, current: { summary: string; description: string }) =>
      refineTaskDescription(instruction, current)
  )

  ipcMain.handle(IPC.llmSetKey, (_e, key: string) => {
    setLlmApiKey(key)
    return { ok: true }
  })

  ipcMain.handle(IPC.llmGetStatus, () => ({ hasKey: getLlmApiKey() !== null }))

  ipcMain.handle(IPC.llmTest, () => testLlm())

  // ---- coder agent ----
  ipcMain.handle(IPC.agentGeneratePatch, (_e, taskText: string) => generatePatch(taskText))
  ipcMain.handle(IPC.agentOpenInIdea, (_e, relPath: string) => openInIdea(relPath))
  ipcMain.handle(IPC.agentSetCoderKey, (_e, key: string) => {
    setCoderApiKey(key)
    return { ok: true }
  })
  ipcMain.handle(IPC.agentTestCoder, () => testCoder())

  ipcMain.handle(IPC.agentPickRepo, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Папка проекта для кодер-агента',
      properties: ['openDirectory']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    const repoPath = res.filePaths[0]
    updateSettings({ coder: { ...getSettings().coder, repoPath } })
    return { ok: true, path: repoPath }
  })

  ipcMain.handle(IPC.agentPickIdea, async () => {
    const res = await dialog.showOpenDialog({
      title: 'Лаунчер IntelliJ IDEA',
      filters: [{ name: 'IDEA', extensions: ['exe', 'cmd', 'bat'] }],
      properties: ['openFile']
    })
    if (res.canceled || !res.filePaths[0]) return { ok: false }
    const ideaPath = res.filePaths[0]
    updateSettings({ coder: { ...getSettings().coder, ideaPath } })
    return { ok: true, path: ideaPath }
  })

  ipcMain.handle(IPC.agentGitInfo, (_e, repo: string) => gitInfo(repo))
  ipcMain.handle(IPC.agentGitDiff, (_e, repo: string) => workingDiff(repo))
  ipcMain.handle(IPC.agentCreateBranch, (_e, input: CreateBranchInput) => createBranch(input))
  ipcMain.handle(IPC.agentApplyPatch, (_e, input: { repo: string; diff: string }) =>
    applyPatch(input)
  )
  ipcMain.handle(IPC.agentCommit, (_e, input: { repo: string; message: string }) =>
    commitChanges(input)
  )
  ipcMain.handle(IPC.agentPush, (_e, input: { repo: string; remote: string; branch: string }) =>
    pushBranch(input)
  )

  // ---------------- GitLab ----------------
  ipcMain.handle(IPC.gitlabConfig, () => getGitlabPublicConfig())
  ipcMain.handle(IPC.gitlabTest, (_e, input: GitlabCredentialsInput) => testGitlab(input))
  ipcMain.handle(IPC.gitlabSave, async (_e, input: GitlabCredentialsInput) => {
    const res = await testGitlab(input)
    if (!res.ok) return res
    saveGitlabCredentials(input.baseUrl, input.pat, input.expiry ?? '')
    await refreshGitlabIdentity()
    return { ok: true, displayName: res.displayName }
  })
  ipcMain.handle(IPC.gitlabSetExpiry, (_e, date: string) => {
    setGitlabTokenExpiry(date)
    return { ok: true }
  })
  ipcMain.handle(IPC.gitlabDisconnect, () => {
    clearGitlabCredentials()
    return { ok: true }
  })
  ipcMain.handle(IPC.gitlabProjects, (_e, search?: string) =>
    listProjects(search).catch(() => [])
  )
  ipcMain.handle(IPC.gitlabBranches, (_e, projectId: number, search?: string) =>
    listBranches(projectId, search).catch(() => [])
  )
  ipcMain.handle(IPC.gitlabMembers, (_e, projectId: number, search?: string) =>
    listProjectMembers(projectId, search).catch(() => [])
  )
  ipcMain.handle(IPC.gitlabResolveUser, (_e, username: string) =>
    resolveGitlabUser(username).catch(() => null)
  )
  ipcMain.handle(IPC.gitlabMyReviews, () => listMyReviewMRs().catch(() => []))
  ipcMain.handle(IPC.gitlabMyMRs, () => listMyAuthoredMRs().catch(() => []))
  ipcMain.handle(IPC.gitlabBranchCommitTitle, (_e, projectId: number, branch: string) =>
    getBranchCommitTitle(projectId, branch).catch(() => '')
  )
  // Auto-detect the GitLab project for a local repo via its origin remote.
  ipcMain.handle(IPC.gitlabDetectProject, async (_e, repo: string) => {
    if (!hasGitlab()) return null
    const path = parseRepoPath(await originRemoteUrl(repo))
    return path ? findProjectByPath(path) : null
  })
  ipcMain.handle(IPC.gitlabCreateMR, async (_e, input: CreateMrInput): Promise<CreateMrResult> => {
    try {
      const mr = await createMergeRequest(input)
      let note: string | undefined
      // Optional Jira automation: move the linked issue to "Ready to Review".
      const auto = getSettings().gitlabAutomation
      if (auto.onMrCreated && mr.jiraKey && auto.readyToReviewStatus.trim()) {
        const status = auto.readyToReviewStatus.trim()
        const t = await transitionToStatus(mr.jiraKey, status).catch(
          (e): ActionResult => ({ ok: false, error: e instanceof Error ? e.message : String(e) })
        )
        if (t.ok && t.skipped) {
          note = `${mr.jiraKey} уже в «${status}»`
        } else if (t.ok) {
          note = `${mr.jiraKey} → «${status}» ✓`
          notifyAutoTransition(mr.jiraKey, status, 'создание MR')
          rebroadcast() // push the new unread-events count to the widget badge
        } else {
          note = `Jira-переход не выполнен: ${t.error ?? ''}`.trim()
        }
      }
      return { ok: true, iid: mr.iid, webUrl: mr.webUrl, note }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
  ipcMain.handle(IPC.getIssueSummary, (_e, key: string) => getIssueSummary(key))
  ipcMain.handle(IPC.getIssueDescription, (_e, key: string) =>
    getIssueDescription(key).catch(() => '')
  )

  // ---- windows ----
  ipcMain.handle(IPC.openSettings, () => {
    openSettings()
  })
  ipcMain.handle(IPC.closeOnboarding, () => {
    closeOnboarding()
    void refreshNow() // pick up the new "my field" immediately
  })
  ipcMain.handle(IPC.openPanel, (_e, view?: PanelView) => {
    openPanel(view)
  })
  ipcMain.handle(IPC.closePanel, () => {
    closePanel()
  })
  // One-way (send) drag events. Movement is driven by a cursor poll in beginWidgetDrag;
  // the renderer only signals start/end.
  ipcMain.on(IPC.widgetDragStart, () => beginWidgetDrag())
  ipcMain.on(IPC.widgetDragMove, () => dragWidgetTo())
  ipcMain.on(IPC.widgetDragEnd, () => endWidgetDrag())

  ipcMain.handle(IPC.hideWidget, () => {
    hideWidget()
  })
  ipcMain.on(IPC.widgetSetInteractive, (_e, interactive: boolean) =>
    setWidgetInteractive(interactive)
  )
}
