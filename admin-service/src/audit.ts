import { createHash } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export type AuditAction = 'enroll' | 'revoke' | 'role' | 'archive'
export interface AuditInput {
  /** Identifiant de l'administrateur (jeton Keycloak), ou le compte technique de l'outil en ligne de commande. */
  actor: string
  action: AuditAction
  /** Identifiant de l'agent concerné. */
  target: string
  detail?: string
}
export interface AuditEntry extends AuditInput {
  /** Date ISO 8601 (UTC). */
  ts: string
  /** Empreinte de l'entrée précédente (64 zéros pour la première). */
  prev: string
  hash: string
}
export interface AuditLog {
  append(input: AuditInput): Promise<void>
  /** Les `limit` dernières entrées (la plus récente d'abord) et le résultat de la vérification du chaînage de tout le journal. */
  list(limit: number): Promise<{ entries: AuditEntry[]; chainValid: boolean }>
}

const GENESIS = '0'.repeat(64)

/** SHA-256 standard (node:crypto) sur le contenu de l'entrée et l'empreinte précédente: modifier ou supprimer une ligne casse la chaîne. */
export const hashEntry = (e: Omit<AuditEntry, 'hash'>): string =>
  createHash('sha256').update(JSON.stringify([e.ts, e.actor, e.action, e.target, e.detail ?? '', e.prev])).digest('hex')

/** Journal en ajout seul: un fichier JSON Lines (une entrée par ligne) dans le volume dédié. */
export class FileAuditLog implements AuditLog {
  private dir: string
  private file: string
  private queue: Promise<unknown> = Promise.resolve()
  private last: string | undefined

  constructor(dir: string) {
    this.dir = dir
    this.file = join(dir, 'audit.jsonl')
  }

  private async readAll(): Promise<{ entries: AuditEntry[]; chainValid: boolean }> {
    let text = ''
    try {
      text = await readFile(this.file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    const entries: AuditEntry[] = []
    let chainValid = true
    let prev = GENESIS
    for (const line of text.split('\n').filter((l) => l.trim() !== '')) {
      let e: AuditEntry
      try {
        e = JSON.parse(line) as AuditEntry
      } catch {
        chainValid = false
        continue
      }
      if (e.prev !== prev || e.hash !== hashEntry(e)) chainValid = false
      prev = e.hash
      entries.push(e)
    }
    return { entries, chainValid }
  }

  /** Les ajouts sont mis en file: deux révocations simultanées ne peuvent pas partager la même empreinte précédente. */
  append(input: AuditInput): Promise<void> {
    const run = this.queue.then(async () => {
      await mkdir(this.dir, { recursive: true })
      if (this.last === undefined) this.last = (await this.readAll()).entries.at(-1)?.hash ?? GENESIS
      const body = { ts: new Date().toISOString(), ...input, prev: this.last }
      const entry: AuditEntry = { ...body, hash: hashEntry(body) }
      await appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8')
      this.last = entry.hash
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  async list(limit: number): Promise<{ entries: AuditEntry[]; chainValid: boolean }> {
    await this.queue
    const { entries, chainValid } = await this.readAll()
    return { entries: entries.slice(-limit).reverse(), chainValid }
  }
}
