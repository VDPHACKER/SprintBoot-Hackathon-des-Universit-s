import type { Agent, AgentInput, IdentityProvider, SynapseAdmin } from '../src/agents.ts'

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
  async listUsers(): Promise<Agent[]> {
    return [...this.users.values()]
  }
}

export class FakeSynapse implements SynapseAdmin {
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