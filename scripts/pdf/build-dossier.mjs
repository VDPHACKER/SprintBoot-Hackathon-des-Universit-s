// Assemble le dossier de candidature en UN SEUL PDF (police 12 pt, interligne 1,5): fiche équipe, note de pré-projet, note de
// sécurité, lien du dépôt public. Mesure le nombre de pages réel de chaque pièce (les deux notes sont limitées à 2 pages) en les
// imprimant séparément avec la même mise en page, puis imprime le document complet.
// Usage: cd scripts/pdf && npm ci && node build-dossier.mjs
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { marked } from 'marked'

const ROOT = resolve(import.meta.dirname, '../..')
const OUT = join(ROOT, 'dossier')
const REPO_URL = 'https://github.com/VDPHACKER/SprintBoot-Hackathon-des-Universit-s'
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean)
const browser = BROWSERS.find((p) => existsSync(p))
if (!browser) throw new Error('Aucun Chrome/Edge trouvé: définir CHROME_PATH')

/** [titre de la pièce, source Markdown, pages maximum exigées (0 = pas de limite)] */
const PIECES = [
  ['Pièce 1 — Fiche équipe', 'docs/fiche-equipe.md', 0],
  ['Pièce 2 — Note de pré-projet', 'docs/note-pre-projet.md', 2],
  ['Pièce 3 — Note de sécurité', 'docs/note-securite.md', 2],
]

const CSS = `
  @page { size: A4; margin: 20mm 18mm; }
  html { font-size: 12pt; }
  body { font: 12pt/1.5 Calibri, 'Segoe UI', Arial, sans-serif; color: #111; }
  h1 { font-size: 16pt; line-height: 1.3; margin: 0 0 8pt; border-bottom: 1.5pt solid #0b6b45; padding-bottom: 3pt; color: #0f2a1f; }
  h2 { font-size: 13pt; line-height: 1.3; margin: 10pt 0 2pt; color: #0b6b45; }
  p, li { margin: 3pt 0; font-size: 12pt; line-height: 1.5; } ul, ol { margin: 3pt 0; padding-left: 18pt; }
  table { border-collapse: collapse; width: 100%; margin: 5pt 0; font-size: 12pt; line-height: 1.5; }
  th, td { border: .6pt solid #999; padding: 2pt 5pt; vertical-align: top; text-align: left; font-size: 12pt; line-height: 1.5; }
  th { background: #eef5f0; }
  code { font: 12pt Consolas, monospace; background: #f3f3f3; padding: 0 2pt; }
  a { color: #0b5cad; text-decoration: underline; word-break: break-all; }
  section.piece { break-before: page; }
  section.piece:first-of-type { break-before: auto; }
  .cover { text-align: center; padding-top: 70mm; }
  .cover h1 { font-size: 26pt; border: 0; } .cover p { font-size: 14pt; }
`

const mdHtml = (file) => marked.parse(readFileSync(join(ROOT, file), 'utf8'))
const work = mkdtempSync(join(tmpdir(), 'pdf-dossier-unique-'))
const print = (html, name) => {
  const page = `<!doctype html><html lang="fr"><meta charset="utf-8"><style>${CSS}</style><body>${html}</body></html>`
  const file = join(work, `${name}.html`)
  writeFileSync(file, page)
  if (process.env.KEEP_HTML) writeFileSync(join(process.env.KEEP_HTML, `${name}.html`), page)
  const pdf = join(work, `${name}.pdf`)
  execFileSync(browser, ['--headless=new', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdf}`, pathToFileURL(file).href], { stdio: 'ignore', timeout: 120_000 })
  const pages = Math.max(...[...readFileSync(pdf, 'latin1').matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1])))
  return { pdf, pages }
}

let failed = false
const sections = []
for (const [title, source, max] of PIECES) {
  const body = mdHtml(source)
  const { pages } = print(`<section class="piece">${body}</section>`, source.replace(/\W+/g, '-'))
  const ok = max === 0 || pages <= max
  if (!ok) failed = true
  console.log(`${ok ? 'OK    ' : 'ECHEC '} ${title}: ${pages} page(s)${max ? ` (maximum ${max})` : ''}`)
  sections.push(`<section class="piece"><p><strong>${title}</strong></p>${body}</section>`)
}

const cover = `<section class="cover"><h1>DÎYOY</h1><p>Messagerie souveraine de l'administration</p><p>Dossier de candidature — Hackathon 226, sprint technique pré-hackathon</p><p>Équipe Burkina'novation</p></section>`
const repo = `<section class="piece"><p><strong>Pièce 4 — Dépôt public</strong></p><h1>Dépôt public du code</h1><p>Le code source (serveur, client, configuration et déploiement), la licence AGPL-3.0, le README en français et les comptes de démonstration fictifs sont publiés ici :</p><p><a href="${REPO_URL}">${REPO_URL}</a></p><p>Installation en une commande : <code>docker compose up -d --wait</code>.</p></section>`
const { pdf, pages } = print([cover, ...sections, repo].join('\n'), 'dossier-complet')
mkdirSync(OUT, { recursive: true })
const target = join(OUT, 'DIYOY-dossier-candidature.pdf')
writeFileSync(target, readFileSync(pdf))
console.log(`Document unique: ${pages} page(s) -> ${target}`)
process.exit(failed ? 1 : 0)
