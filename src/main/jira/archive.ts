import { jiraRequest } from './client'

/**
 * Native Jira Cloud issue archiving — Premium-only.
 * The widget's default "archive" is local (see store/settings.ts); this is an optional
 * server-side archive that can be wired up if the instance has the feature.
 */
export async function archiveIssuesNative(issueKeys: string[]): Promise<void> {
  await jiraRequest<void>('/rest/api/3/issue/archive', {
    method: 'PUT',
    body: { issueIdsOrKeys: issueKeys }
  })
}
