import './ui/style.css'
import { initLocale } from './i18n/index.ts'
import { mountApp } from './ui/app.ts'

initLocale()
void mountApp(document.getElementById('app')!)