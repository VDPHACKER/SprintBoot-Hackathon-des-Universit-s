import type { RoomInfo, SynapseAdmin } from './agents.ts'

/** Client de l'API d'administration de Synapse, joint par le réseau interne uniquement. */
export class HttpSynapseAdmin implements SynapseAdmin {
  private baseUrl: string
  private getToken: () => string

  constructor(baseUrl: string, getToken: () => string) {
    this.baseUrl = baseUrl
    this.getToken = getToken
  }

  private async call(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${this.getToken()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }

  async upsertUser(mxid: string, displayName: string): Promise<void> {
    const res = await this.call('PUT', `/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`, { displayname: displayName })
    if (!res.ok) throw new Error(`Synapse upsertUser a échoué: ${res.status} ${await res.text()}`)
  }

  async listRooms(): Promise<RoomInfo[]> {
    const rooms: RoomInfo[] = []
    let from: string | undefined
    do {
      const res = await this.call('GET', `/_synapse/admin/v1/rooms?limit=100${from ? `&from=${from}` : ''}`)
      if (!res.ok) throw new Error(`Synapse rooms a échoué: ${res.status}`)
      const page = (await res.json()) as {
        rooms: Array<{ room_id: string; name?: string | null; creator?: string; joined_members?: number; encryption?: string | null; history_visibility?: string; join_rules?: string }>
        next_batch?: string | number
      }
      for (const r of page.rooms) {
        rooms.push({
          roomId: r.room_id, name: r.name || r.room_id, creator: r.creator ?? '', members: r.joined_members ?? 0,
          encryption: r.encryption ?? null, historyVisibility: r.history_visibility, joinRules: r.join_rules,
        })
      }
      from = page.next_batch === undefined ? undefined : String(page.next_batch)
    } while (from !== undefined)
    return rooms
  }

  async roomMembers(roomId: string): Promise<string[]> {
    const res = await this.call('GET', `/_synapse/admin/v1/rooms/${encodeURIComponent(roomId)}/members`)
    if (!res.ok) throw new Error(`Synapse members a échoué: ${res.status}`)
    return ((await res.json()) as { members: string[] }).members
  }

  async version(): Promise<string> {
    const res = await this.call('GET', '/_synapse/admin/v1/server_version')
    if (!res.ok) throw new Error(`Synapse version a échoué: ${res.status}`)
    return ((await res.json()) as { server_version: string }).server_version
  }

  async deactivate(mxid: string): Promise<void> {
    const res = await this.call('POST', `/_synapse/admin/v1/deactivate/${encodeURIComponent(mxid)}`, { erase: false })
    // 404: le compte n'existe pas (ou plus): rien à désactiver, la révocation reste idempotente.
    if (!res.ok && res.status !== 404) throw new Error(`Synapse deactivate a échoué: ${res.status} ${await res.text()}`)
  }
}