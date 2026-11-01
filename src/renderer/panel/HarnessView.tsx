import { useEffect, useState } from 'react'
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
  ReviewFinding
} from '@shared/types'

type Sub = 'run' | 'agents' | 'prohibitions' | 'history'

const SEV_LABEL: Record<ReviewFinding['severity'], string> = {
  critical: '🔴',
  major: '🟠',
  minor: '🟡',
  nit: '⚪',
  praise: '🟢'
}

const ENGINE_LABEL: Record<HarnessEngine, string> = {
  default: 'Авто',
  claude: 'Claude',
  local: 'Локальная'
}

/** Render text preserving line breaks and simple **bold** — so a prose summary is readable. */
function RichText({ text }: { text: string }): JSX.Element {
  return (
    <div className="hv-rich">
      {text.split('\n').map((line, i) => (
        <div className="hv-rich__line" key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
            seg.startsWith('**') && seg.endsWith('**') ? (
              <b key={j}>{seg.slice(2, -2)}</b>
            ) : (
              <span key={j}>{seg}</span>
            )
          )}
        </div>
      ))}
    </div>
  )
}

function Findings({ step }: { step: HarnessStepResult }): JSX.Element {
  if (step.status === 'error') return <div className="status-msg err">{step.error}</div>
  if (step.status === 'running') {
    return (
      <div className="hint">
        <span className="spinner" /> выполняется…
      </div>
    )
  }
  return (
    <>
      {step.summary && (
        <div className="hv-summary">
          <RichText text={step.summary} />
        </div>
      )}
      {step.findings.length === 0 ? (
        !step.summary && <div className="hint">замечаний нет</div>
      ) : (
        step.findings.map((f, i) => (
          <div className={`hv-finding hv-sev-${f.severity}`} key={i}>
            <div className="hv-finding__head">
              <span className="hv-finding__sev">{SEV_LABEL[f.severity]}</span>
              <b>{f.title}</b>
              {f.file && (
                <span className="hv-finding__loc">
                  {f.file}
                  {f.line ? `:${f.line}` : ''}
                </span>
              )}
            </div>
            <div className="hv-finding__detail">{f.detail}</div>
            {f.suggestion && <div className="hv-finding__sug">💡 {f.suggestion}</div>}
          </div>
        ))
      )}
    </>
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
        {p.reviewers.length === 0 && <div className="hint">Нет агентов-ревьюверов.</div>}
        {p.reviewers.map((a) => (
          <label className="checkbox-row" key={a.id}>
            <input type="checkbox" checked={p.selAgents.has(a.id)} onChange={() => p.toggleAgent(a.id)} />
            {a.name} <span className="hv-agent-engine">· {ENGINE_LABEL[a.engine]}</span>
          </label>
        ))}
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
        <div className="hv-run">
          {p.liveRun.steps.map((step) => (
            <div className="hv-step" key={step.stepId}>
              <div className="hv-step__head">
                <b>{step.agentName}</b>
                <span className="hv-step__engine">{ENGINE_LABEL[step.engine]}</span>
                {step.status === 'running' && p.logs[step.stepId] && (
                  <span className="hint">{p.logs[step.stepId]}</span>
                )}
              </div>
              <Findings step={step} />
            </div>
          ))}
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
        </div>
      )}
    </>
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
      <div className="hv-run">
        <div className="row">
          <button className="btn" onClick={() => setOpenId(null)}>
            ← Назад
          </button>
          <span className="hint">{open.source.label}</span>
        </div>
        {open.steps.map((step) => (
          <div className="hv-step" key={step.stepId}>
            <div className="hv-step__head">
              <b>{step.agentName}</b>
              <span className="hv-step__engine">{ENGINE_LABEL[step.engine]}</span>
            </div>
            <Findings step={step} />
          </div>
        ))}
      </div>
    )
  }

  if (runs.length === 0) return <div className="panel__empty">Пока нет запусков</div>

  return (
    <>
      {runs.map((r) => {
        const total = r.steps.reduce((n, s) => n + s.findings.length, 0)
        return (
          <div className="hv-card" key={r.id} onClick={() => setOpenId(r.id)} style={{ cursor: 'pointer' }}>
            <div className="hv-card__head">
              <b>{r.source.label}</b>
              <span className={`hv-badge hv-status-${r.status}`}>{r.status}</span>
            </div>
            <div className="hint">
              {new Date(r.startedAt).toLocaleString('ru-RU')} · {r.steps.length} ревьювер(ов) · {total} замечаний
            </div>
          </div>
        )
      })}
    </>
  )
}
