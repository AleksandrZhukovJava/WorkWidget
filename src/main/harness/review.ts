import { randomUUID } from 'node:crypto'
import { getMrDiff } from '../gitlab/mr'
import { runGit } from '../agent/git'
import { getAgentById, enabledProhibitionTexts, upsertRun } from './store'
import { engineByName, resolveEngine, executeReview } from './engine'
import { enrichFindings } from './enrich'
import type {
  HarnessRun,
  HarnessRunEvent,
  HarnessSource,
  HarnessStepResult
} from '@shared/types'

export type EmitFn = (ev: HarnessRunEvent) => void

// Active runs, so a run can be cancelled from the UI.
const active = new Map<string, AbortController>()

export function cancelRun(runId: string): void {
  active.get(runId)?.abort()
}

/** Resolve the unified diff for a source (MR changes or local branch diff vs its base). */
async function sourceDiff(source: HarnessSource): Promise<string> {
  if (source.kind === 'mr') {
    if (source.projectId === undefined || source.iid === undefined) {
      throw new Error('Не указан MR (projectId/iid)')
    }
    return getMrDiff(source.projectId, source.iid)
  }
  // branch
  const { repo, base, branch } = source
  if (!repo || !branch) throw new Error('Не указан репозиторий или ветка')
  const range = base ? `${base}...${branch}` : branch
  const diff = await runGit(repo, ['diff', range]).catch((e: Error) => {
    throw new Error(`git diff ${range}: ${e.message}`)
  })
  return diff
}

function sourceContext(source: HarnessSource): string {
  const lines = [`Источник: ${source.label}`]
  if (source.jiraKey) lines.push(`Jira: ${source.jiraKey}`)
  if (source.kind === 'branch') lines.push(`Ветка ${source.branch} относительно ${source.base}`)
  return lines.join('\n')
}

/**
 * Run the selected reviewer agents against a source (MR or local branch), in parallel, each on
 * its own engine. Streams lifecycle events via `emit` and persists the run for history. One
 * agent failing never aborts the others. Returns the finished run.
 */
export async function runReview(
  source: HarnessSource,
  agentIds: string[],
  emit: EmitFn
): Promise<HarnessRun> {
  const runId = randomUUID()
  const controller = new AbortController()
  active.set(runId, controller)

  const startedAt = new Date().toISOString()
  const steps: HarnessStepResult[] = agentIds.map((agentId) => {
    const agent = getAgentById(agentId)
    return {
      stepId: randomUUID(),
      agentId,
      agentName: agent?.name ?? agentId,
      engine: agent?.engine ?? 'default',
      status: 'running',
      findings: [],
      summary: '',
      startedAt
    }
  })
  const run: HarnessRun = { id: runId, source, startedAt, status: 'running', steps }
  upsertRun(run)
  emit({ runId, kind: 'run-start', run })

  // Collect the diff once, shared by all reviewers.
  let diff = ''
  try {
    diff = await sourceDiff(source)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    for (const step of steps) {
      step.status = 'error'
      step.error = msg
      step.finishedAt = new Date().toISOString()
      emit({ runId, kind: 'step-done', step })
    }
    run.status = 'error'
    run.finishedAt = new Date().toISOString()
    upsertRun(run)
    active.delete(runId)
    emit({ runId, kind: 'run-done', run })
    return run
  }

  // Keep the reviewed diff on the run so the UI can render a GitLab-style code view with inline
  // findings (and history keeps it). Cap the stored copy so a huge MR can't bloat the store.
  const MAX_STORED_DIFF = 500_000
  run.diff = diff.length > MAX_STORED_DIFF ? diff.slice(0, MAX_STORED_DIFF) : diff
  upsertRun(run)
  emit({ runId, kind: 'diff', diff: run.diff })

  const context = sourceContext(source)
  const prohibitions = enabledProhibitionTexts()
  const repoDir = source.kind === 'branch' ? source.repo : undefined

  await Promise.all(
    steps.map(async (step) => {
      emit({ runId, kind: 'step-start', stepId: step.stepId })
      const agent = getAgentById(step.agentId)
      if (!agent) {
        step.status = 'error'
        step.error = 'Агент не найден'
        step.finishedAt = new Date().toISOString()
        emit({ runId, kind: 'step-done', step })
        return
      }
      try {
        const engineName = await resolveEngine(agent.engine)
        step.engine = engineName
        const engine = engineByName(engineName)
        const result = await executeReview(engine, {
          agent,
          prohibitions,
          diff,
          context,
          repoDir,
          signal: controller.signal,
          onLog: (text) => emit({ runId, kind: 'log', stepId: step.stepId, text })
        })
        step.summary = result.summary
        step.findings = result.findings
        step.usage = result.usage
        // Attach a GitLab line link + a real-file code fragment to each finding (best-effort).
        await enrichFindings(source, diff, step.findings).catch(() => {})
        step.status = controller.signal.aborted ? 'cancelled' : 'done'
      } catch (err) {
        step.status = controller.signal.aborted ? 'cancelled' : 'error'
        step.error = err instanceof Error ? err.message : String(err)
      } finally {
        step.finishedAt = new Date().toISOString()
        upsertRun(run)
        emit({ runId, kind: 'step-done', step })
      }
    })
  )

  run.status = controller.signal.aborted
    ? 'cancelled'
    : steps.every((s) => s.status === 'error')
      ? 'error'
      : 'done'
  run.finishedAt = new Date().toISOString()
  upsertRun(run)
  active.delete(runId)
  emit({ runId, kind: 'run-done', run })
  return run
}
