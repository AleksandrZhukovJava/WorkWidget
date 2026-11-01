import type { HarnessAgent, ReviewFinding } from '@shared/types'

/** Everything a review step needs, engine-agnostic. */
export interface ReviewRequest {
  agent: HarnessAgent
  /** enabled hard-rule texts to inject + enforce */
  prohibitions: string[]
  /** unified diff under review */
  diff: string
  /** extra context (task text, file list, etc.) */
  context: string
  /** repo dir — gives the Claude engine read access to surrounding code; optional */
  repoDir?: string
  /** abort the underlying model/process */
  signal: AbortSignal
  /** progress/log callback for the live transcript */
  onLog: (text: string) => void
}

export interface ReviewResult {
  summary: string
  findings: ReviewFinding[]
}

/**
 * A pluggable backend reduced to one primitive: a single completion. The review logic
 * (prompt building, parsing, repair pass) lives in executeReview() on top of this, so both
 * engines share it and the orchestrator/UI never know which engine runs inside.
 */
export interface ReviewEngine {
  chat(system: string, user: string, req: ReviewRequest): Promise<string>
}
