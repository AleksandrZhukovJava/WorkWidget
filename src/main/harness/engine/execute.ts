import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildRepairSystemPrompt,
  buildRepairUserPrompt,
  parseReview,
  hasSalvageableText,
  stripThink
} from './review-prompt'
import type { ReviewEngine, ReviewRequest, ReviewResult } from './types'

/**
 * Run a review on any engine: build prompts → one completion → parse. If the model answered
 * in prose (valid JSON missing, zero findings) but there IS substance, do ONE repair pass that
 * asks the same engine to restructure its own answer into the schema. Whatever survives, the
 * summary keeps the model's cleaned text so the UI is never a parse-failure blank.
 */
export async function executeReview(engine: ReviewEngine, req: ReviewRequest): Promise<ReviewResult> {
  const system = buildReviewSystemPrompt(req.agent, req.prohibitions)
  const user = buildReviewUserPrompt(req.diff, req.context)
  const raw = await engine.chat(system, user, req)
  const parsed = parseReview(raw)
  if (parsed.findings.length > 0) return parsed

  // No structured findings. Try to salvage a prose answer into findings (one extra call).
  if (hasSalvageableText(raw) && !req.signal.aborted) {
    req.onLog('Переформатирую ответ в структуру…')
    try {
      const repaired = await engine.chat(buildRepairSystemPrompt(), buildRepairUserPrompt(raw), req)
      const p2 = parseReview(repaired)
      if (p2.findings.length > 0) {
        return { summary: p2.summary || parsed.summary || cleanSummary(raw), findings: p2.findings }
      }
    } catch {
      /* repair is best-effort — fall through to the readable prose summary below */
    }
  }
  // Still unstructured: keep the model's text as a readable summary (UI renders line breaks).
  return { summary: parsed.summary || cleanSummary(raw), findings: [] }
}

function cleanSummary(raw: string): string {
  return stripThink(raw).slice(0, 4000)
}
