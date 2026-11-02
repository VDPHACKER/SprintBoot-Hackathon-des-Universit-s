/** Nom du serveur de messagerie (partie droite des identifiants Matrix). */
export const SERVER_NAME = 'chat.localhost'
/** Identifiant du fournisseur d'identité côté Synapse: `oidc-` + idp_id (voir homeserver.yaml.tmpl). */
export const SSO_PROVIDER = 'oidc-keycloak'
/**
 * Fin de session côté identité (Keycloak). Sans elle, « Se déconnecter » ne ferme que la session de messagerie: le clic
 * suivant sur « Se connecter » rouvrirait le compte sans mot de passe ni code, ce qui est inacceptable sur un poste partagé.
 * Adresse publique de la démonstration locale (voir README: ports non configurables).
 */
export const identityLogoutUrl = (): string =>
  'http://auth.localhost:8081/realms/bf/protocol/openid-connect/logout?client_id=synapse&post_logout_redirect_uri=' +
  encodeURIComponent(`${window.location.origin}/`)