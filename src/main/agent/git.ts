import { execFile } from 'node:child_process'
import { writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type {
  GitInfo,
  BranchResult,
  ApplyResult,
  CommitResult,
  PushResult,
  GitDiffResult
} from '@shared/types'

/** Run a git subcommand in the repo; resolves stdout, rejects with a readable message. */
export function runGit(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repo, ...args],
      {
        windowsHide: true,
        timeout: 120_000,
        maxBuffer: 8 * 1024 * 1024,
        // Never block on an interactive credential prompt (would hang the app); credential
        // helpers still work — only the terminal fallback is disabled.
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString().trim() || err.message))
        else resolve(stdout.toString())
      }
    )
  })
}

async function isGitRepo(repo: string): Promise<boolean> {
  return runGit(repo, ['rev-parse', '--is-inside-work-tree'])
    .then(() => true)
    .catch(() => false)
}

/** URL of the `origin` remote, or '' if none/not a repo. Used to auto-detect the GitLab project. */
export async function originRemoteUrl(repo: string): Promise<string> {
  return (await runGit(repo, ['remote', 'get-url', 'origin']).catch(() => '')).trim()
}

/** Current git state of the folder: is it a repo, current branch, and whether it's dirty. */
export async function gitInfo(repo: string): Promise<GitInfo> {
  if (!repo.trim()) return { ok: false, isGit: false, branch: '', dirty: false, error: 'Не указан путь к проекту' }
  const isGit = await runGit(repo, ['rev-parse', '--is-inside-work-tree'])
    .then(() => true)
    .catch(() => false)
  if (!isGit) return { ok: true, isGit: false, branch: '', dirty: false }
  const branch = (await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim()
  const status = await runGit(repo, ['status', '--porcelain']).catch(() => '')
  return { ok: true, isGit: true, branch, dirty: status.trim().length > 0 }
}

export interface CreateBranchInput {
  repo: string
  name: string
  base: string
  remote: string
  updateFromRemote: boolean
}

/**
 * Create (and check out) a new local branch from `base`. When `updateFromRemote`, fetch the
 * remote base first and branch off `<remote>/<base>`. Refuses to touch git when the working
 * tree is dirty. Local only — never pushes.
 */
export async function createBranch(input: CreateBranchInput): Promise<BranchResult> {
  const { repo, name, base, remote, updateFromRemote } = input
  try {
    if (!name.trim()) return { ok: false, error: 'Пустое имя ветки' }

    const isGit = await runGit(repo, ['rev-parse', '--is-inside-work-tree'])
      .then(() => true)
      .catch(() => false)
    if (!isGit) return { ok: false, error: `Это не git-репозиторий: ${repo}` }

    // Safety: don't act on a dirty working tree.
    const dirty = (await runGit(repo, ['status', '--porcelain'])).trim().length > 0
    if (dirty) {
      return {
        ok: false,
        error:
          'В рабочей копии есть несохранённые изменения — закоммить или спрячь (stash) их, ' +
          'прежде чем создавать ветку.'
      }
    }

    // Branch must not already exist.
    const exists = await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`])
      .then(() => true)
      .catch(() => false)
    if (exists) return { ok: false, error: `Ветка «${name}» уже существует` }

    let baseRef = base
    let note: string | undefined
    if (updateFromRemote) {
      const fetched = await runGit(repo, ['fetch', remote, base])
        .then(() => true)
        .catch(() => false)
      const remoteRef = `${remote}/${base}`
      const remoteOk =
        fetched &&
        (await runGit(repo, ['rev-parse', '--verify', '--quiet', `refs/remotes/${remoteRef}`])
          .then(() => true)
          .catch(() => false))
      if (remoteOk) baseRef = remoteRef
      else note = `Не удалось обновить из ${remoteRef} — ветка создана от локальной «${base}».`
    }

    // Base ref must resolve.
    const baseOk = await runGit(repo, ['rev-parse', '--verify', '--quiet', baseRef])
      .then(() => true)
      .catch(() => false)
    if (!baseOk) return { ok: false, error: `Базовая ветка «${baseRef}» не найдена в репозитории` }

    await runGit(repo, ['checkout', '-b', name, baseRef])
    return { ok: true, branch: name, base: baseRef, note }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Uncommitted changes in the working tree (tracked, staged + unstaged, relative to HEAD),
 * plus the list of untracked files. This is exactly what makes the tree "dirty" and blocks
 * branch creation — surfaced so the user can review it.
 */
export async function workingDiff(repo: string): Promise<GitDiffResult> {
  try {
    if (!(await isGitRepo(repo))) return { ok: false, error: `Это не git-репозиторий: ${repo}` }
    // `git diff HEAD` covers staged + unstaged tracked changes; falls back to `git diff` on
    // an unborn HEAD (repo with no commits yet).
    const diff = await runGit(repo, ['diff', 'HEAD']).catch(() =>
      runGit(repo, ['diff']).catch(() => '')
    )
    const untracked = (
      await runGit(repo, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
    )
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    return { ok: true, diff, untracked }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Apply a unified diff to the working tree. Tries a clean `git apply` first, then a 3-way
 * merge apply as a fallback for fuzzy context. Leaves changes unstaged for the user to
 * review; never commits. Returns the list of touched files.
 */
export async function applyPatch(input: { repo: string; diff: string }): Promise<ApplyResult> {
  const { repo, diff } = input
  try {
    if (!diff.trim()) return { ok: false, error: 'Пустой дифф — нечего применять' }
    if (!(await isGitRepo(repo))) return { ok: false, error: `Это не git-репозиторий: ${repo}` }

    // git apply wants LF endings and a trailing newline.
    const normalized = diff.replace(/\r\n/g, '\n').replace(/\n*$/, '\n')
    const patchFile = join(tmpdir(), `jira-widget-patch-${Date.now()}.diff`)
    await writeFile(patchFile, normalized, 'utf8')
    const flags = ['--whitespace=nowarn']
    try {
      const checkErr = await runGit(repo, ['apply', '--check', ...flags, patchFile])
        .then(() => null)
        .catch((e: Error) => e)
      if (checkErr === null) {
        await runGit(repo, ['apply', ...flags, patchFile])
      } else {
        // Fallback: 3-way merge apply (tolerates context drift when blobs are known).
        try {
          await runGit(repo, ['apply', '--3way', ...flags, patchFile])
        } catch {
          return {
            ok: false,
            error:
              'Не удалось применить дифф (git apply):\n' +
              checkErr.message +
              '\n\nВероятно, контекст диффа не совпадает с файлами. Сгенерируйте заново или ' +
              'примените вручную.'
          }
        }
      }
      const changed = (await runGit(repo, ['diff', '--name-only']).catch(() => ''))
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      const untracked = (
        await runGit(repo, ['ls-files', '--others', '--exclude-standard']).catch(() => '')
      )
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
      return { ok: true, files: [...new Set([...changed, ...untracked])] }
    } finally {
      await unlink(patchFile).catch(() => {})
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Stage everything and create a local commit. Local only — never pushes. */
export async function commitChanges(input: {
  repo: string
  message: string
}): Promise<CommitResult> {
  const { repo, message } = input
  try {
    if (!message.trim()) return { ok: false, error: 'Пустое сообщение коммита' }
    if (!(await isGitRepo(repo))) return { ok: false, error: `Это не git-репозиторий: ${repo}` }
    const dirty = (await runGit(repo, ['status', '--porcelain'])).trim().length > 0
    if (!dirty) return { ok: false, error: 'Нет изменений для коммита' }
    await runGit(repo, ['add', '-A'])
    await runGit(repo, ['commit', '-m', message])
    const hash = (await runGit(repo, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim()
    const branch = (
      await runGit(repo, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')
    ).trim()
    return { ok: true, hash, branch }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Push the branch to the remote with upstream tracking. Only ever called on explicit
 * user confirmation from the UI. */
export async function pushBranch(input: {
  repo: string
  remote: string
  branch: string
}): Promise<PushResult> {
  const { repo, remote, branch } = input
  try {
    if (!branch.trim()) return { ok: false, error: 'Не указана ветка для push' }
    if (!(await isGitRepo(repo))) return { ok: false, error: `Это не git-репозиторий: ${repo}` }
    await runGit(repo, ['push', '-u', remote, branch])
    return { ok: true, remote, branch }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
