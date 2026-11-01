import { coderChat } from '../../llm/client'
import { buildReviewSystemPrompt, buildReviewUserPrompt, parseReview } from './review-prompt'
import type { ReviewEngine, ReviewRequest, ReviewResult } from './types'

/**
 * Review on the local model (OpenAI-compatible / LM Studio), via the existing coder profile.
 * Fully usable without Claude or internet. The model has no native tools, so the orchestrator
 * feeds it the diff + context directly and we parse the structured reply. Hard rules are
 * enforced at the prompt level (there is no tool execution here to hook).
 */
export const localEngine: ReviewEngine = {
  async review(req: ReviewRequest): Promise<ReviewResult> {
    const system = buildReviewSystemPrompt(req.agent, req.prohibitions)
    const user = buildReviewUserPrompt(req.diff, req.context)
    req.onLog('Отправляю дифф локальной модели…')
    const raw = await coderChat([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ])
    req.onLog('Ответ получен, разбираю находки…')
    return parseReview(raw)
  }
}
