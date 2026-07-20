import { jiraRequest, restApi, JiraError } from './client'
import { assignToMe } from './assign'
import { textToAdf } from './comments'
import { getApiVersion } from '../store/credentials'
import type { CreateField, CreateFieldOption } from '@shared/types'

interface RawProject {
  id: string
  key: string
  name: string
}

interface RawIssueType {
  id: string
  name: string
  subtask: boolean
}

/** Projects visible to the current user, for the settings project picker. */
export async function getProjects(): Promise<{ key: string; name: string }[]> {
  const projects = await jiraRequest<RawProject[]>(`${restApi()}/project`)
  return projects
    .map((p) => ({ key: p.key, name: p.name }))
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Issue types selectable when creating in the given project (subtasks excluded), plus the
 * project as Jira itself resolves it (key + real name) — resolved fresh from Jira every
 * time, not just echoed back from local settings, so the UI can prove which project it's
 * actually about to create in.
 *
 * Endpoint choice is a minefield on Server/DC 9.x because its URL routing swallows unknown
 * paths into neighbouring handlers with wildly misleading errors, observed live on this
 * user's instance:
 *   - `GET /issue/createmeta?projectKeys=…` (removed in DC 9) → routed as issue key
 *     "createmeta" → "Issue does not exist"
 *   - `GET /issuetype/project?projectId=…` (Cloud-only) → routed as issue type id
 *     "project" → "Given issue type does not exist"
 * The granular createmeta (`/issue/createmeta/{key}/issuetypes`, Server 8.4+ and current
 * Cloud) is the one that actually exists on both; the legacy monolithic createmeta is kept
 * only as a fallback for older instances.
 */
export async function getIssueTypesForProject(projectKey: string): Promise<{
  project: { key: string; name: string }
  types: { id: string; name: string }[]
}> {
  const project = await jiraRequest<RawProject>(
    `${restApi()}/project/${encodeURIComponent(projectKey)}`
  )
  const types = await fetchCreateMetaIssueTypes(projectKey)
  return {
    project: { key: project.key, name: project.name },
    types: types.filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }))
  }
}

interface GranularCreateMetaResponse {
  values?: RawIssueType[]
  /** Cloud names the array differently */
  issueTypes?: RawIssueType[]
}

interface LegacyCreateMetaResponse {
  projects?: { issuetypes?: RawIssueType[] }[]
}

async function fetchCreateMetaIssueTypes(projectKey: string): Promise<RawIssueType[]> {
  let granularError: unknown
  try {
    const resp = await jiraRequest<GranularCreateMetaResponse>(
      `${restApi()}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes`,
      { query: { maxResults: 100 } }
    )
    const types = resp.values ?? resp.issueTypes
    if (types) return types
  } catch (err) {
    granularError = err
  }

  try {
    const resp = await jiraRequest<LegacyCreateMetaResponse>(`${restApi()}/issue/createmeta`, {
      query: { projectKeys: projectKey, expand: 'projects.issuetypes' }
    })
    return resp.projects?.[0]?.issuetypes ?? []
  } catch {
    // The legacy endpoint's mis-routed errors ("Issue does not exist") are pure noise —
    // surface the granular endpoint's error instead, it's the meaningful one.
    throw granularError ?? new Error('Не удалось получить типы задач проекта')
  }
}

// ---- fillable fields for a (project, issue type) pair ----

interface RawFieldMeta {
  fieldId?: string
  key?: string
  name: string
  required: boolean
  schema?: { type?: string; custom?: string; items?: string }
  allowedValues?: { id?: string; value?: string; name?: string }[]
}

/** Core fields the form already handles (or that make no sense as ad-hoc inputs). */
const EXCLUDED_FIELDS = new Set([
  'summary',
  'description',
  'project',
  'issuetype',
  'reporter',
  'assignee',
  'attachment',
  'issuelinks'
])

/** Reduce Jira field metadata to a renderable control; null = type we don't support. */
function toCreateField(m: RawFieldMeta, id: string): CreateField | null {
  const base = { id, name: m.name, required: m.required }
  const options: CreateFieldOption[] = (m.allowedValues ?? [])
    .map((v) => ({ id: v.id ?? '', label: v.value ?? v.name ?? v.id ?? '' }))
    .filter((o) => o.id && o.label)
  const t = m.schema?.type
  if (t === 'option' || t === 'priority') {
    return options.length ? { ...base, control: 'select', options } : null
  }
  if (t === 'array') {
    if (m.schema?.items === 'option' && options.length) {
      return { ...base, control: 'multiselect', options }
    }
    if (m.schema?.items === 'string') return { ...base, control: 'labels' }
    return null
  }
  if (t === 'string') {
    return { ...base, control: m.schema?.custom?.includes('textarea') ? 'textarea' : 'text' }
  }
  if (t === 'number') return { ...base, control: 'number' }
  if (t === 'date') return { ...base, control: 'date' }
  return null
}

/**
 * Fillable fields for creating an issue of the given type, with allowed values where Jira
 * defines them. Granular createmeta first (Server 8.4+/Cloud), monolithic as fallback —
 * same routing minefield as getIssueTypesForProject above.
 */
export async function getCreateFields(
  projectKey: string,
  issueTypeId: string
): Promise<CreateField[]> {
  let raw: RawFieldMeta[] | null = null
  let granularError: unknown
  try {
    const resp = await jiraRequest<{ values?: RawFieldMeta[]; fields?: RawFieldMeta[] }>(
      `${restApi()}/issue/createmeta/${encodeURIComponent(projectKey)}/issuetypes/${encodeURIComponent(issueTypeId)}`,
      { query: { maxResults: 200 } }
    )
    raw = resp.values ?? resp.fields ?? null
  } catch (err) {
    granularError = err
  }
  if (!raw) {
    try {
      const resp = await jiraRequest<{
        projects?: { issuetypes?: { fields?: Record<string, RawFieldMeta> }[] }[]
      }>(`${restApi()}/issue/createmeta`, {
        query: {
          projectKeys: projectKey,
          issuetypeIds: issueTypeId,
          expand: 'projects.issuetypes.fields'
        }
      })
      const fields = resp.projects?.[0]?.issuetypes?.[0]?.fields
      raw = fields ? Object.entries(fields).map(([k, v]) => ({ ...v, fieldId: k })) : []
    } catch {
      throw granularError ?? new Error('Не удалось получить поля типа задачи')
    }
  }
  return raw
    .map((m) => ({ m, id: m.fieldId ?? m.key ?? '' }))
    .filter((x) => x.id && !EXCLUDED_FIELDS.has(x.id))
    .map((x) => toCreateField(x.m, x.id))
    .filter((f): f is CreateField => f !== null)
    .sort((a, b) => Number(b.required) - Number(a.required) || a.name.localeCompare(b.name))
}

export interface CreateIssueInput {
  projectKey: string
  /**
   * Issue type by name, not id — matches exactly what the picker showed and avoids any
   * id-scoping mismatch between the lookup call and Jira's create validation (this is what
   * caused "Given issue type does not exist" even though the id came straight from Jira).
   */
  issueTypeName: string
  summary: string
  description?: string
  assignToMe: boolean
  /** additional fields, already in Jira value shape ({id} / [{id}] / scalars), keyed by field id */
  extraFields?: Record<string, unknown>
}

/** Create a Jira issue, then (best-effort, doesn't undo creation on failure) assign it. */
export async function createIssue(
  input: CreateIssueInput
): Promise<{ ok: boolean; key?: string; error?: string }> {
  try {
    const description = input.description?.trim()
    const resp = await jiraRequest<{ key: string }>(`${restApi()}/issue`, {
      method: 'POST',
      body: {
        fields: {
          // extras first — the core fields below always win on collision
          ...(input.extraFields ?? {}),
          project: { key: input.projectKey },
          issuetype: { name: input.issueTypeName },
          summary: input.summary,
          // Server/DC v2 wants plain text (Jira wiki markup ok); Cloud v3 wants ADF.
          ...(description
            ? { description: getApiVersion() === '2' ? description : textToAdf(description) }
            : {})
        }
      }
    })
    if (input.assignToMe) await assignToMe(resp.key).catch(() => {})
    return { ok: true, key: resp.key }
  } catch (err) {
    return { ok: false, error: err instanceof JiraError ? err.message : String(err) }
  }
}
