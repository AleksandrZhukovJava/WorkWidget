/** Central registry of IPC channel names shared by main, preload and renderer. */
export const IPC = {
  // credentials / config
  getConfig: 'config:get',
  saveCredentials: 'config:saveCredentials',
  clearCredentials: 'config:clearCredentials',
  testConnection: 'config:testConnection',
  startOAuth: 'config:startOAuth',
  oauthDisconnect: 'config:oauthDisconnect',
  testServer: 'config:testServer',
  saveServer: 'config:saveServer',
  serverDisconnect: 'config:serverDisconnect',

  // settings
  getSettings: 'settings:get',
  updateSettings: 'settings:update',

  // issues
  getIssues: 'issues:get',
  refreshIssues: 'issues:refresh',
  getTransitions: 'issues:getTransitions',
  doTransition: 'issues:doTransition',
  getStatuses: 'issues:getStatuses',
  transitionTo: 'issues:transitionTo',
  addComment: 'issues:addComment',
  openInBrowser: 'issues:openInBrowser',
  archive: 'issues:archive',
  unarchive: 'issues:unarchive',
  setPriority: 'issues:setPriority',
  setBlocked: 'issues:setBlocked',
  setCurrent: 'issues:setCurrent',
  setChecklist: 'issues:setChecklist',
  addLocalTask: 'issues:addLocalTask',
  updateLocalTask: 'issues:updateLocalTask',
  deleteLocalTask: 'issues:deleteLocalTask',
  setLocalDone: 'issues:setLocalDone',
  getHistory: 'issues:getHistory',
  getDashboard: 'app:getDashboard',
  copyText: 'app:copyText',
  getProjects: 'issues:getProjects',
  getProjectIssueTypes: 'issues:getProjectIssueTypes',
  getProjectStatuses: 'issues:getProjectStatuses',
  getCreateFields: 'issues:getCreateFields',
  createIssue: 'issues:createIssue',
  assignToMe: 'issues:assignToMe',

  closeOnboarding: 'onboarding:close',
  widgetSetInteractive: 'widget:setInteractive',

  // notifications
  getEvents: 'events:get',
  markEventsRead: 'events:markRead',
  clearEvents: 'events:clear',

  // widget custom image skin
  pickWidgetImage: 'widget:pickImage',
  clearWidgetImage: 'widget:clearImage',
  getWidgetImage: 'widget:getImage',

  // LLM assistant
  llmGenerate: 'llm:generate',
  llmRefine: 'llm:refine',

  // coder agent
  agentGeneratePatch: 'agent:generatePatch',
  agentOpenInIdea: 'agent:openInIdea',
  agentSetCoderKey: 'agent:setCoderKey',
  agentTestCoder: 'agent:testCoder',
  agentPickRepo: 'agent:pickRepo',
  agentPickIdea: 'agent:pickIdea',
  agentGitInfo: 'agent:gitInfo',
  agentGitDiff: 'agent:gitDiff',
  agentCreateBranch: 'agent:createBranch',
  agentApplyPatch: 'agent:applyPatch',
  agentCommit: 'agent:commit',
  agentPush: 'agent:push',
  getIssueDescription: 'issues:getDescription',
  getIssueSummary: 'issues:getSummary',
  llmSetKey: 'llm:setKey',
  llmGetStatus: 'llm:getStatus',
  llmTest: 'llm:test',

  // gitlab
  gitlabConfig: 'gitlab:config',
  gitlabTest: 'gitlab:test',
  gitlabSave: 'gitlab:save',
  gitlabSetExpiry: 'gitlab:setExpiry',
  gitlabDisconnect: 'gitlab:disconnect',
  gitlabProjects: 'gitlab:projects',
  gitlabBranches: 'gitlab:branches',
  gitlabMembers: 'gitlab:members',
  gitlabResolveUser: 'gitlab:resolveUser',
  gitlabDiagnoseReviewer: 'gitlab:diagnoseReviewer',
  gitlabCreateMR: 'gitlab:createMR',
  gitlabMyReviews: 'gitlab:myReviews',
  gitlabMyMRs: 'gitlab:myMRs',
  gitlabDetectProject: 'gitlab:detectProject',
  gitlabBranchCommitTitle: 'gitlab:branchCommitTitle',

  // auto-update
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateInstall: 'update:install',

  // windows
  openSettings: 'window:openSettings',
  openPanel: 'window:openPanel',
  closePanel: 'window:closePanel',
  widgetDragStart: 'window:widgetDragStart',
  widgetDragMove: 'window:widgetDragMove',
  widgetDragEnd: 'window:widgetDragEnd',
  hideWidget: 'window:hideWidget',

  // push (main -> renderer)
  issuesUpdated: 'event:issuesUpdated',
  switchView: 'event:switchView',
  updateStatus: 'event:updateStatus'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
