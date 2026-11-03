export type Role = 'admin' | 'chef_de_service' | 'agent'
export const ROLES: readonly Role[] = ['admin', 'chef_de_service', 'agent']

export interface AgentInput {
  username: string
  displayName: string
  ministry: string
  fonction: string
  role: Role
  /** Mot de passe temporaire (changement obligatoire à la première connexion). */
  initialPassword?: string
}
export interface Agent extends Omit<AgentInput, 'initialPassword'> {
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
  /** Change le rôle d'un agent existant et ferme ses sessions (le nouveau rôle s'applique tout de suite). */
  setUserRole(username: string, role: Role): Promise<void>
  listUsers(): Promise<Agent[]>
}
/** Métadonnées d'un salon vues par le serveur (jamais son contenu: il est chiffré de bout en bout). */
export interface RoomInfo {
  roomId: string
  name: string
  creator: string
  members: number
  /** Algorithme de chiffrement du salon, ou null s'il n'est pas chiffré. */
  encryption: string | null
  historyVisibility?: string
  joinRules?: string
}
export interface SynapseAdmin {
  upsertUser(mxid: string, displayName: string): Promise<void>
  deactivate(mxid: string): Promise<void>
  listRooms(): Promise<RoomInfo[]>
  /** Identifiants Matrix des membres actuels d'un salon. */
  roomMembers(roomId: string): Promise<string[]>
  version(): Promise<string>
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
/** Noms techniques réservés: svc-admin est le compte d'administration de Synapse, service-account-* ceux de Keycloak. */
const RESERVED = /^(svc-admin|service-account-)/

function assertUsername(username: unknown): asserts username is string {
  if (typeof username !== 'string' || !USERNAME.test(username) || RESERVED.test(username)) throw new AgentError('INVALID_USERNAME')
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
  if (input.initialPassword !== undefined && (typeof input.initialPassword !== 'string' || input.initialPassword.length < 8)) {
    throw new AgentError('INVALID_FIELD')
  }

  // Un compte révoqué ne se réactive pas par un simple ré-enrôlement (Keycloak et Synapse resteraient désactivés alors que la
  // réponse dirait « active »): on refuse explicitement; l'agent revenant reçoit un nouvel identifiant.
  const existing = (await deps.identity.listUsers()).find((u) => u.username === input.username)
  if (existing?.status === 'revoked') throw new AgentError('REVOKED_ACCOUNT')

  await deps.identity.createUser(input)
  await deps.synapse.upsertUser(mxid(deps.domain, input.username), input.displayName)
  const { initialPassword: _omit, ...agent } = input
  return { ...agent, status: 'active' }
}

/**
 * Change le rôle d'un agent. Refusé pour un compte révoqué, un agent inconnu, ou si cela retirerait le dernier
 * administrateur actif (plus personne ne pourrait ensuite administrer la messagerie).
 */
export async function changeRole(deps: Deps, username: string, role: Role): Promise<Agent & { previousRole: Role }> {
  assertUsername(username)
  if (!ROLES.includes(role)) throw new AgentError('INVALID_ROLE')
  const users = await deps.identity.listUsers()
  const target = users.find((u) => u.username === username)
  if (!target) throw new AgentError('UNKNOWN_AGENT')
  if (target.status === 'revoked') throw new AgentError('REVOKED_ACCOUNT')
  if (target.role === 'admin' && role !== 'admin' && users.filter((u) => u.role === 'admin' && u.status === 'active').length <= 1) {
    throw new AgentError('LAST_ADMIN')
  }
  const previousRole = target.role // lu AVANT le changement (certaines implémentations modifient l'objet en place)
  if (previousRole !== role) await deps.identity.setUserRole(username, role)
  return { ...target, role, previousRole }
}

/**
 * L'identité est coupée d'abord: plus aucune nouvelle connexion possible, puis Synapse est désactivé
 * (jetons et appareils supprimés, sortie des salons). Chaque étape est idempotente: relancer une
 * révocation interrompue est sans risque.
 */
export async function revoke(deps: Deps, username: string): Promise<RevocationReport> {
  assertUsername(username)
  // Refus de révoquer le dernier administrateur actif: plus personne ne pourrait ensuite enrôler, révoquer ni changer un rôle.
  // Un compte déjà révoqué ou inconnu n'est pas concerné: la révocation reste idempotente.
  const users = await deps.identity.listUsers()
  const target = users.find((u) => u.username === username)
  if (target?.role === 'admin' && target.status === 'active' && users.filter((u) => u.role === 'admin' && u.status === 'active').length <= 1) {
    throw new AgentError('LAST_ADMIN')
  }
  await deps.identity.disableUser(username)
  await deps.synapse.deactivate(mxid(deps.domain, username))
  return { username, identityDisabled: true, synapseDeactivated: true }
}