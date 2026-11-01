import { runClaudePrint } from './claude-cli'
import type { ChatResult, ReviewEngine, ReviewRequest } from './types'

// Review can involve reading several files — give the agent room, but keep a hard ceiling.
const CLAUDE_REVIEW_TIMEOUT_MS = 240_000

/**
 * Review via the user's logged-in Claude Code CLI. Runs read-only (allowedTools limited to
 * Read/Grep/Glob) so the agent can inspect surrounding code but cannot edit, run shell or push
 * — a second safety layer on top of the prompt-level hard rules. Works without any local model.
 * One raw completion; the shared executeReview() handles prompts, parsing and the repair pass.
 */
export const claudeEngine: ReviewEngine = {
  async chat(system: string, user: string, req: ReviewRequest): Promise<ChatResult> {
    const readOnly = ['Read', 'Grep', 'Glob']
    req.onLog('Claude обрабатывает запрос…')
    const res = await runClaudePrint({
      prompt: user,
      system,
      cwd: req.repoDir,
      model: req.agent.model,
      allowedTools: readOnly,
      disallowedTools: req.agent.disallowedTools,
      signal: req.signal,
      timeoutMs: CLAUDE_REVIEW_TIMEOUT_MS,
      onLog: req.onLog
    })
    if (res.isError && !res.result.trim()) {
      throw new Error('Claude вернул ошибку выполнения (пустой результат)')
    }
    return { text: res.result, usage: res.usage }
  }
}
