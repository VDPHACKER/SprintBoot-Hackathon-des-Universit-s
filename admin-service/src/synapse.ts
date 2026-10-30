import type { SynapseAdmin } from './agents.ts'

/** Client de l'API d'administration de Synapse, joint par le réseau interne uniquement. */
export class HttpSynapseAdmin implements SynapseAdmin {
  private baseUrl: string
  private getToken: () => string

  constructor(baseUrl: string, getToken: () => string) {
    this.baseUrl = baseUrl
    this.getToken = getToken
  }

  private async call(method: string, path: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.getToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }

  async upsertUser(mxid: string, displayName: string): Promise<void> {
    const res = await this.call('PUT', `/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, { displayname: displayName })
    if (!res.ok) throw new Error(`Synapse upsertUser a échoué: ${res.status} ${await res.text()}`)
  }

  async deactivate(mxid: string): Promise<void> {
    const res = await this.call('POST', `/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`, { erase: false })
    // 404: le compte n'existe pas (ou plus): rien à désactiver, la révocation reste idempotente.
    if (!res.ok && res.status !== 404) throw new Error(`Synapse deactivate a échoué: ${res.status} ${await res.text()}`)
  }
}