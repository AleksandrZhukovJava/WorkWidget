import { runClaudePrint } from './claude-cli'
import { buildReviewSystemPrompt, buildReviewUserPrompt, parseReview } from './review-prompt'
import type { ReviewEngine, ReviewRequest, ReviewResult } from './types'

// Review can involve reading several files — give the agent room, but keep a hard ceiling.
const CLAUDE_REVIEW_TIMEOUT_MS = 240_000

/**
 * Review via the user's logged-in Claude Code CLI. Runs read-only (allowedTools limited to
 * Read/Grep/Glob, plus the agent's own allow-list) so the agent can inspect surrounding code
 * but cannot edit, run shell or push — a second safety layer on top of the prompt-level hard
 * rules. Works without any local model.
 */
export const claudeEngine: ReviewEngine = {
  async review(req: ReviewRequest): Promise<ReviewResult> {
    const system = buildReviewSystemPrompt(req.agent, req.prohibitions)
    const user = buildReviewUserPrompt(req.diff, req.context)
    // Read-only tool set: the agent's allow-list, always narrowed to safe read tools.
    const readOnly = ['Read', 'Grep', 'Glob']
    const allowed = [...new Set([...(req.agent.allowedTools ?? []), ...readOnly])].filter((t) =>
      readOnly.includes(t)
    )
    req.onLog('Claude анализирует дифф…')
    const res = await runClaudePrint({
      prompt: user,
      system,
      cwd: req.repoDir,
      model: req.agent.model,
      allowedTools: allowed,
      disallowedTools: req.agent.disallowedTools,
      signal: req.signal,
      timeoutMs: CLAUDE_REVIEW_TIMEOUT_MS,
      onLog: req.onLog
    })
    if (res.isError && !res.result.trim()) {
      throw new Error('Claude вернул ошибку выполнения (пустой результат)')
    }
    req.onLog('Ответ получен, разбираю находки…')
    return parseReview(res.result)
  }
}
