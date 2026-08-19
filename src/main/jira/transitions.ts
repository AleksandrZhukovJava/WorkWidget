import { jiraRequest, restApi } from './client'
import { getSettings } from '../store/settings'
import { resolveFieldId, myIdentityPayload } from './assign'
import type { ActionResult, JiraTransition } from '@shared/types'

interface RawTransitionsResponse {
  transitions: {
    id: string
    name: string
    to: { name: string; statusCategory?: { key?: string } }
    /** with expand=transitions.fields: fieldId -> { required, ... } for that transition's screen */
    fields?: Record<string, { required?: boolean }>
  }[]
}

/** Resolved id of the configured QA field, or null (label empty / not found). */
async function qaFieldId(): Promise<string | null> {
  const label = getSettings().qaFieldLabel.trim()
  return label ? resolveFieldId(label) : null
}

export async function getTransitions(issueKey: string): Promise<JiraTransition[]> {
  // expand fields so we can tell which transitions require the QA field on their screen.
  const resp = await jiraRequest<RawTransitionsResponse>(
    `${restApi()}/issue/${encodeURIComponent(issueKey)}/transitions`,
    { query: { expand: 'transitions.fields' } }
  )
  const qaId = await qaFieldId()
  return (resp.transitions ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    toStatus: t.to.name,
    toCategory: t.to.statusCategory?.key,
    requiresQa: !!(qaId && t.fields?.[qaId]?.required)
  }))
}

/** POST a transition, optionally setting fields on its screen (e.g. a required QA field). */
export async function doTransition(
  issueKey: string,
  transitionId: string,
  fields?: Record<string, unknown>
): Promise<void> {
  await jiraRequest<void>(`${restApi()}/issue/${encodeURIComponent(issueKey)}/transitions`, {
    method: 'POST',
    body: { transition: { id: transitionId }, ...(fields ? { fields } : {}) }
  })
}

/** Field payload that puts a user into the QA field: a given @login, else the current user. */
async function qaFieldPayload(qaUser?: string): Promise<Record<string, unknown> | undefined> {
  const id = await qaFieldId()
  if (!id) return undefined
  const value = qaUser?.trim() ? { name: qaUser.trim() } : myIdentityPayload()
  return value ? { [id]: value } : undefined
}

/** Do a transition, auto-filling the QA field with the current user when that screen requires it. */
async function doHop(issueKey: string, t: JiraTransition): Promise<void> {
  await doTransition(issueKey, t.id, t.requiresQa ? await qaFieldPayload() : undefined)
}

/** Direct transition that fills the QA field (chosen @login or self) — used by the QA modal. */
export async function doTransitionWithQa(
  issueKey: string,
  transitionId: string,
  qaUser?: string
): Promise<void> {
  await doTransition(issueKey, transitionId, await qaFieldPayload(qaUser))
}

interface ProjectStatusesResponse {
  statuses?: { name: string }[]
}

/** All distinct status names in a project (across issue types). [] if unknown/unavailable. */
export async function getProjectStatuses(projectKey: string): Promise<string[]> {
  if (!projectKey.trim()) return []
  try {
    const resp = await jiraRequest<ProjectStatusesResponse[]>(
      `${restApi()}/project/${encodeURIComponent(projectKey)}/statuses`
    )
    const names = new Set<string>()
    for (const type of resp ?? []) for (const s of type.statuses ?? []) names.add(s.name)
    return [...names]
  } catch {
    return []
  }
}

/** All status names available in the issue's project (for the "move to any status" picker). */
export async function getAllStatuses(issueKey: string): Promise<string[]> {
  const names = await getProjectStatuses(issueKey.split('-')[0])
  if (names.length) return names
  // Fallback: at least the directly-reachable statuses.
  return (await getTransitions(issueKey)).map((t) => t.toStatus)
}

/** Status-name equality tolerant of case and surrounding whitespace. */
function eqStatus(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

async function getCurrentStatus(issueKey: string): Promise<string | null> {
  try {
    const resp = await jiraRequest<{ fields: { status: { name: string } } }>(
      `${restApi()}/issue/${encodeURIComponent(issueKey)}`,
      { query: { fields: 'status' } }
    )
    return resp.fields.status.name
  } catch {
    return null
  }
}

/** Workflow graph, read-only: status name → set of directly reachable status names. */
export type StatusGraph = Map<string, Set<string>>

/**
 * Shape of Jira's workflow-designer endpoint
 * (`GET /rest/workflowDesigner/latest/workflows?name=<name>&draft=false`). The graph lives
 * under `layout`: statuses carry a layout `id` ("S<20>", the initial "Create" node is
 * `initial:true` / "I<1>"), and transitions reference statuses by `sourceId`/`targetId`,
 * with `globalTransition` meaning "available from any status".
 */
interface WorkflowDesignerResponse {
  layout?: {
    statuses?: {
      id: string
      name: string
      initial?: boolean
      /** statusCategory.id === 3 marks a "done"/terminal status (Done, Declined, Merged…) */
      statusCategory?: { id?: number }
    }[]
    transitions?: {
      sourceId?: string
      targetId?: string
      name?: string
      initial?: boolean
      globalTransition?: boolean
    }[]
  }
}

/** Parsed workflow: the reachability graph plus the set of terminal ("done") status names. */
export interface WorkflowModel {
  graph: StatusGraph
  /** names of done-category statuses — avoided as intermediate hops when routing */
  doneStatuses: Set<string>
}

/** Build the workflow model from a workflow-designer response. Null if it can't be interpreted. */
export function parseWorkflow(resp: WorkflowDesignerResponse): WorkflowModel | null {
  const statuses = resp.layout?.statuses ?? []
  const transitions = resp.layout?.transitions ?? []
  if (statuses.length === 0 || transitions.length === 0) return null

  const idToName = new Map(statuses.map((s) => [s.id, s.name]))
  // Real status nodes only — exclude the synthetic initial "Create" node.
  const realStatusIds = statuses.filter((s) => !s.initial).map((s) => s.id)
  const doneStatuses = new Set(
    statuses.filter((s) => s.statusCategory?.id === 3).map((s) => s.name)
  )

  const graph: StatusGraph = new Map()
  const addEdge = (from: string, to: string): void => {
    if (from === to) return
    if (!graph.has(from)) graph.set(from, new Set())
    graph.get(from)!.add(to)
  }

  for (const t of transitions) {
    if (t.initial) continue // issue-creation transition, not a status→status edge
    const toName = t.targetId ? idToName.get(t.targetId) : undefined
    if (!toName) continue
    if (t.globalTransition) {
      for (const sid of realStatusIds) {
        const fromName = idToName.get(sid)
        if (fromName) addEdge(fromName, toName)
      }
    } else {
      const fromName = t.sourceId ? idToName.get(t.sourceId) : undefined
      if (fromName) addEdge(fromName, toName)
    }
  }
  return graph.size ? { graph, doneStatuses } : null
}

/** Response shape of the project-config workflow scheme (used to resolve the workflow name). */
interface WorkflowSchemeResponse {
  defaultWorkflow?: { name?: string }
  workflowMappings?: { workflow?: string; issueTypes?: { name?: string }[] }[]
  // some Jira versions nest under `mappings`
  mappings?: { workflow?: { name?: string } | string; issueTypes?: { name?: string }[] }[]
}

/** Best-effort: name of the workflow governing this issue (project + issue type). Null if unknown. */
async function resolveWorkflowName(issueKey: string): Promise<string | null> {
  try {
    const projectKey = issueKey.split('-')[0]
    const issue = await jiraRequest<{ fields?: { issuetype?: { name?: string } } }>(
      `${restApi()}/issue/${encodeURIComponent(issueKey)}`,
      { query: { fields: 'issuetype' } }
    )
    const issueType = issue.fields?.issuetype?.name
    const scheme = await jiraRequest<WorkflowSchemeResponse>(
      `/rest/projectconfig/latest/workflowscheme/${encodeURIComponent(projectKey)}`
    )
    const maps = scheme.workflowMappings ?? scheme.mappings ?? []
    for (const m of maps) {
      const name = typeof m.workflow === 'string' ? m.workflow : m.workflow?.name
      if (name && issueType && (m.issueTypes ?? []).some((it) => it.name === issueType)) return name
    }
    return scheme.defaultWorkflow?.name ?? null
  } catch {
    return null
  }
}

/**
 * Fetch the workflow graph governing an issue, read-only. Returns null when unavailable (name
 * couldn't be resolved, insufficient permission, unrecognized shape) so the caller falls back
 * to a safe direct-only transition instead of guessing.
 */
export async function buildStatusGraph(issueKey: string): Promise<WorkflowModel | null> {
  const name = await resolveWorkflowName(issueKey)
  if (!name) return null
  try {
    const resp = await jiraRequest<WorkflowDesignerResponse>(
      '/rest/workflowDesigner/latest/workflows',
      { query: { name, draft: 'false' } }
    )
    return parseWorkflow(resp)
  } catch {
    return null
  }
}

/**
 * Breadth-first shortest path of statuses to walk from `from` to `target` (excludes `from`,
 * includes `target`). `[]` when already there; null when unreachable. Statuses in `avoid` are
 * never used as intermediate hops (the target itself is always allowed).
 */
export function bfsPath(
  graph: StatusGraph,
  from: string,
  target: string,
  avoid?: Set<string>
): string[] | null {
  if (from === target) return []
  const prev = new Map<string, string>()
  const seen = new Set<string>([from])
  const queue: string[] = [from]
  while (queue.length) {
    const cur = queue.shift()!
    for (const next of graph.get(cur) ?? []) {
      if (seen.has(next)) continue
      // Don't route THROUGH an avoided status, but allow it as the final destination.
      if (avoid?.has(next) && next !== target) continue
      seen.add(next)
      prev.set(next, cur)
      if (next === target) {
        const path: string[] = []
        let s: string | undefined = target
        while (s && s !== from) {
          path.unshift(s)
          s = prev.get(s)
        }
        return path
      }
      queue.push(next)
    }
  }
  return null
}

/**
 * Fallback multi-hop when the workflow graph isn't available (name couldn't be resolved,
 * older server, etc.): explore forward transitions, preferring non-terminal ("done") next
 * statuses and never revisiting, until the target is directly reachable. Bounded against loops.
 * Reaches the target whenever a forward path exists — the graph path is just cleaner when we
 * can get it.
 */
async function greedyWalk(
  issueKey: string,
  start: string,
  target: string
): Promise<{ ok: boolean; error?: string }> {
  let current = start
  const visited = new Set<string>([start])
  for (let hop = 0; hop < 12; hop++) {
    const ts = await getTransitions(issueKey)
    const direct = ts.find((t) => eqStatus(t.toStatus, target))
    if (direct) {
      await doHop(issueKey, direct)
      return { ok: true }
    }
    const candidates = ts.filter((t) => !visited.has(t.toStatus))
    // Prefer a non-terminal next status so we don't dead-end in Done/Declined.
    const next = candidates.find((t) => t.toCategory !== 'done') ?? candidates[0]
    if (!next) {
      const opts = ts.map((t) => t.toStatus).join(', ') || '—'
      return {
        ok: false,
        error: `Не нашёл путь к «${target}» (застрял на «${current}»). Доступно: ${opts}.`
      }
    }
    visited.add(next.toStatus)
    await doHop(issueKey, next)
    current = next.toStatus
  }
  return { ok: false, error: `Путь к «${target}» слишком длинный.` }
}

/**
 * Move an issue to `target`. Plan first, mutate second:
 *  1. if a DIRECT transition to target exists, take it (the common 1-hop case);
 *  2. otherwise BFS a graph-verified shortest path (avoiding terminal statuses) and execute it;
 *  3. if the graph is unavailable or has no path, fall back to a bounded greedy walk.
 */
export async function transitionToStatus(issueKey: string, target: string): Promise<ActionResult> {
  try {
    const current = await getCurrentStatus(issueKey)
    if (current === null) return { ok: false, error: 'Не удалось определить текущий статус' }
    // Already in the target status — nothing to do. Flag it so callers can report "уже в статусе"
    // instead of a misleading "переведено", and skip the needless refresh/notification.
    if (eqStatus(current, target)) return { ok: true, skipped: true }

    // 1) Fast, safe path: a direct transition to the target.
    const live = await getTransitions(issueKey)
    const direct = live.find((t) => eqStatus(t.toStatus, target))
    if (direct) {
      await doHop(issueKey, direct)
      return { ok: true }
    }

    // 2) Multi-hop via a graph-verified shortest path (clean, avoids terminal statuses).
    const model = await buildStatusGraph(issueKey)
    if (model) {
      const allNames = new Set<string>([
        ...model.graph.keys(),
        ...[...model.graph.values()].flatMap((s) => [...s])
      ])
      const realTarget = [...allNames].find((n) => eqStatus(n, target)) ?? target
      const path =
        bfsPath(model.graph, current, realTarget, model.doneStatuses) ??
        bfsPath(model.graph, current, realTarget)
      if (path) {
        let cur = current
        for (const nextStatus of path) {
          const ts = await getTransitions(issueKey)
          const edge = ts.find((t) => eqStatus(t.toStatus, nextStatus))
          // Workflow drifted from the plan — recover with a live greedy walk from here.
          if (!edge) return greedyWalk(issueKey, cur, target)
          await doHop(issueKey, edge)
          cur = nextStatus
        }
        return { ok: true }
      }
    }

    // 3) No graph or no path in it — bounded greedy exploration (reaches the target when a
    // forward path exists; the graph path above is just cleaner when we can get it).
    return greedyWalk(issueKey, current, target)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
