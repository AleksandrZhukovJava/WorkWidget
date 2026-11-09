import {
  buildReviewSystemPrompt,
  buildReviewUserPrompt,
  buildRepairSystemPrompt,
  buildRepairUserPrompt,
  parseReview,
  parseMarkdownReview,
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
  // When we have structured findings (the "broken-down by class" view the user wants), the summary
  // must be ONLY a short clean verdict — never the raw JSON/markdown dump, which would show up as a
  // duplicate blob above the cards.
  if (parsed.findings.length > 0) return { summary: shortVerdict(parsed.summary), findings: parsed.findings, usage }

  // No JSON findings — try to extract them from a markdown-style review without another model call.
  const md = parseMarkdownReview(first.text)
  if (md.findings.length > 0) {
    return { summary: shortVerdict(md.summary), findings: md.findings, usage }
  }

  // Still nothing structured. Ask the same engine to restructure its own answer (one extra call).
  if (hasSalvageableText(first.text) && !req.signal.aborted) {
    req.onLog('Переформатирую ответ в структуру…')
    try {
      const repaired = await engine.chat(buildRepairSystemPrompt(), buildRepairUserPrompt(first.text), req)
      const usage2 = addUsage(usage, repaired.usage)
      // Prefer JSON from the repair; else try markdown on the repaired text too.
      const p2 = parseReview(repaired.text)
      const r2 = p2.findings.length > 0 ? p2 : parseMarkdownReview(repaired.text)
      if (r2.findings.length > 0) {
        return { summary: shortVerdict(r2.summary), findings: r2.findings, usage: usage2 }
      }
      return { summary: cleanSummary(first.text), findings: [], usage: usage2 }
    } catch {
      /* repair is best-effort — fall through to the readable prose summary below */
    }
  }
  // Still unstructured: keep the model's text as a readable (de-noised) summary.
  return { summary: cleanSummary(first.text), findings: [], usage }
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

/**
 * Strip model noise from text meant for the summary: reasoning blocks, fenced code, and any raw
 * contract JSON object ({...} containing "findings"). This is what stops the "json вариант" and the
 * full prose dump from leaking into the UI above the structured cards.
 */
function stripNoise(raw: string): string {
  let t = stripThink(raw).replace(/```[\s\S]*?```/g, ' ')
  const a = t.indexOf('{')
  const b = t.lastIndexOf('}')
  if (a >= 0 && b > a && /"findings"/.test(t.slice(a, b + 1))) {
    t = `${t.slice(0, a)} ${t.slice(b + 1)}`
  }
  return t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/** A short, clean verdict shown beside structured findings (empty when there's nothing readable). */
function shortVerdict(s: string): string {
  return stripNoise(s).slice(0, 1200)
}

/** A longer, de-noised prose summary for when there are NO structured findings to show. */
function cleanSummary(raw: string): string {
  return stripNoise(raw).slice(0, 4000)
}
