import { useEffect, useRef, useState } from 'react'

export interface Command {
  id: string
  label: string
  run: () => void
}

/** Ctrl+K quick launcher: filter commands by label, Enter/click to run. */
export function CommandPalette({
  items,
  onClose
}: {
  items: Command[]
  onClose: () => void
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => inputRef.current?.focus(), [])

  const filtered = items.filter((c) => c.label.toLowerCase().includes(query.toLowerCase()))

  function run(cmd: Command | undefined): void {
    if (!cmd) return
    cmd.run()
    onClose()
  }

  function onKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') onClose()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      run(filtered[active])
    }
  }

  return (
    <div className="palette__backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette__input"
          placeholder="Команда или раздел…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={onKey}
        />
        <div className="palette__list">
          {filtered.length === 0 && <div className="palette__empty">Ничего не найдено</div>}
          {filtered.map((c, i) => (
            <button
              key={c.id}
              className={`palette__item ${i === active ? 'is-active' : ''}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(c)}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
