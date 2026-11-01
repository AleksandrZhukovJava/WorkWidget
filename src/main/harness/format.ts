import type { HarnessRun, HarnessStepResult, ReviewFinding } from '@shared/types'

const SEVERITY_LABEL: Record<ReviewFinding['severity'], string> = {
  critical: '🔴 critical',
  major: '🟠 major',
  minor: '🟡 minor',
  nit: '⚪ nit',
  praise: '🟢 praise'
}

function findingMd(f: ReviewFinding): string {
  const loc = f.file ? ` \`${f.file}${f.line ? `:${f.line}` : ''}\`` : ''
  const sug = f.suggestion ? `\n  - 💡 ${f.suggestion}` : ''
  return `- **${SEVERITY_LABEL[f.severity]}** ${f.title}${loc}\n  - ${f.detail}${sug}`
}

function stepMd(step: HarnessStepResult): string {
  const head = `### ${step.agentName}`
  if (step.status === 'error') return `${head}\n\n_ошибка: ${step.error ?? 'неизвестно'}_`
  const summary = step.summary ? `${step.summary}\n` : ''
  const body = step.findings.length
    ? step.findings.map(findingMd).join('\n')
    : '_замечаний нет_'
  return `${head}\n\n${summary}\n${body}`
}

/** A single markdown note combining every reviewer's findings — posted as one MR comment. */
export function formatReviewNote(run: HarnessRun): string {
  const header = `## 🤖 Авто-ревью (Кодер Агент)\n\nИсточник: ${run.source.label}`
  return [header, ...run.steps.map(stepMd)].join('\n\n---\n\n')
}
