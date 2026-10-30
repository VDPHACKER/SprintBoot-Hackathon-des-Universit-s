import type { Agent, AgentInput, IdentityProvider } from './agents.ts'

/** Fournisseur d'identité en mémoire. Remplacé par KeycloakIdentity à la tâche 4. */
export class InMemoryIdentity implements IdentityProvider {
  protected users = new Map<string, Agent>()

  async createUser(a: AgentInput): Promise<void> {
    this.users.set(a.username, { ...a, status: 'active' })
  }
  async disableUser(username: string): Promise<void> {
    const u = this.users.get(username)
    if (u) u.status = 'revoked'
  }
  async listUsers(): Promise<Agent[]> {
    return [...this.users.values()]
  }
}