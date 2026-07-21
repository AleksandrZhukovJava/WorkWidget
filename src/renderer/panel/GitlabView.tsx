import { useEffect, useState } from 'react'
import { parseJiraKey } from '@shared/jira-key'
import type {
  CreateMrResult,
  GitlabConfig,
  GitlabMR,
  GitlabProject,
  GitlabUser
} from '@shared/types'

/** Prefill passed from the coder-agent after it pushes a branch. */
export interface MrPrefill {
  sourceBranch: string
  targetBranch: string
  title: string
  /** local repo path — used to auto-detect the GitLab project via its origin remote */
  repoPath?: string
}

function MrRow({ mr }: { mr: GitlabMR }): JSX.Element {
  return (
    <div className="gl-mr">
      <div className="gl-mr__main">
        <a
          className="gl-mr__title"
          href={mr.webUrl}
          onClick={(e) => {
            e.preventDefault()
            void window.api.openInBrowser(mr.webUrl)
          }}
        >
          {mr.title}
        </a>
        <div className="gl-mr__meta">
          <span className="gl-mr__branch">
            {mr.sourceBranch} → {mr.targetBranch}
          </span>
          {mr.author && <span> · {mr.author}</span>}
          {mr.approved && <span className="gl-mr__approved"> · ✓ одобрен</span>}
        </div>
      </div>
      {mr.jiraKey && (
        <button
          className="gl-mr__key"
          title="Открыть задачу в Jira"
          onClick={() => void window.api.copyText(mr.jiraKey ?? '')}
        >
          {mr.jiraKey}
        </button>
      )}
    </div>
  )
}

export function GitlabView({
  prefill,
  onConsumePrefill
}: {
  prefill?: MrPrefill | null
  onConsumePrefill?: () => void
}): JSX.Element {
  const [cfg, setCfg] = useState<GitlabConfig | null>(null)
  const [tab, setTab] = useState<'reviews' | 'create'>('reviews')

  const [reviews, setReviews] = useState<GitlabMR[] | null>(null)
  const [myMRs, setMyMRs] = useState<GitlabMR[] | null>(null)

  // create-MR form
  const [projects, setProjects] = useState<GitlabProject[]>([])
  const [projectId, setProjectId] = useState<number | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [members, setMembers] = useState<GitlabUser[]>([])
  const [sourceBranch, setSourceBranch] = useState('')
  const [targetBranch, setTargetBranch] = useState('')
  const [title, setTitle] = useState('')
  const [titleTouched, setTitleTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [assignSelf, setAssignSelf] = useState(true)
  const [reviewerIds, setReviewerIds] = useState<number[]>([])
  const [creating, setCreating] = useState(false)
  const [result, setResult] = useState<CreateMrResult | null>(null)
  // Project search + persisted favorite projects.
  const [projectSearch, setProjectSearch] = useState('')
  const [favProjects, setFavProjects] = useState<GitlabProject[]>([])
  // Reviewer search + persisted favorites (★) and auto-selected (📌) reviewers.
  const [memberSearch, setMemberSearch] = useState('')
  const [favorites, setFavorites] = useState<GitlabUser[]>([])
  const [autoReviewers, setAutoReviewers] = useState<GitlabUser[]>([])

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setFavorites(s.gitlabFavoriteReviewers ?? [])
      setAutoReviewers(s.gitlabAutoReviewers ?? [])
      setFavProjects(s.gitlabFavoriteProjects ?? [])
    })
  }, [])

  function isFavProject(id: number): boolean {
    return favProjects.some((f) => f.id === id)
  }
  function toggleFavProject(p: GitlabProject): void {
    const next = isFavProject(p.id) ? favProjects.filter((f) => f.id !== p.id) : [...favProjects, p]
    setFavProjects(next)
    void window.api.updateSettings({ gitlabFavoriteProjects: next })
  }

  function isFav(id: number): boolean {
    return favorites.some((f) => f.id === id)
  }
  function toggleFavorite(u: GitlabUser): void {
    const next = isFav(u.id)
      ? favorites.filter((f) => f.id !== u.id)
      : [...favorites, { id: u.id, username: u.username, name: u.name }]
    setFavorites(next)
    void window.api.updateSettings({ gitlabFavoriteReviewers: next })
  }

  function isAuto(id: number): boolean {
    return autoReviewers.some((a) => a.id === id)
  }
  function toggleAuto(u: GitlabUser): void {
    const next = isAuto(u.id)
      ? autoReviewers.filter((a) => a.id !== u.id)
      : [...autoReviewers, { id: u.id, username: u.username, name: u.name }]
    setAutoReviewers(next)
    void window.api.updateSettings({ gitlabAutoReviewers: next })
    // Unpinning only stops future auto-selection; pinning is picked up by the effect below.
  }

  // Whenever the reviewer pool (project members / favorites) or the auto list changes,
  // ensure every auto-reviewer that IS available is selected. Only adds — a manual uncheck
  // for a one-off MR is preserved until the pool changes again.
  useEffect(() => {
    const available = new Set([...favorites, ...members].map((u) => u.id))
    const autoIds = autoReviewers.filter((a) => available.has(a.id)).map((a) => a.id)
    if (autoIds.length === 0) return
    setReviewerIds((prev) => {
      const missing = autoIds.filter((id) => !prev.includes(id))
      return missing.length ? [...prev, ...missing] : prev
    })
  }, [autoReviewers, favorites, members])

  useEffect(() => {
    void window.api.gitlabConfig().then(setCfg)
  }, [])

  useEffect(() => {
    if (!cfg?.connected) return
    void window.api.gitlabMyReviews().then(setReviews)
    void window.api.gitlabMyMRs().then(setMyMRs)
  }, [cfg?.connected])

  // Project list — server-side search (debounced), '' loads the membership list.
  useEffect(() => {
    if (!cfg?.connected) return
    const t = setTimeout(() => {
      void window.api.gitlabProjects(projectSearch.trim() || undefined).then(setProjects)
    }, 250)
    return () => clearTimeout(t)
  }, [projectSearch, cfg?.connected])

  async function selectProject(p: GitlabProject): Promise<void> {
    setProjectId(p.id)
    setResult(null)
    setMemberSearch('') // reset reviewer search; the effect below loads the member list
    const b = await window.api.gitlabBranches(p.id)
    setBranches(b)
    if (!targetBranch) setTargetBranch(p.defaultBranch)
  }

  // Reviewer/member list — server-side search (debounced), like the project search. Typing a
  // name re-queries the backend, so colleagues reachable via shared/parent groups (not just the
  // first page of direct members) show up — matching who GitLab's own picker offers.
  useEffect(() => {
    if (projectId == null) return
    const t = setTimeout(() => {
      void window.api.gitlabMembers(projectId, memberSearch.trim() || undefined).then(setMembers)
    }, 250)
    return () => clearTimeout(t)
  }, [projectId, memberSearch])

  // Coder-agent hand-off: switch to the create tab, prefill, auto-detect the project.
  useEffect(() => {
    if (!prefill || !cfg?.connected) return
    setTab('create')
    setSourceBranch(prefill.sourceBranch)
    setTargetBranch(prefill.targetBranch)
    setTitle(prefill.title)
    setTitleTouched(true) // agent already provided a title — don't override it
    if (prefill.repoPath) {
      void window.api.gitlabDetectProject(prefill.repoPath).then((p) => {
        if (!p) return
        setProjects((prev) => (prev.some((x) => x.id === p.id) ? prev : [p, ...prev]))
        void selectProject(p)
      })
    }
    onConsumePrefill?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, cfg?.connected])

  // Auto-suggest the MR title from the source branch: if the branch carries a Jira key that
  // exists → «feat(KEY): <issue summary>»; otherwise the branch's head commit title. Skips once
  // the user has typed a title of their own.
  useEffect(() => {
    if (titleTouched || projectId == null || !sourceBranch.trim()) return
    let cancelled = false
    void (async () => {
      const key = parseJiraKey(sourceBranch)
      let suggestion = ''
      if (key) {
        const summary = await window.api.getIssueSummary(key)
        if (summary) suggestion = `feat(${key}): ${summary}`
      }
      if (!suggestion) {
        const commit = await window.api.gitlabBranchCommitTitle(projectId, sourceBranch.trim())
        suggestion = commit || (key ? `feat(${key}): ` : '')
      }
      if (!cancelled && suggestion) setTitle(suggestion)
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, sourceBranch, titleTouched])

  function toggleReviewer(id: number): void {
    setReviewerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  async function submit(): Promise<void> {
    if (projectId == null || !sourceBranch.trim() || !targetBranch.trim() || !title.trim()) return
    setCreating(true)
    setResult(null)
    const res = await window.api.gitlabCreateMR({
      projectId,
      sourceBranch: sourceBranch.trim(),
      targetBranch: targetBranch.trim(),
      title: title.trim(),
      description,
      reviewerIds,
      assignSelf
    })
    setCreating(false)
    setResult(res)
    if (res.ok) void window.api.gitlabMyMRs().then(setMyMRs)
  }

  if (cfg && !cfg.connected) {
    return (
      <div className="panel__list">
        <div className="panel__empty">
          GitLab не подключён. Откройте <b>Настройки → GitLab</b> и укажите адрес и токен.
        </div>
      </div>
    )
  }

  // Projects: server-searched list (in `projects`) minus favorites, which show on top.
  const otherProjects = projects.filter((p) => !isFavProject(p.id))
  const projectRow = (p: GitlabProject): JSX.Element => (
    <div className={`gl-reviewer ${projectId === p.id ? 'is-selected' : ''}`} key={p.id}>
      <button className="gl-project-pick" onClick={() => void selectProject(p)}>
        {projectId === p.id ? '● ' : ''}
        {p.pathWithNamespace}
      </button>
      <button
        className={`gl-star ${isFavProject(p.id) ? 'is-on' : ''}`}
        title={isFavProject(p.id) ? 'Убрать из избранного' : 'В избранное'}
        onClick={() => toggleFavProject(p)}
      >
        {isFavProject(p.id) ? '★' : '☆'}
      </button>
    </div>
  )

  const q = memberSearch.trim().toLowerCase()
  const matches = (u: GitlabUser): boolean =>
    !q || u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q)
  // Members not already in favorites, filtered by the search box.
  // Pinned = favorites ∪ auto-reviewers, always shown at top (dedup by id).
  const pinnedUsers: GitlabUser[] = [
    ...favorites,
    ...autoReviewers.filter((a) => !favorites.some((f) => f.id === a.id))
  ]
  const isPinned = (id: number): boolean => pinnedUsers.some((u) => u.id === id)
  const filteredMembers = members.filter((m) => !isPinned(m.id) && matches(m))

  const reviewerRow = (u: GitlabUser): JSX.Element => (
    <div className="gl-reviewer" key={u.id}>
      <label className="checkbox-row" style={{ flex: 1 }}>
        <input
          type="checkbox"
          checked={reviewerIds.includes(u.id)}
          onChange={() => toggleReviewer(u.id)}
        />
        {u.name} <span className="hint">@{u.username}</span>
      </label>
      <button
        className={`gl-pin ${isAuto(u.id) ? 'is-on' : ''}`}
        title={isAuto(u.id) ? 'Не выбирать автоматически' : 'Всегда выбирать автоматически'}
        onClick={() => toggleAuto(u)}
      >
        📌
      </button>
      <button
        className={`gl-star ${isFav(u.id) ? 'is-on' : ''}`}
        title={isFav(u.id) ? 'Убрать из избранного' : 'В избранное'}
        onClick={() => toggleFavorite(u)}
      >
        {isFav(u.id) ? '★' : '☆'}
      </button>
    </div>
  )

  return (
    <div className="panel__list gl">
      <div className="seg">
        <button
          className={`seg__btn ${tab === 'reviews' ? 'is-active' : ''}`}
          onClick={() => setTab('reviews')}
        >
          Мои ревью
        </button>
        <button
          className={`seg__btn ${tab === 'create' ? 'is-active' : ''}`}
          onClick={() => setTab('create')}
        >
          Создать MR
        </button>
      </div>

      {tab === 'reviews' && (
        <>
          <div className="gl-section-title">Ждут моего ревью</div>
          {reviews === null && <div className="panel__empty">Загрузка…</div>}
          {reviews && reviews.length === 0 && <div className="hint">Нет назначенных ревью.</div>}
          {reviews?.map((mr) => (
            <MrRow key={`r-${mr.iid}`} mr={mr} />
          ))}

          <div className="gl-section-title">Мои открытые MR</div>
          {myMRs === null && <div className="panel__empty">Загрузка…</div>}
          {myMRs && myMRs.length === 0 && <div className="hint">Нет открытых MR.</div>}
          {myMRs?.map((mr) => (
            <MrRow key={`m-${mr.iid}`} mr={mr} />
          ))}
        </>
      )}

      {tab === 'create' && (
        <div className="gl-form">
          <div className="field">
            <label>Проект</label>
            <input
              className="gl-search"
              placeholder="Поиск проекта…"
              value={projectSearch}
              onChange={(e) => setProjectSearch(e.target.value)}
            />
            <div className="gl-reviewers">
              {favProjects.length > 0 && <div className="gl-reviewers-head">★ Избранные</div>}
              {favProjects.map(projectRow)}
              {favProjects.length > 0 && otherProjects.length > 0 && (
                <div className="gl-reviewers-head">Проекты</div>
              )}
              {otherProjects.map(projectRow)}
              {favProjects.length === 0 && otherProjects.length === 0 && (
                <div className="hint">Проектов не найдено.</div>
              )}
            </div>
          </div>

          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Из ветки</label>
              <input
                list="gl-branches"
                value={sourceBranch}
                onChange={(e) => setSourceBranch(e.target.value)}
                placeholder="feature/OSE-1234"
              />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>В ветку</label>
              <input
                list="gl-branches"
                value={targetBranch}
                onChange={(e) => setTargetBranch(e.target.value)}
                placeholder="develop"
              />
            </div>
            <datalist id="gl-branches">
              {branches.map((b) => (
                <option key={b} value={b} />
              ))}
            </datalist>
          </div>

          <div className="field">
            <label>Заголовок</label>
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value)
                setTitleTouched(true)
              }}
            />
          </div>
          <div className="field">
            <label>Описание</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={assignSelf}
              onChange={(e) => setAssignSelf(e.target.checked)}
            />
            Назначить меня исполнителем
          </label>

          <div className="field">
            <label>Ревьюверы</label>
            {projectId == null && <div className="hint">Сначала выберите проект.</div>}
            {projectId != null && (
              <>
                <input
                  className="gl-search"
                  placeholder="Поиск участника…"
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                />
                <div className="gl-reviewers">
                  {pinnedUsers.length > 0 && (
                    <div className="gl-reviewers-head">★ Избранные / 📌 авто</div>
                  )}
                  {pinnedUsers.map(reviewerRow)}
                  {pinnedUsers.length > 0 && filteredMembers.length > 0 && (
                    <div className="gl-reviewers-head">Участники</div>
                  )}
                  {filteredMembers.map(reviewerRow)}
                  {pinnedUsers.length === 0 && filteredMembers.length === 0 && (
                    <div className="hint">
                      {members.length === 0 ? 'Нет участников.' : 'Ничего не найдено.'}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="row">
            <button
              className="btn btn--primary"
              disabled={
                creating ||
                projectId == null ||
                !sourceBranch.trim() ||
                !targetBranch.trim() ||
                !title.trim()
              }
              onClick={() => void submit()}
            >
              {creating ? <span className="spinner" /> : 'Создать MR'}
            </button>
          </div>

          {result && !result.ok && <div className="status-msg err">{result.error}</div>}
          {result?.ok && (
            <div className="status-msg ok">
              MR создан{' '}
              <a
                href={result.webUrl}
                onClick={(e) => {
                  e.preventDefault()
                  if (result.webUrl) void window.api.openInBrowser(result.webUrl)
                }}
              >
                !{result.iid}
              </a>{' '}
              ✓{result.note && <div className="hint">{result.note}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
