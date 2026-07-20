import { useEffect, useMemo, useState } from 'react'
import { PRIORITY_LABEL, type PriorityLevel } from '@shared/priority'
import { JiraMarkup } from './JiraMarkup'
import type { ChecklistItem, JiraIssue, JiraTransition } from '@shared/types'

/**
 * Full-task detail overlay opened from a card's «Подробнее» button. Consolidates the Jira
 * description, all task actions (moved here out of the compact card), and the purely-local
 * progress checklist. It reads `issue` fresh from the parent's live list, so checklist/status
 * edits reflect after the poller rebroadcast without any local mirror of that state.
 */
export function IssueDetail({
  issue,
  onClose,
  onGenerate
}: {
  issue: JiraIssue
  onClose: () => void
  onGenerate?: (issue: JiraIssue) => void
}): JSX.Element {
  const [desc, setDesc] = useState<string | null>(null)
  const [transitions, setTransitions] = useState<JiraTransition[] | null>(null)
  const [statuses, setStatuses] = useState<string[] | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const [blockEditing, setBlockEditing] = useState(false)
  const [blockText, setBlockText] = useState(issue.blockReason)

  const [newItem, setNewItem] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  // Load Jira description + available actions once per task (only for real Jira issues).
  useEffect(() => {
    if (issue.isLocal) {
      setDesc('')
      return
    }
    let cancelled = false
    setDesc(null)
    window.api
      .getIssueDescription(issue.key)
      .then((d) => !cancelled && setDesc(d))
      .catch(() => !cancelled && setDesc(''))
    if (!issue.done) {
      window.api.getTransitions(issue.key).then((t) => !cancelled && setTransitions(t)).catch(() => !cancelled && setTransitions([]))
      window.api.getStatuses(issue.key).then((s) => !cancelled && setStatuses(s)).catch(() => !cancelled && setStatuses([]))
    }
    return () => {
      cancelled = true
    }
  }, [issue.key, issue.isLocal, issue.done])

  // Close on Escape.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  async function run(
    label: string,
    fn: () => Promise<{ ok: boolean; error?: string }>,
    closeAfter = false
  ): Promise<void> {
    setBusy(true)
    setMsg(null)
    const res = await fn()
    setBusy(false)
    setMsg(res.ok ? `${label} ✓` : res.error ?? 'Ошибка')
    if (res.ok && closeAfter) onClose()
  }

  // ---- checklist (whole-array replace; store keys by issue.key) ----
  const items = issue.checklist ?? []
  const doneCount = items.filter((i) => i.done).length

  function save(next: ChecklistItem[]): void {
    void window.api.setChecklist(issue.key, next)
  }
  function addItem(): void {
    const text = newItem.trim()
    if (!text) return
    const item: ChecklistItem = {
      id: crypto.randomUUID(),
      text,
      done: false,
      createdAt: new Date().toISOString()
    }
    save([...items, item])
    setNewItem('')
  }
  function toggleItem(id: string): void {
    save(items.map((i) => (i.id === id ? { ...i, done: !i.done } : i)))
  }
  function deleteItem(id: string): void {
    save(items.filter((i) => i.id !== id))
    if (editingId === id) setEditingId(null)
  }
  function beginEdit(item: ChecklistItem): void {
    setEditingId(item.id)
    setEditText(item.text)
  }
  function commitEdit(): void {
    const text = editText.trim()
    if (editingId && text) save(items.map((i) => (i.id === editingId ? { ...i, text } : i)))
    setEditingId(null)
  }
  // Drag-to-reorder: move item from `from` to `to`, then persist the whole array.
  function reorder(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= items.length) return
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    save(next)
  }

  const prioLabel = useMemo(
    () => (issue.localPriority > 0 ? PRIORITY_LABEL[issue.localPriority as PriorityLevel] : ''),
    [issue.localPriority]
  )

  return (
    <div className="issue-detail__overlay" onMouseDown={onClose}>
      <div className="issue-detail" onMouseDown={(e) => e.stopPropagation()}>
        <div className="issue-detail__head">
          <div className="issue-detail__id">
            {issue.isLocal ? (
              <span className="issue__key issue__key--local">Своя задача</span>
            ) : (
              <span
                className="issue__key"
                title="Открыть в браузере"
                onClick={() => void window.api.openInBrowser(issue.url)}
              >
                {issue.key}
              </span>
            )}
            {!issue.isLocal && <span className="issue__status">{issue.status}</span>}
            {issue.done && <span className="issue__done-badge">✓</span>}
            {issue.blocked && <span className="issue__block-badge" title={issue.blockReason}>🚫</span>}
            {prioLabel && <span className="issue-detail__prio">⚑ {prioLabel}</span>}
          </div>
          <button className="issue-detail__close" title="Закрыть (Esc)" onClick={onClose}>
            ✕
          </button>
        </div>

        <div
          className="issue-detail__title"
          title="Кликните, чтобы скопировать название"
          onClick={() => void window.api.copyText(issue.summary)}
        >
          {issue.summary}
        </div>

        {issue.blocked && <div className="issue__blocked-note">🚫 {issue.blockReason}</div>}

        {/* --- Описание из Jira --- */}
        {!issue.isLocal && (
          <div className="issue-detail__section">
            <div className="issue-detail__section-title">Описание</div>
            {desc === null ? (
              <div className="hint">Загрузка описания…</div>
            ) : desc.trim() ? (
              <div className="issue-detail__desc">
                <JiraMarkup text={desc} />
              </div>
            ) : (
              <div className="hint">Без описания</div>
            )}
          </div>
        )}

        {/* --- Пункты выполнения (локальный чеклист) --- */}
        <div className="issue-detail__section">
          <div className="issue-detail__section-title">
            Пункты выполнения
            {items.length > 0 && (
              <span className="checklist__progress">
                {doneCount}/{items.length} ☑
              </span>
            )}
          </div>
          <ul className="checklist">
            {items.map((item, index) => (
              <li
                key={item.id}
                className={`checklist__item ${item.done ? 'is-done' : ''} ${
                  dragIndex === index ? 'is-dragging' : ''
                } ${overIndex === index && dragIndex !== index ? 'is-over' : ''}`}
                draggable={editingId === null}
                onDragStart={(e) => {
                  setDragIndex(index)
                  // Carry the source index in the drag payload so the drop handler never
                  // depends on React state having re-rendered between dragstart and drop.
                  e.dataTransfer.setData('text/plain', String(index))
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'move'
                  if (overIndex !== index) setOverIndex(index)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  const from = Number(e.dataTransfer.getData('text/plain'))
                  if (Number.isInteger(from)) reorder(from, index)
                  setDragIndex(null)
                  setOverIndex(null)
                }}
                onDragEnd={() => {
                  setDragIndex(null)
                  setOverIndex(null)
                }}
              >
                <span className="checklist__grip" title="Перетащите, чтобы изменить порядок">
                  ⠿
                </span>
                <button
                  className="checklist__check"
                  title={item.done ? 'Снять отметку' : 'Отметить выполненным'}
                  onClick={() => toggleItem(item.id)}
                >
                  {item.done ? '☑' : '☐'}
                </button>
                {editingId === item.id ? (
                  <input
                    className="checklist__edit"
                    autoFocus
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onBlur={commitEdit}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitEdit()
                      if (e.key === 'Escape') setEditingId(null)
                    }}
                  />
                ) : (
                  <span className="checklist__text" onDoubleClick={() => beginEdit(item)}>
                    {item.text}
                  </span>
                )}
                <button className="checklist__act" title="Редактировать" onClick={() => beginEdit(item)}>
                  ✎
                </button>
                <button className="checklist__act" title="Удалить" onClick={() => deleteItem(item.id)}>
                  🗑
                </button>
              </li>
            ))}
          </ul>
          <div className="checklist__add">
            <input
              placeholder="+ добавить пункт…"
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addItem()
              }}
            />
            <button className="btn" disabled={!newItem.trim()} onClick={addItem}>
              Добавить
            </button>
          </div>
        </div>

        {/* --- Действия --- */}
        <div className="issue-detail__section">
          <div className="issue-detail__section-title">Действия</div>

          {!issue.isLocal && !issue.done && (
            <>
              <div className="row">
                <select
                  defaultValue=""
                  disabled={busy || !transitions?.length}
                  onChange={(e) => {
                    const id = e.target.value
                    if (id) void run('Статус изменён', () => window.api.doTransition(issue.key, id))
                    e.target.value = ''
                  }}
                >
                  <option value="" disabled>
                    {transitions === null
                      ? 'Загрузка…'
                      : transitions.length
                        ? 'Сменить статус…'
                        : 'Нет доступных переходов'}
                  </option>
                  {transitions?.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} → {t.toStatus}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row">
                <select
                  defaultValue=""
                  disabled={busy || !statuses}
                  title="Перейдёт в выбранный статус, при необходимости пройдя несколько переходов"
                  onChange={(e) => {
                    const target = e.target.value
                    if (target) {
                      void (async () => {
                        setBusy(true)
                        setMsg(null)
                        const res = await window.api.transitionTo(issue.key, target)
                        setBusy(false)
                        setMsg(
                          !res.ok
                            ? res.error ?? 'Ошибка'
                            : res.skipped
                              ? `Уже в статусе «${target}»`
                              : `Переведено в «${target}» ✓`
                        )
                      })()
                    }
                    e.target.value = ''
                  }}
                >
                  <option value="" disabled>
                    {statuses === null ? 'Загрузка статусов…' : 'Перейти в статус… (мультишаг)'}
                  </option>
                  {statuses?.map((s) => (
                    <option key={s} value={s}>
                      → {s}
                    </option>
                  ))}
                </select>
              </div>

              <textarea
                placeholder="Комментарий…"
                value={comment}
                disabled={busy}
                onChange={(e) => setComment(e.target.value)}
              />
              <div className="row">
                <button
                  className="btn btn--primary"
                  disabled={busy || !comment.trim()}
                  onClick={() =>
                    void run('Комментарий добавлен', async () => {
                      const res = await window.api.addComment(issue.key, comment.trim())
                      if (res.ok) setComment('')
                      return res
                    })
                  }
                >
                  {busy ? <span className="spinner" /> : 'Отправить комментарий'}
                </button>
                <button className="btn" disabled={busy} onClick={() => void run('Назначено на вас', () => window.api.assignToMe(issue.key))}>
                  👤 На себя
                </button>
              </div>
            </>
          )}

          {blockEditing && (
            <div className="issue__expand">
              <textarea
                placeholder="Что блокирует задачу?"
                value={blockText}
                onChange={(e) => setBlockText(e.target.value)}
              />
              <div className="row">
                <button
                  className="btn btn--primary"
                  disabled={!blockText.trim()}
                  onClick={() => void window.api.setBlocked(issue.key, blockText.trim()).then(() => setBlockEditing(false))}
                >
                  {issue.blocked ? 'Сохранить причину' : 'Заблокировать'}
                </button>
                {issue.blocked && (
                  <button
                    className="btn"
                    onClick={() =>
                      void window.api.setBlocked(issue.key, '').then(() => {
                        setBlockText('')
                        setBlockEditing(false)
                      })
                    }
                  >
                    Снять блок
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="issue-detail__buttons">
            {!issue.isLocal && (
              <button className="btn" onClick={() => void window.api.openInBrowser(issue.url)}>
                Открыть в браузере ↗
              </button>
            )}
            {!issue.isLocal && onGenerate && (
              <button className="btn" onClick={() => onGenerate(issue)}>
                🤖 Сгенерировать патч
              </button>
            )}
            {!issue.done && (
              <button
                className="btn"
                onClick={() => {
                  setBlockText(issue.blockReason)
                  setBlockEditing((v) => !v)
                }}
              >
                {issue.blocked ? 'Изменить / снять блок' : '🚫 Заблокировать'}
              </button>
            )}
            {issue.done ? (
              <button className="btn" onClick={() => void window.api.setLocalDone(issue.key, false)}>
                ↩ Вернуть в работу
              </button>
            ) : (
              <button className="btn" onClick={() => void window.api.setLocalDone(issue.key, true)}>
                ✓ Завершить
              </button>
            )}
            {issue.isLocal ? (
              <button
                className="btn btn--danger"
                onClick={() => {
                  void window.api.deleteLocalTask(issue.key)
                  onClose()
                }}
              >
                Удалить
              </button>
            ) : (
              <button
                className="btn"
                onClick={() => {
                  void window.api.archive(issue.key)
                  onClose()
                }}
              >
                Архив (убрать из виджета)
              </button>
            )}
          </div>

          {msg && <div className="hint">{msg}</div>}
        </div>
      </div>
    </div>
  )
}
