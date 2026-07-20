/**
 * Tolerant parsing of LLM output into {summary, description}.
 *
 * Local models are messy: they wrap JSON in markdown fences, prepend chat like
 * "Вот результат:", emit <think>…</think> reasoning blocks, put LITERAL newlines inside
 * JSON strings (invalid JSON!), leave trailing commas, or rename keys. Every one of those
 * used to dump raw JSON text into the form fields. This module digs the fields out anyway.
 *
 * Pure (no electron imports) so it can be unit-tested directly.
 */

export interface ParsedTask {
  summary: string
  description: string
}

/** Remove reasoning blocks and surrounding chat noise; prefer fenced content if present. */
export function stripNoise(raw: string): string {
  let t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  // A fenced block anywhere wins — models often write prose around it.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  // Unterminated fence (model got cut off or forgot to close).
  const open = t.match(/```(?:json)?\s*([\s\S]*)$/i)
  if (open && t.startsWith('```')) return open[1].trim()
  return t
}

/** Narrow to the outermost {...} if the text contains one. */
function braceSlice(t: string): string {
  const first = t.indexOf('{')
  const last = t.lastIndexOf('}')
  if (first !== -1 && last > first) return t.slice(first, last + 1)
  return t
}

const SUMMARY_KEYS = ['summary', 'title', 'заголовок']
const DESCRIPTION_KEYS = ['description', 'body', 'описание']

function pickFields(obj: Record<string, unknown>): ParsedTask | null {
  const lower = new Map(Object.entries(obj).map(([k, v]) => [k.toLowerCase().trim(), v]))
  const summary = SUMMARY_KEYS.map((k) => lower.get(k)).find((v) => typeof v === 'string')
  const description = DESCRIPTION_KEYS.map((k) => lower.get(k)).find(
    (v) => typeof v === 'string'
  )
  if (summary === undefined && description === undefined) return null
  return {
    summary: ((summary as string) ?? '').trim(),
    description: ((description as string) ?? '').trim()
  }
}

function tryJsonParse(t: string): ParsedTask | null {
  // As-is, then with trailing commas removed.
  for (const candidate of [t, t.replace(/,\s*([}\]])/g, '$1')]) {
    try {
      let parsed: unknown = JSON.parse(candidate)
      // Double-encoded: a JSON string containing JSON.
      if (typeof parsed === 'string') parsed = JSON.parse(parsed)
      if (parsed && typeof parsed === 'object') {
        const picked = pickFields(parsed as Record<string, unknown>)
        if (picked) return picked
      }
    } catch {
      /* next candidate */
    }
  }
  return null
}

function unescapeJsonString(s: string): string {
  return s
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, '\\')
}

/**
 * Last resort for ALMOST-JSON (e.g. literal newlines inside the quoted values, which
 * JSON.parse rejects): pull the field values out by key with regexes. The description
 * value is matched greedily to the last quote — it's the last field in our requested
 * shape, and this tolerates unescaped quotes/newlines inside it.
 */
function regexExtract(t: string): ParsedTask | null {
  const sumKeys = SUMMARY_KEYS.join('|')
  const descKeys = DESCRIPTION_KEYS.join('|')
  const sum = t.match(new RegExp(`"(?:${sumKeys})"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, 'i'))
  const desc = t.match(new RegExp(`"(?:${descKeys})"\\s*:\\s*"([\\s\\S]*)"`, 'i'))
  if (!sum && !desc) return null
  return {
    summary: unescapeJsonString(sum?.[1] ?? '').trim(),
    description: unescapeJsonString(desc?.[1] ?? '').trim()
  }
}

/**
 * Parse LLM output into task fields. Returns null only when the text bears no resemblance
 * to the requested JSON shape — the caller then treats it as plain prose.
 */
export function parseLlmTaskOutput(raw: string): ParsedTask | null {
  const cleaned = stripNoise(raw)
  // Whole text first — the double-encoded case ("{\"summary\"…}") is a valid JSON *string*
  // and would be ruined by brace-slicing its escaped quotes.
  const whole = tryJsonParse(cleaned)
  if (whole) return whole
  const candidate = braceSlice(cleaned)
  return tryJsonParse(candidate) ?? regexExtract(candidate)
}
