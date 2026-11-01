import { getSettings } from '../../store/settings'
import { claudeEngine } from './claude-engine'
import { localEngine } from './local-engine'
import { claudeVersion, claudeLoggedIn } from './claude-cli'
import type { EngineStatus, HarnessEngine } from '@shared/types'
import type { ReviewEngine } from './types'

export type { ReviewEngine, ReviewRequest, ReviewResult } from './types'

let cachedStatus: EngineStatus | null = null

/** Probe both engines. Cached briefly so repeated UI calls don't re-spawn the CLI each time. */
export async function engineStatus(force = false): Promise<EngineStatus> {
  if (cachedStatus && !force) return cachedStatus
  const version = await claudeVersion()
  const baseUrl = getSettings().coder.baseUrl.trim()
  const reachable = await localReachable(baseUrl)
  cachedStatus = {
    claude: { cliFound: version !== '', loggedIn: version !== '' && claudeLoggedIn(), version },
    local: { reachable, baseUrl }
  }
  return cachedStatus
}

async function localReachable(baseUrl: string): Promise<boolean> {
  if (!baseUrl) return false
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), 2500)
  try {
    const res = await fetch(url, { signal: controller.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(t)
  }
}

/**
 * Resolve 'default' to a concrete engine: Claude when its CLI is available, else local.
 * A concrete 'claude'/'local' choice is honored as-is (errors surface if it isn't available).
 */
export async function resolveEngine(engine: HarnessEngine): Promise<'claude' | 'local'> {
  if (engine === 'claude' || engine === 'local') return engine
  const status = await engineStatus()
  return status.claude.cliFound ? 'claude' : 'local'
}

export function engineByName(name: 'claude' | 'local'): ReviewEngine {
  return name === 'claude' ? claudeEngine : localEngine
}
