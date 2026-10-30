import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { joseVerifier, roleGuard } from './auth.ts'
import { KeycloakIdentity } from './keycloak.ts'
import { buildServer } from './server.ts'
import { HttpSynapseAdmin } from './synapse.ts'

const secretsDir = process.env.SECRETS_DIR ?? '/secrets'
const readSecret = (name: string) => readFileSync(join(secretsDir, name), 'utf8').trim()

const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080'
const realm = process.env.KEYCLOAK_REALM ?? 'bf'
// L'émetteur des jetons est l'URL publique du realm, différente de l'URL interne utilisée pour joindre Keycloak.
const issuer = process.env.KEYCLOAK_ISSUER ?? `http://auth.localhost:8081/realms/${realm}`

const server = buildServer({
  identity: new KeycloakIdentity({
    baseUrl: keycloakUrl,
    realm,
    clientId: 'automation',
    getClientSecret: () => readSecret('automation_secret'),
  }),
  synapse: new HttpSynapseAdmin(process.env.SYNAPSE_URL ?? 'http://synapse:8008', () => readSecret('svc-admin.token')),
  domain: process.env.SERVER_NAME ?? 'chat.localhost',
  adminGuard: roleGuard(joseVerifier(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`, issuer), 'admin'),
})

await server.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) })