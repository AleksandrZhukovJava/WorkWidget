import { createRoot } from 'react-dom/client'
import { Settings } from './Settings'
import { initTheme } from '../theme'
import '../styles.css'

initTheme()
createRoot(document.getElementById('root')!).render(<Settings />)
