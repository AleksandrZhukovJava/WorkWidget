/**
 * Parse a Jira issue key (e.g. OSE-1234) out of free text — a merge-request title like
 * `feat(OSE-1234): ...` or a branch name like `feature/OSE-1234`. Returns the first match,
 * uppercased, or null. Deliberately simple and shared between main and renderer.
 */
const JIRA_KEY_RE = /[A-Z][A-Z0-9]+-\d+/

export function parseJiraKey(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.toUpperCase().match(JIRA_KEY_RE)
  return m ? m[0] : null
}

/**
 * All Jira-key-like tokens in the text (deduped, uppercased). Used to link an MR to a task:
 * relying on the FIRST match alone mislinks MRs whose title/branch carries the service name
 * (e.g. `employee-operation-service-2/…`) — that token matches the pattern before the real key.
 * Matching against every candidate lets the actual task key win regardless of ordering.
 */
export function parseAllJiraKeys(text: string | null | undefined): string[] {
  if (!text) return []
  const matches = text.toUpperCase().match(/[A-Z][A-Z0-9]+-\d+/g)
  return matches ? [...new Set(matches)] : []
}
