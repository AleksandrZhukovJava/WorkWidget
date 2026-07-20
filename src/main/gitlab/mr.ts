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

export async function listProjectMembers(projectId: number, search?: string): Promise<GitlabUser[]> {
  const q = search?.trim() || undefined
  const [members, projectUsers] = await Promise.all([
    glRequest<GlMember[]>(`/projects/${projectId}/members/all`, {
      query: { per_page: 100, query: q }
    }).catch(() => [] as GlMember[]),
    // `/projects/:id/users` is broader than membership (covers access via shared/invited
    // groups) — it matches who GitLab actually lets you pick as a reviewer. Only when
    // searching, to keep the default list to real members.
    q
      ? glRequest<GlMember[]>(`/projects/${projectId}/users`, {
          query: { per_page: 50, search: q }
        }).catch(() => [] as GlMember[])
      : Promise.resolve([] as GlMember[])
  ])
  const byId = new Map<number, GitlabUser>()
  for (const u of [...members, ...projectUsers]) {
    byId.set(u.id, { id: u.id, username: u.username, name: u.name })
  }
  return [...byId.values()]
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
