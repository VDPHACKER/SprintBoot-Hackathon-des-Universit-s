import type { AgentInput, SynapseAdmin } from '../src/agents.ts'
import { InMemoryIdentity } from '../src/identity-memory.ts'

/** Identité en mémoire; `log` enregistre l'ordre des appels. */
export class FakeIdentity extends InMemoryIdentity {
  log: string[]
  constructor(log: string[]) {
    super()
    this.log = log
  }
  override async createUser(a: AgentInput): Promise<void> {
    this.log.push(`identity.createUser:${a.username}`)
    return super.createUser(a)
  }
  override async disableUser(username: string): Promise<void> {
    this.log.push(`identity.disableUser:${username}`)
    return super.disableUser(username)
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