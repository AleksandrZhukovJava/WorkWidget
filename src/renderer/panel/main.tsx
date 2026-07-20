import { createRoot } from 'react-dom/client'
import { Panel } from './Panel'
import { initTheme } from '../theme'
import '../styles.css'

initTheme()
createRoot(document.getElementById('root')!).render(<Panel />)
