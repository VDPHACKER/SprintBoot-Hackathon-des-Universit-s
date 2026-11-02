// Génère les PDF du dossier à partir des documents Markdown, puis COMPTE les pages réelles (le règlement limite les notes à
// deux pages). Utilise le Chrome ou Edge installé en mode sans fenêtre. Usage: cd scripts/pdf && npm ci && node build-pdf.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { marked } from 'marked'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'dossier')
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) throw new Error('Aucun Chrome/Edge trouvé: définir CHROME_PATH')

/** [source, PDF produit, pages maximum exigées (0 = pas de limite)] */
const DOCUMENTS = [
  ['docs/fiche-equipe.md', '1-fiche-equipe.pdf', 0],
  ['docs/note-pre-projet.md', '2-note-pre-projet.pdf', 2],
  ['docs/note-securite.md', '3-note-securite.pdf', 2],
  ['README.md', 'README.pdf', 2],
]

const CSS = `
  @page { size: A4; margin: 13mm 14mm; }
  body { font: 9.6pt/1.35 Calibri, 'Segoe UI', Arial, sans-serif; color: #111; }
  h1 { font-size: 16pt; margin: 0 0 6pt; border-bottom: 1.5pt solid #006b3f; padding-bottom: 3pt; }
  h2 { font-size: 11.5pt; margin: 9pt 0 3pt; color: #006b3f; }
  p, li { margin: 2pt 0; } ul, ol { margin: 2pt 0; padding-left: 15pt; }
  table { border-collapse: collapse; width: 100%; margin: 4pt 0; font-size: 8.6pt; }
  th, td { border: .6pt solid #999; padding: 2pt 4pt; vertical-align: top; text-align: left; }
  th { background: #eef5f0; }
  code { font: 8.4pt Consolas, monospace; background: #f3f3f3; padding: 0 2pt; }
  pre { font: 8.2pt/1.3 Consolas, monospace; background: #f3f3f3; padding: 4pt; margin: 3pt 0; white-space: pre-wrap; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 3pt 0; padding-left: 6pt; border-left: 2pt solid #bbb; color: #333; }
  a { color: #0b5cad; text-decoration: none; }
`

mkdirSync(OUT, { recursive: true })
const work = mkdtempSync(join(tmpdir(), 'pdf-dossier-'))
let failed = false

for (const [source, target, maxPages] of DOCUMENTS) {
  const body = marked.parse(readFileSync(join(ROOT, source), 'utf8'))
  const html = join(work, `${target}.html`)
  const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><style>${CSS}</style><body>${body}</body></html>`
  writeFileSync(html, page)
  if (process.env.KEEP_HTML) writeFileSync(join(process.env.KEEP_HTML, `${target}.html`), page) // pour inspecter la mise en page
  const pdf = join(OUT, target)
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(html).href], {
    stdio: 'ignore',
    timeout: 120_000,
  })
  // Nombre de pages: la plus grande valeur « /Count » de l'arbre des pages du PDF.
  const pages = Math.max(...[...readFileSync(pdf, 'latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])))
  const ok = maxPages === 0 || pages <= maxPages
  if (!ok) failed = true
  console.log(`${ok ? 'OK    ' : 'ECHEC '} ${target}: ${pages} page(s)${maxPages ? ` (maximum ${maxPages})` : ''}`)
}
process.exit(failed ? 1 : 0)