import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../panel/Panel'
import { UpdateBanner } from '../shared/UpdateBanner'
import { Settings } from '../settings/Settings'
import { Onboarding } from '../onboarding/Onboarding'
import { CommandPalette } from './CommandPalette'
import type { FeatureToggles, PanelView } from '@shared/types'

// Sidebar sections. Task sub-views live under «Задачи» as a secondary list.
type Section = PanelView | 'settings'

// Which nav sections are gated behind an optional feature toggle (Настройки → Функции).
const FEATURE_OF: Partial<Record<Section, keyof FeatureToggles>> = {
  agent: 'agent',
  notifications: 'notifications',
  history: 'history',
  gitlab: 'gitlab'
}
const ALL_FEATURES_ON: FeatureToggles = {
  agent: true,
  notifications: true,
  history: true,
  gitlab: true
}

const TASK_SUBVIEWS: { view: PanelView; label: string }[] = [
  { view: 'prioritized', label: 'Приоритеты' },
  { view: 'inbox', label: 'Без приоритета' },
  { view: 'blocked', label: 'Заблокированные' },
  { view: 'local', label: 'Свои' },
  { view: 'completed', label: 'Завершённые' }
]
// When status blocks are configured, «Приоритеты» becomes the grouped «По блокам» list and
// the priority-based «Без приоритета» split is dropped (superseded by blocks).
const TASK_SUBVIEWS_BLOCKS: { view: PanelView; label: string }[] = [
  { view: 'prioritized', label: 'По блокам' },
  { view: 'blocked', label: 'Заблокированные' },
  { view: 'local', label: 'Свои' },
  { view: 'completed', label: 'Завершённые' }
]
const TASK_VIEWS = new Set<string>([...TASK_SUBVIEWS.map((s) => s.view), 'agent'])

const NAV: { section: Section; icon: string; label: string }[] = [
  { section: 'prioritized', icon: '✓', label: 'Задачи' },
  { section: 'create', icon: '＋', label: 'Создать' },
  { section: 'notifications', icon: '🔔', label: 'Уведомления' },
  { section: 'agent', icon: '🤖', label: 'Кодер-агент' },
  { section: 'gitlab', icon: '🦊', label: 'GitLab' },
  { section: 'history', icon: '🕘', label: 'История' },
  { section: 'archive', icon: '🗄', label: 'Архив' },
  { section: 'dashboard', icon: '📊', label: 'Панель' }
]

const TITLES: Record<string, string> = {
  prioritized: 'Задачи',
  inbox: 'Задачи',
  blocked: 'Задачи',
  local: 'Задачи',
  completed: 'Задачи',
  create: 'Создать задачу',
  notifications: 'Уведомления',
  agent: 'Кодер-агент',
  gitlab: 'GitLab',
  history: 'История',
  archive: 'Архив',
  dashboard: 'Панель',
  settings: 'Настройки'
}

export function MainApp(): JSX.Element {
  const [ready, setReady] = useState(false)
  const [onboarded, setOnboarded] = useState(true)
  const [section, setSection] = useState<Section>('prioritized')
  const [unread, setUnread] = useState(0)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [features, setFeatures] = useState<FeatureToggles>(ALL_FEATURES_ON)
  // When status blocks are configured, «Задачи» splits into groups and the sub-nav changes.
  const [hasBlocks, setHasBlocks] = useState(false)
  const taskSubviews = hasBlocks ? TASK_SUBVIEWS_BLOCKS : TASK_SUBVIEWS

  useEffect(() => {
    void window.api.getSettings().then((s) => {
      setOnboarded(s.onboardingDone)
      setFeatures(s.features)
      setHasBlocks(s.taskBlocks.length > 0)
      const gate = FEATURE_OF[s.defaultView]
      setSection(gate && !s.features[gate] ? 'prioritized' : s.defaultView)
    })
    void window.api.getIssues().then((p) => setUnread(p.unreadEvents))
    const off = window.api.onIssuesUpdated((p) => setUnread(p.unreadEvents))
    // Small splash so the shell doesn't flash before settings/data resolve.
    const t = setTimeout(() => setReady(true), 500)
    // Deep-link: main process asks to open a specific section (widget/tray/orbit).
    const offNav = window.api.onSwitchView((v) => setSection(v as Section))
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      off()
      offNav()
      clearTimeout(t)
      document.removeEventListener('keydown', onKey)
    }
  }, [])

  // If the currently-open section gets turned off, fall back to the task list.
  useEffect(() => {
    const gate = FEATURE_OF[section]
    if (gate && !features[gate]) setSection('prioritized')
  }, [features, section])

  const isFeatureOn = (s: Section): boolean => {
    const gate = FEATURE_OF[s]
    return !gate || features[gate]
  }
  const visibleNav = NAV.filter((n) => isFeatureOn(n.section))

  const isTaskSection = TASK_VIEWS.has(section)
  // Every non-settings section IS a real PanelView — pass it straight through (the earlier
  // "force prioritized" was the bug that made create/notifications/history/… show tasks).
  const panelView = (section === 'settings' ? 'prioritized' : section) as PanelView

  const paletteItems = useMemo(
    () => [
      ...visibleNav.map((n) => ({ id: n.section, label: n.label, run: () => setSection(n.section) })),
      { id: 'settings', label: 'Настройки', run: () => setSection('settings') },
      { id: 'create', label: 'Создать задачу', run: () => setSection('create') },
      { id: 'widget', label: 'Показать / скрыть виджет', run: () => void window.api.hideWidget() },
      { id: 'refresh', label: 'Обновить задачи', run: () => void window.api.refreshIssues() }
    ],
    [visibleNav]
  )

  if (!ready) {
    return (
      <div className="splash">
        <div className="splash__logo">J</div>
        <div className="spinner" />
      </div>
    )
  }

  // First-run gate: onboarding only, no sidebar/sections visible until completed.
  if (!onboarded) {
    return (
      <div className="onboarding-gate">
        <Onboarding onDone={() => setOnboarded(true)} />
      </div>
    )
  }

  return (
    <div className="shell">
      <aside className="shell__sidebar">
        <div className="shell__brand">Jira Widget</div>
        <nav className="shell__nav">
          {visibleNav.map((n) => {
            const active =
              n.section === section ||
              (n.section === 'prioritized' && isTaskSection && section !== 'agent')
            return (
              <button
                key={n.section}
                className={`shell__nav-item ${active ? 'is-active' : ''}`}
                onClick={() => setSection(n.section)}
              >
                <span className="shell__nav-icon">{n.icon}</span>
                {n.label}
                {n.section === 'notifications' && unread > 0 && (
                  <span className="menu-badge">{unread}</span>
                )}
              </button>
            )
          })}
        </nav>
        <div className="shell__nav shell__nav--bottom">
          <button
            className={`shell__nav-item ${section === 'settings' ? 'is-active' : ''}`}
            onClick={() => setSection('settings')}
          >
            <span className="shell__nav-icon">⚙</span>
            Настройки
          </button>
        </div>
      </aside>

      <main className="shell__main">
        <UpdateBanner />
        <header className="shell__top">
          <span className="shell__title">{TITLES[section] ?? ''}</span>
          {/* Secondary task sub-nav (Slack/IDEA-style), only within Задачи */}
          {isTaskSection && section !== 'agent' && (
            <div className="shell__subnav">
              {taskSubviews.map((s) => (
                <button
                  key={s.view}
                  className={`shell__subnav-item ${section === s.view ? 'is-active' : ''}`}
                  onClick={() => setSection(s.view)}
                >
                  {s.label}
                </button>
              ))}
            </div>
          )}
          <button
            className="btn btn--icon shell__palette-btn"
            title="Команды (Ctrl+K)"
            onClick={() => setPaletteOpen(true)}
          >
            ⌘K
          </button>
        </header>

        <div className="shell__content">
          {section === 'settings' ? (
            <Settings
              onFeaturesChange={setFeatures}
              onChanged={() =>
                void window.api.getSettings().then((s) => setHasBlocks(s.taskBlocks.length > 0))
              }
            />
          ) : (
            <Panel view={panelView} onNavigate={(v) => setSection(v)} chromeless />
          )}
        </div>
      </main>

      {paletteOpen && (
        <CommandPalette items={paletteItems} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  )
}
