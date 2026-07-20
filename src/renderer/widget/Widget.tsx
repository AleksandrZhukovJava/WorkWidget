import { useEffect, useRef, useState } from 'react'
import { PRIORITY_COLOR } from '@shared/priority'
import type { NotificationEvent, WidgetAppearance } from '@shared/types'

// Level bucket 0..3 (green/yellow/orange/red) for mood/weather glyphs.
function levelIndex(n: number, t: WidgetAppearance['thresholds']): number {
  if (n >= t.red) return 3
  if (n >= t.orange) return 2
  if (n >= t.yellow) return 1
  return 0
}
const MOOD = ['🙂', '😐', '😟', '😱']
const WEATHER = ['☀️', '⛅', '🌧️', '⛈️']

const EVENT_ICON: Record<NotificationEvent['type'], string> = {
  new: '🆕',
  status: '🔄',
  due: '⏰',
  comment: '💬',
  review: '👀',
  token: '🔑'
}

const DEFAULT_APPEARANCE: WidgetAppearance = {
  skin: 'classic',
  glow: true,
  thresholds: { yellow: 3, orange: 6, red: 9 },
  imageVersion: 0
}

/**
 * Ring color by active task count, boundaries user-configurable (Настройки → Виджет):
 * green below yellow-start, then yellow/orange/red. Orange/red also pulse when glow is on.
 */
function countLevel(
  n: number,
  t: WidgetAppearance['thresholds']
): { color: string; ringClass: string } {
  if (n >= t.red) return { color: 'var(--breach)', ringClass: 'is-breach' }
  if (n >= t.orange) return { color: '#fb8500', ringClass: 'is-warn' }
  if (n >= t.yellow) return { color: 'var(--warn)', ringClass: '' }
  return { color: 'var(--ok)', ringClass: '' }
}

export function Widget(): JSX.Element {
  const [count, setCount] = useState(0)
  // Active-task count per priority level (index 0..5); drives the «donut» skin.
  const [prio, setPrio] = useState<number[]>([0, 0, 0, 0, 0, 0])
  const [appearance, setAppearance] = useState<WidgetAppearance>(DEFAULT_APPEARANCE)
  const [unread, setUnread] = useState(0)
  const [vpn, setVpn] = useState<boolean | null>(null)
  const [blocked, setBlocked] = useState(0)
  const [showStats, setShowStats] = useState(true)
  const [netError, setNetError] = useState(false)
  // Drag state: start screen pos + whether the click threshold was crossed.
  const drag = useRef<{ sx: number; sy: number; moved: boolean } | null>(null)
  // True for the whole drag — while set, the hover handler must not flip the window
  // click-through, otherwise a fast flick drops the drag.
  const dragging = useRef(false)

  useEffect(() => {
    function apply(p: {
      issues: { blocked: boolean; done: boolean; localPriority?: number; status?: string }[]
      vpn: boolean | null
      showStats: boolean
      appearance?: WidgetAppearance
      unreadEvents?: number
      countedStatuses?: string[] | null
      countBlocked?: boolean
      netError?: boolean
    }): void {
      setNetError(!!p.netError)
      const notDone = p.issues.filter((i) => !i.done)
      // When task blocks define counted statuses, the ring counts exactly those; otherwise
      // the legacy "active" set. Blocked issues are excluded unless countBlocked is on.
      let active = p.countedStatuses
        ? notDone.filter((i) => p.countedStatuses!.includes(i.status ?? ''))
        : notDone
      if (!p.countBlocked) active = active.filter((i) => !i.blocked)
      setCount(active.length)
      const buckets = [0, 0, 0, 0, 0, 0]
      for (const i of active) buckets[Math.min(5, Math.max(0, i.localPriority ?? 0))]++
      setPrio(buckets)
      setVpn(p.vpn)
      setBlocked(notDone.filter((i) => i.blocked).length)
      setShowStats(p.showStats)
      if (p.appearance) setAppearance(p.appearance)
      setUnread(p.unreadEvents ?? 0)
    }
    void window.api.getIssues().then(apply)
    const off = window.api.onIssuesUpdated(apply)
    return off
  }, [])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>): void {
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { sx: e.screenX, sy: e.screenY, moved: false }
    dragging.current = true
    // Pin the window interactive for the whole drag so the hover handler can't drop it.
    setInteractive(true)
    // Main follows the OS cursor from here; we only signal start.
    window.api.widgetDragStart(e.screenX, e.screenY)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    if (!d) return
    if (!d.moved && Math.hypot(e.screenX - d.sx, e.screenY - d.sy) > 4) d.moved = true
  }

  function endDrag(e: React.PointerEvent<HTMLDivElement>): void {
    const d = drag.current
    drag.current = null
    dragging.current = false
    try {
      e.currentTarget.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
    if (!d) return
    window.api.widgetDragEnd() // stops the cursor poll + persists position
    // A press without movement = a click → open the panel.
    if (!d.moved) void window.api.openPanel()
  }

  // Custom-image skin background, refetched only when a new image is picked.
  const [bgImage, setBgImage] = useState<string | null>(null)
  useEffect(() => {
    if (appearance.skin !== 'image') return
    void window.api.getWidgetImage().then((r) => setBgImage(r.dataUrl))
  }, [appearance.skin, appearance.imageVersion])

  const { color, ringClass } = countLevel(count, appearance.thresholds)
  const skin = appearance.skin
  const skinClass = `skin-${skin} ${appearance.glow ? '' : 'no-glow'}`
  // Gauge skin: ring fill fraction of the way to the red threshold.
  const fillDeg = Math.round(Math.min(1, count / Math.max(1, appearance.thresholds.red)) * 360)

  const lvl = levelIndex(count, appearance.thresholds)

  // Donut skin: conic-gradient of the ring split by priority (highest first, then unprioritized).
  const donutGradient = (() => {
    const total = prio.reduce((a, b) => a + b, 0)
    if (total === 0) return 'conic-gradient(#30363d 0deg 360deg)'
    const order = [5, 4, 3, 2, 1, 0]
    let acc = 0
    const stops: string[] = []
    for (const level of order) {
      const c = prio[level]
      if (c === 0) continue
      const from = (acc / total) * 360
      acc += c
      const to = (acc / total) * 360
      const col = level === 0 ? '#30363d' : PRIORITY_COLOR[level as 1 | 2 | 3 | 4 | 5]
      stops.push(`${col} ${from}deg ${to}deg`)
    }
    return `conic-gradient(${stops.join(', ')})`
  })()

  // Particles skin: drifting dots, denser with load.
  const particleCount = skin === 'particles' ? Math.min(6 + count * 3, 40) : 0

  // These skins print the blocked count as a line UNDER the count/face (terminal-style etc.)
  // instead of the usual top-corner badge.
  const blockedUnder = skin === 'crt' || skin === 'mood' || skin === 'weather'

  // Digits skin: flying number glyphs bouncing around a square (Windows-screensaver vibe).
  const digitCount = skin === 'digits' ? 16 : 0
  const flyingDigits = Array.from({ length: digitCount }).map((_, i) => ({
    ch: String((i * 7 + count) % 10),
    x: (i * 61) % 100,
    y: (i * 37) % 100,
    dx: (((i * 53) % 60) - 30) * 1.4,
    dy: (((i * 29) % 60) - 30) * 1.4,
    d: 3 + (i % 6) * 0.9
  }))

  // The window is a fixed, mostly-transparent 224px square that's click-through by default.
  // We watch the cursor's distance from the ring center and, with hysteresis, (a) reveal the
  // orbit and (b) tell main to capture the mouse only while over the ring/orbit zone — so the
  // window never moves (no jump/oscillation) and transparent areas never block the desktop.
  const [expanded, setExpanded] = useState(false)
  const interactive = useRef(false)
  const expandedRef = useRef(false)
  // While true, hover is ignored until the cursor leaves — so acting on a button (which
  // collapses the orbit) doesn't immediately re-open it while the cursor is still over the ring.
  const suppressUntilLeave = useRef(false)

  function setInteractive(on: boolean): void {
    if (interactive.current === on) return
    interactive.current = on
    window.api.widgetSetInteractive(on)
  }
  function collapse(): void {
    expandedRef.current = false
    setExpanded(false)
    setInteractive(false)
    suppressUntilLeave.current = true
  }

  useEffect(() => {
    const CENTER = 130 // half of the 260px window
    const RING_R = 62 // enter: cursor over the ring
    const ORBIT_R = 130 // leave: cursor past the whole orbit zone

    function onMove(e: MouseEvent): void {
      // While dragging, keep the window captured no matter where the cursor is relative to
      // center — otherwise a fast flick briefly reads as "far from center" and drops the drag.
      if (dragging.current) {
        setInteractive(true)
        return
      }
      const dist = Math.hypot(e.clientX - CENTER, e.clientY - CENTER)
      // Re-arm hover only after the cursor has fully left the orbit zone.
      if (suppressUntilLeave.current) {
        if (dist > ORBIT_R) suppressUntilLeave.current = false
        else {
          setInteractive(false)
          return
        }
      }
      if (!expandedRef.current && dist <= RING_R) expandedRef.current = true
      else if (expandedRef.current && dist > ORBIT_R) expandedRef.current = false
      setExpanded(expandedRef.current)
      setInteractive(dist <= (expandedRef.current ? ORBIT_R : RING_R))
    }
    function onLeave(): void {
      expandedRef.current = false
      suppressUntilLeave.current = false
      setExpanded(false)
      setInteractive(false)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseleave', onLeave)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseleave', onLeave)
    }
  }, [])

  // Newest-events preview shown when hovering the orbit's notifications button.
  const [preview, setPreview] = useState<NotificationEvent[] | null>(null)
  async function loadPreview(): Promise<void> {
    setPreview((await window.api.getEvents()).slice(0, 2))
  }

  // Fanned across the top arc (degrees from vertical; negative = left). Acting on a button
  // collapses the orbit — the choice is made, so it shouldn't linger open.
  const act = (fn: () => void) => () => {
    fn()
    collapse()
  }
  const orbit: {
    angle: number
    icon: string
    title: string
    onClick: () => void
    badge?: number
    preview?: boolean
  }[] = [
    { angle: -72, icon: '📋', title: 'Задачи', onClick: act(() => void window.api.openPanel()) },
    { angle: -36, icon: '➕', title: 'Создать задачу', onClick: act(() => void window.api.openPanel('create')) },
    { angle: 0, icon: '🔔', title: 'Уведомления', onClick: act(() => void window.api.openPanel('notifications')), badge: unread, preview: true },
    { angle: 36, icon: '⚙️', title: 'Настройки', onClick: act(() => void window.api.openSettings()) },
    { angle: 72, icon: '✕', title: 'Скрыть виджет', onClick: act(() => void window.api.hideWidget()) }
  ]

  return (
    <div className={`widget ${expanded ? 'is-expanded' : ''}`}>
      {orbit.map((b, i) => (
        <button
          key={b.title}
          className="widget__orbit"
          style={{ ['--angle' as string]: `${b.angle}deg`, transitionDelay: `${i * 30}ms` }}
          title={b.title}
          onClick={b.onClick}
          onMouseEnter={b.preview ? () => void loadPreview() : undefined}
          onMouseLeave={b.preview ? () => setPreview(null) : undefined}
        >
          {b.icon}
          {b.badge !== undefined && b.badge > 0 && (
            <span className="widget__orbit-badge">{b.badge > 9 ? '9+' : b.badge}</span>
          )}
        </button>
      ))}
      {expanded && preview && (
        <div className="widget__preview">
          <div className="widget__preview-title">Новые события</div>
          {preview.length === 0 && <div className="widget__preview-empty">пусто</div>}
          {preview.map((e) => (
            <div key={e.id} className={`widget__preview-item ${e.read ? '' : 'is-unread'}`}>
              <span>{EVENT_ICON[e.type]}</span> <b>{e.issueKey}</b> {e.text}
            </div>
          ))}
        </div>
      )}
      {/* Passive unread signal on the ring — only while the orbit is collapsed. */}
      {unread > 0 && !expanded && (
        <button
          className="widget__bell"
          title={`Непрочитанных событий: ${unread}`}
          onClick={() => void window.api.openPanel('notifications')}
        >
          🔔<span className="widget__bell-count">{unread > 9 ? '9+' : unread}</span>
        </button>
      )}
      <div
        className={`widget__ring ${skinClass} ${ringClass}`}
        style={{
          ['--level' as string]: color,
          ['--fill' as string]: `${fillDeg}deg`,
          ...(skin === 'donut' ? { ['--donut' as string]: donutGradient } : {}),
          ...(skin === 'image' && bgImage
            ? {
                backgroundImage: `linear-gradient(rgba(5, 8, 14, 0.15), rgba(5, 8, 14, 0.6)), url(${bgImage})`
              }
            : {})
        }}
        title="Перетащите, чтобы переместить · клик — открыть задачи"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="widget__spark" />
        {Array.from({ length: particleCount }).map((_, i) => (
          <span
            key={i}
            className="widget__particle"
            style={{
              ['--a' as string]: `${(i * 137) % 360}deg`,
              ['--r' as string]: `${16 + ((i * 11) % 26)}px`,
              ['--d' as string]: `${1.4 + (i % 5) * 0.35}s`
            }}
          />
        ))}
        {flyingDigits.map((d, i) => (
          <span
            key={i}
            className="widget__digit"
            style={{
              left: `${d.x}%`,
              top: `${d.y}%`,
              ['--dx' as string]: `${d.dx}px`,
              ['--dy' as string]: `${d.dy}px`,
              ['--d' as string]: `${d.d}s`
            }}
          >
            {d.ch}
          </span>
        ))}
        {(skin === 'mood' || skin === 'weather') && (
          <span className="widget__face">{skin === 'mood' ? MOOD[lvl] : WEATHER[lvl]}</span>
        )}
        {showStats && blocked > 0 && !blockedUnder && (
          <span className="widget__blocked" title={`Заблокировано: ${blocked}`}>
            🚫{blocked}
          </span>
        )}
        {netError ? (
          <>
            <span
              className="widget__count widget__count--err"
              title="Нет связи с Jira — проверьте сеть/VPN"
            >
              ⚠
            </span>
            <span className="widget__label">нет сети</span>
          </>
        ) : (
          <>
            <span className="widget__count">{count}</span>
            <span className="widget__label">задач</span>
          </>
        )}
        {showStats && blocked > 0 && blockedUnder && (
          <span className="widget__blocked-under" title={`Заблокировано: ${blocked}`}>
            {skin === 'crt' ? `blocked: ${blocked}` : `🚫 ${blocked}`}
          </span>
        )}
        {vpn !== null && (
          <span
            className="widget__vpn"
            style={{ ['--vpn' as string]: vpn ? 'var(--ok)' : 'var(--breach)' }}
            title={vpn ? 'VPN включён' : 'VPN выключен'}
          />
        )}
      </div>
    </div>
  )
}
