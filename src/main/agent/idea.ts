import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'
import { getSettings } from '../store/settings'

/**
 * Open a repo file in IntelliJ IDEA via its launcher (`idea64.exe` / `idea.cmd`), which
 * reveals the file in the currently open project. Best-effort; returns a readable error.
 */
export function openInIdea(relPath: string): { ok: boolean; error?: string } {
  const { ideaPath, repoPath } = getSettings().coder
  if (!ideaPath.trim()) return { ok: false, error: 'Не указан путь к IDEA (Настройки → Кодер-агент)' }
  if (!existsSync(ideaPath)) return { ok: false, error: `Не найден лаунчер IDEA: ${ideaPath}` }
  const target = isAbsolute(relPath) ? relPath : join(repoPath, relPath)
  try {
    const child = spawn(ideaPath, [target], { detached: true, stdio: 'ignore', windowsHide: true })
    child.unref()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
