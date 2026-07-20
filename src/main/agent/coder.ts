import { coderChat } from '../llm/client'
import { getSettings } from '../store/settings'
import { collectContext } from './retrieve'
import type { AgentPatchResult } from '@shared/types'

/** Extract a diff/code block from a chatty model reply (tolerant of surrounding prose). */
function extractDiff(raw: string): string {
  const t = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fence = t.match(/```(?:diff|patch)?\s*([\s\S]*?)```/i)
  if (fence) return fence[1].trim()
  // Unfenced: keep from the first diff/hunk marker onward if present.
  const marker = t.search(/^(diff --git|--- |\+\+\+ |@@ )/m)
  return marker >= 0 ? t.slice(marker).trim() : t
}

/**
 * Given a Jira task, gather repo context and ask the coder model for a unified diff that
 * implements it. Display-only — the diff is never applied in this iteration.
 */
export async function generatePatch(taskText: string): Promise<AgentPatchResult> {
  try {
    const { repoPath } = getSettings().coder
    const ctx = await collectContext(repoPath, taskText)

    const filesBlock =
      ctx.files.length === 0
        ? '(релевантные файлы не найдены — предложи изменения по описанию)'
        : ctx.files.map((f) => `--- ${f.path}\n${f.content}`).join('\n\n')

    const system = [
      'Ты — кодер-агент. По задаче и приложенным файлам проекта предложи изменения.',
      'Верни ТОЛЬКО unified diff в формате git (diff --git / ---/+++ / @@). Меняй только',
      'показанные файлы; не добавляй пояснений до или после диффа.'
    ].join(' ')

    const user = `ЗАДАЧА:\n${taskText}\n\nФАЙЛЫ ПРОЕКТА:\n${filesBlock}`

    const raw = await coderChat([
      { role: 'system', content: system },
      { role: 'user', content: user }
    ])

    return { ok: true, files: ctx.files.map((f) => f.path), diff: extractDiff(raw) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
