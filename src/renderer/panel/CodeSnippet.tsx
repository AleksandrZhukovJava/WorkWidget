// A syntax-highlighted code fragment around a finding — GitLab/IDEA style: real file line numbers
// in the gutter and the problem line tinted by severity. Uses the highlight.js "Light" build with
// only the languages we need registered, so the bundle stays lean.
import { Light as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs'
import java from 'react-syntax-highlighter/dist/esm/languages/hljs/java'
import kotlin from 'react-syntax-highlighter/dist/esm/languages/hljs/kotlin'
import groovy from 'react-syntax-highlighter/dist/esm/languages/hljs/groovy'
import typescript from 'react-syntax-highlighter/dist/esm/languages/hljs/typescript'
import javascript from 'react-syntax-highlighter/dist/esm/languages/hljs/javascript'
import python from 'react-syntax-highlighter/dist/esm/languages/hljs/python'
import go from 'react-syntax-highlighter/dist/esm/languages/hljs/go'
import ruby from 'react-syntax-highlighter/dist/esm/languages/hljs/ruby'
import rust from 'react-syntax-highlighter/dist/esm/languages/hljs/rust'
import cpp from 'react-syntax-highlighter/dist/esm/languages/hljs/cpp'
import c from 'react-syntax-highlighter/dist/esm/languages/hljs/c'
import csharp from 'react-syntax-highlighter/dist/esm/languages/hljs/csharp'
import php from 'react-syntax-highlighter/dist/esm/languages/hljs/php'
import scala from 'react-syntax-highlighter/dist/esm/languages/hljs/scala'
import swift from 'react-syntax-highlighter/dist/esm/languages/hljs/swift'
import objectivec from 'react-syntax-highlighter/dist/esm/languages/hljs/objectivec'
import xml from 'react-syntax-highlighter/dist/esm/languages/hljs/xml'
import json from 'react-syntax-highlighter/dist/esm/languages/hljs/json'
import yaml from 'react-syntax-highlighter/dist/esm/languages/hljs/yaml'
import sql from 'react-syntax-highlighter/dist/esm/languages/hljs/sql'
import bash from 'react-syntax-highlighter/dist/esm/languages/hljs/bash'
import css from 'react-syntax-highlighter/dist/esm/languages/hljs/css'
import scss from 'react-syntax-highlighter/dist/esm/languages/hljs/scss'
import properties from 'react-syntax-highlighter/dist/esm/languages/hljs/properties'
import type { FindingSnippet, ReviewFinding } from '@shared/types'

for (const [name, lang] of Object.entries({
  java,
  kotlin,
  groovy,
  typescript,
  javascript,
  python,
  go,
  ruby,
  rust,
  cpp,
  c,
  csharp,
  php,
  scala,
  swift,
  objectivec,
  xml,
  json,
  yaml,
  sql,
  bash,
  css,
  scss,
  properties
})) {
  SyntaxHighlighter.registerLanguage(name, lang)
}

/** rgba tint for the highlighted (problem) line, by severity. */
const TARGET_TINT: Record<ReviewFinding['severity'], string> = {
  critical: 'rgba(239, 68, 68, 0.22)',
  major: 'rgba(249, 115, 22, 0.20)',
  minor: 'rgba(234, 179, 8, 0.18)',
  nit: 'rgba(148, 163, 184, 0.16)',
  praise: 'rgba(34, 197, 94, 0.16)'
}

export function CodeSnippet({
  snippet,
  severity
}: {
  snippet: FindingSnippet
  severity?: ReviewFinding['severity']
}): JSX.Element {
  // lineProps receives the 1-based index WITHIN the content, not the gutter number.
  const targetIdx = snippet.targetLine - snippet.startLine + 1
  const tint = TARGET_TINT[severity ?? 'minor']
  return (
    <div className="cs">
      <SyntaxHighlighter
        language={snippet.language}
        style={atomOneDark}
        showLineNumbers
        startingLineNumber={snippet.startLine}
        wrapLines
        lineProps={(ln: number) => ({
          className: ln === targetIdx ? 'cs-line cs-line--target' : 'cs-line',
          style: ln === targetIdx ? { background: tint, display: 'block' } : { display: 'block' }
        })}
        codeTagProps={{ className: 'cs-code' }}
        customStyle={{
          margin: 0,
          padding: '8px 0',
          background: 'transparent',
          fontSize: '12px',
          lineHeight: '1.5',
          borderRadius: 0
        }}
        lineNumberStyle={{
          minWidth: '2.6em',
          paddingRight: '0.9em',
          textAlign: 'right',
          color: 'var(--muted, #6b7280)',
          userSelect: 'none'
        }}
      >
        {snippet.lines.join('\n')}
      </SyntaxHighlighter>
    </div>
  )
}
