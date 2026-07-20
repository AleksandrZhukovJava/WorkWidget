import { createRoot } from 'react-dom/client'
import { MainApp } from './MainApp'
import { initTheme } from '../theme'
import '../styles.css'

initTheme()
createRoot(document.getElementById('root')!).render(<MainApp />)
