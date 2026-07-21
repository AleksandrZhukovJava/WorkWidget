// GitLab merge-request operations. DELIBERATELY OMITS any merge/accept and any force-push:
// accepting an MR (PUT /merge_requests/:iid/merge) and force pushing are never implemented
// here, by design — see the plan. Only safe, reversible actions live in this file.
import { glRequest } from './client'
import { getGitlabUser } from '../store/credentials'
import { getSettings, getReviewApprovedSeen, addReviewApprovedSeen } from '../store/settings'
import { parseJiraKey } from '@shared/jira-key'
import type {
  CreateMrInput,
  GitlabMR,
  GitlabProject,
  GitlabUser
} from '@shared/types'

interface GlProject {
  id: number
  path_with_namespace: string
  web_url: string
  default_branch: string
}

interface GlMember {
  id: number
  username: string
  name: string
}

interface GlMR {
  iid: number
  project_id: number
  title: string
  source_branch: string
  target_branch: string
  web_url: string
  author?: { name?: string; username?: string }
  reviewers?: { name?: string; username?: string }[]
  updated_at: string
}

function mapProject(p: GlProject): GitlabProject {
  return {
    id: p.id,
    pathWithNamespace: p.path_with_namespace,
    webUrl: p.web_url,
    defaultBranch: p.default_branch
  }
}

function mapMR(m: GlMR): GitlabMR {
  return {
    iid: m.iid,
    projectId: m.project_id,
    title: m.title,
    sourceBranch: m.source_branch,
    targetBranch: m.target_branch,
    webUrl: m.web_url,
    author: m.author?.name || m.author?.username || '',
    reviewers: (m.reviewers ?? []).map((r) => r.name || r.username || '').filter(Boolean),
    jiraKey: parseJiraKey(m.title) ?? parseJiraKey(m.source_branch),
    updatedAt: m.updated_at
  }
}

/** Projects the user is a member of (for choosing where to open an MR). */
export async function listProjects(search?: string): Promise<GitlabProject[]> {
  const list = await glRequest<GlProject[]>('/projects', {
    query: { membership: true, per_page: 50, order_by: 'last_activity_at', search }
  })
  return list.map(mapProject)
}

/**
 * Extract `namespace/project` from an origin remote URL:
 *   git@gitlab.host:group/sub/proj.git → group/sub/proj
 *   https://gitlab.host/group/proj.git  → group/proj
 * Returns '' when nothing usable is found.
 */
export function parseRepoPath(remoteUrl: string): string {
  let s = remoteUrl.trim()
  if (!s) return ''
  s = s.replace(/\.git$/i, '')
  const scp = s.match(/^[^@]+@[^:]+:(.+)$/) // scp-like ssh
  if (scp) return scp[1].replace(/^\/+/, '')
  try {
    const u = new URL(s)
    return u.pathname.replace(/^\/+/, '')
  } catch {
    return ''
  }
}

/** Try to resolve a single project by its full path (namespace/name), e.g. from a git remote. */
export async function findProjectByPath(pathWithNamespace: string): Promise<GitlabProject | null> {
  try {
    const p = await glRequest<GlProject>(`/projects/${encodeURIComponent(pathWithNamespace)}`)
    return mapProject(p)
  } catch {
    return null
  }
}

/** Title of a branch's head commit (fallback MR title when there's no linked Jira issue). */
export async function getBranchCommitTitle(projectId: number, branch: string): Promise<string> {
  try {
    const b = await glRequest<{ commit?: { title?: string } }>(
      `/projects/${projectId}/repository/branches/${encodeURIComponent(branch)}`
    )
    return b.commit?.title ?? ''
  } catch {
    return ''
  }
}

export async function listBranches(projectId: number, search?: string): Promise<string[]> {
  const list = await glRequest<{ name: string }[]>(
    `/projects/${projectId}/repository/branches`,
    { query: { per_page: 100, search } }
  )
  return list.map((b) => b.name)
}

/** The project's owning group id (null if the project sits under a user namespace). */
async function projectGroupId(projectId: number): Promise<number | null> {
  try {
    const p = await glRequest<{ namespace?: { id: number; kind: string } }>(
      `/projects/${projectId}`
    )
    return p.namespace?.kind === 'group' ? p.namespace.id : null
  } catch {
    return null
  }
}

/**
 * Users assignable as MR reviewers — as broad as GitLab's own picker. We union three sources
 * because none alone is complete:
 *   - `/projects/:id/members/all` — direct + inherited (ancestor-group) members,
 *   - `/projects/:id/users`       — everyone with project access (covers invited/shared groups),
 *   - `/groups/:groupId/members/all` — the owning group's members (colleagues who have access via
 *     the group but were never added to the project directly; the common "missing reviewer" case).
 * With a search term GitLab filters server-side, so the frontend searches instead of paging.
 */
export async function listProjectMembers(projectId: number, search?: string): Promise<GitlabUser[]> {
  const q = search?.trim() || undefined
  const groupId = q ? await projectGroupId(projectId) : null // group union only matters when searching
  const [members, projectUsers, groupMembers, autocomplete, globalUsers] = await Promise.all([
    glRequest<GlMember[]>(`/projects/${projectId}/members/all`, {
      query: { per_page: 100, query: q }
    }).catch(() => [] as GlMember[]),
    q
      ? glRequest<GlMember[]>(`/projects/${projectId}/users`, {
          query: { per_page: 100, search: q }
        }).catch(() => [] as GlMember[])
      : Promise.resolve([] as GlMember[]),
    groupId
      ? glRequest<GlMember[]>(`/groups/${groupId}/members/all`, {
          query: { per_page: 100, query: q }
        }).catch(() => [] as GlMember[])
      : Promise.resolve([] as GlMember[]),
    // The exact feed GitLab's own reviewer/assignee picker uses — the broadest, project-scoped
    // list of assignable users. This is what makes "I can pick them on GitLab" match here.
    q
      ? glRequest<GlMember[]>('/-/autocomplete/users.json', {
          raw: true,
          query: { active: true, project_id: projectId, search: q, per_page: 20 }
        }).catch(() => [] as GlMember[])
      : Promise.resolve([] as GlMember[]),
    // Last-resort global user search by name/username — catches an assignable colleague who
    // isn't surfaced by any project/group endpoint on this instance.
    q
      ? glRequest<GlMember[]>('/users', {
          query: { search: q, active: true, per_page: 20 }
        }).catch(() => [] as GlMember[])
      : Promise.resolve([] as GlMember[])
  ])
  const byId = new Map<number, GitlabUser>()
  for (const u of [...members, ...projectUsers, ...groupMembers, ...autocomplete, ...globalUsers]) {
    if (u && typeof u.id === 'number') byId.set(u.id, { id: u.id, username: u.username, name: u.name })
  }
  return [...byId.values()]
}

/**
 * Resolve a single user by exact @username (with a name-search fallback). Lets the user add a
 * reviewer the member/autocomplete lists don't surface — `GET /users?username=` is a precise
 * lookup that works regardless of project membership. Returns null if nothing matches.
 */
export async function resolveGitlabUser(username: string): Promise<GitlabUser | null> {
  const u = username.trim().replace(/^@/, '')
  if (!u) return null
  const exact = await glRequest<GlMember[]>('/users', { query: { username: u } }).catch(
    () => [] as GlMember[]
  )
  let hit = exact[0]
  if (!hit) {
    const found = await glRequest<GlMember[]>('/users', {
      query: { search: u, per_page: 5 }
    }).catch(() => [] as GlMember[])
    hit = found.find((m) => m.username?.toLowerCase() === u.toLowerCase()) ?? found[0]
  }
  return hit ? { id: hit.id, username: hit.username, name: hit.name } : null
}

/** Create a merge request. Never merges it — only opens it. */
export async function createMergeRequest(
  input: CreateMrInput
): Promise<{ iid: number; webUrl: string; jiraKey: string | null }> {
  const me = getGitlabUser()
  const body: Record<string, unknown> = {
    source_branch: input.sourceBranch,
    target_branch: input.targetBranch,
    title: input.title,
    description: input.description ?? '',
    reviewer_ids: input.reviewerIds,
    remove_source_branch: true
  }
  if (input.assignSelf && me.id) body.assignee_id = me.id
  const mr = await glRequest<GlMR>(`/projects/${input.projectId}/merge_requests`, {
    method: 'POST',
    body
  })
  const mapped = mapMR(mr)
  return { iid: mapped.iid, webUrl: mapped.webUrl, jiraKey: mapped.jiraKey }
}

/**
 * Open MRs still awaiting MY review. GitLab keeps me in `reviewer_id` even after I approve,
 * so the raw list would keep showing MRs I've already signed off on — filter those out.
 */
export async function listMyReviewMRs(): Promise<GitlabMR[]> {
  const me = getGitlabUser()
  if (!me.id) return []
  const list = await glRequest<GlMR[]>('/merge_requests', {
    query: { scope: 'all', reviewer_id: me.id, state: 'opened', per_page: 50, order_by: 'updated_at' }
  })
  const mapped = list.map(mapMR)
  const mode = getSettings().gitlabReviewApprovalMode
  if (mode === 'always') return mapped // show all — skip the extra per-MR approval calls

  const approvedNow = await Promise.all(
    mapped.map((mr) => hasMyApproval(mr.projectId, mr.iid, me.id))
  )
  if (mode === 'current') {
    // Hide only while my approval currently stands; returns if it's reset.
    return mapped.filter((_mr, i) => !approvedNow[i])
  }
  // mode === 'has': hide once I've approved at least once, even if the approval later drops.
  const seen = new Set(getReviewApprovedSeen())
  const newlyApproved: string[] = []
  const kept = mapped.filter((mr, i) => {
    const key = `${mr.projectId}:${mr.iid}`
    if (approvedNow[i] && !seen.has(key)) newlyApproved.push(key)
    return !approvedNow[i] && !seen.has(key)
  })
  addReviewApprovedSeen(newlyApproved) // remember, so they stay hidden even if the approval resets
  return kept
}

/** Whether the given user is among an MR's approvers. Best-effort — false on any error. */
async function hasMyApproval(projectId: number, iid: number, userId: number): Promise<boolean> {
  try {
    const r = await glRequest<{ approved_by?: { user?: { id?: number } }[] }>(
      `/projects/${projectId}/merge_requests/${iid}/approvals`
    )
    return (r.approved_by ?? []).some((a) => a.user?.id === userId)
  } catch {
    return false
  }
}

/** Open MRs authored by the current user. */
export async function listMyAuthoredMRs(): Promise<GitlabMR[]> {
  const me = getGitlabUser()
  if (!me.id) return []
  const list = await glRequest<GlMR[]>('/merge_requests', {
    query: { scope: 'all', author_id: me.id, state: 'opened', per_page: 50, order_by: 'updated_at' }
  })
  return list.map(mapMR)
}

/** Whether an MR has at least one approval. Best-effort — false on any error. */
export async function isMrApproved(projectId: number, iid: number): Promise<boolean> {
  try {
    const r = await glRequest<{ approved?: boolean; approved_by?: unknown[] }>(
      `/projects/${projectId}/merge_requests/${iid}/approvals`
    )
    if (typeof r.approved === 'boolean') return r.approved
    return Array.isArray(r.approved_by) && r.approved_by.length > 0
  } catch {
    return false
  }
}
