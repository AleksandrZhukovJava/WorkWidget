import { useEffect, useRef, useState } from 'react'
import { IssueCard } from './IssueCard'
import { IssueDetail } from './IssueDetail'
import { UpdateBanner } from '../shared/UpdateBanner'
import { GitlabView, type MrPrefill } from './GitlabView'
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_LEVELS } from '@shared/priority'
import { parseAllJiraKeys } from '@shared/jira-key'
import { greeting } from '@shared/greeting'
import type {
  AgentPatchResult,
  AppSettings,
  ApplyResult,
  ArchivedItem,
  BranchResult,
  CommitResult,
  CreateField,
  DashboardData,
  GitDiffResult,
  GitInfo,
  GitlabMR,
  HistoryItem,
  JiraIssue,
  NotificationEvent,
  PanelView,
  PushResult,
  TaskBlock
} from '@shared/types'

type View = PanelView

/** Colored unified-diff view (green add / red del / accent hunk). */
function DiffPre({ diff }: { diff: string }): JSX.Element {
  return (
    <pre className="agent__diff">
      {diff.split('\n').map((line, i) => (
        <span
          key={i}
          className={
            line.startsWith('+') && !line.startsWith('+++')
              ? 'diff-add'
              : line.startsWith('-') && !line.startsWith('---')
                ? 'diff-del'
                : line.startsWith('@@')
                  ? 'diff-hunk'
                  : ''
          }
        >
          {line + '\n'}
        </span>
      ))}
    </pre>
  )
}

const EVENT_ICON: Record<NotificationEvent['type'], string> = {
  new: '🆕',
  status: '🔄',
  due: '⏰',
  comment: '💬',
  review: '👀',
  token: '🔑',
  mr: '🦊'
}

/** Short relative time like "5 мин", "2 ч", "3 дн". */
function relTime(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'только что'
  if (s < 3600) return `${Math.floor(s / 60)} мин`
  if (s < 86400) return `${Math.floor(s / 3600)} ч`
  return `${Math.floor(s / 86400)} дн`
}

function todayStr(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function Panel({
  view: controlledView,
  onNavigate,
  chromeless
}: {
  /** When provided, the parent (MainApp shell) controls navigation. */
  view?: View
  onNavigate?: (v: View) => void
  /** Hide the built-in header (hamburger + title) when embedded in the shell. */
  chromeless?: boolean
} = {}): JSX.Element {
  // Standalone mode keeps its own view; embedded mode reads it from props.
  const [internalView, setInternalView] = useState<View>('prioritized')
  const view = controlledView ?? internalView
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [detailKey, setDetailKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [archived, setArchived] = useState<ArchivedItem[]>([])
  const [query, setQuery] = useState('')

  const [newDesc, setNewDesc] = useState('')
  const [newPrio, setNewPrio] = useState(0)

  const [histDate, setHistDate] = useState(todayStr())
  const [history, setHistory] = useState<HistoryItem[] | null>(null)

  const [userName, setUserName] = useState('')

  const [events, setEvents] = useState<NotificationEvent[] | null>(null)
  const [unreadEvents, setUnreadEvents] = useState(0)

  // Coder-agent wizard: task → project → branch → work (generate diff).
  const [agentTask, setAgentTask] = useState('')
  const [agentKey, setAgentKey] = useState('') // Jira key for branch naming ('' for local)
  const [agentSelKey, setAgentSelKey] = useState('') // selected issue key (incl. local id)
  const [agentBusy, setAgentBusy] = useState(false)
  const [agentResult, setAgentResult] = useState<AgentPatchResult | null>(null)
  const [coderCfg, setCoderCfg] = useState<AppSettings['coder'] | null>(null)
  const [agentEnabled, setAgentEnabled] = useState(true) // features.agent — gates the card entry
  const [gitlabEnabled, setGitlabEnabled] = useState(true) // features.gitlab — gates the MR hand-off
  const [taskBlocks, setTaskBlocks] = useState<TaskBlock[]>([]) // configurable status groups
  const [agentRepo, setAgentRepo] = useState('') // project chosen for this task
  const [agentGit, setAgentGit] = useState<GitInfo | null>(null)
  // Uncommitted-changes viewer (what blocks branch creation on a dirty tree).
  const [agentDiff, setAgentDiff] = useState<GitDiffResult | null>(null)
  const [agentDiffOpen, setAgentDiffOpen] = useState(false)
  const [agentDiffBusy, setAgentDiffBusy] = useState(false)
  const [agentStrategy, setAgentStrategy] = useState<'feature' | 'hotfix'>('feature')
  const [agentBranch, setAgentBranch] = useState('')
  const [agentUpdateBase, setAgentUpdateBase] = useState(true)
  const [agentBranchBusy, setAgentBranchBusy] = useState(false)
  const [agentBranchDone, setAgentBranchDone] = useState<BranchResult | null>(null)
  // Apply → commit → push sub-flow (all local; push only on explicit confirmation).
  const [agentApplyBusy, setAgentApplyBusy] = useState(false)
  const [agentApplied, setAgentApplied] = useState<ApplyResult | null>(null)
  const [agentCommitMsg, setAgentCommitMsg] = useState('')
  const [agentCommitBusy, setAgentCommitBusy] = useState(false)
  const [agentCommitDone, setAgentCommitDone] = useState<CommitResult | null>(null)
  const [agentPushBusy, setAgentPushBusy] = useState(false)
  const [agentPushDone, setAgentPushDone] = useState<PushResult | null>(null)
  // Hand-off to the GitLab «Создать MR» form after the agent pushes a branch.
  const [mrPrefill, setMrPrefill] = useState<MrPrefill | null>(null)
  // GitLab MRs linked to Jira issues (by key) — drives the MR chip on the card.
  const [mrsByKey, setMrsByKey] = useState<Record<string, GitlabMR[]>>({})

  const agentBase = coderCfg
    ? agentStrategy === 'feature'
      ? coderCfg.featureBase
      : coderCfg.hotfixBase
    : ''

  /** Load the git state of the chosen project into the wizard. */
  async function refreshAgentGit(repo: string): Promise<void> {
    setAgentGit(null)
    // Any cached working-diff is stale once git state is re-read.
    setAgentDiff(null)
    setAgentDiffOpen(false)
    if (repo) setAgentGit(await window.api.agentGitInfo(repo))
  }

  /** Show/hide the uncommitted changes that keep the tree dirty (reloads fresh on open). */
  async function toggleAgentDiff(): Promise<void> {
    if (agentDiffOpen) {
      setAgentDiffOpen(false)
      return
    }
    setAgentDiffOpen(true)
    setAgentDiffBusy(true)
    setAgentDiff(await window.api.agentGitDiff(agentRepo))
    setAgentDiffBusy(false)
  }

  // Re-read block config whenever the main task list is shown, so edits in Settings apply
  // even if the panel stayed mounted.
  useEffect(() => {
    if (view === 'prioritized')
      void window.api.getSettings().then((s) => setTaskBlocks(s.taskBlocks))
  }, [view])

  // Load GitLab MRs and index them by linked Jira key, for the MR chip on task cards.
  useEffect(() => {
    if (!gitlabEnabled) return
    void Promise.all([window.api.gitlabMyReviews(), window.api.gitlabMyMRs()])
      .then(([reviews, mine]) => {
        const map: Record<string, GitlabMR[]> = {}
        for (const mr of [...mine, ...reviews]) {
          // Index under every Jira key in the title+branch (not just mr.jiraKey's first match),
          // so an MR whose branch/title carries the service name still links to the real task.
          const keys = parseAllJiraKeys(`${mr.title} ${mr.sourceBranch}`)
          for (const k of keys) {
            const list = (map[k] ??= [])
            if (!list.some((x) => x.projectId === mr.projectId && x.iid === mr.iid)) list.push(mr)
          }
        }
        setMrsByKey(map)
      })
      .catch(() => {})
  }, [gitlabEnabled])

  // Re-read git state when the window regains focus — the user may have switched branches
  // in their IDE while the wizard sat open, so the shown "current branch" would go stale.
  // Fetch without clearing first, to avoid a flash of the branch line.
  useEffect(() => {
    function onFocus(): void {
      if (view === 'agent' && agentRepo) void window.api.agentGitInfo(agentRepo).then(setAgentGit)
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [view, agentRepo])

  /**
   * Pick a task for the agent. Local task → its own text; Jira task → key + title + the
   * fetched Jira description. Jira selection also drives the branch name (feature/{key}).
   */
  async function selectIssueForAgent(issue: JiraIssue): Promise<void> {
    setAgentSelKey(issue.key)
    setAgentResult(null)
    setAgentBranchDone(null)
    setAgentStrategy('feature')
    resetAgentApplyFlow()
    if (issue.isLocal) {
      setAgentKey('')
      setAgentTask(issue.summary)
    } else {
      setAgentKey(issue.key)
      const desc = await window.api.getIssueDescription(issue.key).catch(() => '')
      setAgentTask(`${issue.key} ${issue.summary}` + (desc ? `\n\n${desc}` : ''))
    }
  }
  /** Entry from a Jira card's ⋮ menu: open the agent tab with the issue pre-selected. */
  function startAgent(issue: JiraIssue): void {
    go('agent')
    void selectIssueForAgent(issue)
  }

  async function pickAgentRepo(): Promise<void> {
    const r = await window.api.agentPickRepo()
    if (r.ok && r.path) {
      setAgentRepo(r.path)
      void refreshAgentGit(r.path)
    }
  }

  async function createAgentBranch(): Promise<void> {
    if (!coderCfg || !agentRepo || !agentBranch.trim()) return
    setAgentBranchBusy(true)
    const res = await window.api.agentCreateBranch({
      repo: agentRepo,
      name: agentBranch.trim(),
      base: agentBase,
      remote: coderCfg.remote,
      updateFromRemote: agentUpdateBase
    })
    setAgentBranchBusy(false)
    setAgentBranchDone(res)
    if (res.ok) void refreshAgentGit(agentRepo)
  }

  /** Reset the apply → commit → push sub-flow (on regenerate / new task). */
  function resetAgentApplyFlow(): void {
    setAgentApplied(null)
    setAgentCommitDone(null)
    setAgentPushDone(null)
  }

  /** «Начать работу»: generate the diff on the prepared branch (not yet applied). */
  async function runAgent(): Promise<void> {
    setAgentResult(null)
    resetAgentApplyFlow()
    setAgentBusy(true)
    const res = await window.api.agentGeneratePatch(agentTask)
    setAgentResult(res)
    setAgentBusy(false)
    // Default commit message = first line of the task (Jira: "KEY summary").
    if (res.ok) setAgentCommitMsg(agentTask.split('\n')[0].trim())
  }

  /** Apply the generated diff to the working tree (unstaged, reviewable). */
  async function applyAgentPatch(): Promise<void> {
    if (!agentRepo || !agentResult?.diff) return
    setAgentApplyBusy(true)
    setAgentApplied(null)
    setAgentCommitDone(null)
    setAgentPushDone(null)
    setAgentApplied(await window.api.agentApplyPatch({ repo: agentRepo, diff: agentResult.diff }))
    setAgentApplyBusy(false)
  }

  /** Create a local commit from the applied changes. */
  async function commitAgentChanges(): Promise<void> {
    if (!agentRepo || !agentCommitMsg.trim()) return
    setAgentCommitBusy(true)
    setAgentCommitDone(null)
    setAgentPushDone(null)
    setAgentCommitDone(await window.api.agentCommit({ repo: agentRepo, message: agentCommitMsg.trim() }))
    setAgentCommitBusy(false)
  }

  /** Hand off to the GitLab «Создать MR» form, prefilled from the just-pushed branch. */
  function startMrFromAgent(): void {
    const branch = agentBranchDone?.branch ?? agentBranch
    const firstLine = agentTask.split('\n')[0].trim()
    const summary = agentKey ? firstLine.replace(agentKey, '').trim() : firstLine
    const title = agentKey ? `feat(${agentKey}): ${summary}` : firstLine
    setMrPrefill({ sourceBranch: branch, targetBranch: agentBase, title, repoPath: agentRepo })
    go('gitlab')
  }

  /** Push the branch to the remote — only after an explicit confirmation. */
  async function pushAgentBranch(): Promise<void> {
    if (!coderCfg || !agentRepo || !agentCommitDone?.branch) return
    const branch = agentCommitDone.branch
    const ok = window.confirm(
      `Запушить ветку «${branch}» в ${coderCfg.remote}? Это отправит коммиты на удалённый сервер.`
    )
    if (!ok) return
    setAgentPushBusy(true)
    setAgentPushDone(null)
    setAgentPushDone(
      await window.api.agentPush({ repo: agentRepo, remote: coderCfg.remote, branch })
    )
    setAgentPushBusy(false)
  }

  // Recompute the suggested branch name whenever the strategy / key / config changes.
  useEffect(() => {
    if (!coderCfg) return
    const fmt = agentStrategy === 'feature' ? coderCfg.branchFormat : coderCfg.hotfixFormat
    setAgentBranch(fmt.replaceAll('{key}', agentKey || ''))
  }, [agentStrategy, agentKey, coderCfg])

  const [dash, setDash] = useState<DashboardData | null>(null)
  const [dashCfg, setDashCfg] = useState({ stats: true, statuses: true, vpn: true })

  const [projectKey, setProjectKey] = useState('')
  const [createProject, setCreateProject] = useState<{ key: string; name: string } | null>(null)
  const [createTypes, setCreateTypes] = useState<{ id: string; name: string }[] | null>(null)
  const [createTypesError, setCreateTypesError] = useState<string | null>(null)
  const [createTypeName, setCreateTypeName] = useState('')
  const [createSummary, setCreateSummary] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createAssignToMe, setCreateAssignToMe] = useState(true)
  const [createBusy, setCreateBusy] = useState(false)
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [aiText, setAiText] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiRefine, setAiRefine] = useState('')
  const [aiRefineBusy, setAiRefineBusy] = useState(false)

  // Extra createmeta fields (Настройки Jira: допполя типа задачи + допустимые значения).
  const [extraOpen, setExtraOpen] = useState(false)
  const [extraFields, setExtraFields] = useState<CreateField[] | null>(null)
  const [extraError, setExtraError] = useState<string | null>(null)
  const [extraValues, setExtraValues] = useState<Record<string, string | string[]>>({})
  // Fields pinned as always-filled defaults (persisted): field id → default value.
  const [fieldDefaults, setFieldDefaults] = useState<Record<string, string | string[]>>({})

  const isPinnedField = (id: string): boolean =>
    Object.prototype.hasOwnProperty.call(fieldDefaults, id)

  function saveFieldDefaults(next: Record<string, string | string[]>): void {
    setFieldDefaults(next)
    void window.api.updateSettings({ createFieldDefaults: next })
  }

  /** Set a field's value; for pinned fields the new value is also saved as the default. */
  function setFieldValue(id: string, value: string | string[]): void {
    setExtraValues((prev) => ({ ...prev, [id]: value }))
    if (isPinnedField(id)) saveFieldDefaults({ ...fieldDefaults, [id]: value })
  }

  function togglePinField(id: string): void {
    if (isPinnedField(id)) {
      const next = { ...fieldDefaults }
      delete next[id]
      saveFieldDefaults(next)
    } else {
      saveFieldDefaults({ ...fieldDefaults, [id]: extraValues[id] ?? '' })
    }
  }

  function extraFieldControl(f: CreateField): JSX.Element {
    const v = extraValues[f.id]
    if (f.control === 'select') {
      return (
        <select value={(v as string) ?? ''} onChange={(e) => setFieldValue(f.id, e.target.value)}>
          <option value="">— не заполнять —</option>
          {f.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    if (f.control === 'multiselect') {
      return (
        <select
          multiple
          size={Math.min(4, f.options?.length ?? 4)}
          value={(v as string[]) ?? []}
          onChange={(e) =>
            setFieldValue(f.id, [...e.target.selectedOptions].map((o) => o.value))
          }
        >
          {f.options?.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      )
    }
    if (f.control === 'textarea') {
      return (
        <textarea value={(v as string) ?? ''} onChange={(e) => setFieldValue(f.id, e.target.value)} />
      )
    }
    return (
      <input
        type={f.control === 'number' ? 'number' : f.control === 'date' ? 'date' : 'text'}
        placeholder={f.control === 'labels' ? 'метки через запятую' : ''}
        value={(v as string) ?? ''}
        onChange={(e) => setFieldValue(f.id, e.target.value)}
      />
    )
  }

  function renderExtraField(f: CreateField): JSX.Element {
    return (
      <div className="extra-field" key={f.id}>
        <span className="extra-field__name">
          {f.name}
          {f.required && <b style={{ color: 'var(--breach)' }}> *</b>}
          <button
            className={`extra-field__pin ${isPinnedField(f.id) ? 'is-on' : ''}`}
            title={
              isPinnedField(f.id)
                ? 'Не заполнять по умолчанию'
                : 'Всегда заполнять (сохранить как значение по умолчанию)'
            }
            onClick={() => togglePinField(f.id)}
          >
            📌
          </button>
        </span>
        {extraFieldControl(f)}
      </div>
    )
  }

  async function loadExtraFields(): Promise<void> {
    const typeId = createTypes?.find((t) => t.name === createTypeName)?.id
    if (!typeId) return
    setExtraFields(null)
    setExtraError(null)
    const res = await window.api.getCreateFields(typeId)
    if (res.ok) setExtraFields(res.fields ?? [])
    else {
      setExtraFields([])
      setExtraError(res.error ?? 'Не удалось получить поля')
    }
  }

  // Different issue types have different fields — refetch when the type changes. Seed values
  // from the saved defaults, and auto-load the fields (even collapsed) if any are pinned so
  // the always-filled ones render immediately.
  useEffect(() => {
    setExtraValues({ ...fieldDefaults })
    if (extraOpen || Object.keys(fieldDefaults).length > 0) void loadExtraFields()
    else setExtraFields(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createTypeName, fieldDefaults])

  /** UI values → Jira field payload ({id}/[{id}]/scalars); empty values are skipped. */
  function buildExtraFieldValues(): Record<string, unknown> | undefined {
    if (!extraFields) return undefined
    const out: Record<string, unknown> = {}
    for (const f of extraFields) {
      const v = extraValues[f.id]
      if (v === undefined || v === '' || (Array.isArray(v) && v.length === 0)) continue
      switch (f.control) {
        case 'select':
          out[f.id] = { id: v }
          break
        case 'multiselect':
          out[f.id] = (v as string[]).map((id) => ({ id }))
          break
        case 'labels':
          out[f.id] = String(v)
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
          break
        case 'number':
          out[f.id] = Number(v)
          break
        default:
          out[f.id] = v
      }
    }
    return Object.keys(out).length ? out : undefined
  }

  // Draft autosave plumbing: guard against overwriting stored drafts with the initial
  // empty state before they've been loaded, and keep the latest values in a ref for the
  // beforeunload flush (state values would be stale in that listener).
  const draftsLoaded = useRef(false)
  const draftRef = useRef({
    createAiText: '',
    createSummary: '',
    createDescription: '',
    localTask: ''
  })

  useEffect(() => {
    if (!draftsLoaded.current) return
    const d = {
      createAiText: aiText,
      createSummary,
      createDescription,
      localTask: newDesc
    }
    draftRef.current = d
    const t = setTimeout(() => void window.api.updateSettings({ drafts: d }), 500)
    return () => clearTimeout(t)
  }, [aiText, createSummary, createDescription, newDesc])

  useEffect(() => {
    // Window is closing (panel destroyed on close) — persist immediately, skipping the
    // debounce. The IPC message is queued synchronously, so it survives the teardown.
    function flush(): void {
      if (draftsLoaded.current) void window.api.updateSettings({ drafts: draftRef.current })
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      // Only pick the default view in standalone mode; embedded mode is parent-driven.
      if (controlledView === undefined) setInternalView(s.defaultView)
      setProjectKey(s.jiraProjectKey)
      setUserName(s.userName)
      setAgentEnabled(s.features.agent)
      setGitlabEnabled(s.features.gitlab)
      setTaskBlocks(s.taskBlocks)
      setFieldDefaults(s.createFieldDefaults ?? {})
      // Restore unsent drafts — the panel window is destroyed on close, so anything
      // typed lives only here between sessions.
      setAiText(s.drafts.createAiText)
      setCreateSummary(s.drafts.createSummary)
      setCreateDescription(s.drafts.createDescription)
      setNewDesc(s.drafts.localTask)
      draftRef.current = { ...s.drafts }
      draftsLoaded.current = true
    })
    void window.api.getIssues().then((p) => {
      setIssues(p.issues)
      setError(p.error)
      setUnreadEvents(p.unreadEvents)
      setLoading(false)
    })
    const off = window.api.onIssuesUpdated((p) => {
      setIssues(p.issues)
      setError(p.error)
      setUnreadEvents(p.unreadEvents)
      setLoading(false)
      void loadArchived()
    })
    void loadArchived()
    return () => off()
  }, [])

  // Close the dropdown on outside click.
  useEffect(() => {
    if (!menuOpen) return
    function onDocClick(e: MouseEvent): void {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [menuOpen])

  function go(next: View): void {
    setMenuOpen(false)
    if (onNavigate) onNavigate(next)
    else setInternalView(next)
  }

  // Load per-view data whenever the active view changes (works for both internal nav and
  // parent-driven nav via the `view` prop).
  useEffect(() => {
    if (view === 'archive') void loadArchived()
    if (view === 'history') void loadHistory(histDate)
    if (view === 'dashboard') void loadDashboard()
    if (view === 'create') void loadCreateTypes()
    if (view === 'notifications') void loadEvents()
    if (view === 'agent' && !coderCfg) {
      void window.api.getSettings().then((s) => {
        setCoderCfg(s.coder)
        setAgentRepo(s.coder.repoPath)
        setAgentBranch(s.coder.branchFormat.replaceAll('{key}', ''))
        void refreshAgentGit(s.coder.repoPath)
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  async function loadEvents(): Promise<void> {
    setEvents(await window.api.getEvents())
    // Opening the tab clears the unread state (widget dot goes quiet).
    await window.api.markEventsRead()
    setUnreadEvents(0)
  }

  async function clearEvents(): Promise<void> {
    await window.api.clearEvents()
    setEvents([])
  }

  async function loadCreateTypes(): Promise<void> {
    setCreateTypes(null)
    setCreateProject(null)
    setCreateTypesError(null)
    setCreateTypeName('')
    setExtraOpen(false)
    setExtraFields(null)
    setExtraValues({ ...fieldDefaults })
    const s = await window.api.getSettings()
    setProjectKey(s.jiraProjectKey)
    if (!s.jiraProjectKey) return
    const res = await window.api.getProjectIssueTypes()
    if (res.ok) {
      const types = res.types ?? []
      setCreateTypes(types)
      setCreateProject(res.project ?? null)
      if (types.length) setCreateTypeName(types[0].name)
    } else {
      setCreateTypes([])
      setCreateTypesError(res.error ?? 'Не удалось загрузить типы задач')
    }
  }

  async function generateWithAi(): Promise<void> {
    if (!aiText.trim()) return
    setAiBusy(true)
    setCreateMsg(null)
    const res = await window.api.llmGenerate(aiText.trim())
    setAiBusy(false)
    if (res.ok) {
      if (res.summary) setCreateSummary(res.summary)
      if (res.description) setCreateDescription(res.description)
    } else {
      setCreateMsg({ ok: false, text: res.error ?? 'LLM не ответила' })
    }
  }

  async function refineWithAi(): Promise<void> {
    if (!aiRefine.trim() || (!createSummary.trim() && !createDescription.trim())) return
    setAiRefineBusy(true)
    setCreateMsg(null)
    const res = await window.api.llmRefine(aiRefine.trim(), {
      summary: createSummary,
      description: createDescription
    })
    setAiRefineBusy(false)
    if (res.ok) {
      if (res.summary) setCreateSummary(res.summary)
      if (res.description) setCreateDescription(res.description)
      setAiRefine('')
    } else {
      setCreateMsg({ ok: false, text: res.error ?? 'LLM не ответила' })
    }
  }

  /** Wipe the whole create form — free-text, title, description, refine, extra fields. */
  function clearCreateForm(): void {
    setAiText('')
    setAiRefine('')
    setCreateSummary('')
    setCreateDescription('')
    setExtraValues({ ...fieldDefaults }) // pinned defaults are always-filled, keep them
    setCreateMsg(null)
    // Also drop the persisted drafts so they don't come back next open.
    void window.api.updateSettings({
      drafts: { createAiText: '', createSummary: '', createDescription: '', localTask: newDesc }
    })
  }

  async function submitCreate(): Promise<void> {
    if (!createSummary.trim() || !createTypeName) return
    setCreateBusy(true)
    setCreateMsg(null)
    const res = await window.api.createIssue({
      issueTypeName: createTypeName,
      summary: createSummary.trim(),
      description: createDescription.trim() || undefined,
      assignToMe: createAssignToMe,
      extraFields: buildExtraFieldValues()
    })
    setCreateBusy(false)
    if (res.ok) {
      setCreateMsg({ ok: true, text: `Создано: ${res.key} ✓` })
      setCreateSummary('')
      setCreateDescription('')
      setAiText('')
      setExtraValues({ ...fieldDefaults }) // keep pinned defaults for the next issue
    } else {
      // Jira deliberately returns this vague message both when a type truly doesn't exist
      // and when the user lacks "Create Issue" permission for it — it won't say which.
      const hint = /issue ?type/i.test(res.error ?? '')
        ? ' Возможно, у вас нет прав создавать задачи этого типа в этом проекте — проверьте вручную в веб-версии Jira.'
        : ''
      setCreateMsg({ ok: false, text: (res.error ?? 'Не удалось создать задачу') + hint })
    }
  }

  async function loadArchived(): Promise<void> {
    const s = await window.api.getSettings()
    setArchived(s.archived)
  }

  async function refresh(): Promise<void> {
    setLoading(true)
    const p = await window.api.refreshIssues()
    setIssues(p.issues)
    setError(p.error)
    setLoading(false)
  }

  async function restore(key: string): Promise<void> {
    await window.api.unarchive(key)
    await loadArchived()
  }

  async function loadHistory(date: string): Promise<void> {
    setHistory(null)
    setHistory(await window.api.getHistory(date))
  }

  async function loadDashboard(): Promise<void> {
    const s = await window.api.getSettings()
    setDashCfg(s.dashboard)
    setDash(null)
    setDash(await window.api.getDashboard())
  }

  async function toggleDash(key: 'stats' | 'statuses' | 'vpn'): Promise<void> {
    const next = { ...dashCfg, [key]: !dashCfg[key] }
    setDashCfg(next)
    await window.api.updateSettings({ dashboard: next })
  }

  async function addLocal(): Promise<void> {
    if (!newDesc.trim()) return
    await window.api.addLocalTask(newDesc.trim(), newPrio)
    setNewDesc('')
    setNewPrio(0)
  }

  // Blocked and completed tasks live in their own tabs, excluded from inbox/prioritized/local.
  const completed = issues
    .filter((i) => i.done)
    .sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? ''))
  const blocked = issues.filter((i) => !i.done && i.blocked)
  const prioritized = issues.filter((i) => !i.done && !i.blocked && (i.localPriority ?? 0) > 0)
  const inbox = issues.filter((i) => !i.done && !i.blocked && (i.localPriority ?? 0) === 0)
  const localTasks = issues.filter((i) => i.isLocal && !i.done)

  // Group active (not-done) issues by configured blocks, in order. Each issue lands in the
  // FIRST matching block (so overlapping status lists don't duplicate); the rest go to «Прочее».
  // Issues arrive already priority-sorted, so order within a block reflects priority.
  const blockGroups = (() => {
    // Blocked issues are excluded — they have their own «Заблокированные» tab.
    const nonDone = issues.filter((i) => !i.done && !i.blocked)
    const assigned = new Set<string>()
    const groups = taskBlocks.map((b) => {
      const items = nonDone.filter((i) => !assigned.has(i.key) && b.statuses.includes(i.status))
      items.forEach((i) => assigned.add(i.key))
      return { block: b, items }
    })
    const other = nonDone.filter((i) => !assigned.has(i.key))
    return { groups, other }
  })()

  // When blocks are configured, the main «Задачи» list splits into these groups (counted
  // blocks placed on top by the user's ordering; priority applies within a block).
  const groupedActive = view === 'prioritized' && taskBlocks.length > 0
  const blocksJsx = (
    <>
      {blockGroups.groups.map(
        (g) =>
          g.items.length > 0 && (
            <div key={g.block.id} className="task-block">
              <div className="task-block__head">
                <span className="task-block__name">{g.block.name}</span>
                {g.block.counted && (
                  <span className="task-block__counted" title="Учитывается в счётчике">
                    ● в счётчике
                  </span>
                )}
                <span className="task-block__count">{g.items.length}</span>
              </div>
              {g.items.map((issue) => (
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  onOpenDetail={(i) => setDetailKey(i.key)}
                  mrs={mrsByKey[issue.key]}
                />
              ))}
            </div>
          )
      )}
      {blockGroups.other.length > 0 && (
        <div className="task-block">
          <div className="task-block__head">
            <span className="task-block__name">Прочее</span>
            <span className="task-block__count">{blockGroups.other.length}</span>
          </div>
          {blockGroups.other.map((issue) => (
            <IssueCard
              key={issue.key}
              issue={issue}
              onOpenDetail={(i) => setDetailKey(i.key)}
              mrs={mrsByKey[issue.key]}
            />
          ))}
        </div>
      )}
    </>
  )

  const activeList =
    view === 'prioritized'
      ? prioritized
      : view === 'blocked'
        ? blocked
        : view === 'local'
          ? localTasks
          : view === 'completed'
            ? completed
            : inbox

  const q = query.trim().toLowerCase()
  const filteredArchived = q
    ? archived.filter(
        (a) => a.key.toLowerCase().includes(q) || a.summary.toLowerCase().includes(q)
      )
    : archived

  const title =
    view === 'prioritized'
      ? `Приоритеты (${prioritized.length})`
      : view === 'inbox'
        ? `Без приоритета (${inbox.length})`
        : view === 'blocked'
          ? `Заблокировано (${blocked.length})`
          : view === 'local'
            ? `Свои задачи (${localTasks.length})`
            : view === 'completed'
              ? `Завершённые (${completed.length})`
              : view === 'history'
                ? 'История'
                : view === 'dashboard'
                  ? 'Панель управления'
                  : view === 'create'
                    ? 'Создать задачу'
                    : `Архив (${archived.length})`

  return (
    <div className="panel">
      {/* Standalone popup only — in the shell, MainApp renders its own banner. */}
      {!chromeless && <UpdateBanner />}
      {!chromeless && (
      <div className="panel__head">
        <div className="panel__menu" ref={menuRef}>
          <button
            className="btn btn--icon"
            title="Меню"
            onClick={() => setMenuOpen((v) => !v)}
          >
            ☰
          </button>
          {menuOpen && (
            <div className="panel__dropdown">
              <button className={view === 'inbox' ? 'is-active' : ''} onClick={() => go('inbox')}>
                Без приоритета
              </button>
              <button
                className={view === 'prioritized' ? 'is-active' : ''}
                onClick={() => go('prioritized')}
              >
                Приоритеты
              </button>
              <button
                className={view === 'blocked' ? 'is-active' : ''}
                onClick={() => go('blocked')}
              >
                Заблокирован
              </button>
              <button className={view === 'local' ? 'is-active' : ''} onClick={() => go('local')}>
                Свои
              </button>
              <button
                className={view === 'completed' ? 'is-active' : ''}
                onClick={() => go('completed')}
              >
                Завершённые
              </button>
              <button
                className={view === 'history' ? 'is-active' : ''}
                onClick={() => go('history')}
              >
                История
              </button>
              <button
                className={view === 'dashboard' ? 'is-active' : ''}
                onClick={() => go('dashboard')}
              >
                Панель
              </button>
              <button
                className={view === 'notifications' ? 'is-active' : ''}
                onClick={() => go('notifications')}
              >
                Уведомления
                {unreadEvents > 0 && <span className="menu-badge">{unreadEvents}</span>}
              </button>
              <div className="panel__dropdown-sep" />
              <button
                className={view === 'archive' ? 'is-active' : ''}
                onClick={() => go('archive')}
              >
                Архив
              </button>
            </div>
          )}
        </div>
        <span className="panel__title">{title}</span>
        {view !== 'archive' && view !== 'history' && view !== 'dashboard' && view !== 'create' && (
          <button className="btn btn--icon" title="Обновить" onClick={() => void refresh()}>
            {loading ? <span className="spinner" /> : '⟳'}
          </button>
        )}
        {view === 'dashboard' && (
          <button className="btn btn--icon" title="Обновить" onClick={() => void loadDashboard()}>
            {dash === null ? <span className="spinner" /> : '⟳'}
          </button>
        )}
        {view !== 'create' && (
          <button className="btn btn--icon" title="Создать задачу" onClick={() => go('create')}>
            +
          </button>
        )}
        <button
          className="btn btn--icon"
          title="Настройки"
          onClick={() => void window.api.openSettings()}
        >
          ⚙
        </button>
      </div>
      )}

      {userName && (view === 'prioritized' || view === 'inbox') && (
        <div className="panel__greeting">{greeting(userName)} 👋</div>
      )}

      {view === 'archive' ? (
        <>
          <div className="panel__search">
            <input
              placeholder="Поиск по архиву (ключ или название)…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="panel__list">
            {archived.length === 0 && <div className="panel__empty">Архив пуст</div>}
            {archived.length > 0 && filteredArchived.length === 0 && (
              <div className="panel__empty">Ничего не найдено</div>
            )}
            {filteredArchived.map((a) => (
              <div className="issue" key={a.key}>
                <div className="issue__top">
                  <span
                    className="issue__key"
                    title="Открыть в браузере"
                    onClick={() => a.url && void window.api.openInBrowser(a.url)}
                  >
                    {a.key}
                  </span>
                  {a.status && <span className="issue__status">{a.status}</span>}
                </div>
                {a.summary && a.summary !== a.key && (
                  <div className="issue__summary">{a.summary}</div>
                )}
                <div className="issue__actions">
                  <button className="btn btn--primary" onClick={() => void restore(a.key)}>
                    Вернуть из архива
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : view === 'history' ? (
        <>
          <div className="panel__search">
            <input
              type="date"
              value={histDate}
              onChange={(e) => {
                setHistDate(e.target.value)
                void loadHistory(e.target.value)
              }}
            />
          </div>
          <div className="panel__list">
            {history === null && <div className="panel__empty">Загрузка…</div>}
            {history !== null && history.length === 0 && (
              <div className="panel__empty">В этот день ничего не завершено</div>
            )}
            {history?.map((h) => (
              <div className="issue" key={h.key}>
                <div className="issue__top">
                  {h.isLocal ? (
                    <span className="issue__key issue__key--local" title="Своя задача">
                      Своя
                    </span>
                  ) : (
                    <span
                      className="issue__key"
                      title="Открыть в браузере"
                      onClick={() => h.url && void window.api.openInBrowser(h.url)}
                    >
                      {h.key}
                    </span>
                  )}
                  <span className="issue__status">✓ {new Date(h.doneAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <div className="issue__summary">{h.summary}</div>
              </div>
            ))}
          </div>
        </>
      ) : view === 'notifications' ? (
        <div className="panel__list">
          {events !== null && events.length > 0 && (
            <div className="row" style={{ padding: '4px 10px' }}>
              <button className="btn" onClick={() => void clearEvents()}>
                Очистить все
              </button>
            </div>
          )}
          {events === null && <div className="panel__empty">Загрузка…</div>}
          {events !== null && events.length === 0 && (
            <div className="panel__empty">Событий пока нет</div>
          )}
          {events?.map((e) => (
            <div
              key={e.id}
              className={`event ${e.read ? '' : 'event--unread'}`}
              onClick={() => e.url && void window.api.openInBrowser(e.url)}
              title={e.url ? 'Открыть в браузере' : ''}
            >
              <span className="event__icon">{EVENT_ICON[e.type]}</span>
              <div className="event__body">
                <div className="event__head">
                  <b>{e.issueKey}</b> {e.text}
                </div>
                <div className="event__summary">{e.issueSummary}</div>
              </div>
              <span className="event__time">{relTime(e.at)}</span>
            </div>
          ))}
        </div>
      ) : view === 'agent' ? (
        <div className="panel__list agent">
          {/* Step 1 — task (pick from my tasks) */}
          <div className="agent__step">
            <div className="agent__step-title">1. Задача</div>
            <select
              value={agentSelKey}
              onChange={(e) => {
                const iss = issues.find((i) => i.key === e.target.value)
                if (iss) void selectIssueForAgent(iss)
              }}
            >
              <option value="" disabled>
                Выбери задачу из своих…
              </option>
              {issues
                .filter((i) => !i.done)
                .map((i) => (
                  <option key={i.key} value={i.key}>
                    {i.isLocal ? `Своя: ${i.summary}` : `${i.key} — ${i.summary}`}
                  </option>
                ))}
            </select>
            {agentTask && (
              <div className="agent__taskbox" title={agentTask}>
                {agentTask}
              </div>
            )}
          </div>

          {/* Step 2 — project */}
          <div className="agent__step">
            <div className="agent__step-title">2. Проект</div>
            <div className="row">
              <input readOnly value={agentRepo} placeholder="Папка проекта не выбрана" />
              <button className="btn" onClick={() => void pickAgentRepo()}>
                Выбрать папку…
              </button>
              {agentRepo && (
                <button
                  className="btn"
                  title="Обновить состояние git (ветка, изменения)"
                  onClick={() => void refreshAgentGit(agentRepo)}
                >
                  ⟳
                </button>
              )}
            </div>
            {agentGit && !agentGit.isGit && agentRepo && (
              <div className="status-msg err">Это не git-репозиторий</div>
            )}
            {agentGit?.isGit && (
              <div className="hint">
                Текущая ветка: <b>{agentGit.branch}</b>
                {agentGit.dirty && (
                  <span style={{ color: 'var(--breach)' }}> · есть несохранённые изменения</span>
                )}
              </div>
            )}
            {agentGit?.isGit && agentGit.dirty && (
              <div className="agent__dirty">
                <div className="row">
                  <button className="btn" onClick={() => void toggleAgentDiff()}>
                    {agentDiffOpen ? 'Скрыть изменения' : 'Показать несохранённые изменения'}
                  </button>
                  <span className="hint">
                    Их нужно закоммитить или спрятать (stash), чтобы создать ветку.
                  </span>
                </div>
                {agentDiffOpen && agentDiffBusy && (
                  <div className="hint">
                    <span className="spinner" /> Загружаю дифф…
                  </div>
                )}
                {agentDiffOpen && !agentDiffBusy && agentDiff && !agentDiff.ok && (
                  <div className="status-msg err">{agentDiff.error}</div>
                )}
                {agentDiffOpen && !agentDiffBusy && agentDiff?.ok && (
                  <>
                    {agentDiff.diff?.trim() ? (
                      <DiffPre diff={agentDiff.diff} />
                    ) : (
                      <div className="hint">Нет изменений в отслеживаемых файлах.</div>
                    )}
                    {agentDiff.untracked && agentDiff.untracked.length > 0 && (
                      <div className="agent__files">
                        <div className="hint">Новые (неотслеживаемые) файлы:</div>
                        {agentDiff.untracked.map((f) => (
                          <div className="agent__file" key={f}>
                            <span className="agent__file-path" title={f}>
                              {f}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Step 3 — branch */}
          <div className="agent__step">
            <div className="agent__step-title">3. Ветка</div>
            <label className="checkbox-row">
              <input
                type="radio"
                name="agent-strategy"
                checked={agentStrategy === 'feature'}
                onChange={() => setAgentStrategy('feature')}
              />
              Новая ветка от <b>&nbsp;{coderCfg?.featureBase}</b>
            </label>
            <label className="checkbox-row">
              <input
                type="radio"
                name="agent-strategy"
                checked={agentStrategy === 'hotfix'}
                onChange={() => setAgentStrategy('hotfix')}
              />
              Хотфикс от <b>&nbsp;{coderCfg?.hotfixBase}</b>
            </label>
            <div className="field" style={{ marginTop: 6 }}>
              <label>Имя ветки</label>
              <input value={agentBranch} onChange={(e) => setAgentBranch(e.target.value)} />
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={agentUpdateBase}
                onChange={(e) => setAgentUpdateBase(e.target.checked)}
              />
              Обновить базовую ветку (fetch от {coderCfg?.remote}/{agentBase})
            </label>
            <div className="row" style={{ marginTop: 6 }}>
              <button
                className="btn btn--primary"
                disabled={
                  agentBranchBusy ||
                  !agentRepo ||
                  !agentBranch.trim() ||
                  !agentGit?.isGit ||
                  agentBranchDone?.ok
                }
                onClick={() => void createAgentBranch()}
              >
                {agentBranchBusy ? <span className="spinner" /> : 'Создать ветку'}
              </button>
            </div>
            {agentBranchDone && !agentBranchDone.ok && (
              <div className="status-msg err">{agentBranchDone.error}</div>
            )}
            {agentBranchDone?.ok && (
              <div className="status-msg ok">
                Ветка <b>{agentBranchDone.branch}</b> создана от <b>{agentBranchDone.base}</b> ✓
                {agentBranchDone.note && <div className="hint">{agentBranchDone.note}</div>}
              </div>
            )}
          </div>

          {/* Step 4 — work (generate diff) */}
          <div className="agent__step">
            <div className="agent__step-title">4. Работа над задачей</div>
            <div className="row">
              <button
                className="btn btn--primary"
                disabled={agentBusy || !agentBranchDone?.ok || !agentTask.trim()}
                onClick={() => void runAgent()}
              >
                {agentBusy ? <span className="spinner" /> : 'Сгенерировать патч'}
              </button>
            </div>
            {!agentBranchDone?.ok && (
              <div className="hint">Сначала создайте ветку (шаг 3).</div>
            )}
          </div>

          {agentBusy && (
            <div className="panel__empty">
              <span className="spinner" /> Генерирую изменения…
            </div>
          )}
          {!agentBusy && agentResult && !agentResult.ok && (
            <div className="status-msg err">{agentResult.error}</div>
          )}
          {!agentBusy && agentResult?.ok && (
            <>
              {agentResult.files && agentResult.files.length > 0 && (
                <div className="agent__files">
                  <div className="hint">Файлы в контексте:</div>
                  {agentResult.files.map((f) => (
                    <div className="agent__file" key={f}>
                      <span className="agent__file-path" title={f}>
                        {f}
                      </span>
                      <button
                        className="btn"
                        title="Открыть в IntelliJ IDEA"
                        onClick={() => void window.api.agentOpenInIdea(f)}
                      >
                        ↗ IDEA
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <DiffPre diff={agentResult.diff || '(модель не вернула дифф)'} />
              <div className="row">
                <button
                  className="btn"
                  onClick={() => void window.api.copyText(agentResult.diff ?? '')}
                >
                  Скопировать дифф
                </button>
                <button className="btn" onClick={() => void runAgent()}>
                  Заново
                </button>
              </div>

              {/* Apply → commit → push. All local; push only on explicit confirmation. */}
              <div className="agent__apply">
                <div className="row">
                  <button
                    className="btn btn--primary"
                    disabled={agentApplyBusy || !agentRepo || !agentResult.diff}
                    onClick={() => void applyAgentPatch()}
                  >
                    {agentApplyBusy ? <span className="spinner" /> : 'Применить к файлам'}
                  </button>
                  {agentApplied?.ok && (
                    <span className="hint">Изменения в рабочей копии (пока не закоммичены)</span>
                  )}
                </div>
                {agentApplied && !agentApplied.ok && (
                  <div className="status-msg err" style={{ whiteSpace: 'pre-wrap' }}>
                    {agentApplied.error}
                  </div>
                )}

                {agentApplied?.ok && (
                  <>
                    {agentApplied.files && agentApplied.files.length > 0 && (
                      <div className="agent__files">
                        <div className="hint">Изменённые файлы:</div>
                        {agentApplied.files.map((f) => (
                          <div className="agent__file" key={f}>
                            <span className="agent__file-path" title={f}>
                              {f}
                            </span>
                            <button
                              className="btn"
                              title="Открыть в IntelliJ IDEA"
                              onClick={() => void window.api.agentOpenInIdea(f)}
                            >
                              ↗ IDEA
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="field" style={{ marginTop: 6 }}>
                      <label>Сообщение коммита</label>
                      <input
                        value={agentCommitMsg}
                        onChange={(e) => setAgentCommitMsg(e.target.value)}
                      />
                    </div>
                    <div className="row">
                      <button
                        className="btn btn--primary"
                        disabled={
                          agentCommitBusy || !agentCommitMsg.trim() || agentCommitDone?.ok
                        }
                        onClick={() => void commitAgentChanges()}
                      >
                        {agentCommitBusy ? <span className="spinner" /> : 'Закоммитить'}
                      </button>
                    </div>
                    {agentCommitDone && !agentCommitDone.ok && (
                      <div className="status-msg err">{agentCommitDone.error}</div>
                    )}
                    {agentCommitDone?.ok && (
                      <div className="status-msg ok">
                        Коммит <b>{agentCommitDone.hash}</b> в ветке{' '}
                        <b>{agentCommitDone.branch}</b> ✓
                      </div>
                    )}
                  </>
                )}

                {agentCommitDone?.ok && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button
                      className="btn"
                      disabled={agentPushBusy || agentPushDone?.ok}
                      onClick={() => void pushAgentBranch()}
                    >
                      {agentPushBusy ? (
                        <span className="spinner" />
                      ) : (
                        `Запушить в ${coderCfg?.remote ?? 'origin'}`
                      )}
                    </button>
                    {agentPushDone && !agentPushDone.ok && (
                      <span className="status-msg err">{agentPushDone.error}</span>
                    )}
                    {agentPushDone?.ok && (
                      <span className="status-msg ok">
                        Запушено в {agentPushDone.remote}/{agentPushDone.branch} ✓
                      </span>
                    )}
                  </div>
                )}

                {agentPushDone?.ok && gitlabEnabled && (
                  <div className="row" style={{ marginTop: 6 }}>
                    <button className="btn btn--primary" onClick={() => startMrFromAgent()}>
                      🦊 Создать MR
                    </button>
                    <span className="hint">Откроется форма GitLab с заполненными ветками.</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      ) : view === 'gitlab' ? (
        <GitlabView prefill={mrPrefill} onConsumePrefill={() => setMrPrefill(null)} />
      ) : view === 'dashboard' ? (
        <div className="panel__list">
          <div className="dash__toggles">
            <label className="checkbox-row">
              <input type="checkbox" checked={dashCfg.stats} onChange={() => void toggleDash('stats')} />
              Статистика
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={dashCfg.statuses} onChange={() => void toggleDash('statuses')} />
              По статусам
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={dashCfg.vpn} onChange={() => void toggleDash('vpn')} />
              VPN
            </label>
          </div>

          {dash === null && <div className="panel__empty">Загрузка…</div>}

          {dash && dashCfg.vpn && (
            <div className="dash__card">
              <div className="dash__row">
                <span
                  className="dash__dot"
                  style={{ background: dash.vpn ? 'var(--ok)' : 'var(--breach)' }}
                />
                VPN: <b>{dash.vpn ? 'включён' : 'выключен'}</b>
              </div>
            </div>
          )}

          {dash && dashCfg.stats && (
            <div className="dash__card">
              <div className="dash__title">Статистика</div>
              <div className="dash__grid">
                <span>Всего активных</span>
                <b>{dash.stats.total}</b>
                <span>Заблокировано</span>
                <b>{dash.stats.blocked}</b>
                <span>Своих</span>
                <b>{dash.stats.local}</b>
                <span>Выполнено сегодня</span>
                <b>{dash.stats.doneToday}</b>
              </div>
              <div className="dash__prios">
                {PRIORITY_LEVELS.filter((l) => l > 0).map((l) => (
                  <span key={l} className="dash__prio" style={{ borderColor: PRIORITY_COLOR[l] }}>
                    <span style={{ color: PRIORITY_COLOR[l] }}>{PRIORITY_LABEL[l]}</span>
                    <b>{dash.stats.byPriority[l] ?? 0}</b>
                  </span>
                ))}
              </div>
            </div>
          )}

          {dash && dashCfg.statuses && (
            <div className="dash__card">
              <div className="dash__title">По статусам</div>
              {dash.statuses.length === 0 && <div className="hint">Нет активных задач</div>}
              {dash.statuses.map((s) => (
                <div className="dash__row" key={s.name}>
                  <span>{s.name}</span>
                  <b style={{ marginLeft: 'auto' }}>{s.count}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : view === 'create' ? (
        <div className="panel__list">
          {!projectKey ? (
            <div className="panel__empty">
              Сначала укажи проект для новых задач в{' '}
              <a href="#" onClick={() => void window.api.openSettings()}>
                настройках
              </a>
              .
            </div>
          ) : (
            <div className="panel__addlocal">
              <div className="hint">
                Проект:{' '}
                {createProject ? (
                  <b style={{ color: 'var(--text)' }}>
                    {createProject.key} — {createProject.name}
                  </b>
                ) : (
                  `${projectKey} (проверяю в Jira…)`
                )}
              </div>

              {createTypesError ? (
                <div className="status-msg err">
                  {createTypesError}
                  <button className="btn" style={{ marginLeft: 8 }} onClick={() => void loadCreateTypes()}>
                    Повторить
                  </button>
                </div>
              ) : (
                <select
                  value={createTypeName}
                  disabled={createTypes === null}
                  onChange={(e) => setCreateTypeName(e.target.value)}
                >
                  {createTypes === null && <option>Загрузка типов…</option>}
                  {createTypes?.length === 0 && <option>Нет доступных типов задач</option>}
                  {createTypes?.map((t) => (
                    <option key={t.id} value={t.name}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}

              <div className="ai-block">
                <textarea
                  placeholder="✨ Опиши задачу своими словами — ИИ оформит по шаблону…"
                  value={aiText}
                  disabled={aiBusy}
                  onChange={(e) => setAiText(e.target.value)}
                />
                <div className="row">
                  <button
                    className="btn"
                    disabled={aiBusy || !aiText.trim()}
                    title="Сгенерировать заголовок и описание по шаблону из настроек"
                    onClick={() => void generateWithAi()}
                  >
                    {aiBusy ? <span className="spinner" /> : '✨ Сформулировать'}
                  </button>
                </div>
              </div>

              <input
                placeholder="Заголовок задачи"
                value={createSummary}
                onChange={(e) => setCreateSummary(e.target.value)}
              />
              <textarea
                className="create-desc"
                placeholder="Описание (опционально)"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
              />
              {createTypeName && (
                <div className="extra-fields">
                  {/* Pinned defaults — always shown and pre-filled. */}
                  {extraFields && extraFields.filter((f) => isPinnedField(f.id)).length > 0 && (
                    <div className="extra-fields__pinned">
                      <div className="hint">Поля по умолчанию (заполняются всегда):</div>
                      {extraFields.filter((f) => isPinnedField(f.id)).map(renderExtraField)}
                    </div>
                  )}

                  <button
                    className="btn btn--ghost"
                    onClick={() => {
                      const next = !extraOpen
                      setExtraOpen(next)
                      if (next && extraFields === null) void loadExtraFields()
                    }}
                  >
                    {extraOpen ? '▾' : '▸'} Дополнительные поля
                  </button>
                  {extraOpen && extraFields === null && !extraError && (
                    <div className="hint">Загрузка полей…</div>
                  )}
                  {extraOpen && extraError && (
                    <div className="status-msg err">
                      {extraError}
                      <button
                        className="btn"
                        style={{ marginLeft: 8 }}
                        onClick={() => void loadExtraFields()}
                      >
                        Повторить
                      </button>
                    </div>
                  )}
                  {extraOpen &&
                    extraFields &&
                    extraFields.filter((f) => !isPinnedField(f.id)).length === 0 &&
                    !extraError && (
                      <div className="hint">
                        {extraFields.length === 0
                          ? 'Дополнительных полей для этого типа нет.'
                          : 'Все поля закреплены как «по умолчанию» выше.'}
                      </div>
                    )}
                  {extraOpen &&
                    extraFields?.filter((f) => !isPinnedField(f.id)).map(renderExtraField)}
                  {extraOpen && (
                    <div className="hint">
                      📌 у поля — «заполнять всегда» (сохранится между сессиями).
                    </div>
                  )}
                </div>
              )}

              {(createSummary.trim() || createDescription.trim()) && (
                <div className="row">
                  <input
                    placeholder="✨ Уточнить: «добавь ссылку», «переформулируй критерии»…"
                    value={aiRefine}
                    disabled={aiRefineBusy}
                    onChange={(e) => setAiRefine(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void refineWithAi()
                    }}
                  />
                  <button
                    className="btn"
                    disabled={aiRefineBusy || !aiRefine.trim()}
                    title="ИИ внесёт правку в заголовок/описание, остальное не тронет"
                    onClick={() => void refineWithAi()}
                  >
                    {aiRefineBusy ? <span className="spinner" /> : 'Уточнить'}
                  </button>
                </div>
              )}
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={createAssignToMe}
                  onChange={(e) => setCreateAssignToMe(e.target.checked)}
                />
                Назначить на себя
              </label>
              <div className="row">
                <button
                  className="btn btn--primary"
                  disabled={createBusy || !createSummary.trim() || !createTypeName}
                  onClick={() => void submitCreate()}
                >
                  {createBusy ? <span className="spinner" /> : 'Создать'}
                </button>
                <button
                  className="btn"
                  disabled={
                    createBusy ||
                    !(
                      aiText.trim() ||
                      aiRefine.trim() ||
                      createSummary.trim() ||
                      createDescription.trim() ||
                      Object.keys(extraValues).length > 0
                    )
                  }
                  title="Очистить все поля формы"
                  onClick={clearCreateForm}
                >
                  Очистить
                </button>
              </div>
              {createMsg && (
                <div className={`status-msg ${createMsg.ok ? 'ok' : 'err'}`}>{createMsg.text}</div>
              )}
            </div>
          )}
        </div>
      ) : view === 'local' ? (
        <>
          <div className="panel__addlocal">
            <textarea
              placeholder="Описание своей задачи (не из Jira)…"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
            />
            <div className="row">
              <select value={newPrio} onChange={(e) => setNewPrio(Number(e.target.value))}>
                {PRIORITY_LEVELS.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl === 0 ? '⚑ Без приоритета' : `⚑ ${PRIORITY_LABEL[lvl]}`}
                  </option>
                ))}
              </select>
              <button
                className="btn btn--primary"
                disabled={!newDesc.trim()}
                onClick={() => void addLocal()}
              >
                Добавить
              </button>
            </div>
          </div>
          <div className="panel__list">
            {localTasks.length === 0 && (
              <div className="panel__empty">Пока нет своих задач — добавь выше</div>
            )}
            {localTasks.map((issue) => (
              <IssueCard key={issue.key} issue={issue} onOpenDetail={(i) => setDetailKey(i.key)} />
            ))}
          </div>
        </>
      ) : (
        <div className="panel__list">
          {view === 'completed' && (
            <div className="hint" style={{ padding: '0 2px' }}>
              Здесь — завершённые свои задачи. Закрытые задачи Jira смотри во вкладке
              «История».
            </div>
          )}
          {error && <div className="panel__error">{error}</div>}
          {groupedActive ? (
            blockGroups.groups.every((g) => g.items.length === 0) &&
            blockGroups.other.length === 0 ? (
              <div className="panel__empty">Нет активных задач</div>
            ) : (
              blocksJsx
            )
          ) : (
            <>
              {!error && !loading && activeList.length === 0 && (
                <div className="panel__empty">
                  {view === 'prioritized'
                    ? 'Нет приоритизированных задач'
                    : view === 'blocked'
                      ? 'Нет заблокированных задач'
                      : view === 'completed'
                        ? 'Пока нет завершённых задач'
                        : 'Все задачи распределены'}
                </div>
              )}
              {activeList.map((issue) => (
                <IssueCard
                  key={issue.key}
                  issue={issue}
                  onOpenDetail={(i) => setDetailKey(i.key)}
                  mrs={mrsByKey[issue.key]}
                />
              ))}
            </>
          )}
        </div>
      )}

      {detailKey &&
        (() => {
          const di = issues.find((i) => i.key === detailKey)
          return di ? (
            <IssueDetail
              issue={di}
              onClose={() => setDetailKey(null)}
              onGenerate={agentEnabled ? startAgent : undefined}
            />
          ) : null
        })()}
    </div>
  )
}
