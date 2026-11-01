import { useEffect, useMemo, useState } from 'react'
import type {
  EngineStatus,
  GitlabMR,
  HarnessAgent,
  HarnessEngine,
  HarnessRun,
  HarnessRunEvent,
  HarnessSource,
  HarnessStepResult,
  Prohibition,
  ReviewFinding,
  TokenUsage
} from '@shared/types'
import {
  DiffView,
  ENGINE_LABEL,
  RichText,
  SEV_LABEL,
  SnippetView,
  extractSnippet,
  parseDiff,
  type DiffFile,
  type InlineFinding
} from './DiffView'

type Sub = 'run' | 'agents' | 'prohibitions' | 'history'

/** Thousands-separated integer (ru: thin non-breaking space), e.g. 12 345. */
function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('ru-RU')
}

/** Elapsed duration from a start ISO timestamp to now: "45с" or "2:07". */
function fmtElapsedFrom(startedAt: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 1000))
  const m = Math.floor(s / 60)
  const sec = s % 60
  return m > 0 ? `${m}:${String(sec).padStart(2, '0')}` : `${sec}с`
}

/** USD cost with enough precision to be meaningful for a single review ($0.0123). */
function fmtCost(usd: number): string {
  return usd >= 1 ? `$${usd.toFixed(2)}` : `$${usd.toFixed(4)}`
}

/** Sum step usages into one total; null when no step reported anything. */
function sumUsage(steps: HarnessStepResult[]): TokenUsage | null {
  let acc: TokenUsage | null = null
  for (const s of steps) {
    const u = s.usage
    if (!u) continue
    if (!acc) {
      acc = { ...u }
      continue
    }
    acc = {
      inputTokens: acc.inputTokens + u.inputTokens,
      outputTokens: acc.outputTokens + u.outputTokens,
      cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
      cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
      totalTokens: acc.totalTokens + u.totalTokens,
      costUsd:
        acc.costUsd === undefined && u.costUsd === undefined
          ? undefined
          : (acc.costUsd ?? 0) + (u.costUsd ?? 0),
      calls: acc.calls + u.calls
    }
  }
  return acc
}

/**
 * Explicit token accounting as a row of labelled chips. `big` is the emphasized run-total
 * variant shown above a run; the compact variant sits under each step.
 */
function UsageBadges({ usage, big }: { usage: TokenUsage; big?: boolean }): JSX.Element {
  return (
    <div className={`hv-usage${big ? ' hv-usage--big' : ''}`}>
      <span className="hv-usage__total" title="Всего токенов (вход + выход)">
        Σ {fmtInt(usage.totalTokens)} ток.
      </span>
      <span className="hv-usage__chip" title="Токенов на входе (промпт + дифф + контекст)">
        ↓ вход {fmtInt(usage.inputTokens)}
      </span>
      <span className="hv-usage__chip" title="Токенов на выходе (ответ модели)">
        ↑ выход {fmtInt(usage.outputTokens)}
      </span>
      {usage.cacheReadTokens > 0 && (
        <span className="hv-usage__chip" title="Токенов прочитано из кэша промпта (не тарифицируются как новые)">
          ⚡ кэш {fmtInt(usage.cacheReadTokens)}
        </span>
      )}
      {usage.cacheCreationTokens > 0 && (
        <span className="hv-usage__chip" title="Токенов записано в кэш промпта">
          ✎ кэш+ {fmtInt(usage.cacheCreationTokens)}
        </span>
      )}
      {usage.costUsd !== undefined && (
        <span className="hv-usage__cost" title="Стоимость по данным Claude CLI">
          {fmtCost(usage.costUsd)}
        </span>
      )}
      <span className="hv-usage__chip" title="Сколько обращений к модели (ревью + переформатирование)">
        {usage.calls} вызов(ов)
      </span>
    </div>
  )
}

export function HarnessView({ gitlabEnabled }: { gitlabEnabled: boolean }): JSX.Element {
  const [sub, setSub] = useState<Sub>('run')
  const [engine, setEngine] = useState<EngineStatus | null>(null)
  // Claude engine config (API-key fallback + explicit CLI path).
  const [cfgOpen, setCfgOpen] = useState(false)
  const [claudeKey, setClaudeKey] = useState('')
  const [cliPath, setCliPath] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [cfgMsg, setCfgMsg] = useState<string | null>(null)
  const [agents, setAgents] = useState<HarnessAgent[]>([])
  const [prohibitions, setProhibitions] = useState<Prohibition[]>([])
  const [runs, setRuns] = useState<HarnessRun[]>([])

  // run tab
  const [sourceTab, setSourceTab] = useState<'mr' | 'branch'>(gitlabEnabled ? 'mr' : 'branch')
  const [mrs, setMrs] = useState<GitlabMR[]>([])
  const [selMr, setSelMr] = useState<string>('') // "projectId:iid"
  const [repo, setRepo] = useState('')
  const [base, setBase] = useState('develop')
  const [branch, setBranch] = useState('')
  const [selAgents, setSelAgents] = useState<Set<string>>(new Set())
  const [liveRun, setLiveRun] = useState<HarnessRun | null>(null)
  const [logs, setLogs] = useState<Record<string, string>>({})
  const [posting, setPosting] = useState(false)
  const [postMsg, setPostMsg] = useState<string | null>(null)

  const reviewers = agents.filter((a) => a.kind === 'reviewer')

  // Live run events.
  useEffect(() => {
    const off = window.api.onHarnessRunEvent((ev: HarnessRunEvent) => {
      if (ev.kind === 'run-start') {
        setLiveRun(ev.run)
        setLogs({})
        setPostMsg(null)
      } else if (ev.kind === 'diff') {
        setLiveRun((prev) => (prev ? { ...prev, diff: ev.diff } : prev))
      } else if (ev.kind === 'log') {
        setLogs((prev) => ({ ...prev, [ev.stepId]: ev.text }))
      } else if (ev.kind === 'step-done') {
        setLiveRun((prev) =>
          prev
            ? { ...prev, steps: prev.steps.map((s) => (s.stepId === ev.step.stepId ? ev.step : s)) }
            : prev
        )
      } else if (ev.kind === 'run-done') {
        setLiveRun(ev.run)
        void window.api.harnessListRuns().then(setRuns)
      }
    })
    return off
  }, [])

  useEffect(() => {
    void window.api.harnessEngineStatus().then(setEngine)
    void window.api.harnessClaudeConfig().then((c) => {
      setHasKey(c.hasKey)
      setCliPath(c.cliPath)
    })
    void window.api.harnessListAgents().then((a) => {
      setAgents(a)
      setSelAgents(new Set(a.filter((x) => x.kind === 'reviewer').map((x) => x.id)))
    })
    void window.api.harnessListProhibitions().then(setProhibitions)
    void window.api.harnessListRuns().then(setRuns)
    void window.api.getSettings().then((s) => {
      setRepo(s.coder.repoPath)
      setBase(s.coder.featureBase)
      if (s.coder.repoPath) {
        void window.api.agentGitInfo(s.coder.repoPath).then((g) => {
          if (g.isGit && g.branch) setBranch(g.branch)
        })
      }
    })
    if (gitlabEnabled) {
      void Promise.all([window.api.gitlabMyMRs(), window.api.gitlabMyReviews()]).then(
        ([mine, reviews]) => {
          const map = new Map<string, GitlabMR>()
          for (const mr of [...mine, ...reviews]) map.set(`${mr.projectId}:${mr.iid}`, mr)
          const list = [...map.values()]
          setMrs(list)
          if (list.length) setSelMr(`${list[0].projectId}:${list[0].iid}`)
        }
      )
    }
  }, [gitlabEnabled])

  function toggleAgent(id: string): void {
    setSelAgents((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function togglePin(agent: HarnessAgent): Promise<void> {
    setAgents(await window.api.harnessSaveAgent({ ...agent, pinned: !agent.pinned }))
  }

  async function saveClaudeCfg(): Promise<void> {
    setCfgMsg(null)
    if (claudeKey.trim()) {
      await window.api.harnessSetClaudeKey(claudeKey.trim())
      setClaudeKey('')
      setHasKey(true)
    }
    await window.api.harnessSetCliPath(cliPath)
    setCfgMsg('Сохранено ✓')
    setEngine(await window.api.harnessEngineStatus())
  }
  async function clearClaudeKey(): Promise<void> {
    await window.api.harnessSetClaudeKey('')
    setHasKey(false)
    setCfgMsg('Ключ удалён')
    setEngine(await window.api.harnessEngineStatus())
  }

  const running = liveRun?.status === 'running'

  async function startReview(): Promise<void> {
    const agentIds = [...selAgents]
    if (agentIds.length === 0) return
    if (sourceTab === 'mr') {
      const mr = mrs.find((m) => `${m.projectId}:${m.iid}` === selMr)
      if (!mr) return
      const source: HarnessSource = {
        kind: 'mr',
        label: `!${mr.iid} ${mr.title}`,
        projectId: mr.projectId,
        iid: mr.iid,
        webUrl: mr.webUrl,
        jiraKey: mr.jiraKey
      }
      await window.api.harnessReviewMr(source, agentIds)
    } else {
      if (!repo.trim() || !branch.trim()) return
      const source: HarnessSource = {
        kind: 'branch',
        label: `${branch} ← ${base}`,
        repo: repo.trim(),
        base: base.trim(),
        branch: branch.trim(),
        jiraKey: null
      }
      await window.api.harnessReviewBranch(source, agentIds)
    }
  }

  async function postComments(): Promise<void> {
    if (!liveRun) return
    setPosting(true)
    setPostMsg(null)
    const r = await window.api.harnessPostReviewComments(liveRun.id)
    setPosting(false)
    setPostMsg(r.ok ? 'Комментарии опубликованы в MR ✓' : r.error ?? 'Не удалось опубликовать')
  }

  return (
    <div className="panel__list harness">
      {/* engine status */}
      <div className="hv-engines">
        <span className={`hv-engine ${engine?.claude.cliFound ? 'is-ok' : 'is-off'}`}>
          Claude: {engine ? (engine.claude.cliFound ? engine.claude.version || 'есть' : 'нет CLI') : '…'}
        </span>
        <span className={`hv-engine ${engine?.local.reachable ? 'is-ok' : 'is-off'}`}>
          Локальная: {engine ? (engine.local.reachable ? 'доступна' : 'не запущена') : '…'}
        </span>
        <button className="hv-cfg-toggle" title="Настройки движка Claude" onClick={() => setCfgOpen((v) => !v)}>
          ⚙ Claude
        </button>
      </div>

      {cfgOpen && (
        <div className="hv-cfg">
          {engine && engine.claude.cliFound && !engine.claude.loggedIn && (
            <div className="status-msg err">
              Claude CLI не авторизован. Выполни <code>claude</code> → <code>/login</code> в
              терминале, либо укажи API-ключ ниже.
            </div>
          )}
          <div className="field">
            <label>Anthropic API-ключ {hasKey && <span className="hv-badge">сохранён</span>}</label>
            <input
              type="password"
              value={claudeKey}
              onChange={(e) => setClaudeKey(e.target.value)}
              placeholder={hasKey ? '•••••••• (оставь пустым — не менять)' : 'sk-ant-… (необязательно)'}
            />
            <div className="hint">
              Если задан — используется вместо залогиненного CLI (оплата по токенам). Пусто —
              работает подписочная сессия CLI.
            </div>
          </div>
          <div className="field">
            <label>Путь к claude CLI</label>
            <input
              value={cliPath}
              onChange={(e) => setCliPath(e.target.value)}
              placeholder="пусто = искать в PATH"
            />
          </div>
          <div className="row">
            <button className="btn btn--primary" onClick={() => void saveClaudeCfg()}>
              Сохранить
            </button>
            {hasKey && (
              <button className="btn" onClick={() => void clearClaudeKey()}>
                Удалить ключ
              </button>
            )}
            {cfgMsg && <span className="hint">{cfgMsg}</span>}
          </div>
        </div>
      )}

      <div className="hv-subnav">
        {(['run', 'agents', 'prohibitions', 'history'] as Sub[]).map((s) => (
          <button key={s} className={sub === s ? 'is-active' : ''} onClick={() => setSub(s)}>
            {s === 'run' ? 'Запуск' : s === 'agents' ? 'Агенты' : s === 'prohibitions' ? 'Запреты' : 'История'}
          </button>
        ))}
      </div>

      {sub === 'run' && (
        <RunTab
          gitlabEnabled={gitlabEnabled}
          sourceTab={sourceTab}
          setSourceTab={setSourceTab}
          mrs={mrs}
          selMr={selMr}
          setSelMr={setSelMr}
          repo={repo}
          setRepo={setRepo}
          base={base}
          setBase={setBase}
          branch={branch}
          setBranch={setBranch}
          reviewers={reviewers}
          selAgents={selAgents}
          toggleAgent={toggleAgent}
          onTogglePin={togglePin}
          running={!!running}
          onStart={() => void startReview()}
          onCancel={() => liveRun && void window.api.harnessCancel(liveRun.id)}
          liveRun={liveRun}
          logs={logs}
          posting={posting}
          postMsg={postMsg}
          onPost={() => void postComments()}
        />
      )}

      {sub === 'agents' && (
        <AgentsTab agents={agents} onChange={setAgents} engine={engine} />
      )}

      {sub === 'prohibitions' && (
        <ProhibitionsTab prohibitions={prohibitions} onChange={setProhibitions} />
      )}

      {sub === 'history' && <HistoryTab runs={runs} />}
    </div>
  )
}

// ---------------- Reviewer picker (dropdown + pin) ----------------
/** Pinned reviewers first, then the rest; order is otherwise preserved. */
function sortReviewers(reviewers: HarnessAgent[]): HarnessAgent[] {
  return reviewers
    .map((a, i) => ({ a, i }))
    .sort((x, y) => Number(Boolean(y.a.pinned)) - Number(Boolean(x.a.pinned)) || x.i - y.i)
    .map((e) => e.a)
}

/**
 * Reviewer selection as a dropdown: the summary shows who's chosen; the menu lists reviewers with
 * a checkbox and a pin toggle. Pinned reviewers (📌) sort to the top and persist on the agent.
 */
function ReviewerPicker({
  reviewers,
  selAgents,
  toggleAgent,
  onTogglePin
}: {
  reviewers: HarnessAgent[]
  selAgents: Set<string>
  toggleAgent: (id: string) => void
  onTogglePin: (agent: HarnessAgent) => void
}): JSX.Element {
  if (reviewers.length === 0) return <div className="hint">Нет агентов-ревьюверов.</div>
  const sorted = sortReviewers(reviewers)
  const chosen = sorted.filter((a) => selAgents.has(a.id))
  const summary =
    chosen.length === 0
      ? 'Никто не выбран'
      : chosen.length <= 2
        ? chosen.map((a) => a.name).join(', ')
        : `${chosen[0].name} + ещё ${chosen.length - 1}`

  return (
    <details className="hv-dropdown">
      <summary className="hv-dropdown__sum">
        <span className="hv-dropdown__text">{summary}</span>
        <span className="hv-dropdown__count">{chosen.length}</span>
        <span className="hv-dropdown__caret" />
      </summary>
      <div className="hv-dropdown__menu">
        {sorted.map((a) => (
          <div className="hv-pickrow" key={a.id}>
            <label className="checkbox-row">
              <input type="checkbox" checked={selAgents.has(a.id)} onChange={() => toggleAgent(a.id)} />
              {a.name} <span className="hv-agent-engine">· {ENGINE_LABEL[a.engine]}</span>
            </label>
            <button
              type="button"
              className={`hv-pin${a.pinned ? ' is-on' : ''}`}
              title={a.pinned ? 'Открепить' : 'Закрепить вверху'}
              onClick={() => onTogglePin(a)}
            >
              📌
            </button>
          </div>
        ))}
      </div>
    </details>
  )
}

// ---------------- Run tab ----------------
function RunTab(props: {
  gitlabEnabled: boolean
  sourceTab: 'mr' | 'branch'
  setSourceTab: (t: 'mr' | 'branch') => void
  mrs: GitlabMR[]
  selMr: string
  setSelMr: (v: string) => void
  repo: string
  setRepo: (v: string) => void
  base: string
  setBase: (v: string) => void
  branch: string
  setBranch: (v: string) => void
  reviewers: HarnessAgent[]
  selAgents: Set<string>
  toggleAgent: (id: string) => void
  onTogglePin: (agent: HarnessAgent) => void
  running: boolean
  onStart: () => void
  onCancel: () => void
  liveRun: HarnessRun | null
  logs: Record<string, string>
  posting: boolean
  postMsg: string | null
  onPost: () => void
}): JSX.Element {
  const p = props
  const canStart = p.selAgents.size > 0 && !p.running

  return (
    <>
      <div className="hv-source-tabs">
        {p.gitlabEnabled && (
          <button className={p.sourceTab === 'mr' ? 'is-active' : ''} onClick={() => p.setSourceTab('mr')}>
            MR
          </button>
        )}
        <button className={p.sourceTab === 'branch' ? 'is-active' : ''} onClick={() => p.setSourceTab('branch')}>
          Локальная ветка
        </button>
      </div>

      {p.sourceTab === 'mr' ? (
        <div className="field">
          <label>Merge request</label>
          {p.mrs.length === 0 ? (
            <div className="hint">Нет доступных MR (свои и где ты ревьювер).</div>
          ) : (
            <select value={p.selMr} onChange={(e) => p.setSelMr(e.target.value)}>
              {p.mrs.map((m) => (
                <option key={`${m.projectId}:${m.iid}`} value={`${m.projectId}:${m.iid}`}>
                  !{m.iid} — {m.title}
                </option>
              ))}
            </select>
          )}
        </div>
      ) : (
        <>
          <div className="field">
            <label>Папка репозитория</label>
            <input value={p.repo} onChange={(e) => p.setRepo(e.target.value)} placeholder="C:/work/project" />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>База</label>
              <input value={p.base} onChange={(e) => p.setBase(e.target.value)} placeholder="develop" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>Ветка</label>
              <input value={p.branch} onChange={(e) => p.setBranch(e.target.value)} placeholder="feature/…" />
            </div>
          </div>
        </>
      )}

      <div className="field">
        <label>Ревьюверы</label>
        <ReviewerPicker
          reviewers={p.reviewers}
          selAgents={p.selAgents}
          toggleAgent={p.toggleAgent}
          onTogglePin={p.onTogglePin}
        />
      </div>

      <div className="row">
        <button className="btn btn--primary" disabled={!canStart} onClick={p.onStart}>
          {p.running ? <span className="spinner" /> : 'Запустить ревью'}
        </button>
        {p.running && (
          <button className="btn" onClick={p.onCancel}>
            Остановить
          </button>
        )}
      </div>

      {p.liveRun && (
        <>
          <RunResults run={p.liveRun} logs={p.logs} />
          {p.liveRun.status !== 'running' &&
            p.liveRun.source.kind === 'mr' &&
            p.liveRun.steps.some((s) => s.status === 'done') && (
              <div className="row" style={{ marginTop: 6 }}>
                <button className="btn" disabled={p.posting} onClick={p.onPost}>
                  {p.posting ? <span className="spinner" /> : 'Запостить комментарии в MR'}
                </button>
                {p.postMsg && <span className="hint">{p.postMsg}</span>}
              </div>
            )}
        </>
      )}
    </>
  )
}

/** Filename from a path, for a compact location label. */
function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** One finding as a collapsible row: header = severity + line + title; body = code snippet,
 *  why (detail) and the proposed fix (suggestion). Expanded on demand to stay compact. */
function FindingItem({
  finding,
  files
}: {
  finding: ReviewFinding
  files: DiffFile[]
}): JSX.Element {
  const snippet = extractSnippet(files, finding.file, finding.line)
  const loc = finding.line
    ? `строка ${finding.line}`
    : finding.file
      ? baseName(finding.file)
      : 'общее'
  return (
    <details className={`hv-fi hv-sev-${finding.severity}`}>
      <summary className="hv-fi__sum">
        <span className="hv-fi__sev">{SEV_LABEL[finding.severity]}</span>
        <span className="hv-fi__loc">{loc}</span>
        <span className="hv-fi__title">{finding.title}</span>
      </summary>
      <div className="hv-fi__body">
        {snippet ? (
          <div className="hv-fi__block">
            <div className="hv-fi__label">{snippet.path}</div>
            <SnippetView lines={snippet.lines} />
          </div>
        ) : (
          finding.file && (
            <div className="hv-fi__label">
              {finding.file}
              {finding.line ? `:${finding.line}` : ''}
            </div>
          )
        )}
        <div className="hv-fi__block">
          <div className="hv-fi__label">Почему</div>
          <div className="hv-fi__text">
            <RichText text={finding.detail} />
          </div>
        </div>
        {finding.suggestion && (
          <div className="hv-fi__block hv-fi__fix">
            <div className="hv-fi__label">✅ Как исправить</div>
            <div className="hv-fi__text">
              <RichText text={finding.suggestion} />
            </div>
          </div>
        )}
      </div>
    </details>
  )
}

/** One reviewer as a collapsible panel: header shows status/count/engine; body holds the
 *  reviewer's summary and its findings (each its own dropdown), plus token usage. */
function ReviewerPanel({
  step,
  files,
  log
}: {
  step: HarnessStepResult
  files: DiffFile[]
  log?: string
}): JSX.Element {
  const done = step.status === 'done'
  const statusText =
    step.status === 'running'
      ? 'идёт…'
      : step.status === 'error'
        ? 'ошибка'
        : step.status === 'cancelled'
          ? 'отменён'
          : step.findings.length
            ? `${step.findings.length} замеч.`
            : 'без замечаний'
  return (
    <details className="hv-rp" open={done}>
      <summary className="hv-rp__sum">
        <span className="hv-rp__caret" />
        <b>{step.agentName}</b>
        <span className="hv-step__engine">{ENGINE_LABEL[step.engine]}</span>
        <span className="hv-rp__status">{statusText}</span>
        {step.status === 'running' && (
          <span className="hv-step__live">
            <span className="spinner" />
            <span className="hv-step__elapsed">{fmtElapsedFrom(step.startedAt)}</span>
            {log && <span className="hint">{log}</span>}
          </span>
        )}
      </summary>
      <div className="hv-rp__body">
        {step.status === 'error' && <div className="status-msg err">{step.error}</div>}
        {step.summary && (
          <div className="hv-summary">
            <RichText text={step.summary} />
          </div>
        )}
        {done && step.findings.length > 0 && (
          <div className="hv-fi-list">
            {step.findings.map((f, i) => (
              <FindingItem key={i} finding={f} files={files} />
            ))}
          </div>
        )}
        {step.usage && <UsageBadges usage={step.usage} />}
      </div>
    </details>
  )
}

// ---------------- Shared run results (reviewer/finding dropdowns · GitLab diff) ----------------
/** Collect every finding across the run's steps, tagged with its reviewer + engine. */
function collectFindings(run: HarnessRun): InlineFinding[] {
  return run.steps.flatMap((s) =>
    s.findings.map((f) => ({ ...f, reviewer: s.agentName, engine: s.engine }))
  )
}

/**
 * The results of a run, shared by the live Запуск view and the История detail. Two views:
 *  - «Замечания» (default): each reviewer is a dropdown; inside, each finding is its own dropdown
 *    (header = line + title) opening to a focused code snippet, the why, and the proposed fix.
 *  - «Как в GitLab»: the full reviewed diff with findings as inline comments on their lines.
 */
function RunResults({ run, logs }: { run: HarnessRun; logs?: Record<string, string> }): JSX.Element {
  const [view, setView] = useState<'findings' | 'gitlab'>('findings')

  // Re-render each second while the run is in progress so the per-step elapsed timers tick.
  const [, tick] = useState(0)
  const runningNow = run.status === 'running'
  useEffect(() => {
    if (!runningNow) return
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [runningNow])

  const files = useMemo(() => parseDiff(run.diff ?? ''), [run.diff])
  const total = sumUsage(run.steps)
  const hasDiff = Boolean(run.diff && run.diff.trim())
  const showGitlab = view === 'gitlab' && hasDiff

  return (
    <div className="hv-run">
      {total && (
        <div className="hv-run__usage">
          <span className="hv-run__usage-label">Токены за запуск</span>
          <UsageBadges usage={total} big />
        </div>
      )}

      {hasDiff && (
        <div className="hv-viewtabs">
          <button className={!showGitlab ? 'is-active' : ''} onClick={() => setView('findings')}>
            Замечания
          </button>
          <button className={showGitlab ? 'is-active' : ''} onClick={() => setView('gitlab')}>
            Как в GitLab
          </button>
        </div>
      )}

      {showGitlab ? (
        <DiffView diff={run.diff as string} findings={collectFindings(run)} />
      ) : (
        run.steps.map((step) => (
          <ReviewerPanel key={step.stepId} step={step} files={files} log={logs?.[step.stepId]} />
        ))
      )}
    </div>
  )
}

// ---------------- Agents tab ----------------
function AgentsTab({
  agents,
  onChange,
  engine
}: {
  agents: HarnessAgent[]
  onChange: (a: HarnessAgent[]) => void
  engine: EngineStatus | null
}): JSX.Element {
  const [editing, setEditing] = useState<HarnessAgent | null>(null)

  function blank(): HarnessAgent {
    return {
      id: '',
      name: 'Новый ревьювер',
      kind: 'reviewer',
      engine: 'default',
      model: '',
      focus: '',
      systemPrompt: '',
      skillIds: [],
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: [],
      builtin: false
    }
  }

  async function save(): Promise<void> {
    if (!editing) return
    onChange(await window.api.harnessSaveAgent(editing))
    setEditing(null)
  }
  async function del(id: string): Promise<void> {
    onChange(await window.api.harnessDeleteAgent(id))
  }

  if (editing) {
    return (
      <div className="hv-edit">
        <div className="field">
          <label>Имя</label>
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
        </div>
        <div className="row">
          <div className="field" style={{ flex: 1 }}>
            <label>Движок</label>
            <select
              value={editing.engine}
              onChange={(e) => setEditing({ ...editing, engine: e.target.value as HarnessEngine })}
            >
              <option value="default">Авто</option>
              <option value="claude">Claude</option>
              <option value="local">Локальная</option>
            </select>
          </div>
          <div className="field" style={{ flex: 1 }}>
            <label>Модель (необяз.)</label>
            <input
              value={editing.model}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder="sonnet / opus / …"
            />
          </div>
        </div>
        <div className="field">
          <label>Фокус</label>
          <input value={editing.focus} onChange={(e) => setEditing({ ...editing, focus: e.target.value })} />
        </div>
        <div className="field">
          <label>Системный промпт (роль)</label>
          <textarea
            value={editing.systemPrompt}
            onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
            rows={6}
          />
        </div>
        {engine && editing.engine !== 'local' && !engine.claude.cliFound && (
          <div className="hint">⚠ Claude CLI не найден — этот агент сможет работать только на локальной модели.</div>
        )}
        <div className="row">
          <button className="btn btn--primary" disabled={!editing.name.trim()} onClick={() => void save()}>
            Сохранить
          </button>
          <button className="btn" onClick={() => setEditing(null)}>
            Отмена
          </button>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="row">
        <button className="btn btn--primary" onClick={() => setEditing(blank())}>
          + Новый агент
        </button>
      </div>
      {agents.map((a) => (
        <div className="hv-card" key={a.id}>
          <div className="hv-card__head">
            <b>{a.name}</b>
            <span className="hv-agent-engine">{ENGINE_LABEL[a.engine]}</span>
            {a.builtin && <span className="hv-badge">встроенный</span>}
          </div>
          {a.focus && <div className="hint">{a.focus}</div>}
          <div className="row">
            <button className="btn" onClick={() => setEditing(a)}>
              Изменить
            </button>
            {!a.builtin && (
              <button className="btn" onClick={() => void del(a.id)}>
                Удалить
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  )
}

// ---------------- Prohibitions tab ----------------
function ProhibitionsTab({
  prohibitions,
  onChange
}: {
  prohibitions: Prohibition[]
  onChange: (p: Prohibition[]) => void
}): JSX.Element {
  const [text, setText] = useState('')

  async function add(): Promise<void> {
    if (!text.trim()) return
    onChange(
      await window.api.harnessSaveProhibition({ id: '', text: text.trim(), enabled: true, builtin: false })
    )
    setText('')
  }
  async function toggle(p: Prohibition): Promise<void> {
    onChange(await window.api.harnessSaveProhibition({ ...p, enabled: !p.enabled }))
  }
  async function del(id: string): Promise<void> {
    onChange(await window.api.harnessDeleteProhibition(id))
  }

  return (
    <>
      <div className="hint" style={{ padding: '0 2px 4px' }}>
        Встроенные запреты нельзя выключить или удалить — агенты никогда их не нарушают.
      </div>
      {prohibitions.map((p) => (
        <div className="hv-proh" key={p.id}>
          <label className="checkbox-row">
            <input type="checkbox" checked={p.enabled} disabled={p.builtin} onChange={() => void toggle(p)} />
            <span>{p.text}</span>
          </label>
          {p.builtin ? (
            <span className="hv-badge">🔒 встроенный</span>
          ) : (
            <button className="btn btn--icon" title="Удалить" onClick={() => void del(p.id)}>
              ✕
            </button>
          )}
        </div>
      ))}
      <div className="row" style={{ marginTop: 6 }}>
        <input
          style={{ flex: 1 }}
          placeholder="Добавить свой запрет…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void add()
          }}
        />
        <button className="btn" disabled={!text.trim()} onClick={() => void add()}>
          Добавить
        </button>
      </div>
    </>
  )
}

// ---------------- History tab ----------------
function HistoryTab({ runs }: { runs: HarnessRun[] }): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null)
  const open = runs.find((r) => r.id === openId)

  if (open) {
    return (
      <>
        <div className="row">
          <button className="btn" onClick={() => setOpenId(null)}>
            ← Назад
          </button>
          <span className="hint">{open.source.label}</span>
        </div>
        <RunResults run={open} />
      </>
    )
  }

  if (runs.length === 0) return <div className="panel__empty">Пока нет запусков</div>

  return (
    <>
      {runs.map((r) => {
        const total = r.steps.reduce((n, s) => n + s.findings.length, 0)
        const usage = sumUsage(r.steps)
        return (
          <div className="hv-card" key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
            <div className="hv-card__head">
              <b>{r.source.label}</b>
              <span className={`hv-badge hv-status-${r.status}`}>{r.status}</span>
            </div>
            <div className="hint">
              {new Date(r.startedAt).toLocaleString('ru-RU')} · {r.steps.length} ревьювер(ов) · {total} замечаний
              {usage && (
                <>
                  {' · '}
                  <span className="hv-usage__inline" title="Всего токенов за запуск">
                    Σ {fmtInt(usage.totalTokens)} ток.
                  </span>
                  {usage.costUsd !== undefined && <> · {fmtCost(usage.costUsd)}</>}
                </>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}
