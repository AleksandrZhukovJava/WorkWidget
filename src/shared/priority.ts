import type { JiraIssue } from './types'

/** Local priority levels (0 = none). Higher value = more important = sorts first. */
export const PRIORITY_LEVELS = [5, 4, 3, 2, 1, 0] as const
export type PriorityLevel = 0 | 1 | 2 | 3 | 4 | 5

export const PRIORITY_LABEL: Record<PriorityLevel, string> = {
  0: '—',
  1: 'Очень низкий',
  2: 'Низкий',
  3: 'Средний',
  4: 'Высокий',
  5: 'Критический'
}

export const PRIORITY_COLOR: Record<PriorityLevel, string> = {
  0: '#8b95a5',
  1: '#7d8590',
  2: '#2f81f7',
  3: '#d29922',
  4: '#fb8500',
  5: '#f85149'
}

/** Stable sort: higher local priority first; ties keep the incoming (JQL) order. */
export function sortByPriority(issues: JiraIssue[]): JiraIssue[] {
  return [...issues].sort((a, b) => b.localPriority - a.localPriority)
}
