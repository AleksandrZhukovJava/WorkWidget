import './mock-api' // installs window.api before components import it
import type { CSSProperties } from 'react'
import { createRoot } from 'react-dom/client'
import { Widget } from '../widget/Widget'
import { MainApp } from '../main/MainApp'
import '../styles.css'

function Gallery(): JSX.Element {
  return (
    <div style={{ display: 'flex', gap: 28, padding: 28, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <section>
        <h2 style={h2}>Widget (наведи — орбита)</h2>
        <div style={{ width: 260, height: 260, background: '#0a0c10', borderRadius: 16, overflow: 'visible' }}>
          <Widget />
        </div>
      </section>
      <section>
        <h2 style={h2}>Main window</h2>
        <div style={{ width: 1000, height: 660, overflow: 'hidden', border: '1px solid #30363d', borderRadius: 12 }}>
          <MainApp />
        </div>
      </section>
    </div>
  )
}

const h2: CSSProperties = {
  color: '#8b95a5',
  font: '600 12px/1 Segoe UI, sans-serif',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: 10
}

document.body.style.background = '#05070a'
createRoot(document.getElementById('root')!).render(<Gallery />)
