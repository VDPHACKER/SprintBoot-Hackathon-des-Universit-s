import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { InMemoryIdentity } from './identity-memory.ts'
import { buildServer } from './server.ts'
import { HttpSynapseAdmin } from './synapse.ts'

const secretsDir = process.env.SECRETS_DIR ?? '/secrets'
const readSecret = (name: string) => readFileSync(join(secretsDir, name), 'utf8').trim()

const server = buildServer({
  identity: new InMemoryIdentity(),
  synapse: new HttpSynapseAdmin(process.env.SYNAPSE_URL ?? 'http://synapse:8008', () => readSecret('svc-admin.token')),
  domain: process.env.SERVER_NAME ?? 'chat.localhost',
  adminToken: readSecret('admin_api_token'),
})

await server.listen({ host: '0.0.0.0', port: Number(process.env.PORT ?? 3000) })