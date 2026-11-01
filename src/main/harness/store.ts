import { randomUUID } from 'node:crypto'
import Store from 'electron-store'
import type { HarnessAgent, HarnessRun, Prohibition } from '@shared/types'

/**
 * Persistent state for the Coder Agent harness: preconfigured agents, hard prohibitions and
 * the run history. Kept in its own electron-store (separate from jira-settings) so the harness
 * can evolve independently. Built-in agents/prohibitions are (re)seeded on access.
 */
interface HarnessState {
  agents: HarnessAgent[]
  prohibitions: Prohibition[]
  runs: HarnessRun[]
}

const MAX_RUNS = 100

const harnessStore = new Store<HarnessState>({
  name: 'coder-harness',
  defaults: { agents: [], prohibitions: [], runs: [] }
})

// ---- built-in prohibitions (locked: always present, never disableable/deletable) ----
// Keyed by a stable id so we can keep their text in sync on upgrade without duplicating.
const BUILTIN_PROHIBITIONS: Omit<Prohibition, 'enabled'>[] = [
  {
    id: 'no-mr-merge',
    builtin: true,
    text: 'Никогда не мержить, не аппрувить и не закрывать merge request / pull request.'
  },
  {
    id: 'no-force-push',
    builtin: true,
    text: 'Никогда не выполнять git push --force / --force-with-lease и не переписывать историю.'
  },
  {
    id: 'no-protected-push',
    builtin: true,
    text: 'Не пушить напрямую в защищённые ветки (main, master, develop, release/*) без явного подтверждения пользователя.'
  },
  {
    id: 'no-outside-repo',
    builtin: true,
    text: 'Не изменять файлы вне выбранного репозитория / рабочей папки.'
  },
  {
    id: 'no-destructive',
    builtin: true,
    text: 'Не выполнять деструктивные команды (rm -rf, drop database, git reset --hard и т.п.).'
  },
  {
    id: 'no-secrets',
    builtin: true,
    text: 'Не читать, не выводить и не изменять секреты (.env, токены, ключи, пароли).'
  }
]

// ---- seeded reviewer agents (editable, but builtin ones can't be deleted) ----
function seedAgents(): HarnessAgent[] {
  return [
    {
      id: randomUUID(),
      name: 'Ревьювер бизнес-логики',
      kind: 'reviewer',
      engine: 'default',
      model: '',
      focus: 'корректность, краевые случаи, целостность данных',
      systemPrompt: [
        'Ты — старший инженер, ревьюишь изменения на предмет БИЗНЕС-ЛОГИКИ и корректности.',
        'Ищи: логические ошибки, необработанные краевые случаи, гонки/конкурентность,',
        'нарушение инвариантов и целостности данных, неверные условия, проблемы транзакций,',
        'расхождение с намерением задачи. Не придирайся к стилю — это другой ревьювер.',
        'Для каждой находки указывай файл и, по возможности, строку.'
      ].join(' '),
      skillIds: [],
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: [],
      builtin: true
    },
    {
      id: randomUUID(),
      name: 'Ревьювер стиля кода',
      kind: 'reviewer',
      engine: 'default',
      model: '',
      focus: 'читаемость, именование, дублирование, конвенции',
      systemPrompt: [
        'Ты — ревьювер СТИЛЯ и читаемости кода. Ищи: плохие имена, дублирование,',
        'слишком длинные функции, мёртвый код, несоответствие конвенциям проекта,',
        'отсутствие/избыток комментариев, неидиоматичные конструкции. Не оценивай',
        'бизнес-логику — это другой ревьювер. Для каждой находки указывай файл и строку.'
      ].join(' '),
      skillIds: [],
      allowedTools: ['Read', 'Grep', 'Glob'],
      disallowedTools: [],
      builtin: true
    }
  ]
}

/** Agents, seeding the built-in reviewers on first use. */
export function getAgents(): HarnessAgent[] {
  let agents = harnessStore.get('agents')
  if (!agents || agents.length === 0) {
    agents = seedAgents()
    harnessStore.set('agents', agents)
  }
  return agents
}

/** Insert or update an agent (matched by id); returns the full list. */
export function saveAgent(agent: HarnessAgent): HarnessAgent[] {
  const agents = getAgents()
  const idx = agents.findIndex((a) => a.id === agent.id)
  const next = agent.id && idx >= 0 ? agent : { ...agent, id: agent.id || randomUUID() }
  if (idx >= 0) agents[idx] = { ...agents[idx], ...next, builtin: agents[idx].builtin }
  else agents.push(next)
  harnessStore.set('agents', agents)
  return agents
}

/** Delete a non-builtin agent; built-in agents are never removed. */
export function deleteAgent(id: string): HarnessAgent[] {
  const agents = getAgents().filter((a) => !(a.id === id && !a.builtin))
  harnessStore.set('agents', agents)
  return agents
}

export function getAgentById(id: string): HarnessAgent | undefined {
  return getAgents().find((a) => a.id === id)
}

/**
 * Prohibitions, always including the locked built-ins (merged by id, their text kept current).
 * User-added rules are preserved; a built-in is always enabled and marked builtin.
 */
export function getProhibitions(): Prohibition[] {
  const stored = harnessStore.get('prohibitions') ?? []
  const builtins: Prohibition[] = BUILTIN_PROHIBITIONS.map((b) => ({ ...b, enabled: true }))
  const custom = stored.filter((p) => !p.builtin && !BUILTIN_PROHIBITIONS.some((b) => b.id === p.id))
  const merged = [...builtins, ...custom]
  harnessStore.set('prohibitions', merged)
  return merged
}

/** Insert/update a user prohibition. Built-ins are immutable (always-on) and ignored here. */
export function saveProhibition(p: Prohibition): Prohibition[] {
  if (BUILTIN_PROHIBITIONS.some((b) => b.id === p.id)) return getProhibitions()
  const list = getProhibitions()
  const custom = p.id ? p : { ...p, id: randomUUID() }
  const idx = list.findIndex((x) => x.id === custom.id)
  if (idx >= 0 && !list[idx].builtin) list[idx] = { ...custom, builtin: false }
  else if (idx < 0) list.push({ ...custom, builtin: false })
  harnessStore.set('prohibitions', list)
  return getProhibitions()
}

/** Delete a user prohibition; built-ins can't be deleted. */
export function deleteProhibition(id: string): Prohibition[] {
  if (BUILTIN_PROHIBITIONS.some((b) => b.id === id)) return getProhibitions()
  const list = getProhibitions().filter((p) => p.id !== id || p.builtin)
  harnessStore.set('prohibitions', list)
  return getProhibitions()
}

/** The enabled prohibition texts, injected into every agent's system prompt / enforced by hooks. */
export function enabledProhibitionTexts(): string[] {
  return getProhibitions()
    .filter((p) => p.enabled)
    .map((p) => p.text)
}

// ---- runs (history) ----
export function getRuns(): HarnessRun[] {
  return harnessStore.get('runs') ?? []
}

export function getRun(id: string): HarnessRun | undefined {
  return getRuns().find((r) => r.id === id)
}

/** Insert or update a run (matched by id), newest first, capped. */
export function upsertRun(run: HarnessRun): void {
  const runs = getRuns().filter((r) => r.id !== run.id)
  runs.unshift(run)
  harnessStore.set('runs', runs.slice(0, MAX_RUNS))
}
