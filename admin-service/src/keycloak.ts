import { ROLES, type Agent, type AgentInput, type IdentityProvider, type Role } from './agents.ts'

export interface KeycloakOptions {
  /** URL interne de Keycloak (réseau Docker), pas l'URL publique. */
  baseUrl: string
  realm: string
  clientId: string
  getClientSecret: () => string
}

interface KcUser {
  id: string
  username: string
  enabled: boolean
  attributes?: Record<string, string[]>
}

const attr = (u: KcUser, name: string) => u.attributes?.[name]?.[0]

/** Identité des agents dans Keycloak, via son API d'administration et un compte technique (client_credentials). */
export class KeycloakIdentity implements IdentityProvider {
  private o: KeycloakOptions
  private cached: { token: string; expiresAt: number } | undefined

  constructor(options: KeycloakOptions) {
    this.o = options
  }

  private async token(): Promise<string> {
    if (this.cached && Date.now() < this.cached.expiresAt - 10_000) return this.cached.token
    const res = await fetch(`${this.o.baseUrl}/realms/${this.o.realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.o.clientId,
        client_secret: this.o.getClientSecret(),
      }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`Keycloak token a échoué: ${res.status} ${await res.text()}`)
    const j = (await res.json()) as { access_token: string; expires_in: number }
    this.cached = { token: j.access_token, expiresAt: Date.now() + j.expires_in * 1000 }
    return j.access_token
  }

  private async admin(method: string, path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.o.baseUrl}/admin/realms/${this.o.realm}${path}`, {
      method,
      headers: { authorization: `Bearer ${await this.token()}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    })
  }

  private async ok(res: Response, what: string): Promise<Response> {
    if (!res.ok) throw new Error(`Keycloak ${what} a échoué: ${res.status} ${await res.text()}`)
    return res
  }

  private async findId(username: string): Promise<string | undefined> {
    const res = await this.ok(await this.admin('GET', `/users?username=${encodeURIComponent(username)}&exact=true`), 'recherche')
    return ((await res.json()) as KcUser[])[0]?.id
  }

  /** Un seul rôle applicatif par agent: les deux autres sont retirés (pas de privilège résiduel après un changement de rôle). */
  private async setRole(id: string, role: Role): Promise<void> {
    const reps = await Promise.all(
      ROLES.map(async (r) => ({ r, rep: await (await this.ok(await this.admin('GET', `/roles/${r}`), `rôle ${r}`)).json() })),
    )
    const others = reps.filter((x) => x.r !== role).map((x) => x.rep)
    await this.ok(await this.admin('DELETE', `/users/${id}/role-mappings/realm`, others), 'retrait des rôles')
    await this.ok(await this.admin('POST', `/users/${id}/role-mappings/realm`, [reps.find((x) => x.r === role)!.rep]), 'ajout du rôle')
  }

  async createUser(a: AgentInput): Promise<void> {
    const attributes = {
      displayName: [a.displayName],
      ministry: [a.ministry],
      fonction: [a.fonction],
      role: [a.role],
      // Marqueur d'enrôlement exigé par Synapse (attribute_requirements): un compte Keycloak créé hors enrôlement n'ouvre pas de compte de messagerie.
      enrolled: ['true'],
    }
    const res = await this.admin('POST', '/users', {
      username: a.username,
      enabled: true,
      attributes,
      // Le second facteur est aussi imposé par le flux du realm; l'action requise guide la première connexion.
      requiredActions: a.initialPassword ? ['UPDATE_PASSWORD', 'CONFIGURE_TOTP'] : ['CONFIGURE_TOTP'],
      credentials: a.initialPassword ? [{ type: 'password', value: a.initialPassword, temporary: true }] : [],
    })
    let id: string | undefined
    if (res.status === 201) {
      id = res.headers.get('location')?.split('/').pop()
    } else if (res.status === 409) {
      // Déjà enrôlé: on met à jour la fiche sans toucher au mot de passe ni à l'état activé/désactivé.
      id = await this.findId(a.username)
      if (id) await this.ok(await this.admin('PUT', `/users/${id}`, { attributes }), 'mise à jour')
    } else {
      await this.ok(res, 'création')
    }
    if (!id) throw new Error('Keycloak: identifiant utilisateur introuvable après création')
    await this.setRole(id, a.role)
  }

  async disableUser(username: string): Promise<void> {
    const id = await this.findId(username)
    if (!id) return // jamais enrôlé: rien à désactiver, la révocation reste idempotente
    await this.ok(await this.admin('PUT', `/users/${id}`, { enabled: false }), 'désactivation')
    await this.ok(await this.admin('POST', `/users/${id}/logout`), 'fermeture des sessions')
  }

  async listUsers(): Promise<Agent[]> {
    const res = await this.ok(await this.admin('GET', '/users?max=1000&briefRepresentation=false'), 'liste')
    return ((await res.json()) as KcUser[])
      .filter((u) => ROLES.includes(attr(u, 'role') as Role))
      .map((u) => ({
        username: u.username,
        displayName: attr(u, 'displayName') ?? u.username,
        ministry: attr(u, 'ministry') ?? '',
        fonction: attr(u, 'fonction') ?? '',
        role: attr(u, 'role') as Role,
        status: u.enabled ? 'active' : 'revoked',
      }))
  }
}