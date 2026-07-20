import { jiraRequest, restApi } from './client'
import { getApiVersion } from '../store/credentials'

/** Build a minimal Atlassian Document Format (ADF) doc from plain text (one paragraph per line). */
export function textToAdf(text: string): unknown {
  const paragraphs = text.split(/\r?\n/).map((line) => ({
    type: 'paragraph',
    content: line.length ? [{ type: 'text', text: line }] : []
  }))
  return { type: 'doc', version: 1, content: paragraphs }
}

export async function addComment(issueKey: string, text: string): Promise<void> {
  // Cloud (v3) wants ADF; Server/DC (v2) wants a plain-text body.
  const body = getApiVersion() === '2' ? { body: text } : { body: textToAdf(text) }
  await jiraRequest<void>(`${restApi()}/issue/${encodeURIComponent(issueKey)}/comment`, {
    method: 'POST',
    body
  })
}
