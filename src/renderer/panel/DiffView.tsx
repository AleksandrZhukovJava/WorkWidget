import { useMemo } from 'react'
import type { HarnessEngine, ReviewFinding } from '@shared/types'

/** Severity → emoji, shared across the harness result views. */
export const SEV_LABEL: Record<ReviewFinding['severity'], string> = {
  critical: '🔴',
  major: '🟠',
  minor: '🟡',
  nit: '⚪',
  praise: '🟢'
}

export const ENGINE_LABEL: Record<HarnessEngine, string> = {
  default: 'Авто',
  claude: 'Claude',
  local: 'Локальная'
}

/** Render text preserving line breaks and simple **bold** — so a prose detail is readable. */
export function RichText({ text }: { text: string }): JSX.Element {
  return (
    <div className="hv-rich">
      {text.split('\n').map((line, i) => (
        <div className="hv-rich__line" key={i}>
          {line.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
            seg.startsWith('**') && seg.endsWith('**') ? (
              <b key={j}>{seg.slice(2, -2)}</b>
            ) : (
              <span key={j}>{seg}</span>
            )
          )}
        </div>
      ))}
    </div>
  )
}

/** A finding tagged with which reviewer (and engine) produced it, for GitLab-style attribution. */
export interface InlineFinding extends ReviewFinding {
  reviewer: string
  engine: HarnessEngine
}

type LineKind = 'add' | 'del' | 'ctx' | 'hunk'
export interface DiffLine {
  kind: LineKind
  oldNo?: number
  newNo?: number
  text: string
}
export interface DiffFile {
  oldPath: string
  newPath: string
  isNew: boolean
  isDeleted: boolean
  isRenamed: boolean
  lines: DiffLine[]
}

function stripAbPrefix(p: string): string {
  return p.replace(/^[ab]\//, '').replace(/\t.*$/, '').trim()
}

/** Parse a unified diff (git / GitLab style) into files → lines with old/new line numbers. */
export function parseDiff(raw: string): DiffFile[] {
  const files: DiffFile[] = []
  let cur: DiffFile | null = null
  let oldNo = 0
  let newNo = 0
  const flush = (): void => {
    if (cur) files.push(cur)
  }
  for (const l of raw.split('\n')) {
    if (l.startsWith('diff --git')) {
      flush()
      cur = { oldPath: '', newPath: '', isNew: false, isDeleted: false, isRenamed: false, lines: [] }
      const m = l.match(/^diff --git a\/(.+) b\/(.+)$/)
      if (m) {
        cur.oldPath = m[1]
        cur.newPath = m[2]
      }
      continue
    }
    if (!cur) continue
    if (l.startsWith('--- ')) {
      const p = l.slice(4)
      if (p.trim() === '/dev/null') cur.isNew = true
      else cur.oldPath = stripAbPrefix(p)
      continue
    }
    if (l.startsWith('+++ ')) {
      const p = l.slice(4)
      if (p.trim() === '/dev/null') cur.isDeleted = true
      else cur.newPath = stripAbPrefix(p)
      continue
    }
    if (l.startsWith('new file')) {
      cur.isNew = true
      continue
    }
    if (l.startsWith('deleted file')) {
      cur.isDeleted = true
      continue
    }
    if (l.startsWith('rename ')) {
      cur.isRenamed = true
      continue
    }
    if (
      l.startsWith('index ') ||
      l.startsWith('similarity ') ||
      l.startsWith('old mode') ||
      l.startsWith('new mode') ||
      l.startsWith('Binary ')
    ) {
      continue
    }
    const hunk = l.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      oldNo = parseInt(hunk[1], 10)
      newNo = parseInt(hunk[2], 10)
      cur.lines.push({ kind: 'hunk', text: l })
      continue
    }
    if (l.startsWith('\\')) continue // "\ No newline at end of file"
    if (l.startsWith('+')) {
      cur.lines.push({ kind: 'add', newNo, text: l.slice(1) })
      newNo++
      continue
    }
    if (l.startsWith('-')) {
      cur.lines.push({ kind: 'del', oldNo, text: l.slice(1) })
      oldNo++
      continue
    }
    // context line (leading space, or a blank line inside a hunk)
    cur.lines.push({ kind: 'ctx', oldNo, newNo, text: l.startsWith(' ') ? l.slice(1) : l })
    oldNo++
    newNo++
  }
  flush()
  return files
}

function baseName(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i >= 0 ? p.slice(i + 1) : p
}

/** Does a finding's file reference point at this diff file? Tolerant to relative vs full paths. */
function fileMatches(findingFile: string | undefined, file: DiffFile): boolean {
  if (!findingFile) return false
  const f = findingFile.replace(/^[ab]\//, '').trim()
  const paths = [file.newPath, file.oldPath].filter(Boolean)
  if (paths.some((p) => p === f || p.endsWith('/' + f) || f.endsWith('/' + p))) return true
  // last resort: same filename
  return paths.some((p) => baseName(p) === baseName(f))
}

/** Which rendered line a finding anchors to (new line preferred, else matching old line). */
function lineIndexForFinding(file: DiffFile, line: number | undefined): number {
  if (!line) return -1
  let idx = file.lines.findIndex((l) => (l.kind === 'add' || l.kind === 'ctx') && l.newNo === line)
  if (idx >= 0) return idx
  idx = file.lines.findIndex((l) => (l.kind === 'del' || l.kind === 'ctx') && l.oldNo === line)
  return idx
}

/** A snippet line, flagged if it is the one a finding points at (highlighted in SnippetView). */
export interface SnippetLine extends DiffLine {
  target: boolean
}

/**
 * The few diff lines around a finding's target line, for a focused "вот этот участок" snippet.
 * Returns null when the finding has no locatable file+line in the diff. `ctx` lines of context
 * are kept on each side; hunk-separator lines are dropped so the snippet reads as plain code.
 */
export function extractSnippet(
  files: DiffFile[],
  findingFile: string | undefined,
  findingLine: number | undefined,
  ctx = 3
): { path: string; lines: SnippetLine[] } | null {
  if (!findingFile || !findingLine) return null
  const file = files.find((f) => fileMatches(findingFile, f))
  if (!file) return null
  const idx = lineIndexForFinding(file, findingLine)
  if (idx < 0) return null
  const start = Math.max(0, idx - ctx)
  const end = Math.min(file.lines.length - 1, idx + ctx)
  const lines: SnippetLine[] = []
  for (let i = start; i <= end; i++) {
    const l = file.lines[i]
    if (l.kind === 'hunk') continue
    lines.push({ ...l, target: i === idx })
  }
  return { path: file.newPath || file.oldPath, lines }
}

/** Render an extracted snippet in the diff style, with the finding's line highlighted. */
export function SnippetView({ lines }: { lines: SnippetLine[] }): JSX.Element {
  return (
    <div className="dv-code-block dv-snippet">
      {lines.map((l, i) => (
        <div className={`dv-row dv-${l.kind}${l.target ? ' dv-target' : ''}`} key={i}>
          <span className="dv-gutter dv-gutter--old">
            {l.kind === 'add' ? '' : (l.oldNo ?? '')}
          </span>
          <span className="dv-gutter dv-gutter--new">
            {l.kind === 'del' ? '' : (l.newNo ?? '')}
          </span>
          <span className="dv-sign">{l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}</span>
          <code className="dv-text">{l.text || ' '}</code>
        </div>
      ))}
    </div>
  )
}

function Comment({ f }: { f: InlineFinding }): JSX.Element {
  return (
    <div className={`dv-comment dv-sev-${f.severity}`}>
      <div className="dv-comment__head">
        <span className="dv-comment__sev">{SEV_LABEL[f.severity]}</span>
        <b>{f.title}</b>
        <span className="dv-comment__by">
          {f.reviewer} · {ENGINE_LABEL[f.engine]}
        </span>
      </div>
      {f.detail && (
        <div className="dv-comment__detail">
          <RichText text={f.detail} />
        </div>
      )}
      {f.suggestion && <div className="dv-comment__sug">💡 {f.suggestion}</div>}
    </div>
  )
}

/**
 * GitLab-style rendering of a reviewed diff: per-file code with old/new line-number gutters and
 * +/- coloring, with each finding shown as an inline comment anchored to its line. Findings whose
 * file isn't in the diff (or whose line can't be located) are listed separately so nothing is lost.
 */
export function DiffView({ diff, findings }: { diff: string; findings: InlineFinding[] }): JSX.Element {
  const files = useMemo(() => parseDiff(diff), [diff])

  // Place each finding: onto a specific line, onto a file (no line match), or unplaced.
  const { byLine, byFile, unplaced } = useMemo(() => {
    const byLine = new Map<string, InlineFinding[]>() // key: fileIdx:lineIdx
    const byFile = new Map<number, InlineFinding[]>() // key: fileIdx
    const unplaced: InlineFinding[] = []
    for (const f of findings) {
      const fileIdx = files.findIndex((file) => fileMatches(f.file, file))
      if (fileIdx < 0) {
        unplaced.push(f)
        continue
      }
      const lineIdx = lineIndexForFinding(files[fileIdx], f.line)
      if (lineIdx >= 0) {
        const key = `${fileIdx}:${lineIdx}`
        byLine.set(key, [...(byLine.get(key) ?? []), f])
      } else {
        byFile.set(fileIdx, [...(byFile.get(fileIdx) ?? []), f])
      }
    }
    return { byLine, byFile, unplaced }
  }, [files, findings])

  if (files.length === 0) {
    return <div className="hint">Диф пуст или не распознан.</div>
  }

  return (
    <div className="dv">
      {files.map((file, fi) => {
        const path = file.newPath || file.oldPath
        return (
          <div className="dv-file" key={fi}>
            <div className="dv-file__head">
              <span className="dv-file__path">{path}</span>
              {file.isNew && <span className="dv-tag dv-tag--new">новый</span>}
              {file.isDeleted && <span className="dv-tag dv-tag--del">удалён</span>}
              {file.isRenamed && <span className="dv-tag">переименован</span>}
              {file.oldPath && file.newPath && file.oldPath !== file.newPath && (
                <span className="dv-file__from">← {file.oldPath}</span>
              )}
            </div>
            <div className="dv-code-block">
              {file.lines.map((l, li) => {
                const key = `${fi}:${li}`
                const comments = byLine.get(key)
                return (
                  <div key={li}>
                    <div className={`dv-row dv-${l.kind}`}>
                      <span className="dv-gutter dv-gutter--old">
                        {l.kind === 'add' || l.kind === 'hunk' ? '' : (l.oldNo ?? '')}
                      </span>
                      <span className="dv-gutter dv-gutter--new">
                        {l.kind === 'del' || l.kind === 'hunk' ? '' : (l.newNo ?? '')}
                      </span>
                      <span className="dv-sign">
                        {l.kind === 'add' ? '+' : l.kind === 'del' ? '-' : ''}
                      </span>
                      <code className="dv-text">{l.text || ' '}</code>
                    </div>
                    {comments?.map((f, ci) => <Comment key={ci} f={f} />)}
                  </div>
                )
              })}
            </div>
            {byFile.get(fi) && (
              <div className="dv-file-comments">
                <div className="dv-file-comments__label">Замечания по файлу (без точной строки)</div>
                {byFile.get(fi)!.map((f, ci) => <Comment key={ci} f={f} />)}
              </div>
            )}
          </div>
        )
      })}
      {unplaced.length > 0 && (
        <div className="dv-file-comments">
          <div className="dv-file-comments__label">Прочие замечания (вне диффа)</div>
          {unplaced.map((f, ci) => <Comment key={ci} f={f} />)}
        </div>
      )}
    </div>
  )
}
