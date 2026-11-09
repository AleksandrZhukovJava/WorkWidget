// After a reviewer returns its findings, attach to each one (a) a deep link to the exact line in
// GitLab where the change is needed and (b) a code fragment read from the REAL file (git show for a
// local branch, the GitLab file API for an MR) — so the UI can render syntax-highlighted code with
// line numbers even for findings that fall outside the collected diff. Entirely best-effort: any
// failure leaves the finding untouched and never breaks the review.
import { runGit } from '../agent/git'
import { getRepoFileText, parseRepoPath } from '../gitlab/mr'
import { getGitlabBaseUrl } from '../store/credentials'
import type { FindingSnippet, HarnessSource, ReviewFinding } from '@shared/types'

const SNIPPET_CTX = 4 // lines of context kept on each side of the finding's line

/** ext → highlight.js language id (undefined = render as plain text, still numbered/highlighted). */
function langFromPath(path: string): string | undefined {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  const map: Record<string, string> = {
    java: 'java',
    kt: 'kotlin',
    kts: 'kotlin',
    gradle: 'groovy',
    groovy: 'groovy',
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    go: 'go',
    rb: 'ruby',
    rs: 'rust',
    cpp: 'cpp',
    cxx: 'cpp',
    cc: 'cpp',
    hpp: 'cpp',
    hh: 'cpp',
    c: 'c',
    h: 'c',
    cs: 'csharp',
    php: 'php',
    scala: 'scala',
    swift: 'swift',
    m: 'objectivec',
    vue: 'xml',
    html: 'xml',
    xml: 'xml',
    json: 'json',
    yml: 'yaml',
    yaml: 'yaml',
    sql: 'sql',
    sh: 'bash',
    css: 'css',
    scss: 'scss',
    properties: 'properties'
  }
  return map[ext]
}

/** New-file paths touched by the diff, used to resolve a finding's (possibly bare) file name. */
function diffPaths(diff: string): string[] {
  const out: string[] = []
  for (const line of diff.split('\n')) {
    const m = line.match(/^\+\+\+ b\/(.+)$/)
    if (m && m[1] !== '/dev/null') out.push(m[1].trim())
  }
  return out
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/**
 * Map a finding's `file` (which the model may give as a bare name or partial path) to a real
 * repo-relative path, preferring an exact/suffix match among the diff's files, then a unique
 * basename match. Falls back to the given file unchanged.
 */
function resolvePath(file: string, paths: string[]): string {
  const norm = file.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (paths.includes(norm)) return norm
  const suffix = paths.filter((p) => p === norm || p.endsWith('/' + norm))
  if (suffix.length === 1) return suffix[0]
  const bn = baseName(norm)
  const byBase = paths.filter((p) => baseName(p) === bn)
  if (byBase.length === 1) return byBase[0]
  return norm
}

/** Blob-URL prefix (up to, but excluding, `/-/blob/...`) + the ref to link against, if resolvable. */
async function linkContext(
  source: HarnessSource
): Promise<{ blobBase: string; ref: string } | null> {
  const ref = source.branch?.trim()
  if (!ref) return null
  if (source.kind === 'mr') {
    if (!source.webUrl) return null
    const blobBase = source.webUrl.replace(/\/-\/merge_requests\/.*$/, '')
    return blobBase ? { blobBase, ref } : null
  }
  // local branch: instance base + repo path from the origin remote
  if (!source.repo) return null
  const base = getGitlabBaseUrl()
  if (!base) return null
  const remote = await runGit(source.repo, ['remote', 'get-url', 'origin']).catch(() => '')
  const repoPath = parseRepoPath(remote)
  if (!repoPath) return null
  return { blobBase: `${base.replace(/\/+$/, '')}/${repoPath}`, ref }
}

function buildUrl(blobBase: string, ref: string, path: string, line?: number): string {
  const url = `${blobBase}/-/blob/${encodeURI(ref)}/${encodeURI(path)}`
  return line ? `${url}#L${line}` : url
}

/** Read the full text of a file at the source's ref (cached per run), for fragment extraction. */
async function readFile(
  source: HarnessSource,
  ref: string,
  path: string,
  cache: Map<string, string | null>
): Promise<string | null> {
  const key = `${ref}:${path}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  let text: string | null = null
  if (source.kind === 'mr' && source.projectId !== undefined) {
    text = await getRepoFileText(source.projectId, path, ref)
  } else if (source.kind === 'branch' && source.repo) {
    text = await runGit(source.repo, ['show', `${ref}:${path}`]).catch(() => null)
  }
  cache.set(key, text)
  return text
}

function sliceSnippet(
  text: string,
  path: string,
  line: number
): FindingSnippet | undefined {
  const all = text.replace(/\r\n/g, '\n').split('\n')
  if (line < 1 || line > all.length) return undefined
  const idx = line - 1
  const start = Math.max(0, idx - SNIPPET_CTX)
  const end = Math.min(all.length - 1, idx + SNIPPET_CTX)
  return {
    path,
    startLine: start + 1,
    lines: all.slice(start, end + 1),
    targetLine: line,
    language: langFromPath(path)
  }
}

/**
 * Enrich findings in place with a GitLab line link and a real-file code fragment. Safe to call for
 * any source; silently leaves findings as-is when nothing can be resolved.
 */
export async function enrichFindings(
  source: HarnessSource,
  diff: string,
  findings: ReviewFinding[]
): Promise<void> {
  if (findings.length === 0) return
  const paths = diffPaths(diff)
  const link = await linkContext(source).catch(() => null)
  const cache = new Map<string, string | null>()

  for (const f of findings) {
    if (!f.file) continue
    const path = resolvePath(f.file, paths)
    if (link) f.url = buildUrl(link.blobBase, link.ref, path, f.line)
    if (!f.line) continue
    const ref = source.branch?.trim()
    if (!ref) continue
    try {
      const text = await readFile(source, ref, path, cache)
      if (text != null) {
        const snip = sliceSnippet(text, path, f.line)
        if (snip) f.snippet = snip
      }
    } catch {
      /* best-effort: leave this finding without a fragment */
    }
  }
}
