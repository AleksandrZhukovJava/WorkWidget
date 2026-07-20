import type { ReactNode } from 'react'

/**
 * Renders a practical subset of Jira (Server/DC) wiki markup as React nodes:
 *   - {code}/{code:lang}/{noformat} fenced blocks (verbatim, monospaced)
 *   - headings `hN. …`
 *   - `* ` / `- ` / `# ` list items
 *   - inline: *bold* _italic_ +underline+ {{monospace}} [text|url]
 * Anything it doesn't recognise is passed through as plain text, so descriptions never
 * break — they just fall back to the raw characters. Purely presentational; the source
 * string is whatever Jira returned (we never write markup back).
 */
export function JiraMarkup({ text }: { text: string }): JSX.Element {
  return <>{parseBlocks(text)}</>
}

const FENCE_RE = /\{(code|noformat)(?::[^}]*)?\}\r?\n?([\s\S]*?)\r?\n?\{\1\}/g

function parseBlocks(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  FENCE_RE.lastIndex = 0
  while ((m = FENCE_RE.exec(text))) {
    if (m.index > last) out.push(...renderTextBlock(text.slice(last, m.index), `t${key++}`))
    out.push(
      <pre key={`c${key++}`} className="jira-md__code">
        <code>{m[2]}</code>
      </pre>
    )
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(...renderTextBlock(text.slice(last), `t${key++}`))
  return out
}

function renderTextBlock(seg: string, keyBase: string): ReactNode[] {
  const lines = seg.split(/\r?\n/)
  const out: ReactNode[] = []
  let list: ReactNode[] | null = null
  let n = 0

  const flushList = (): void => {
    if (list && list.length) {
      out.push(
        <ul key={`${keyBase}l${n++}`} className="jira-md__list">
          {list}
        </ul>
      )
    }
    list = null
  }

  lines.forEach((line, idx) => {
    const t = line.trimEnd()
    if (!t.trim()) {
      flushList()
      return
    }
    const h = t.match(/^h([1-6])\.\s*(.*)$/)
    if (h) {
      flushList()
      out.push(
        <div key={`${keyBase}h${idx}`} className={`jira-md__h jira-md__h${h[1]}`}>
          {renderInline(h[2], `${keyBase}h${idx}`)}
        </div>
      )
      return
    }
    const bullet = t.match(/^\s*[*#-]\s+(.*)$/)
    if (bullet) {
      list ??= []
      list.push(
        <li key={`${keyBase}li${idx}`}>{renderInline(bullet[1], `${keyBase}li${idx}`)}</li>
      )
      return
    }
    flushList()
    out.push(
      <p key={`${keyBase}p${idx}`} className="jira-md__p">
        {renderInline(t, `${keyBase}p${idx}`)}
      </p>
    )
  })
  flushList()
  return out
}

const MARKS: Record<string, 'strong' | 'em' | 'u'> = { '*': 'strong', _: 'em', '+': 'u' }

/** Inline markup within a single line/paragraph. */
function renderInline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ''
  let k = 0
  const flush = (): void => {
    if (buf) {
      out.push(buf)
      buf = ''
    }
  }

  for (let i = 0; i < text.length; ) {
    // {{monospace}}
    if (text.startsWith('{{', i)) {
      const end = text.indexOf('}}', i + 2)
      if (end !== -1) {
        flush()
        out.push(
          <code key={`${keyBase}m${k++}`} className="jira-md__mono">
            {text.slice(i + 2, end)}
          </code>
        )
        i = end + 2
        continue
      }
    }
    // [label|url] or [url]
    if (text[i] === '[') {
      const end = text.indexOf(']', i + 1)
      if (end !== -1) {
        const inner = text.slice(i + 1, end)
        const bar = inner.indexOf('|')
        const label = bar === -1 ? inner : inner.slice(0, bar)
        const url = bar === -1 ? inner : inner.slice(bar + 1)
        if (/^https?:\/\//i.test(url)) {
          flush()
          out.push(
            <a
              key={`${keyBase}a${k++}`}
              className="jira-md__link"
              onClick={() => void window.api.openInBrowser(url)}
            >
              {label}
            </a>
          )
          i = end + 1
          continue
        }
      }
    }
    // *bold* _italic_ +underline+ — require word-boundaries to avoid mangling maths/paths
    const mark = MARKS[text[i]]
    if (
      mark &&
      (i === 0 || !/\w/.test(text[i - 1])) &&
      i + 1 < text.length &&
      text[i + 1] !== ' '
    ) {
      const ch = text[i]
      const end = text.indexOf(ch, i + 1)
      if (
        end !== -1 &&
        text[end - 1] !== ' ' &&
        (end + 1 >= text.length || !/\w/.test(text[end + 1]))
      ) {
        flush()
        const Tag = mark
        out.push(<Tag key={`${keyBase}b${k++}`}>{text.slice(i + 1, end)}</Tag>)
        i = end + 1
        continue
      }
    }
    buf += text[i]
    i++
  }
  flush()
  return out
}
