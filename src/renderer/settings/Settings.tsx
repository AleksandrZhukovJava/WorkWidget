import { useEffect, useRef, useState } from 'react'
import type {
  AppSettings,
  AuthMode,
  FeatureToggles,
  JiraConfig,
  PanelView,
  TaskBlock
} from '@shared/types'
import { applyTheme } from '../theme'

type Msg = { ok: boolean; text: string } | null

// Archive isn't offered as a startup view — it's a lookup, not a working list.
const DEFAULT_VIEW_OPTIONS: { value: PanelView; label: string }[] = [
  { value: 'prioritized', label: 'Приоритеты' },
  { value: 'inbox', label: 'Без приоритета' },
  { value: 'blocked', label: 'Заблокирован' },
  { value: 'local', label: 'Свои' },
  { value: 'history', label: 'История' },
  { value: 'dashboard', label: 'Панель' }
]

type SettingsTab =
  | 'connection'
  | 'params'
  | 'features'
  | 'blocks'
  | 'widget'
  | 'notifications'
  | 'ai'
  | 'coder'
  | 'gitlab'

const TAB_TITLES: Record<SettingsTab, string> = {
  connection: 'Подключение к Jira',
  params: 'Параметры',
  features: 'Функции',
  blocks: 'Блоки задач',
  widget: 'Виджет',
  notifications: 'Уведомления',
  ai: 'ИИ-помощник',
  coder: 'Кодер-агент',
  gitlab: 'GitLab'
}

const LOCAL_STATUS = 'Своя задача' // status used for local tasks in blocks

const FEATURE_LABELS: { key: keyof FeatureToggles; label: string; hint: string }[] = [
  { key: 'agent', label: 'Кодер-агент', hint: 'Генерация патчей, ветки git, применение и коммит' },
  { key: 'notifications', label: 'Уведомления', hint: 'Раздел уведомлений в боковом меню' },
  { key: 'history', label: 'История', hint: 'Раздел «История» с выбором даты' },
  { key: 'gitlab', label: 'GitLab', hint: 'Merge request’ы, ревью, связь с задачами' }
]

export function Settings({
  onFeaturesChange,
  onChanged
}: {
  /** notify the shell so the sidebar/palette update live when a feature is toggled */
  onFeaturesChange?: (features: FeatureToggles) => void
  /** notify the shell after any settings change (e.g. task blocks affect «Задачи» routing) */
  onChanged?: () => void
} = {}): JSX.Element {
  const [config, setConfig] = useState<JiraConfig | null>(null)
  const [method, setMethod] = useState<AuthMode>('oauth')

  const [tab, setTab] = useState<SettingsTab>('connection')

  // token fields
  const [baseUrl, setBaseUrl] = useState('')
  const [email, setEmail] = useState('')
  const [apiToken, setApiToken] = useState('')

  // oauth fields
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [copied, setCopied] = useState(false)

  // server (self-hosted / DC) fields
  const [serverUrl, setServerUrl] = useState('')
  const [serverPat, setServerPat] = useState('')

  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)

  const [projects, setProjects] = useState<{ key: string; name: string }[] | null>(null)
  const [projectsError, setProjectsError] = useState<string | null>(null)

  const [widgetImgMsg, setWidgetImgMsg] = useState<Msg>(null)

  // LLM assistant
  const [llmKey, setLlmKey] = useState('')
  const [llmHasKey, setLlmHasKey] = useState(false)
  const [llmTesting, setLlmTesting] = useState(false)
  const [llmMsg, setLlmMsg] = useState<Msg>(null)

  async function testLlmConn(): Promise<void> {
    setLlmTesting(true)
    setLlmMsg(null)
    const res = await window.api.llmTest()
    setLlmTesting(false)
    setLlmMsg(
      res.ok
        ? { ok: true, text: 'LLM отвечает ✓' }
        : { ok: false, text: res.error ?? 'Нет связи с LLM' }
    )
  }

  // Coder-agent tab
  const [coderKey, setCoderKey] = useState('')
  const [coderTesting, setCoderTesting] = useState(false)
  const [coderMsg, setCoderMsg] = useState<Msg>(null)

  // GitLab tab
  const [glConfig, setGlConfig] = useState<{ connected: boolean; displayName: string } | null>(null)
  const [glUrl, setGlUrl] = useState('')
  const [glPat, setGlPat] = useState('')
  const [glBusy, setGlBusy] = useState(false)
  const [glMsg, setGlMsg] = useState<Msg>(null)
  const [glExpiry, setGlExpiry] = useState('')
  const [projectStatuses, setProjectStatuses] = useState<string[]>([])

  async function saveGitlab(): Promise<void> {
    setGlBusy(true)
    setGlMsg(null)
    const res = await window.api.gitlabSave({
      baseUrl: glUrl.trim(),
      pat: glPat.trim(),
      expiry: glExpiry
    })
    setGlBusy(false)
    if (res.ok) {
      setGlPat('')
      setGlConfig({ connected: true, displayName: res.displayName ?? '' })
      setGlMsg({ ok: true, text: `Подключено: ${res.displayName ?? ''}` })
    } else {
      setGlMsg({ ok: false, text: res.error ?? 'Не удалось подключиться' })
    }
  }

  async function disconnectGitlab(): Promise<void> {
    await window.api.gitlabDisconnect()
    setGlConfig({ connected: false, displayName: '' })
    setGlMsg(null)
  }

  async function testCoderConn(): Promise<void> {
    setCoderTesting(true)
    setCoderMsg(null)
    const res = await window.api.agentTestCoder()
    setCoderTesting(false)
    setCoderMsg(
      res.ok
        ? { ok: true, text: 'Модель отвечает ✓' }
        : { ok: false, text: res.error ?? 'Нет связи с моделью' }
    )
  }

  async function loadProjects(): Promise<void> {
    setProjects(null)
    setProjectsError(null)
    const res = await window.api.getProjects()
    if (res.ok) setProjects(res.projects ?? [])
    else setProjectsError(res.error ?? 'Не удалось загрузить список проектов')
  }

  async function reloadConfig(): Promise<void> {
    const c = await window.api.getConfig()
    setConfig(c)
    setBaseUrl(c.baseUrl)
    setEmail(c.email)
    setServerUrl(c.server.baseUrl)
    setClientId('') // never prefilled; presence shown via flags
    const initial: AuthMode = c.server.connected
      ? 'server'
      : c.oauth.connected
        ? 'oauth'
        : c.authMode
    setMethod(initial)
  }

  useEffect(() => {
    void reloadConfig()
    void window.api.getSettings().then((s) => {
      setSettings(s)
      committedMyField.current = { label: s.myFieldLabel, incl: s.myFieldIncludeAssignee }
    })
    void loadProjects()
    void window.api.llmGetStatus().then((s) => setLlmHasKey(s.hasKey))
    void window.api.gitlabConfig().then((c) => {
      setGlConfig({ connected: c.connected, displayName: c.displayName })
      setGlUrl(c.baseUrl)
      setGlExpiry(c.tokenExpiry)
    })
    void window.api.getProjectStatuses().then(setProjectStatuses)
  }, [])

  /** Patch a single GitLab-automation field. */
  async function patchAutomation(patch: Partial<AppSettings['gitlabAutomation']>): Promise<void> {
    if (!settings) return
    await patchSettings({ gitlabAutomation: { ...settings.gitlabAutomation, ...patch } })
  }

  // ---- Task blocks management ----
  const taskBlocks = settings?.taskBlocks ?? []
  function saveBlocks(next: TaskBlock[]): void {
    void patchSettings({ taskBlocks: next })
  }
  function addBlock(): void {
    saveBlocks([
      ...taskBlocks,
      { id: crypto.randomUUID(), name: 'Новый блок', statuses: [], counted: false }
    ])
  }
  function updateBlock(id: string, patch: Partial<TaskBlock>): void {
    saveBlocks(taskBlocks.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }
  function removeBlock(id: string): void {
    saveBlocks(taskBlocks.filter((b) => b.id !== id))
  }
  function moveBlock(id: string, dir: -1 | 1): void {
    const i = taskBlocks.findIndex((b) => b.id === id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= taskBlocks.length) return
    const next = [...taskBlocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveBlocks(next)
  }
  function toggleBlockStatus(id: string, status: string): void {
    const b = taskBlocks.find((x) => x.id === id)
    if (!b) return
    const statuses = b.statuses.includes(status)
      ? b.statuses.filter((s) => s !== status)
      : [...b.statuses, status]
    updateBlock(id, { statuses })
  }

  /** Status picker: a dropdown of the project's real statuses (falls back to a text input
   * when statuses can't be loaded — e.g. no connection / project key). */
  function statusPicker(value: string, onChange: (v: string) => void): JSX.Element {
    if (projectStatuses.length === 0) {
      return (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Название статуса"
        />
      )
    }
    // Include the current value so a previously-saved status still shows even if the list
    // changed; the user can then re-pick the correct one.
    const options = [...new Set([value, ...projectStatuses].filter(Boolean))]
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— не выбран —</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
    )
  }

  async function patchSettings(patch: Partial<AppSettings>): Promise<void> {
    setSettings(await window.api.updateSettings(patch))
    onChanged?.()
  }

  /** Toggle an optional feature and let the shell update its sidebar/palette immediately. */
  async function toggleFeature(key: keyof FeatureToggles, on: boolean): Promise<void> {
    if (!settings) return
    const features = { ...settings.features, [key]: on }
    const next = await window.api.updateSettings({ features })
    setSettings(next)
    onFeaturesChange?.(next.features)
  }

  // Last committed "my field" value — the input/checkbox edit local state freely, and the
  // change is only applied when the user presses the explicit "Подтвердить" button.
  const committedMyField = useRef<{ label: string; incl: boolean } | null>(null)

  const myFieldDirty =
    !!settings &&
    !!committedMyField.current &&
    (settings.myFieldLabel.trim() !== committedMyField.current.label ||
      settings.myFieldIncludeAssignee !== committedMyField.current.incl)

  async function confirmMyField(): Promise<void> {
    if (!settings) return
    const next = {
      label: settings.myFieldLabel.trim(),
      incl: settings.myFieldIncludeAssignee
    }
    committedMyField.current = next
    await patchSettings({ myFieldLabel: next.label, myFieldIncludeAssignee: next.incl })
  }

  function revertMyField(): void {
    if (!settings || !committedMyField.current) return
    setSettings({
      ...settings,
      myFieldLabel: committedMyField.current.label,
      myFieldIncludeAssignee: committedMyField.current.incl
    })
  }

  // ---- OAuth ----
  async function login(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await window.api.startOAuth({ clientId, clientSecret })
    setBusy(false)
    if (res.ok) {
      setClientSecret('')
      setMsg({ ok: true, text: `Вход выполнен: ${res.displayName}` })
      await reloadConfig()
    } else {
      setMsg({ ok: false, text: res.error ?? 'Не удалось войти' })
    }
  }

  async function disconnect(): Promise<void> {
    await window.api.oauthDisconnect()
    setMsg(null)
    await reloadConfig()
  }

  function copyRedirect(): void {
    if (!config) return
    void navigator.clipboard.writeText(config.oauth.redirectUri).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  // ---- token ----
  async function testToken(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await window.api.testConnection({ baseUrl, email, apiToken })
    setBusy(false)
    setMsg(
      res.ok
        ? { ok: true, text: `Подключение успешно: ${res.displayName}` }
        : { ok: false, text: res.error ?? 'Ошибка подключения' }
    )
  }

  async function saveToken(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await window.api.saveCredentials({ baseUrl, email, apiToken })
    setBusy(false)
    if (res.ok) {
      setApiToken('')
      setMsg({ ok: true, text: `Сохранено. Вошли как ${res.displayName}` })
      await reloadConfig()
    } else {
      setMsg({ ok: false, text: res.error ?? 'Не удалось сохранить' })
    }
  }

  // ---- server (self-hosted / DC) ----
  async function testServer(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await window.api.testServer({ baseUrl: serverUrl, pat: serverPat })
    setBusy(false)
    setMsg(
      res.ok
        ? { ok: true, text: `Подключение успешно: ${res.displayName}` }
        : { ok: false, text: res.error ?? 'Ошибка подключения' }
    )
  }

  async function saveServer(): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await window.api.saveServer({ baseUrl: serverUrl, pat: serverPat })
    setBusy(false)
    if (res.ok) {
      setServerPat('')
      setMsg({ ok: true, text: `Сохранено. Вошли как ${res.displayName}` })
      await reloadConfig()
    } else {
      setMsg({ ok: false, text: res.error ?? 'Не удалось сохранить' })
    }
  }

  async function serverDisconnect(): Promise<void> {
    await window.api.serverDisconnect()
    setMsg(null)
    await reloadConfig()
  }

  if (!config) return <div className="settings">Загрузка…</div>

  return (
    <div className="settings">
      <div className="settings__tabs">
        {(Object.keys(TAB_TITLES) as SettingsTab[]).map((t) => (
          <button
            key={t}
            className={`settings__tab ${tab === t ? 'is-active' : ''}`}
            onClick={() => setTab(t)}
          >
            {TAB_TITLES[t]}
          </button>
        ))}
      </div>

      {tab === 'features' && (
        <div className="settings__section">
          <p className="hint">
            Отключённые функции скрываются из бокового меню и палитры команд. Данные и настройки
            сохраняются — включите обратно в любой момент.
          </p>
          {FEATURE_LABELS.map((f) => (
            <label className="checkbox-row" key={f.key}>
              <input
                type="checkbox"
                checked={settings?.features?.[f.key] ?? true}
                onChange={(e) => void toggleFeature(f.key, e.target.checked)}
              />
              <span>
                <b>{f.label}</b>
                <span className="hint" style={{ display: 'block' }}>
                  {f.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}

      {tab === 'gitlab' && (
        <div className="settings__section">
          <p className="hint">
            Подключение к GitLab по личному токену (PAT со scope <b>api</b>). Действия — только
            безопасные: создание MR, ревьюверы, назначение себя. Мердж и force-push недоступны.
          </p>
          {glConfig?.connected && (
            <div className="status-msg ok">
              Подключено{glConfig.displayName ? `: ${glConfig.displayName}` : ''} ✓
            </div>
          )}
          <div className="field">
            <label>Адрес GitLab</label>
            <input
              value={glUrl}
              onChange={(e) => setGlUrl(e.target.value)}
              placeholder="https://gitlab.example.com"
            />
          </div>
          <div className="field">
            <label>Personal Access Token</label>
            <input
              type="password"
              value={glPat}
              onChange={(e) => setGlPat(e.target.value)}
              placeholder={glConfig?.connected ? '•••••••• (сохранён)' : 'glpat-…'}
            />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>Дата истечения токена (опц.)</label>
              <input
                type="date"
                value={glExpiry}
                onChange={(e) => {
                  setGlExpiry(e.target.value)
                  void window.api.gitlabSetExpiry(e.target.value)
                }}
              />
            </div>
            <div className="field" style={{ width: 170 }}>
              <label>Предупреждать за (дней)</label>
              <input
                type="number"
                min={0}
                max={90}
                value={settings?.gitlabTokenWarnDays ?? 7}
                onChange={(e) =>
                  void patchSettings({
                    gitlabTokenWarnDays: Math.max(0, Math.min(90, Number(e.target.value) || 0))
                  })
                }
              />
            </div>
          </div>
          <p className="hint">
            Если дата задана — при запуске виджета раз в день будет напоминание, что токен скоро
            истекает (за указанное число дней). 0 — не напоминать.
          </p>
          <div className="row">
            <button
              className="btn btn--primary"
              disabled={glBusy || !glUrl.trim() || !glPat.trim()}
              onClick={() => void saveGitlab()}
            >
              {glBusy ? <span className="spinner" /> : 'Подключить'}
            </button>
            {glConfig?.connected && (
              <button className="btn" onClick={() => void disconnectGitlab()}>
                Отключить
              </button>
            )}
          </div>
          {glMsg && <div className={`status-msg ${glMsg.ok ? 'ok' : 'err'}`}>{glMsg.text}</div>}

          <div className="settings__subhead">Ревью</div>
          <div className="field">
            <label>Когда убирать MR из «Ждут моего ревью»</label>
            <select
              value={settings?.gitlabReviewApprovalMode ?? 'current'}
              onChange={(e) =>
                void patchSettings({
                  gitlabReviewApprovalMode: e.target.value as
                    | 'has'
                    | 'current'
                    | 'always'
                })
              }
            >
              <option value="has">Есть апрув — хотя бы раз поставил (больше не показывать)</option>
              <option value="current">
                Текущий апрув — пока стоит (вернётся, если апрув слетит)
              </option>
              <option value="always">Всегда показывать — даже с апрувом</option>
            </select>
          </div>

          <div className="settings__subhead">Автоматизация Jira</div>
          <p className="hint">
            Опционально: перевод связанной задачи по статусам при событиях MR. Переход идёт по
            воркфлоу Jira (может пройти несколько шагов); статусы должны существовать в проекте.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings?.gitlabAutomation.onMrCreated ?? false}
              onChange={(e) => void patchAutomation({ onMrCreated: e.target.checked })}
            />
            При создании MR → перевести задачу в статус:
          </label>
          <div className="field">
            {statusPicker(settings?.gitlabAutomation.readyToReviewStatus ?? '', (v) =>
              void patchAutomation({ readyToReviewStatus: v })
            )}
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings?.gitlabAutomation.onMrApproved ?? false}
              onChange={(e) => void patchAutomation({ onMrApproved: e.target.checked })}
            />
            При апруве MR → перевести задачу в статус:
          </label>
          <div className="field">
            {statusPicker(settings?.gitlabAutomation.readyForTestStatus ?? '', (v) =>
              void patchAutomation({ readyForTestStatus: v })
            )}
          </div>
        </div>
      )}

      {tab === 'blocks' && (
        <div className="settings__section">
          <p className="hint">
            Группируйте задачи раздела «Задачи» по статусам. Порядок блоков = порядок сверху вниз
            (учитываемые в счётчике удобно поставить наверх). Отметьте, какие блоки идут в счётчик
            виджета. Задачи вне блоков попадают в «Прочее».
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings?.countBlocked ?? false}
              onChange={(e) => void patchSettings({ countBlocked: e.target.checked })}
            />
            Учитывать заблокированные задачи в счётчике виджета
          </label>
          {taskBlocks.length === 0 && <div className="hint">Пока нет блоков.</div>}
          {taskBlocks.map((b, idx) => (
            <div className="block-editor" key={b.id}>
              <div className="row">
                <input
                  value={b.name}
                  onChange={(e) => updateBlock(b.id, { name: e.target.value })}
                  placeholder="Название блока"
                  style={{ flex: 1 }}
                />
                <button className="btn" title="Выше" disabled={idx === 0} onClick={() => moveBlock(b.id, -1)}>
                  ↑
                </button>
                <button
                  className="btn"
                  title="Ниже"
                  disabled={idx === taskBlocks.length - 1}
                  onClick={() => moveBlock(b.id, 1)}
                >
                  ↓
                </button>
                <button className="btn" title="Удалить блок" onClick={() => removeBlock(b.id)}>
                  ✕
                </button>
              </div>
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={b.counted}
                  onChange={(e) => updateBlock(b.id, { counted: e.target.checked })}
                />
                Учитывать в счётчике виджета
              </label>
              <div className="block-editor__statuses">
                {[...new Set([LOCAL_STATUS, ...projectStatuses, ...b.statuses])].map((s) => (
                  <label className="checkbox-row" key={s}>
                    <input
                      type="checkbox"
                      checked={b.statuses.includes(s)}
                      onChange={() => toggleBlockStatus(b.id, s)}
                    />
                    {s === LOCAL_STATUS ? 'Свои задачи' : s}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn btn--primary" onClick={() => addBlock()}>
              + Добавить блок
            </button>
          </div>
        </div>
      )}

      {tab === 'connection' && (
        <>
      <div className="seg">
        <button
          className={`seg__btn ${method === 'server' ? 'is-active' : ''}`}
          onClick={() => setMethod('server')}
        >
          Jira Server (PAT)
        </button>
        <button
          className={`seg__btn ${method === 'oauth' ? 'is-active' : ''}`}
          onClick={() => setMethod('oauth')}
        >
          Облако (OAuth)
        </button>
        <button
          className={`seg__btn ${method === 'token' ? 'is-active' : ''}`}
          onClick={() => setMethod('token')}
        >
          API token
        </button>
      </div>

      {method === 'server' && (
        <>
          {config.server.connected ? (
            <div className="status-msg ok">
              Подключено: {config.server.displayName} — {config.server.baseUrl}
            </div>
          ) : (
            <p className="hint">
              Для self-hosted Jira (например jira.company.com). Создай Personal Access Token в
              своём профиле Jira: аватар справа вверху → <b>Profile</b> → <b>Personal Access
              Tokens</b> → <b>Create token</b>. Админ не нужен.
            </p>
          )}

          <div className="field">
            <label>Адрес Jira</label>
            <input
              placeholder="https://jira.company.com"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Personal Access Token {config.server.hasPat && '(сохранён)'}</label>
            <input
              type="password"
              placeholder={config.server.hasPat ? '••••••••••••' : 'Вставьте PAT'}
              value={serverPat}
              onChange={(e) => setServerPat(e.target.value)}
            />
            <div className="hint">Хранится в Windows Credential Manager, в renderer не передаётся.</div>
          </div>

          {msg && <div className={`status-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

          <div className="actions-row">
            <button className="btn" disabled={busy} onClick={() => void testServer()}>
              {busy ? <span className="spinner" /> : 'Проверить'}
            </button>
            <button className="btn btn--primary" disabled={busy} onClick={() => void saveServer()}>
              Сохранить
            </button>
            {config.server.connected && (
              <button className="btn" disabled={busy} onClick={() => void serverDisconnect()}>
                Отключить
              </button>
            )}
          </div>
        </>
      )}

      {method === 'oauth' && (
        <>
          {config.oauth.connected ? (
            <div className="status-msg ok">
              Подключено: {config.oauth.displayName} — {config.oauth.siteUrl}
            </div>
          ) : (
            <p className="hint">
              Откроется обычное окно входа Atlassian (твой SSO). Нужно один раз создать
              OAuth-приложение на developer.atlassian.com (без админа).
            </p>
          )}

          <div className="field">
            <label>Redirect URL — впиши его в настройки OAuth-приложения (Callback URL)</label>
            <div className="row">
              <input readOnly value={config.oauth.redirectUri} />
              <button className="btn" onClick={copyRedirect}>
                {copied ? '✓' : 'Копировать'}
              </button>
            </div>
          </div>

          <div className="field">
            <label>Client ID {config.oauth.hasClientId && '(сохранён)'}</label>
            <input
              placeholder={config.oauth.hasClientId ? '•••••• (введите для замены)' : 'Client ID'}
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
          </div>

          <div className="field">
            <label>Client Secret {config.oauth.hasSecret && '(сохранён)'}</label>
            <input
              type="password"
              placeholder={config.oauth.hasSecret ? '••••••••••••' : 'Client Secret'}
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <div className="hint">Хранится в Windows Credential Manager, в renderer не передаётся.</div>
          </div>

          {msg && <div className={`status-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

          <div className="actions-row">
            <button
              className="btn btn--primary"
              disabled={busy || (!clientId && !config.oauth.hasClientId) || (!clientSecret && !config.oauth.hasSecret)}
              onClick={() => void login()}
            >
              {busy ? <span className="spinner" /> : 'Войти через браузер'}
            </button>
            {config.oauth.connected && (
              <button className="btn" disabled={busy} onClick={() => void disconnect()}>
                Отключить
              </button>
            )}
          </div>
        </>
      )}

      {method === 'token' && (
        <>
          <div className="field">
            <label>Адрес Jira (base URL)</label>
            <input
              placeholder="https://your-domain.atlassian.net"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
          <div className="field">
            <label>Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label>API token {config.hasToken && '(сохранён — оставьте пустым, чтобы не менять)'}</label>
            <input
              type="password"
              placeholder={config.hasToken ? '••••••••••••' : 'Вставьте API token'}
              value={apiToken}
              onChange={(e) => setApiToken(e.target.value)}
            />
            <div className="hint">
              Создать токен: id.atlassian.com → Security → Create and manage API tokens
            </div>
          </div>

          {msg && <div className={`status-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>}

          <div className="actions-row">
            <button className="btn" disabled={busy} onClick={() => void testToken()}>
              {busy ? <span className="spinner" /> : 'Проверить'}
            </button>
            <button className="btn btn--primary" disabled={busy} onClick={() => void saveToken()}>
              Сохранить
            </button>
          </div>
        </>
      )}

        </>
      )}

      {tab === 'params' && settings && (
        <>
          <div className="field">
            <label>Задача считается моей по полю (пусто = стандартный Assignee)</label>
            <input
              value={settings.myFieldLabel}
              onChange={(e) => setSettings({ ...settings, myFieldLabel: e.target.value })}
              placeholder="Исполнитель / QA / …"
            />
            <label className="checkbox-row" style={{ marginTop: 6 }}>
              <input
                type="checkbox"
                checked={settings.myFieldIncludeAssignee}
                disabled={!settings.myFieldLabel.trim()}
                onChange={(e) =>
                  setSettings({ ...settings, myFieldIncludeAssignee: e.target.checked })
                }
              />
              учитывать также Assignee (главное поле — указанное выше)
            </label>
            {myFieldDirty && (
              <>
                <div className="status-msg" style={{ marginTop: 8 }}>
                  Список задач в виджете пересоберётся под новое поле. Приоритеты,
                  блокировки и архив привязаны к номерам задач и сохранятся.
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <button className="btn btn--primary" onClick={() => void confirmMyField()}>
                    Подтвердить смену
                  </button>
                  <button className="btn" onClick={revertMyField}>
                    Отмена
                  </button>
                </div>
              </>
            )}
            <div className="hint">
              Название поля — как в форме задачи Jira (например «Исполнитель»). Изменение
              применяется только после кнопки «Подтвердить смену».
            </div>
          </div>

          <div className="field">
            <label>JQL фильтр «мои задачи»</label>
            <textarea
              value={settings.jql}
              onChange={(e) => setSettings({ ...settings, jql: e.target.value })}
              onBlur={() => void patchSettings({ jql: settings.jql })}
            />
          </div>

          <div className="field">
            <label>Вкладка по умолчанию (открывается при запуске / клике на виджет)</label>
            <select
              value={settings.defaultView}
              onChange={(e) =>
                void patchSettings({ defaultView: e.target.value as PanelView })
              }
            >
              {DEFAULT_VIEW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label>Проект для новых задач</label>
            {projectsError ? (
              <div className="status-msg err">
                {projectsError}
                <button className="btn" style={{ marginLeft: 8 }} onClick={() => void loadProjects()}>
                  Повторить
                </button>
              </div>
            ) : (
              <div className="row">
                <select
                  value={settings.jiraProjectKey}
                  disabled={projects === null}
                  onChange={(e) => void patchSettings({ jiraProjectKey: e.target.value })}
                >
                  <option value="" disabled>
                    {projects === null ? 'Загрузка проектов…' : 'Выбери проект…'}
                  </option>
                  {settings.jiraProjectKey &&
                    projects?.every((p) => p.key !== settings.jiraProjectKey) && (
                      <option value={settings.jiraProjectKey}>
                        {settings.jiraProjectKey} (текущий)
                      </option>
                    )}
                  {projects?.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.key} — {p.name}
                    </option>
                  ))}
                </select>
                <button
                  className="btn btn--icon"
                  title="Обновить список проектов"
                  onClick={() => void loadProjects()}
                >
                  ⟳
                </button>
              </div>
            )}
            <div className="hint">Нужен для кнопки «+» — создания задачи из виджета.</div>
          </div>

          <div className="field">
            <label>Название поля «Исполнитель» в Jira (необязательно)</label>
            <input
              value={settings.implementerFieldLabel}
              onChange={(e) =>
                setSettings({ ...settings, implementerFieldLabel: e.target.value })
              }
              onBlur={() =>
                void patchSettings({ implementerFieldLabel: settings.implementerFieldLabel })
              }
              placeholder="Исполнитель"
            />
            <div className="hint">
              Впиши точно как поле подписано в форме задачи Jira. Оставь пустым, если такого
              поля нет — тогда «Назначить на себя» проставит только стандартный Assignee.
            </div>
          </div>

          <div className="field">
            <label>Автозаполнение поля «QA» при переходе в статус</label>
            <div className="row">
              <input
                value={settings.qaFieldLabel}
                onChange={(e) => setSettings({ ...settings, qaFieldLabel: e.target.value })}
                onBlur={() => void patchSettings({ qaFieldLabel: settings.qaFieldLabel })}
                placeholder="QA"
                title="Название поля QA в форме задачи Jira"
              />
              <input
                value={settings.qaTriggerStatus}
                onChange={(e) => setSettings({ ...settings, qaTriggerStatus: e.target.value })}
                onBlur={() => void patchSettings({ qaTriggerStatus: settings.qaTriggerStatus })}
                placeholder="Testing"
                title="Статус, при переходе в который заполнять QA"
              />
            </div>
            <div className="hint">
              Слева — название поля «QA» (как в форме задачи), справа — статус (напр. «Testing»).
              При переходе задачи в этот статус, если поле QA пустое, туда подставишься ты. Оставь
              название поля пустым, чтобы выключить.
            </div>
          </div>

          <div className="field">
            <label>Интервал обновления (минуты)</label>
            <input
              type="number"
              min={1}
              value={settings.pollIntervalMinutes}
              onChange={(e) =>
                setSettings({ ...settings, pollIntervalMinutes: Number(e.target.value) })
              }
              onBlur={() =>
                void patchSettings({
                  pollIntervalMinutes: Math.max(1, settings.pollIntervalMinutes)
                })
              }
            />
          </div>

          <div className="field checkbox-row">
            <input
              id="autostart"
              type="checkbox"
              checked={settings.autostart}
              onChange={(e) => void patchSettings({ autostart: e.target.checked })}
            />
            <label htmlFor="autostart" style={{ margin: 0 }}>
              Запускать вместе с Windows
            </label>
          </div>
        </>
      )}

      {tab === 'widget' && settings && (
        <>
          <div className="field">
            <label>Тема оформления</label>
            <select
              value={settings.theme}
              onChange={(e) => {
                const theme = e.target.value as AppSettings['theme']
                applyTheme(theme) // live, before the round-trip
                void patchSettings({ theme })
              }}
            >
              <option value="dark">Тёмная</option>
              <option value="light">Светлая</option>
            </select>
          </div>

          <div className="field">
            <label>Скин виджета</label>
            <select
              value={settings.widgetAppearance.skin}
              onChange={(e) =>
                void patchSettings({
                  widgetAppearance: {
                    ...settings.widgetAppearance,
                    skin: e.target.value as AppSettings['widgetAppearance']['skin']
                  }
                })
              }
            >
              <option value="classic">Классический круг</option>
              <option value="gauge">Датчик (кольцо-прогресс до красного порога)</option>
              <option value="hex">Шестиугольник</option>
              <option value="card">Карточка</option>
              <option value="image">Своя картинка</option>
              <option value="minimal">Минимал (плоский, без искры)</option>
              <option value="neon">Неон (яркое свечение)</option>
              <option value="glass">Стекло (Fluent, размытие)</option>
              <option value="crt">Терминал (CRT, скан-линии)</option>
              <option value="pixel">Пиксель (8-bit)</option>
              <option value="gem">Кристалл (огранка)</option>
              <option value="donut">Пончик приоритетов</option>
              <option value="mood">Настроение (лицо)</option>
              <option value="weather">Погода</option>
              <option value="particles">Частицы</option>
              <option value="digits">Квадрат с летающими цифрами</option>
            </select>
          </div>

          <div className="field">
            <label>Своя картинка (фон виджета для скина «Своя картинка»)</label>
            <div className="row">
              <button
                className="btn"
                onClick={() =>
                  void window.api.pickWidgetImage().then(async (r) => {
                    if (r.ok) setSettings(await window.api.getSettings())
                    setWidgetImgMsg(
                      r.ok
                        ? { ok: true, text: 'Картинка установлена ✓' }
                        : r.error
                          ? { ok: false, text: r.error }
                          : null
                    )
                  })
                }
              >
                Выбрать картинку…
              </button>
              <button
                className="btn"
                onClick={() =>
                  void window.api.clearWidgetImage().then(async () => {
                    setSettings(await window.api.getSettings())
                    setWidgetImgMsg(null)
                  })
                }
              >
                Убрать
              </button>
            </div>
            {widgetImgMsg && (
              <div className={`status-msg ${widgetImgMsg.ok ? 'ok' : 'err'}`}>
                {widgetImgMsg.text}
              </div>
            )}
            <div className="hint">
              PNG/JPG/GIF/WebP до 8 МБ. После выбора скин переключится на «Своя картинка»
              автоматически; поверх картинки остаётся цветная окантовка-индикатор.
            </div>
          </div>

          <div className="field checkbox-row">
            <input
              id="glow"
              type="checkbox"
              checked={settings.widgetAppearance.glow}
              onChange={(e) =>
                void patchSettings({
                  widgetAppearance: { ...settings.widgetAppearance, glow: e.target.checked }
                })
              }
            />
            <label htmlFor="glow" style={{ margin: 0 }}>
              Эффект подсветки (свечение и пульсация кольца)
            </label>
          </div>

          <div className="field">
            <label>Пороги цвета кольца (число активных задач, с которого начинается цвет)</label>
            {(
              [
                ['yellow', 'Жёлтый от'],
                ['orange', 'Оранжевый от'],
                ['red', 'Красный от']
              ] as const
            ).map(([key, label]) => (
              <div className="row" key={key} style={{ marginTop: 6, alignItems: 'center' }}>
                <span style={{ width: 110, fontSize: 12 }}>{label}</span>
                <input
                  type="number"
                  min={1}
                  style={{ width: 80 }}
                  value={settings.widgetAppearance.thresholds[key]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      widgetAppearance: {
                        ...settings.widgetAppearance,
                        thresholds: {
                          ...settings.widgetAppearance.thresholds,
                          [key]: Number(e.target.value)
                        }
                      }
                    })
                  }
                  onBlur={() => {
                    // Keep the boundaries sane and strictly ascending.
                    const t = settings.widgetAppearance.thresholds
                    const yellow = Math.max(1, t.yellow || 1)
                    const orange = Math.max(yellow + 1, t.orange || yellow + 1)
                    const red = Math.max(orange + 1, t.red || orange + 1)
                    void patchSettings({
                      widgetAppearance: {
                        ...settings.widgetAppearance,
                        thresholds: { yellow, orange, red }
                      }
                    })
                  }}
                />
              </div>
            ))}
            <div className="hint">
              Меньше жёлтого порога — зелёный. По умолчанию: 3 / 6 / 9 (то есть &lt;3 зелёный,
              3–5 жёлтый, 6–8 оранжевый, 9+ красный).
            </div>
          </div>
        </>
      )}

      {tab === 'notifications' && settings && (
        <>
          {(
            [
              ['enabled', 'Показывать уведомления (события + мигающий значок на виджете)'],
              ['push', 'Windows-уведомления (тосты) — по умолчанию выключено'],
              ['newTasks', 'Новые задачи'],
              ['statusChanges', 'Смена статуса'],
              ['dueSoon', 'Приближение / просрочка срока'],
              ['comments', 'Новые комментарии']
            ] as const
          ).map(([key, label]) => (
            <div className="field checkbox-row" key={key}>
              <input
                id={`ntf-${key}`}
                type="checkbox"
                checked={settings.notifications[key] as boolean}
                disabled={key !== 'enabled' && !settings.notifications.enabled}
                onChange={(e) =>
                  void patchSettings({
                    notifications: { ...settings.notifications, [key]: e.target.checked }
                  })
                }
              />
              <label htmlFor={`ntf-${key}`} style={{ margin: 0 }}>
                {label}
              </label>
            </div>
          ))}

          <div className="field">
            <label>Считать срок «скоро» за сколько часов</label>
            <input
              type="number"
              min={1}
              style={{ width: 90 }}
              value={settings.notifications.dueSoonHours}
              disabled={!settings.notifications.enabled || !settings.notifications.dueSoon}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    dueSoonHours: Number(e.target.value)
                  }
                })
              }
              onBlur={() =>
                void patchSettings({
                  notifications: {
                    ...settings.notifications,
                    dueSoonHours: Math.max(1, settings.notifications.dueSoonHours || 24)
                  }
                })
              }
            />
          </div>

          <div className="field">
            <label>Хранить события (дней), старше — удаляются</label>
            <input
              type="number"
              min={1}
              style={{ width: 90 }}
              value={settings.notifications.retentionDays}
              disabled={!settings.notifications.enabled}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  notifications: {
                    ...settings.notifications,
                    retentionDays: Number(e.target.value)
                  }
                })
              }
              onBlur={() =>
                void patchSettings({
                  notifications: {
                    ...settings.notifications,
                    retentionDays: Math.max(1, settings.notifications.retentionDays || 7)
                  }
                })
              }
            />
          </div>

          <div className="hint">
            События копятся в списке «Уведомления» (бургер-меню панели). Комментарии
            требуют доп. запросов к Jira — можно отключить отдельно.
          </div>
        </>
      )}

      {tab === 'coder' && settings && (
        <>
          <div className="hint" style={{ marginBottom: 10 }}>
            Отдельная кодер-модель: по задаче Jira предлагает изменения в коде (пункт
            «🤖 Сгенерировать патч» в меню карточки). Пока только просмотр диффа — ничего
            не применяется и не коммитится.
          </div>

          <div className="field">
            <label>Адрес сервера (base URL)</label>
            <input
              value={settings.coder.baseUrl}
              onChange={(e) =>
                setSettings({ ...settings, coder: { ...settings.coder, baseUrl: e.target.value } })
              }
              onBlur={() => void patchSettings({ coder: settings.coder })}
              placeholder="http://localhost:1234/v1"
            />
          </div>

          <div className="field">
            <label>Модель</label>
            <input
              value={settings.coder.model}
              onChange={(e) =>
                setSettings({ ...settings, coder: { ...settings.coder, model: e.target.value } })
              }
              onBlur={() => void patchSettings({ coder: settings.coder })}
              placeholder="qwen2.5-coder-7b-instruct"
            />
            <div className="hint">Точный id модели из LM Studio (или любого совместимого сервера).</div>
          </div>

          <div className="field">
            <label>API-ключ (не нужен для LM Studio)</label>
            <div className="row">
              <input
                type="password"
                value={coderKey}
                onChange={(e) => setCoderKey(e.target.value)}
                placeholder="Оставь пустым для локального сервера"
              />
              <button
                className="btn"
                disabled={!coderKey.trim()}
                onClick={() => void window.api.agentSetCoderKey(coderKey.trim()).then(() => setCoderKey(''))}
              >
                Сохранить
              </button>
            </div>
          </div>

          <div className="field">
            <label>Папка проекта</label>
            <div className="row">
              <input
                value={settings.coder.repoPath}
                onChange={(e) =>
                  setSettings({ ...settings, coder: { ...settings.coder, repoPath: e.target.value } })
                }
                onBlur={() => void patchSettings({ coder: settings.coder })}
                placeholder="C:\work\my-project"
              />
              <button
                className="btn"
                onClick={() =>
                  void window.api.agentPickRepo().then(async (r) => {
                    if (r.ok) setSettings(await window.api.getSettings())
                  })
                }
              >
                Выбрать…
              </button>
            </div>
            <div className="hint">
              Агент читает проект (git grep, а для не-git — обход файлов) и ищет релевантные
              файлы под задачу. Только чтение — ничего не меняется.
            </div>
          </div>

          <div className="field">
            <label>Путь к IntelliJ IDEA (лаунчер)</label>
            <div className="row">
              <input
                value={settings.coder.ideaPath}
                onChange={(e) =>
                  setSettings({ ...settings, coder: { ...settings.coder, ideaPath: e.target.value } })
                }
                onBlur={() => void patchSettings({ coder: settings.coder })}
                placeholder="C:\Program Files\JetBrains\IntelliJ IDEA\bin\idea64.exe"
              />
              <button
                className="btn"
                onClick={() =>
                  void window.api.agentPickIdea().then(async (r) => {
                    if (r.ok) setSettings(await window.api.getSettings())
                  })
                }
              >
                Выбрать…
              </button>
            </div>
            <div className="hint">Для кнопки «Открыть в IDEA» рядом с найденными файлами.</div>
          </div>

          <h1 style={{ fontSize: 15, marginTop: 18 }}>Ветки git</h1>
          <div className="hint" style={{ marginBottom: 10 }}>
            Мастер агента создаёт ветку под задачу. В форматах <code>{'{key}'}</code> — номер
            задачи Jira.
          </div>
          {(
            [
              ['featureBase', 'База для feature-ветки', 'develop'],
              ['hotfixBase', 'База для hotfix-ветки', 'main'],
              ['branchFormat', 'Формат имени feature-ветки', 'feature/{key}'],
              ['hotfixFormat', 'Формат имени hotfix-ветки', 'hotfix/{key}'],
              ['remote', 'Remote для обновления', 'origin']
            ] as const
          ).map(([key, label, ph]) => (
            <div className="field" key={key}>
              <label>{label}</label>
              <input
                value={settings.coder[key]}
                onChange={(e) =>
                  setSettings({ ...settings, coder: { ...settings.coder, [key]: e.target.value } })
                }
                onBlur={() => void patchSettings({ coder: settings.coder })}
                placeholder={ph}
              />
            </div>
          ))}

          <div className="actions-row">
            <button className="btn" disabled={coderTesting} onClick={() => void testCoderConn()}>
              {coderTesting ? <span className="spinner" /> : 'Проверить связь с моделью'}
            </button>
          </div>
          {coderMsg && <div className={`status-msg ${coderMsg.ok ? 'ok' : 'err'}`}>{coderMsg.text}</div>}
        </>
      )}

      {tab === 'ai' && settings && (
        <>
          <div className="hint" style={{ marginBottom: 10 }}>
            Оформляет описание задачи по шаблону из твоего свободного текста (кнопка
            «✨ Сформулировать» в форме создания). Любой OpenAI-совместимый сервер. Если
            локальный сервер LM Studio не запущен — виджет поднимет его сам; модель можно
            не указывать, возьмётся первая доступная.
          </div>

          <div className="field">
            <label>Пресет</label>
            <select
              value=""
              onChange={(e) => {
                const p = e.target.value
                if (p === 'lmstudio')
                  void patchSettings({
                    llm: { ...settings.llm, baseUrl: 'http://localhost:1234/v1', model: '' }
                  })
                if (p === 'openai')
                  void patchSettings({
                    llm: {
                      ...settings.llm,
                      baseUrl: 'https://api.openai.com/v1',
                      model: 'gpt-4o-mini'
                    }
                  })
                e.target.value = ''
              }}
            >
              <option value="" disabled>
                Выбрать пресет…
              </option>
              <option value="lmstudio">LM Studio (локально, бесплатно)</option>
              <option value="openai">OpenAI API</option>
            </select>
          </div>

          <div className="field">
            <label>Адрес сервера (base URL)</label>
            <input
              value={settings.llm.baseUrl}
              onChange={(e) =>
                setSettings({ ...settings, llm: { ...settings.llm, baseUrl: e.target.value } })
              }
              onBlur={() => void patchSettings({ llm: settings.llm })}
              placeholder="http://localhost:1234/v1"
            />
          </div>

          <div className="field">
            <label>Модель (для LM Studio можно оставить пустым)</label>
            <input
              value={settings.llm.model}
              onChange={(e) =>
                setSettings({ ...settings, llm: { ...settings.llm, model: e.target.value } })
              }
              onBlur={() => void patchSettings({ llm: settings.llm })}
              placeholder="gpt-4o-mini"
            />
          </div>

          <div className="field">
            <label>API-ключ {llmHasKey && '(сохранён — оставь пустым, чтобы не менять)'}</label>
            <div className="row">
              <input
                type="password"
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
                placeholder={llmHasKey ? '••••••••••••' : 'Не нужен для LM Studio'}
              />
              <button
                className="btn"
                disabled={!llmKey.trim()}
                onClick={() =>
                  void window.api.llmSetKey(llmKey.trim()).then(() => {
                    setLlmKey('')
                    setLlmHasKey(true)
                  })
                }
              >
                Сохранить
              </button>
              {llmHasKey && (
                <button
                  className="btn"
                  title="Удалить сохранённый ключ"
                  onClick={() =>
                    void window.api.llmSetKey('').then(() => setLlmHasKey(false))
                  }
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>Шаблон описания задачи (LLM заполняет разделы по нему)</label>
            <textarea
              style={{ minHeight: 140 }}
              value={settings.llm.promptTemplate}
              onChange={(e) =>
                setSettings({
                  ...settings,
                  llm: { ...settings.llm, promptTemplate: e.target.value }
                })
              }
              onBlur={() => void patchSettings({ llm: settings.llm })}
            />
          </div>

          <div className="actions-row">
            <button className="btn" disabled={llmTesting} onClick={() => void testLlmConn()}>
              {llmTesting ? <span className="spinner" /> : 'Проверить связь с LLM'}
            </button>
          </div>
          {llmMsg && <div className={`status-msg ${llmMsg.ok ? 'ok' : 'err'}`}>{llmMsg.text}</div>}
        </>
      )}
    </div>
  )
}
