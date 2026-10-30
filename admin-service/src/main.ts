import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { joseVerifier, roleGuard } from './auth.ts'
import { seedDemoAccounts } from './demo.ts'
import { KeycloakIdentity } from './keycloak.ts'
import { buildServer } from './server.ts'
import { HttpSynapseAdmin } from './synapse.ts'

const secretsDir = process.env.SECRETS_DIR ?? '/secrets'
const readSecret = (name: string) => readFileSync(join(secretsDir, name), 'utf8').trim()

const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://keycloak:8080'
const realm = process.env.KEYCLOAK_REALM ?? 'bf'
// L'émetteur des jetons est l'URL publique du realm, différente de l'URL interne utilisée pour joindre Keycloak.
const issuer = process.env.KEYCLOAK_ISSUER ?? `http://auth.localhost:8081/realms/${realm}`

const deps = {
  identity: new KeycloakIdentity({
    baseUrl: keycloakUrl,
    realm,
    clientId: 'automation',
    getClientSecret: () => readSecret('automation_secret'),
  }),
  synapse: new HttpSynapseAdmin(process.env.SYNAPSE_URL ?? 'http://synapse:8008', () => readSecret('svc-admin.token')),
  domain: process.env.SERVER_NAME ?? 'chat.localhost',
}

// Le service n'est « prêt » (contrôle de santé) qu'une fois les comptes de démonstration en place.
const seedDemo = process.env.DEMO_ACCOUNTS === 'true'
let ready = !seedDemo

const server = buildServer({
  ...deps,
  adminGuard: roleGuard(joseVerifier(`${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`, issuer), 'admin'),
  isReady: () => ready,
})

await server.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) })

for (let attempt = 1; !ready; attempt++) {
  try {
    await seedDemoAccounts(deps)
    ready = true
    console.log('comptes de démonstration prêts')
  } catch (err) {
    console.error(`comptes de démonstration: tentative ${attempt} échouée`, err)
    await new Promise((resolve) => setTimeout(resolve, 5000))
  }
}