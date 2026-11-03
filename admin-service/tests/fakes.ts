import type { Agent, AgentInput, IdentityProvider, RoomInfo, SynapseAdmin } from '../src/agents.ts'

/** Identité en mémoire; `log` enregistre l'ordre des appels. */
export class FakeIdentity implements IdentityProvider {
  users = new Map<string, Agent>()
  log: string[]
  constructor(log: string[]) {
    this.log = log
  }
  async createUser(a: AgentInput): Promise<void> {
    this.log.push(`identity.createUser:${a.username}`)
    const { initialPassword: _omit, ...agent } = a
    this.users.set(a.username, { ...agent, status: 'active' })
  }
  async disableUser(username: string): Promise<void> {
    this.log.push(`identity.disableUser:${username}`)
    const u = this.users.get(username)
    if (u) u.status = 'revoked'
  }
  async setUserRole(username: string, role: Agent['role']): Promise<void> {
    this.log.push(`identity.setUserRole:${username}:${role}`)
    const u = this.users.get(username)
    if (u) u.role = role
  }
  async listUsers(): Promise<Agent[]> {
    return [...this.users.values()]
  }
}

export class FakeSynapse implements SynapseAdmin {
  rooms: RoomInfo[] = []
  members = new Map<string, string[]>()
  async listRooms(): Promise<RoomInfo[]> {
    return this.rooms
  }
  async roomMembers(roomId: string): Promise<string[]> {
    return this.members.get(roomId) ?? []
  }
  async version(): Promise<string> {
    return '1.0.0-test'
  }
  log: string[]
  constructor(log: string[]) {
    this.log = log
  }
  async upsertUser(mxid: string, displayName: string): Promise<void> {
    this.log.push(`synapse.upsertUser:${mxid}:${displayName}`)
  }
  async deactivate(mxid: string): Promise<void> {
    this.log.push(`synapse.deactivate:${mxid}`)
  }
}