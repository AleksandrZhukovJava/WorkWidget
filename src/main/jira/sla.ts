import { jiraRequest, JiraError } from './client'
import { computeLevel } from '@shared/sla'
import type { SlaInfo } from '@shared/types'

interface JsmDuration {
  millis: number
  friendly: string
}

interface JsmCycle {
  breached: boolean
  paused: boolean
  goalDuration?: JsmDuration
  elapsedTime?: JsmDuration
  remainingTime?: JsmDuration
}

interface JsmSlaValue {
  id: string
  name: string
  ongoingCycle?: JsmCycle
  completedCycles?: JsmCycle[]
}

interface JsmSlaResponse {
  values: JsmSlaValue[]
}

/**
 * Fetch JSM SLA for an issue and reduce it to the single most-urgent active SLA.
 * Returns null for non-JSM issues (404 from servicedeskapi) or when no active cycle exists.
 */
export async function getSla(issueKey: string): Promise<SlaInfo | null> {
  let resp: JsmSlaResponse
  try {
    resp = await jiraRequest<JsmSlaResponse>(
      `/rest/servicedeskapi/request/${encodeURIComponent(issueKey)}/sla`
    )
  } catch (err) {
    // Not a service desk issue, or no JSM access — treat as "no SLA".
    if (err instanceof JiraError && (err.status === 404 || err.status === 400)) return null
    throw err
  }

  const active = (resp.values ?? [])
    .filter((v) => v.ongoingCycle)
    .map((v) => toSlaInfo(v))
    .filter((s): s is SlaInfo => s !== null)

  if (active.length === 0) return null

  // Most urgent = lowest remaining fraction (breached first).
  active.sort((a, b) => urgency(a) - urgency(b))
  return active[0]
}

function urgency(s: SlaInfo): number {
  if (s.breached) return -Infinity
  return s.remainingFraction ?? Infinity
}

function toSlaInfo(value: JsmSlaValue): SlaInfo | null {
  const cycle = value.ongoingCycle
  if (!cycle) return null
  const remainingMs = cycle.remainingTime?.millis ?? null
  const goalMs = cycle.goalDuration?.millis ?? null
  const remainingFraction =
    remainingMs !== null && goalMs && goalMs > 0
      ? Math.max(0, Math.min(1, remainingMs / goalMs))
      : null
  const breached = cycle.breached || (remainingMs !== null && remainingMs < 0)
  return {
    name: value.name,
    remainingMs,
    breached,
    remainingFraction,
    level: computeLevel(remainingFraction, breached)
  }
}
