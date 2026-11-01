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
import type { TokenUsage } from '@shared/types'

/**
 * Run a review on any engine: build prompts → one completion → parse. If the model answered
 * in prose (valid JSON missing, zero findings) but there IS substance, do ONE repair pass that
 * asks the same engine to restructure its own answer into the schema. Whatever survives, the
 * summary keeps the model's cleaned text so the UI is never a parse-failure blank. Token usage
 * from every call (review + optional repair) is summed and returned so the harness can show it.
 */
export async function executeReview(engine: ReviewEngine, req: ReviewRequest): Promise<ReviewResult> {
  const system = buildReviewSystemPrompt(req.agent, req.prohibitions)
  const user = buildReviewUserPrompt(req.diff, req.context)
  const first = await engine.chat(system, user, req)
  const usage = addUsage(undefined, first.usage)
  const parsed = parseReview(first.text)
  if (parsed.findings.length > 0) return { ...parsed, usage }

  // No structured findings. Try to salvage a prose answer into findings (one extra call).
  if (hasSalvageableText(first.text) && !req.signal.aborted) {
    req.onLog('Переформатирую ответ в структуру…')
    try {
      const repaired = await engine.chat(buildRepairSystemPrompt(), buildRepairUserPrompt(first.text), req)
      const usage2 = addUsage(usage, repaired.usage)
      const p2 = parseReview(repaired.text)
      if (p2.findings.length > 0) {
        return {
          summary: p2.summary || parsed.summary || cleanSummary(first.text),
          findings: p2.findings,
          usage: usage2
        }
      }
      return { summary: parsed.summary || cleanSummary(first.text), findings: [], usage: usage2 }
    } catch {
      /* repair is best-effort — fall through to the readable prose summary below */
    }
  }
  // Still unstructured: keep the model's text as a readable summary (UI renders line breaks).
  return { summary: parsed.summary || cleanSummary(first.text), findings: [], usage }
}

/** Fold a call's usage into a running total (summing tokens/cost, counting calls). */
function addUsage(acc: TokenUsage | undefined, u: TokenUsage | undefined): TokenUsage | undefined {
  if (!u) return acc
  if (!acc) return { ...u }
  return {
    inputTokens: acc.inputTokens + u.inputTokens,
    outputTokens: acc.outputTokens + u.outputTokens,
    cacheReadTokens: acc.cacheReadTokens + u.cacheReadTokens,
    cacheCreationTokens: acc.cacheCreationTokens + u.cacheCreationTokens,
    totalTokens: acc.totalTokens + u.totalTokens,
    costUsd:
      acc.costUsd === undefined && u.costUsd === undefined
        ? undefined
        : (acc.costUsd ?? 0) + (u.costUsd ?? 0),
    calls: acc.calls + u.calls
  }
}

function cleanSummary(raw: string): string {
  return stripThink(raw).slice(0, 4000)
}
