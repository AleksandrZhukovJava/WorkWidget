import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MAX_FILES = 6
const MAX_BYTES_PER_FILE = 8_000
const TOTAL_BUDGET = 24_000

// Non-git walk limits and what to skip / include.
const WALK_FILE_CAP = 4000
const SCAN_SIZE_CAP = 200_000
const IGNORE_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'out', '.next', '.nuxt', 'target', 'vendor',
  '.idea', '.vscode', 'coverage', '.gradle', 'bin', 'obj', '__pycache__', '.venv', 'venv'
])
const TEXT_EXT = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'java', 'kt', 'kts', 'py', 'go', 'rs', 'rb', 'php',
  'cs', 'cpp', 'cc', 'c', 'h', 'hpp', 'swift', 'scala', 'sql', 'sh', 'ps1', 'yml', 'yaml',
  'json', 'xml', 'html', 'css', 'scss', 'vue', 'svelte', 'md', 'txt', 'gradle', 'properties',
  'toml', 'ini', 'cfg', 'env', 'dockerfile'
])

export interface RepoContext {
  files: { path: string; content: string }[]
  /** how the project was read, for display */
  source: 'git' | 'walk'
}

/** Run a git subcommand in the repo; resolves stdout, rejects with a readable message. */
function git(repo: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', repo, ...args],
      { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr?.toString().trim() || err.message))
        else resolve(stdout.toString())
      }
    )
  })
}

/**
 * Pull search keywords out of the task text: identifier-ish tokens (incl. snake_case /
 * camelCase names like Worker_absence), length > 3, deduped, capped. Stopwords dropped.
 */
function keywords(text: string): string[] {
  const STOP = new Set([
    'надо', 'нужно', 'задача', 'этой', 'этого', 'когда', 'который', 'чтобы', 'сделать',
    'добавить', 'изменить', 'ошибка', 'ошибку', 'this', 'that', 'with', 'from', 'into'
  ])
  const raw = text.match(/[A-Za-z_][A-Za-z0-9_]{3,}|[А-Яа-яЁё]{4,}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const w of raw) {
    const k = w.trim()
    if (STOP.has(k.toLowerCase()) || seen.has(k.toLowerCase())) continue
    seen.add(k.toLowerCase())
    out.push(k)
    if (out.length >= 12) break
  }
  return out
}

/** Read the top-ranked files (truncated, budgeted); skips binaries/unreadable. */
async function readRanked(repo: string, ranked: string[]): Promise<RepoContext['files']> {
  const files: RepoContext['files'] = []
  let budget = TOTAL_BUDGET
  for (const rel of ranked.slice(0, MAX_FILES)) {
    if (budget <= 0) break
    try {
      const buf = await fsp.readFile(join(repo, rel))
      if (buf.includes(0)) continue // skip binaries
      const slice = buf.toString('utf8').slice(0, Math.min(MAX_BYTES_PER_FILE, budget))
      files.push({ path: rel.split(sep).join('/'), content: slice })
      budget -= slice.length
    } catch {
      /* unreadable — skip */
    }
  }
  return files
}

/** Recursively list candidate source files under root (bounded), skipping junk dirs/binaries. */
async function listProjectFiles(root: string): Promise<string[]> {
  const out: string[] = []
  const stack = [root]
  while (stack.length && out.length < WALK_FILE_CAP) {
    const dir = stack.pop()!
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (out.length >= WALK_FILE_CAP) break
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) stack.push(full)
      } else if (e.isFile()) {
        const ext = e.name.includes('.') ? e.name.split('.').pop()!.toLowerCase() : ''
        if (TEXT_EXT.has(ext) || e.name.toLowerCase() === 'dockerfile') out.push(full)
      }
    }
  }
  return out
}

/**
 * Read the selected project for the coder agent. Prefers `git grep` (fast, respects
 * .gitignore); for non-git folders (or when git finds nothing) falls back to a bounded
 * filesystem walk + in-memory keyword search. Always read-only.
 */
export async function collectContext(repo: string, taskText: string): Promise<RepoContext> {
  if (!repo.trim()) throw new Error('Не указан путь к проекту (Настройки → Кодер-агент)')
  await fsp.access(repo).catch(() => {
    throw new Error(`Папка проекта не найдена: ${repo}`)
  })

  const kws = keywords(taskText)
  const isGit = await git(repo, ['rev-parse', '--is-inside-work-tree'])
    .then(() => true)
    .catch(() => false)

  // ---- git path ----
  if (isGit && kws.length > 0) {
    const hits = new Map<string, number>()
    for (const kw of kws) {
      const out = await git(repo, ['grep', '-l', '-i', '-F', '-I', kw]).catch(() => '')
      for (const f of out.split('\n').map((s) => s.trim()).filter(Boolean)) {
        hits.set(f, (hits.get(f) ?? 0) + 1)
      }
    }
    if (hits.size > 0) {
      const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
      return { files: await readRanked(repo, ranked), source: 'git' }
    }
    // git repo but no keyword hits → fall through to walk (broader read).
  }

  // ---- non-git / fallback walk ----
  const all = await listProjectFiles(repo)
  const scored = new Map<string, number>()
  const lowKws = kws.map((k) => k.toLowerCase())
  for (const full of all) {
    if (lowKws.length === 0) break
    try {
      const st = await fsp.stat(full)
      if (st.size > SCAN_SIZE_CAP) continue
      const text = (await fsp.readFile(full, 'utf8')).toLowerCase()
      let score = 0
      for (const kw of lowKws) if (text.includes(kw)) score++
      if (score > 0) scored.set(relative(repo, full), score)
    } catch {
      /* skip */
    }
  }

  let ranked: string[]
  if (scored.size > 0) {
    ranked = [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  } else {
    // No keyword matches at all — give the model some base bearing: entry/readme files.
    const prefer = /(readme|package\.json|pom\.xml|build\.gradle|index|main|app)\./i
    ranked = all
      .map((f) => relative(repo, f))
      .sort((a, b) => Number(prefer.test(b)) - Number(prefer.test(a)))
  }
  return { files: await readRanked(repo, ranked), source: 'walk' }
}
