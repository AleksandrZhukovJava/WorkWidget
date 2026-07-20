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
