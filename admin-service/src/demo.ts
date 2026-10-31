import { AgentError, enroll, type AgentInput, type Deps } from './agents.ts'

const MIN_NUMERIQUE = 'Ministère fictif de la Transition numérique'
const MIN_SANTE = 'Ministère fictif de la Santé'

/**
 * Comptes de démonstration, tous fictifs. Leurs identifiants (mot de passe et secret TOTP) sont dans
 * deploy/keycloak/demo-users.json et importés avec le realm: l'API d'administration de Keycloak ne sait
 * pas créer un second facteur. Aucun compte « intrus »: l'intrus de l'épreuve du jury n'existe pas.
 */
export const DEMO_ACCOUNTS: AgentInput[] = [
  { username: 'admin.demo', displayName: 'Administrateur (démo)', ministry: MIN_NUMERIQUE, fonction: 'Administrateur de la messagerie', role: 'admin' },
  { username: 'issa.kabore', displayName: 'Issa Kaboré (démo)', ministry: MIN_NUMERIQUE, fonction: 'Directeur de cabinet', role: 'chef_de_service' },
  { username: 'awa.ouedraogo', displayName: 'Awa Ouédraogo (démo)', ministry: MIN_NUMERIQUE, fonction: 'Chargée de mission', role: 'agent' },
  { username: 'moussa.sawadogo', displayName: 'Moussa Sawadogo (démo)', ministry: MIN_SANTE, fonction: 'Chef de service des statistiques', role: 'agent' },
]

/** Idempotent: un compte déjà présent est mis à jour (fiche et rôle), sans toucher à ses identifiants. */
export async function seedDemoAccounts(deps: Deps): Promise<void> {
  for (const account of DEMO_ACCOUNTS) {
    try {
      await enroll(deps, account)
    } catch (err) {
      // Un compte de démonstration révoqué en direct reste révoqué: ne pas bloquer le démarrage du service pour autant.
      if (!(err instanceof AgentError && err.code === 'REVOKED_ACCOUNT')) throw err
    }
  }
}