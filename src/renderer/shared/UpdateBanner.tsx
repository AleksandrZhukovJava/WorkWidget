import { useEffect, useState } from 'react'
import type { UpdateStatus } from '@shared/types'

/**
 * In-app update banner. Subscribes to the auto-update status pushed from main and shows:
 *   - a progress line while a new release downloads,
 *   - an actionable "Обновить и перезапустить" button once it's downloaded.
 * Renders nothing when there's no update (idle / none / checking / error). Safe to mount in
 * any window; if the update API is missing (older preload) it just stays hidden.
 */
export function UpdateBanner(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' })

  useEffect(() => {
    if (!window.api?.onUpdateStatus) return
    void window.api.getUpdateStatus().then(setStatus).catch(() => undefined)
    return window.api.onUpdateStatus(setStatus)
  }, [])

  if (status.state === 'downloaded') {
    return (
      <div className="update-banner update-banner--ready">
        <span className="update-banner__text">⬆️ Доступна версия {status.version}</span>
        <button
          className="btn btn--primary update-banner__btn"
          onClick={() => void window.api.installUpdate()}
        >
          Обновить и перезапустить
        </button>
      </div>
    )
  }

  if (status.state === 'downloading') {
    return (
      <div className="update-banner">
        <span className="update-banner__text">
          ⬇️ Загрузка обновления {status.version ?? ''} — {status.percent ?? 0}%
        </span>
      </div>
    )
  }

  return null
}
