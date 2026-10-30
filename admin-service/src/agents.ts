export type Role = 'admin' | 'chef_de_service' | 'agent'
export const ROLES: readonly Role[] = ['admin', 'chef_de_service', 'agent']

export interface AgentInput {
  username: string
  displayName: string
  ministry: string
  fonction: string
  role: Role
}
export interface Agent extends AgentInput {
  status: 'active' | 'revoked'
}
export interface RevocationReport {
  username: string
  identityDisabled: boolean
  synapseDeactivated: boolean
}

export interface IdentityProvider {
  createUser(a: AgentInput): Promise<void>
  disableUser(username: string): Promise<void>
  listUsers(): Promise<Agent[]>
}
export interface SynapseAdmin {
  upsertUser(mxid: string, displayName: string): Promise<void>
  deactivate(mxid: string): Promise<void>
}
export interface Deps {
  identity: IdentityProvider
  synapse: SynapseAdmin
  domain: string
}

export class AgentError extends Error {
  code: string
  constructor(code: string) {
    super(code)
    this.name = 'AgentError'
    this.code = code
  }
}

const USERNAME = /^[a-z0-9._-]{3,32}$/

/** Le nom d'utilisateur est inséré dans un identifiant Matrix et dans des URL: on le contraint strictement. */
function assertUsername(username: unknown): asserts username is string {
  if (typeof username !== 'string' || !USERNAME.test(username)) throw new AgentError('INVALID_USERNAME')
}

function assertText(value: unknown): void {
  if (typeof value !== 'string' || value.trim() === '') throw new AgentError('INVALID_FIELD')
}

const mxid = (domain: string, username: string) => `@${username}:${domain}`

export async function enroll(deps: Deps, input: AgentInput): Promise<Agent> {
  assertUsername(input?.username)
  if (!ROLES.includes(input.role)) throw new AgentError('INVALID_ROLE')
  assertText(input.displayName)
  assertText(input.ministry)
  assertText(input.fonction)

  await deps.identity.createUser(input)
  await deps.synapse.upsertUser(mxid(deps.domain, input.username), input.displayName)
  return { ...input, status: 'active' }
}

/**
 * L'identité est coupée d'abord: plus aucune nouvelle connexion possible, puis Synapse est désactivé
 * (jetons et appareils supprimés, sortie des salons). Chaque étape est idempotente: relancer une
 * révocation interrompue est sans risque.
 */
export async function revoke(deps: Deps, username: string): Promise<RevocationReport> {
  assertUsername(username)
  await deps.identity.disableUser(username)
  await deps.synapse.deactivate(mxid(deps.domain, username))
  return { username, identityDisabled: true, synapseDeactivated: true }
}