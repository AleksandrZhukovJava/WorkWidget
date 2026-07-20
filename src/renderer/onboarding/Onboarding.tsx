import { useState } from 'react'
import { greeting } from '@shared/greeting'

/**
 * First-run questionnaire. Currently one question — the user's role — which pre-fills the
 * "my task" field: developers are matched by the "Исполнитель" field, QA by "QA". The
 * custom option keeps full control (same field the Settings → Параметры screen edits),
 * so this is only a convenient default, never a limitation.
 */

type Role = 'dev' | 'qa' | 'custom'

// Role → default "my field" label. Empty = standard Jira Assignee.
const ROLE_FIELD: Record<Exclude<Role, 'custom'>, string> = {
  dev: '',
  qa: 'QA'
}

export function Onboarding({ onDone }: { onDone?: () => void } = {}): JSX.Element {
  const [name, setName] = useState('')
  const [role, setRole] = useState<Role>('dev')
  const [customField, setCustomField] = useState('')
  const [busy, setBusy] = useState(false)

  async function finish(fieldLabel: string): Promise<void> {
    setBusy(true)
    await window.api.updateSettings({
      userName: name.trim(),
      myFieldLabel: fieldLabel.trim(),
      onboardingDone: true
    })
    // Embedded (in the main-window gate) → hand control back to the shell; standalone
    // window → close the onboarding window.
    if (onDone) onDone()
    else await window.api.closeOnboarding()
  }

  const options: { value: Role; title: string; hint: string }[] = [
    { value: 'dev', title: '👨‍💻 Разработчик', hint: 'Мои задачи — по стандартному Assignee' },
    { value: 'qa', title: '🔍 QA', hint: 'Мои задачи — по полю «QA»' },
    { value: 'custom', title: '⚙️ Другое / своё поле', hint: 'Укажу поле сам' }
  ]

  return (
    <div className="onboarding">
      <h1>{greeting(name)} 👋</h1>
      <p className="hint">
        Пара вопросов для настройки. Всё это позже можно изменить в Настройках.
      </p>

      <div className="field">
        <label>Как к вам обращаться?</label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Имя (необязательно)"
        />
      </div>

      <div className="field">
        <label>Ваша роль в компании?</label>
        <div className="onboarding__roles">
          {options.map((o) => (
            <button
              key={o.value}
              className={`onboarding__role ${role === o.value ? 'is-active' : ''}`}
              onClick={() => setRole(o.value)}
            >
              <span className="onboarding__role-title">{o.title}</span>
              <span className="onboarding__role-hint">{o.hint}</span>
            </button>
          ))}
        </div>
      </div>

      {role === 'custom' && (
        <div className="field">
          <label>Поле, по которому задача считается вашей (пусто = стандартный Assignee)</label>
          <input
            value={customField}
            onChange={(e) => setCustomField(e.target.value)}
            placeholder="Например: Тестировщик, Owner…"
          />
        </div>
      )}

      <div className="actions-row" style={{ marginTop: 20 }}>
        <button
          className="btn btn--primary"
          disabled={busy}
          onClick={() =>
            void finish(role === 'custom' ? customField : ROLE_FIELD[role])
          }
        >
          {busy ? <span className="spinner" /> : 'Готово'}
        </button>
        <button className="btn" disabled={busy} onClick={() => void finish('')}>
          Пропустить
        </button>
      </div>
    </div>
  )
}
