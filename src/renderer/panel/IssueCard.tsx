import { useState } from 'react'
import { formatRemaining, LEVEL_COLOR } from '@shared/sla'
import { PRIORITY_COLOR, PRIORITY_LABEL, PRIORITY_LEVELS, type PriorityLevel } from '@shared/priority'
import type { GitlabMR, JiraIssue } from '@shared/types'

const BLOCK_COLOR = '#f85149'

export function IssueCard({
  issue,
  onOpenDetail,
  mrs
}: {
  issue: JiraIssue
  /** Open the full-task detail overlay (description + actions + checklist). */
  onOpenDetail?: (issue: JiraIssue) => void
  /** GitLab MRs linked to this issue (by Jira key); renders a clickable chip each */
  mrs?: GitlabMR[]
}): JSX.Element {
  const [copied, setCopied] = useState<'key' | 'sum' | ''>('')

  function copy(text: string, what: 'key' | 'sum'): void {
    void window.api.copyText(text)
    setCopied(what)
    setTimeout(() => setCopied(''), 1200)
  }

  const slaColor = LEVEL_COLOR[issue.sla?.level ?? 'none']
  const prio = (issue.localPriority ?? 0) as PriorityLevel
  const prioColor = PRIORITY_COLOR[prio]
  const borderColor = issue.blocked ? BLOCK_COLOR : issue.done ? 'var(--ok)' : prio > 0 ? prioColor : 'transparent'

  const checklist = issue.checklist ?? []
  const checkDone = checklist.filter((i) => i.done).length

  return (
    <div
      className={`issue ${issue.blocked ? 'is-blocked' : ''} ${issue.current ? 'is-current' : ''}`}
      style={{ borderLeft: `3px solid ${borderColor}` }}
      title={issue.blocked ? `🚫 Блокировано: ${issue.blockReason}` : undefined}
    >
      <div className="issue__top">
        {issue.done && (
          <span
            className="issue__done-badge"
            title={issue.doneAt ? `Завершено: ${new Date(issue.doneAt).toLocaleString('ru-RU')}` : 'Завершено'}
          >
            ✓
          </span>
        )}
        {issue.blocked && (
          <span className="issue__block-badge" title={`Блокировано: ${issue.blockReason}`}>
            🚫
          </span>
        )}
        {prio > 0 && (
          <span className="issue__flag" style={{ color: prioColor }} title={`Приоритет: ${PRIORITY_LABEL[prio]}`}>
            ⚑
          </span>
        )}
        {issue.isLocal ? (
          <span className="issue__key issue__key--local" title="Своя задача (не из Jira)">
            Своя
          </span>
        ) : (
          <>
            <span
              className="issue__key"
              onClick={() => void window.api.openInBrowser(issue.url)}
              title="Открыть в браузере"
            >
              {issue.key}
            </span>
            <button
              className="issue__copy"
              title="Копировать номер"
              onClick={() => copy(issue.key, 'key')}
            >
              ⧉
            </button>
          </>
        )}
        {!issue.done && !issue.blocked && (
          <button
            className={`issue__current ${issue.current ? 'is-on' : ''}`}
            title={issue.current ? 'Снять отметку «текущая»' : 'Отметить как текущую'}
            onClick={() => void window.api.setCurrent(issue.key, !issue.current)}
          >
            {issue.current ? '◉' : '◎'}
          </button>
        )}
        {!issue.isLocal && <span className="issue__status">{issue.status}</span>}
        {!issue.isLocal && issue.assignee && (
          <span className="issue__assignee" title="Исполнитель">
            👤 {issue.assignee}
          </span>
        )}
        {mrs?.map((mr) => (
          <button
            key={mr.iid}
            className={`issue__mr ${mr.approved ? 'is-approved' : ''}`}
            title={`${mr.title}\n${mr.sourceBranch} → ${mr.targetBranch}${mr.approved ? '\n✓ одобрен' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              void window.api.openInBrowser(mr.webUrl)
            }}
          >
            🦊 MR !{mr.iid}
            {mr.approved && ' ✓'}
          </button>
        ))}
        {copied && <span className="issue__copied">скопировано ✓</span>}
        {issue.sla && (
          <span className="issue__sla" style={{ color: slaColor }} title={issue.sla.name}>
            <span className="dot" style={{ background: slaColor }} />
            {formatRemaining(issue.sla)}
          </span>
        )}
      </div>

      <div
        className="issue__summary issue__summary--copy"
        title="Кликните, чтобы скопировать название"
        onClick={() => copy(issue.summary, 'sum')}
      >
        {issue.summary}
      </div>

      {issue.blocked && (
        <div className="issue__blocked-note" title={issue.blockReason}>
          🚫 {issue.blockReason}
        </div>
      )}

      <div className="issue__actions">
        <select
          className="prio-select"
          title="Локальный приоритет (сортировка)"
          value={prio}
          style={{ color: prioColor, borderColor: prio > 0 ? prioColor : undefined }}
          onChange={(e) => void window.api.setPriority(issue.key, Number(e.target.value))}
        >
          {PRIORITY_LEVELS.map((lvl) => (
            <option key={lvl} value={lvl}>
              {lvl === 0 ? '⚑ Приоритет' : `⚑ ${PRIORITY_LABEL[lvl]}`}
            </option>
          ))}
        </select>

        {checklist.length > 0 && (
          <button
            className="issue__checklist"
            title="Пункты выполнения"
            onClick={() => onOpenDetail?.(issue)}
          >
            ☑ {checkDone}/{checklist.length}
          </button>
        )}

        {onOpenDetail && (
          <button className="btn btn--icon issue__detail-btn" title="Подробнее" onClick={() => onOpenDetail(issue)}>
            ⓘ
          </button>
        )}
      </div>
    </div>
  )
}
