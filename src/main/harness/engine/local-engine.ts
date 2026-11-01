import { coderChat } from '../../llm/client'
import type { ReviewEngine, ReviewRequest } from './types'

/**
 * Review on the local model (OpenAI-compatible / LM Studio), via the existing coder profile.
 * Fully usable without Claude or internet. One raw completion; the shared executeReview() builds
 * the prompts, parses and (if the model answered in prose) runs the repair pass. Hard rules are
 * enforced at the prompt level — there is no tool execution here to hook.
 */
export const localEngine: ReviewEngine = {
  async chat(system: string, user: string, req: ReviewRequest): Promise<string> {
    req.onLog('Отправляю запрос локальной модели…')
    return coderChat([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ])
  }
}
