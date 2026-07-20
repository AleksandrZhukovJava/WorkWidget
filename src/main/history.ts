import { getDoneOnDate } from './jira/issues'
import { getDoneItems, localDayOf } from './store/settings'
import { hasCompleteCredentials } from './store/credentials'
import type { HistoryItem } from '@shared/types'

/**
 * Everything completed on a given local date (YYYY-MM-DD): Jira issues actually resolved
 * that day (a live, read-only Jira query) plus items completed via our local overlay
 * (own tasks, or Jira issues marked done locally without touching Jira). Deduped by key so
 * an issue that's both really-resolved-in-Jira and locally mirrored isn't shown twice.
 */
export async function getCompletionsForDate(date: string): Promise<HistoryItem[]> {
  let jira: HistoryItem[] = []
  if (hasCompleteCredentials()) {
    try {
      jira = await getDoneOnDate(date)
    } catch {
      /* offline / query failed — fall back to local-only */
    }
  }
  const jiraKeys = new Set(jira.map((i) => i.key))

  const local: HistoryItem[] = getDoneItems()
    .filter((d) => localDayOf(d.doneAt) === date && !jiraKeys.has(d.key))
    .map((d) => ({ key: d.key, summary: d.summary, isLocal: d.isLocal, url: d.url, doneAt: d.doneAt }))

  return [...jira, ...local].sort((a, b) => b.doneAt.localeCompare(a.doneAt))
}
