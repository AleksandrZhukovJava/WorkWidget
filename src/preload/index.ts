import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AppSettings,
  ActionResult,
  AgentPatchResult,
  ApplyResult,
  BranchResult,
  ChecklistItem,
  UpdateStatus,
  CommitResult,
  ConnectionResult,
  CreateField,
  CreateMrInput,
  CreateMrResult,
  GitDiffResult,
  GitInfo,
  GitlabConfig,
  GitlabCredentialsInput,
  GitlabMR,
  GitlabProject,
  GitlabUser,
  PushResult,
  DashboardData,
  JiraConfig,
  JiraIssue,
  HistoryItem,
  JiraTransition,
  LlmGenerateResult,
  NotificationEvent,
  OAuthCredentialsInput,
  PanelView,
  SaveCredentialsInput,
  ServerCredentialsInput,
  WidgetAppearance
} from '../shared/types'

export interface CreateIssueInput {
  issueTypeName: string
  summary: string
  description?: string
  assignToMe: boolean
  /** additional fields in Jira value shape, keyed by field id */
  extraFields?: Record<string, unknown>
}

export interface CreateIssueResult {
  ok: boolean
  key?: string
  error?: string
}

export interface IssuesPayload {
  issues: JiraIssue[]
  error: string | null
  /** VPN status for the widget dot; null when the VPN indicator is off */
  vpn: boolean | null
  /** whether the stats indicator is enabled (drives the widget blocked badge) */
  showStats: boolean
  /** widget skin/glow/thresholds — appearance changes apply live */
  appearance: WidgetAppearance
  /** unread notification count — drives the blinking widget badge */
  unreadEvents: number
  /** statuses that count toward the widget task counter; null = legacy (active non-blocked) */
  countedStatuses: string[] | null
  /** whether blocked issues are included in the counter */
  countBlocked: boolean
  /** last fetch failed due to connectivity — widget shows a "no network" glyph, not a count */
  netError: boolean
}

const api = {
  // config / credentials
  getConfig: (): Promise<JiraConfig> => ipcRenderer.invoke(IPC.getConfig),
  saveCredentials: (input: SaveCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.saveCredentials, input),
  clearCredentials: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.clearCredentials),
  testConnection: (input: SaveCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.testConnection, input),
  startOAuth: (input: OAuthCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.startOAuth, input),
  oauthDisconnect: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.oauthDisconnect),
  testServer: (input: ServerCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.testServer, input),
  saveServer: (input: ServerCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.saveServer, input),
  serverDisconnect: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.serverDisconnect),

  // settings
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke(IPC.updateSettings, patch),

  // issues
  getIssues: (): Promise<IssuesPayload> => ipcRenderer.invoke(IPC.getIssues),
  refreshIssues: (): Promise<IssuesPayload> => ipcRenderer.invoke(IPC.refreshIssues),
  getTransitions: (key: string): Promise<JiraTransition[]> =>
    ipcRenderer.invoke(IPC.getTransitions, key),
  doTransition: (key: string, transitionId: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.doTransition, key, transitionId),
  getStatuses: (key: string): Promise<string[]> => ipcRenderer.invoke(IPC.getStatuses, key),
  transitionTo: (key: string, status: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.transitionTo, key, status),
  addComment: (key: string, text: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.addComment, key, text),
  openInBrowser: (url: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.openInBrowser, url),
  copyText: (text: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.copyText, text),
  archive: (key: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.archive, key),
  unarchive: (key: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.unarchive, key),
  setPriority: (key: string, level: number): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.setPriority, key, level),
  setBlocked: (key: string, reason: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.setBlocked, key, reason),
  setCurrent: (key: string, on: boolean): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.setCurrent, key, on),
  setChecklist: (key: string, items: ChecklistItem[]): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.setChecklist, key, items),
  addLocalTask: (summary: string, priority: number): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.addLocalTask, summary, priority),
  updateLocalTask: (id: string, summary: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.updateLocalTask, id, summary),
  deleteLocalTask: (id: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.deleteLocalTask, id),
  setLocalDone: (id: string, done: boolean): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.setLocalDone, id, done),
  getHistory: (date: string): Promise<HistoryItem[]> =>
    ipcRenderer.invoke(IPC.getHistory, date),
  getDashboard: (): Promise<DashboardData> => ipcRenderer.invoke(IPC.getDashboard),
  getProjects: (): Promise<{
    ok: boolean
    projects?: { key: string; name: string }[]
    error?: string
  }> => ipcRenderer.invoke(IPC.getProjects),
  getProjectIssueTypes: (): Promise<{
    ok: boolean
    project?: { key: string; name: string }
    types?: { id: string; name: string }[]
    error?: string
  }> => ipcRenderer.invoke(IPC.getProjectIssueTypes),
  getCreateFields: (
    issueTypeId: string
  ): Promise<{ ok: boolean; fields?: CreateField[]; error?: string }> =>
    ipcRenderer.invoke(IPC.getCreateFields, issueTypeId),
  getProjectStatuses: (): Promise<string[]> => ipcRenderer.invoke(IPC.getProjectStatuses),
  createIssue: (input: CreateIssueInput): Promise<CreateIssueResult> =>
    ipcRenderer.invoke(IPC.createIssue, input),
  assignToMe: (key: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.assignToMe, key),

  // widget custom image skin
  pickWidgetImage: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.pickWidgetImage),
  clearWidgetImage: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.clearWidgetImage),
  getWidgetImage: (): Promise<{ dataUrl: string | null }> =>
    ipcRenderer.invoke(IPC.getWidgetImage),

  // LLM assistant
  llmGenerate: (userText: string): Promise<LlmGenerateResult> =>
    ipcRenderer.invoke(IPC.llmGenerate, userText),
  llmRefine: (
    instruction: string,
    current: { summary: string; description: string }
  ): Promise<LlmGenerateResult> => ipcRenderer.invoke(IPC.llmRefine, instruction, current),

  // coder agent
  agentGeneratePatch: (taskText: string): Promise<AgentPatchResult> =>
    ipcRenderer.invoke(IPC.agentGeneratePatch, taskText),
  agentOpenInIdea: (relPath: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.agentOpenInIdea, relPath),
  agentSetCoderKey: (key: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.agentSetCoderKey, key),
  agentTestCoder: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.agentTestCoder),
  agentPickRepo: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.agentPickRepo),
  agentPickIdea: (): Promise<{ ok: boolean; path?: string }> =>
    ipcRenderer.invoke(IPC.agentPickIdea),
  agentGitInfo: (repo: string): Promise<GitInfo> => ipcRenderer.invoke(IPC.agentGitInfo, repo),
  agentGitDiff: (repo: string): Promise<GitDiffResult> =>
    ipcRenderer.invoke(IPC.agentGitDiff, repo),
  agentCreateBranch: (input: {
    repo: string
    name: string
    base: string
    remote: string
    updateFromRemote: boolean
  }): Promise<BranchResult> => ipcRenderer.invoke(IPC.agentCreateBranch, input),
  agentApplyPatch: (input: { repo: string; diff: string }): Promise<ApplyResult> =>
    ipcRenderer.invoke(IPC.agentApplyPatch, input),
  agentCommit: (input: { repo: string; message: string }): Promise<CommitResult> =>
    ipcRenderer.invoke(IPC.agentCommit, input),
  agentPush: (input: { repo: string; remote: string; branch: string }): Promise<PushResult> =>
    ipcRenderer.invoke(IPC.agentPush, input),
  getIssueDescription: (key: string): Promise<string> =>
    ipcRenderer.invoke(IPC.getIssueDescription, key),
  getIssueSummary: (key: string): Promise<string> =>
    ipcRenderer.invoke(IPC.getIssueSummary, key),

  // gitlab
  gitlabConfig: (): Promise<GitlabConfig> => ipcRenderer.invoke(IPC.gitlabConfig),
  gitlabTest: (input: GitlabCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.gitlabTest, input),
  gitlabSave: (input: GitlabCredentialsInput): Promise<ConnectionResult> =>
    ipcRenderer.invoke(IPC.gitlabSave, input),
  gitlabSetExpiry: (date: string): Promise<ActionResult> =>
    ipcRenderer.invoke(IPC.gitlabSetExpiry, date),
  gitlabDisconnect: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.gitlabDisconnect),
  gitlabProjects: (search?: string): Promise<GitlabProject[]> =>
    ipcRenderer.invoke(IPC.gitlabProjects, search),
  gitlabBranches: (projectId: number, search?: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC.gitlabBranches, projectId, search),
  gitlabMembers: (projectId: number, search?: string): Promise<GitlabUser[]> =>
    ipcRenderer.invoke(IPC.gitlabMembers, projectId, search),
  gitlabCreateMR: (input: CreateMrInput): Promise<CreateMrResult> =>
    ipcRenderer.invoke(IPC.gitlabCreateMR, input),
  gitlabMyReviews: (): Promise<GitlabMR[]> => ipcRenderer.invoke(IPC.gitlabMyReviews),
  gitlabMyMRs: (): Promise<GitlabMR[]> => ipcRenderer.invoke(IPC.gitlabMyMRs),
  gitlabDetectProject: (repo: string): Promise<GitlabProject | null> =>
    ipcRenderer.invoke(IPC.gitlabDetectProject, repo),
  gitlabBranchCommitTitle: (projectId: number, branch: string): Promise<string> =>
    ipcRenderer.invoke(IPC.gitlabBranchCommitTitle, projectId, branch),
  llmSetKey: (key: string): Promise<ActionResult> => ipcRenderer.invoke(IPC.llmSetKey, key),
  llmGetStatus: (): Promise<{ hasKey: boolean }> => ipcRenderer.invoke(IPC.llmGetStatus),
  llmTest: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.llmTest),

  // windows
  openSettings: (): Promise<void> => ipcRenderer.invoke(IPC.openSettings),
  closeOnboarding: (): Promise<void> => ipcRenderer.invoke(IPC.closeOnboarding),

  // notifications
  getEvents: (): Promise<NotificationEvent[]> => ipcRenderer.invoke(IPC.getEvents),
  markEventsRead: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.markEventsRead),
  clearEvents: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.clearEvents),
  openPanel: (view?: PanelView): Promise<void> => ipcRenderer.invoke(IPC.openPanel, view),
  closePanel: (): Promise<void> => ipcRenderer.invoke(IPC.closePanel),
  widgetDragStart: (x: number, y: number): void => ipcRenderer.send(IPC.widgetDragStart, x, y),
  widgetDragMove: (x: number, y: number): void => ipcRenderer.send(IPC.widgetDragMove, x, y),
  widgetDragEnd: (): void => ipcRenderer.send(IPC.widgetDragEnd),
  widgetSetInteractive: (interactive: boolean): void =>
    ipcRenderer.send(IPC.widgetSetInteractive, interactive),
  hideWidget: (): Promise<void> => ipcRenderer.invoke(IPC.hideWidget),

  // auto-update
  getUpdateStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.updateGet),
  checkForUpdates: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.updateCheck),
  installUpdate: (): Promise<ActionResult> => ipcRenderer.invoke(IPC.updateInstall),
  onUpdateStatus: (cb: (status: UpdateStatus) => void): (() => void) => {
    const listener = (_e: unknown, status: UpdateStatus): void => cb(status)
    ipcRenderer.on(IPC.updateStatus, listener)
    return () => ipcRenderer.removeListener(IPC.updateStatus, listener)
  },

  // events
  onIssuesUpdated: (cb: (payload: IssuesPayload) => void): (() => void) => {
    const listener = (_e: unknown, payload: IssuesPayload): void => cb(payload)
    ipcRenderer.on(IPC.issuesUpdated, listener)
    return () => ipcRenderer.removeListener(IPC.issuesUpdated, listener)
  },
  // Deep-link section: PanelView or 'settings' (main window). Kept as a broad string.
  onSwitchView: (cb: (view: string) => void): (() => void) => {
    const listener = (_e: unknown, view: string): void => cb(view)
    ipcRenderer.on(IPC.switchView, listener)
    return () => ipcRenderer.removeListener(IPC.switchView, listener)
  }
}

export type JiraWidgetApi = typeof api

contextBridge.exposeInMainWorld('api', api)
