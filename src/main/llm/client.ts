import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { getSettings } from '../store/settings'
import { getLlmApiKey, getCoderApiKey } from '../store/credentials'
import { parseLlmTaskOutput, stripNoise } from './parse'
import type { LlmGenerateResult } from '@shared/types'

// Generous: a local model may need to load into VRAM on the first call.
const LLM_TIMEOUT_MS = 90_000
// Code generation on a local model is slower — allow much longer.
const CODER_TIMEOUT_MS = 180_000
const MODELS_TIMEOUT_MS = 10_000
// How long to wait for a just-spawned local server to come up.
const SERVER_BOOT_MS = 30_000

/** Network-level failure (server not running / unreachable) — retryable after auto-start. */
class LlmConnectionError extends Error {}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
  error?: { message?: string }
}

/** A resolved endpoint: base URL, chosen model id (may be blank = auto), and optional key. */
export interface LlmProfile {
  baseUrl: string
  model: string
  apiKey: string | null
}

/** The task-drafting assistant profile (Настройки → ИИ-помощник). */
function assistantProfile(): LlmProfile {
  const { llm } = getSettings()
  const baseUrl = llm.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Не указан адрес LLM-сервера (см. Настройки → ИИ-помощник)')
  return { baseUrl, model: llm.model.trim(), apiKey: getLlmApiKey() }
}

/** The coder-agent profile (Настройки → Кодер-агент). */
export function coderProfile(): LlmProfile {
  const { coder } = getSettings()
  const baseUrl = coder.baseUrl.trim().replace(/\/+$/, '')
  if (!baseUrl) throw new Error('Не указан адрес сервера кодер-модели (Настройки → Кодер-агент)')
  return { baseUrl, model: coder.model.trim(), apiKey: getCoderApiKey() }
}

async function llmFetch(
  p: LlmProfile,
  path: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${p.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {}),
        ...(init.headers ?? {})
      },
      signal: controller.signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`LLM не ответила за ${timeoutMs / 1000}с`)
    }
    throw new LlmConnectionError(err instanceof Error ? err.message : String(err))
  } finally {
    clearTimeout(timeoutId)
  }
}

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1/i.test(url)
}

/**
 * Best-effort: bring up the local LM Studio server without any visible window.
 * Preferred path is the `lms` CLI bootstrap that LM Studio drops into the user profile;
 * fallback is the app itself in headless service mode. Returns false if neither exists.
 */
function tryStartLocalServer(): boolean {
  const candidates = [
    { cmd: join(homedir(), '.lmstudio', 'bin', 'lms.exe'), args: ['server', 'start'] },
    { cmd: 'C:\\Program Files\\LM Studio\\LM Studio.exe', args: ['--run-as-service'] }
  ]
  for (const c of candidates) {
    if (!existsSync(c.cmd)) continue
    try {
      // windowsHide + detached — a console window here would be exactly the kind of
      // stray black box the user already had to hunt down once.
      const child = spawn(c.cmd, c.args, { detached: true, stdio: 'ignore', windowsHide: true })
      child.unref()
      return true
    } catch {
      /* try next candidate */
    }
  }
  return false
}

async function waitForServer(p: LlmProfile): Promise<boolean> {
  const deadline = Date.now() + SERVER_BOOT_MS
  while (Date.now() < deadline) {
    try {
      const res = await llmFetch(p, '/models', { method: 'GET' }, 3_000)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 1_500))
  }
  return false
}

// Auto-picked model, cached per base URL for the session.
const autoModelByUrl = new Map<string, string>()

/**
 * Model to send: explicit setting wins; otherwise ask the server what it has and take the
 * first one. Makes the empty-model default work with LM Studio's JIT loading, where a
 * made-up model id would be rejected instead of falling back to "whatever is loaded".
 */
async function resolveModel(p: LlmProfile): Promise<string> {
  if (p.model) return p.model
  const cached = autoModelByUrl.get(p.baseUrl)
  if (cached) return cached
  try {
    const res = await llmFetch(p, '/models', { method: 'GET' }, MODELS_TIMEOUT_MS)
    const data = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] }
    const id = data.data?.[0]?.id
    if (id) {
      autoModelByUrl.set(p.baseUrl, id)
      return id
    }
  } catch (err) {
    if (err instanceof LlmConnectionError) throw err
    /* fall through on parse/HTTP errors */
  }
  return 'local-model'
}

/** Bare-bones OpenAI-compatible chat call — covers OpenAI, LM Studio, OpenRouter, etc. */
async function chatCompletion(
  messages: { role: string; content: string }[],
  p: LlmProfile,
  timeoutMs = LLM_TIMEOUT_MS,
  isRetry = false
): Promise<string> {
  let res: Response
  try {
    const model = await resolveModel(p)
    res = await llmFetch(
      p,
      '/chat/completions',
      { method: 'POST', body: JSON.stringify({ model, messages, temperature: 0.3 }) },
      timeoutMs
    )
  } catch (err) {
    // Local server down → try to start it ourselves once, then retry the whole call.
    if (err instanceof LlmConnectionError && isLocalUrl(p.baseUrl) && !isRetry) {
      if (tryStartLocalServer() && (await waitForServer(p))) {
        return chatCompletion(messages, p, timeoutMs, true)
      }
      throw new Error(
        `Локальный LLM-сервер не запущен, и поднять его автоматически не удалось. ` +
          `Открой LM Studio → Developer → Start Server (${p.baseUrl})`
      )
    }
    if (err instanceof LlmConnectionError) {
      throw new Error(`Нет связи с LLM (${p.baseUrl}): ${err.message}`)
    }
    throw err
  }

  const data = (await res.json().catch(() => ({}))) as ChatCompletionResponse
  if (!res.ok) {
    throw new Error(data.error?.message ?? `LLM HTTP ${res.status}`)
  }
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM вернула пустой ответ')
  return content
}

/** Public helper for the coder agent: one chat call against the coder profile. */
export async function coderChat(
  messages: { role: string; content: string }[]
): Promise<string> {
  return chatCompletion(messages, coderProfile(), CODER_TIMEOUT_MS)
}

/** Cheap connectivity check for the coder profile. */
export async function testCoder(): Promise<{ ok: boolean; error?: string }> {
  try {
    await chatCompletion([{ role: 'user', content: 'ping' }], coderProfile(), MODELS_TIMEOUT_MS)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Turn the user's free-form task description into {summary, description} following the
 * user-configurable template from settings. Robust to messy model output — fences,
 * reasoning blocks, almost-JSON — via parseLlmTaskOutput; genuine prose falls back to
 * first-line-as-summary rather than failing.
 */
export async function generateTaskDescription(userText: string): Promise<LlmGenerateResult> {
  const { llm } = getSettings()
  const system = [
    'Ты помощник, который оформляет задачи для Jira на русском языке.',
    'Пользователь описывает задачу своими словами. Верни СТРОГО JSON без пояснений, без markdown, без текста до или после:',
    '{"summary": "<краткий заголовок задачи, до 100 символов>", "description": "<оформленное описание>"}',
    'Переводы строк внутри значений экранируй как \\n.',
    'Описание оформи ровно по этому формату (заполни каждый раздел по смыслу; если данных для раздела нет — напиши "уточнить"):',
    llm.promptTemplate
  ].join('\n\n')

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userText }
      ],
      assistantProfile()
    )

    const parsed = parseLlmTaskOutput(raw)
    if (parsed && (parsed.summary || parsed.description)) {
      return { ok: true, summary: parsed.summary, description: parsed.description }
    }

    // Genuine prose (no JSON shape at all) — first line becomes the summary.
    const cleaned = stripNoise(raw)
    const lines = cleaned.split('\n')
    return {
      ok: true,
      summary: lines[0].replace(/^#+\s*/, '').slice(0, 150).trim(),
      description: lines.slice(1).join('\n').trim() || cleaned
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Apply a follow-up instruction ("добавь ссылку", "переформулируй критерии приёмки") to
 * the already-drafted summary/description. Only the requested change should be made —
 * the model is given the current content verbatim and told to keep the rest intact.
 */
export async function refineTaskDescription(
  instruction: string,
  current: { summary: string; description: string }
): Promise<LlmGenerateResult> {
  const { llm } = getSettings()
  const system = [
    'Ты редактируешь черновик задачи для Jira на русском языке.',
    'Тебе дают текущий заголовок (summary), описание (description) и указание, что изменить.',
    'Внеси ТОЛЬКО запрошенное изменение; всё остальное сохрани без изменений, дословно.',
    'Верни СТРОГО JSON без пояснений, без markdown, без текста до или после:',
    '{"summary": "<заголовок>", "description": "<описание целиком, с внесённой правкой>"}',
    'Переводы строк внутри значений экранируй как \\n.',
    'Эталонная структура описания (для ориентира, не перестраивай без запроса):',
    llm.promptTemplate
  ].join('\n\n')

  const userMsg = [
    `Текущий заголовок: ${current.summary || '(пусто)'}`,
    `Текущее описание:\n${current.description || '(пусто)'}`,
    `Что изменить: ${instruction}`
  ].join('\n\n')

  try {
    const raw = await chatCompletion(
      [
        { role: 'system', content: system },
        { role: 'user', content: userMsg }
      ],
      assistantProfile()
    )
    const parsed = parseLlmTaskOutput(raw)
    if (parsed && (parsed.summary || parsed.description)) {
      return { ok: true, summary: parsed.summary, description: parsed.description }
    }
    // Prose answer — keep the summary, take the text as the updated description.
    return { ok: true, summary: current.summary, description: stripNoise(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Cheap connectivity check for the Settings "Проверить" button. */
export async function testLlm(): Promise<{ ok: boolean; error?: string }> {
  try {
    await chatCompletion([{ role: 'user', content: 'Ответь одним словом: ок' }], assistantProfile())
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
