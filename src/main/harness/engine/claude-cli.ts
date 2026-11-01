import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getClaudeCliPath } from '../store'
import { getAnthropicApiKey } from '../../store/credentials'
import type { TokenUsage } from '@shared/types'

/**
 * Thin wrapper around the user's installed `claude` CLI. We deliberately do NOT handle the
 * subscription OAuth flow ourselves — we drive the already-logged-in CLI, which uses the
 * user's existing session. If that session isn't usable, an Anthropic API key (from settings)
 * is injected as ANTHROPIC_API_KEY. On Windows `claude` is typically a .cmd shim, so spawn via shell.
 */
const IS_WIN = process.platform === 'win32'

/** The command to invoke: an explicit configured path, else an env override, else PATH lookup. */
function claudeCmd(): string {
  return getClaudeCliPath() || process.env.JIRA_WIDGET_CLAUDE_CLI?.trim() || 'claude'
}

/** Spawn env: the key (when set) switches the CLI to API-key auth instead of the login session. */
function spawnEnv(): NodeJS.ProcessEnv {
  const key = getAnthropicApiKey()
  return key ? { ...process.env, ANTHROPIC_API_KEY: key } : { ...process.env }
}

interface RunOpts {
  /** text piped to the CLI as the user prompt (via stdin — safe for large diffs) */
  prompt: string
  /** appended to the system prompt (role + hard rules + output contract) */
  system: string
  cwd?: string
  model?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  signal: AbortSignal
  timeoutMs: number
  onLog: (text: string) => void
}

export interface ClaudePrintResult {
  /** final assistant text (the `result` field of --output-format json) */
  result: string
  isError: boolean
  sessionId?: string
  /** token usage + USD cost reported by the CLI's JSON result */
  usage?: TokenUsage
}

/** Run `claude -p --output-format json`, feeding the prompt over stdin. */
export function runClaudePrint(opts: RunOpts): Promise<ClaudePrintResult> {
  const args = ['-p', '--output-format', 'json', '--append-system-prompt', opts.system]
  if (opts.model?.trim()) args.push('--model', opts.model.trim())
  if (opts.cwd) args.push('--add-dir', opts.cwd)
  if (opts.allowedTools?.length) args.push('--allowedTools', opts.allowedTools.join(','))
  if (opts.disallowedTools?.length) args.push('--disallowedTools', opts.disallowedTools.join(','))

  return new Promise<ClaudePrintResult>((resolve, reject) => {
    const child = spawn(claudeCmd(), args, {
      cwd: opts.cwd,
      shell: IS_WIN,
      windowsHide: true,
      env: spawnEnv()
    })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`Claude CLI не ответил за ${Math.round(opts.timeoutMs / 1000)}с`))
    }, opts.timeoutMs)
    const onAbort = (): void => {
      child.kill()
      reject(new Error('Отменено'))
    }
    opts.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (d) => (stdout += d.toString()))
    child.stderr.on('data', (d) => (stderr += d.toString()))
    child.on('error', (err) => {
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      reject(
        new Error(
          `Не удалось запустить claude CLI (${err.message}). Установлен ли Claude Code и в PATH?`
        )
      )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      opts.signal.removeEventListener('abort', onAbort)
      if (opts.signal.aborted) return
      const parsed = parsePrintJson(stdout)
      if (parsed) return resolve(parsed)
      reject(
        new Error(
          `Claude CLI завершился (код ${code}) без валидного JSON. ${stderr.slice(0, 500) || stdout.slice(0, 500)}`
        )
      )
    })

    child.stdin.write(opts.prompt)
    child.stdin.end()
  })
}

function parsePrintJson(stdout: string): ClaudePrintResult | null {
  const start = stdout.indexOf('{')
  const end = stdout.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const obj = JSON.parse(stdout.slice(start, end + 1)) as {
      result?: string
      is_error?: boolean
      subtype?: string
      session_id?: string
      total_cost_usd?: number
      usage?: {
        input_tokens?: number
        output_tokens?: number
        cache_creation_input_tokens?: number
        cache_read_input_tokens?: number
      }
    }
    return {
      result: String(obj.result ?? ''),
      isError: Boolean(obj.is_error) || obj.subtype === 'error_during_execution',
      sessionId: obj.session_id,
      usage: toTokenUsage(obj.usage, obj.total_cost_usd)
    }
  } catch {
    return null
  }
}

/** Map the CLI's `usage`/`total_cost_usd` into our TokenUsage; undefined if nothing is reported. */
function toTokenUsage(
  u: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  } | undefined,
  costUsd?: number
): TokenUsage | undefined {
  if (!u && costUsd === undefined) return undefined
  const input = u?.input_tokens ?? 0
  const output = u?.output_tokens ?? 0
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u?.cache_creation_input_tokens ?? 0,
    totalTokens: input + output,
    costUsd: typeof costUsd === 'number' ? costUsd : undefined,
    calls: 1
  }
}

/** CLI version string, or '' if `claude` isn't found/executable. */
export function claudeVersion(): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(claudeCmd(), ['--version'], { shell: IS_WIN, windowsHide: true })
    let out = ''
    const timer = setTimeout(() => {
      child.kill()
      resolve('')
    }, 8000)
    child.stdout.on('data', (d) => (out += d.toString()))
    child.on('error', () => {
      clearTimeout(timer)
      resolve('')
    })
    child.on('close', () => {
      clearTimeout(timer)
      resolve(out.trim())
    })
  })
}

/**
 * Best-effort "is the CLI logged in" check: look for the credentials/config the CLI writes
 * after login. Optimistic — if we can't tell, real auth errors still surface at run time.
 */
export function claudeLoggedIn(): boolean {
  const home = homedir()
  const candidates = [
    join(home, '.claude', '.credentials.json'),
    join(home, '.claude.json'),
    join(home, '.config', 'claude', '.credentials.json')
  ]
  return candidates.some((p) => existsSync(p))
}
