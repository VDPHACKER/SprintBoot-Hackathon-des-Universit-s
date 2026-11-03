import './admin.css'
import { changeRole, enrollAgent, exportArchive, listAgents, listAudit, listRooms, revokeAgent, roomMembers, serverStatus, type AgentRole, type AgentRow } from '../matrix/adminApi.ts'
import { finishLogin, logoutUrl, startLogin, usernameOf } from './oidc.ts'

/** Textes de la console (français). */
const T = {
  title: 'Administration', login: 'Se connecter', logout: 'Se déconnecter',
  loginText: 'Espace réservé aux administrateurs de la messagerie. La connexion demande votre mot de passe puis un code à usage unique.',
  denied: 'Ce compte n’a pas le rôle administrateur.', failed: 'La connexion a échoué. Réessayez.', generic: 'Une erreur est survenue. Réessayez.',
  rooms: 'Salons et canaux', server: 'Serveur', archive: 'Archivage légal',
  roomsHelp: 'Salons vus par le serveur : nom, membres et chiffrement. Le contenu des échanges est chiffré de bout en bout et reste illisible ici.',
  roomsEmpty: 'Aucun salon pour le moment.', pickRoom: 'Sélectionnez un salon.',
  colRoom: 'Salon', colCreator: 'Créé par', colMembers: 'Membres', colEncryption: 'Chiffrement',
  encrypted: '✓ Chiffré', clear: '✗ Non chiffré', membersOf: 'Membres du salon',
  serverHelp: 'État réel des composants et chiffres clés, relevés à l’instant.',
  svSynapse: 'Messagerie (Synapse)', svIdentity: 'Identité (Keycloak)', svServer: 'Serveur', svAgents: 'Agents', svRooms: 'Salons', svJournal: 'Journal d’audit',
  up: 'En ligne', down: 'Injoignable', version: 'Version', serverName: 'Nom du serveur', uptime: 'Service d’administration actif depuis',
  total: 'Total', activeN: 'Actifs', revokedN: 'Révoqués', adminsN: 'Administrateurs', encryptedN: 'Chiffrés', clearN: 'Non chiffrés',
  entriesN: 'Entrées', chain: 'Chaîne', chainShort: 'intacte', chainBrokenShort: 'ALTÉRÉE',
  archiveHelp: 'Exporte un fichier JSON des métadonnées : agents, salons et leurs membres, journal d’audit. Il porte une empreinte SHA-256 pour prouver qu’il n’a pas été modifié. Chaque export est inscrit au journal d’audit.',
  archiveLimit: 'Cette archive ne contient AUCUN contenu d’échange : les messages et fichiers sont chiffrés de bout en bout, le serveur ne peut pas les lire. L’archivage du contenu se fait côté destinataire : chaque agent exporte lui-même un salon depuis la messagerie (bouton « Archiver ce salon »), avec une empreinte vérifiable dans ses Paramètres.',
  exportBtn: 'Exporter l’archive (JSON)', exported: 'Archive exportée :', digestLabel: 'empreinte SHA-256',
  audit: 'Journal d’audit',
  auditHelp: 'Toutes les actions d’administration : qui a enrôlé, changé le rôle ou révoqué quel agent, et quand. Le journal ne peut pas être modifié depuis cette console.',
  auditEmpty: 'Aucune action enregistrée.', refresh: 'Actualiser',
  colDate: 'Date', colActor: 'Administrateur', colAction: 'Action', colTarget: 'Agent concerné', colDetail: 'Détail',
  actions: { enroll: 'Enrôlement', revoke: 'Révocation', role: 'Changement de rôle', archive: 'Export d’archive' } as Record<string, string>,
  chainOk: '✓ Chaîne d’intégrité vérifiée : aucune entrée modifiée ni supprimée.',
  chainBad: '⚠ ALERTE : le journal a été modifié ou une entrée a disparu.',
  cliActor: 'Outil en ligne de commande',
  roles: 'Rôles et accès', rolesHelp: 'Le rôle d’un agent est relu à chaque connexion. Changer un rôle ferme ses sessions : il se reconnecte avec son nouveau rôle.',
  roleDesc: {
    admin: 'Accède à cette console : enrôle, change les rôles et révoque les accès.',
    chef_de_service: 'Désigné pour émettre des instructions de service. L’application de ce droit dans la messagerie n’est pas encore en place.',
    agent: 'Utilise la messagerie : échanges chiffrés, groupes, canaux et documents.',
  } as Record<AgentRole, string>,
  apply: 'Appliquer', roleChanged: 'Rôle mis à jour :',
  agents: 'Agents', enroll: 'Enrôlement', search: 'Rechercher un agent', enrollBtn: 'Enrôler un agent',
  colAgent: 'Agent', colStructure: 'Structure', colFunction: 'Fonction', colAccess: 'Accès', colStatus: 'Statut',
  active: 'Actif', revoked: 'Révoqué', you: 'vous', none: 'Aucun agent.',
  role: { agent: 'Agent', chef_de_service: 'Chef de service', admin: 'Administrateur' } as Record<AgentRole, string>,
  second: 'Second facteur', secondOn: 'Application · obligatoire', identifier: 'Identifiant',
  revTitle: 'Révocation immédiate',
  revText: 'Coupe la connexion, ferme toutes les sessions et désactive le compte de messagerie. Action irréversible.',
  revoke: 'Révoquer l’accès', revokeConfirm: 'Confirmer la révocation',
  revokedDone: 'Accès retiré : connexion coupée, sessions fermées, compte désactivé.',
  enrollTitle: 'Enrôler un agent',
  enrollHelp: 'Le mot de passe temporaire est affiché une seule fois : transmettez-le à l’agent, qui devra aussi configurer son code à usage unique.',
  username: 'Identifiant (ex. awa.ouedraogo)', displayName: 'Nom affiché', ministry: 'Ministère / structure', fonction: 'Fonction',
  created: 'Agent enrôlé. Mot de passe temporaire :', hosted: 'Hébergé sur l’infrastructure de l’État. Aucun service tiers.',
  pick: 'Sélectionnez un agent.',
  errors: {
    INVALID_USERNAME: 'Identifiant invalide (3 à 32 caractères : a-z, 0-9, point, tiret).',
    INVALID_FIELD: 'Un champ est vide ou invalide.',
    INVALID_ROLE: 'Rôle invalide.',
    REVOKED_ACCOUNT: 'Ce compte a été révoqué : créez un nouvel identifiant.',
    LAST_ADMIN: 'Impossible : c’est le dernier administrateur actif.',
    UNKNOWN_AGENT: 'Agent introuvable.',
  } as Record<string, string>,
}
const errorText = (e: unknown): string => T.errors[e instanceof Error ? e.message : ''] ?? T.generic

type Child = Node | string | undefined
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (typeof v === 'function') el.addEventListener(k, v as EventListener)
    else if (v === true) el.setAttribute(k, '')
    else if (v !== false && v !== undefined) el.setAttribute(k, String(v))
  }
  el.append(...children.filter((c): c is Node | string => c !== undefined))
  return el
}
const initials = (name: string): string => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join('')
const avatar = (name: string, big = false) => h('span', { class: big ? 'avatar big' : 'avatar', 'aria-hidden': 'true' }, initials(name))

function logo(): SVGElement {
  const ns = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(ns, 'svg')
  for (const [k, v] of Object.entries({ viewBox: '0 0 64 64', width: '34', height: '34', 'aria-hidden': 'true' })) svg.setAttribute(k, v)
  const mk = (d: string, attrs: Record<string, string>) => {
    const p = document.createElementNS(ns, 'path')
    p.setAttribute('d', d)
    for (const [k, v] of Object.entries(attrs)) p.setAttribute(k, v)
    return p
  }
  svg.append(
    mk('M32 3l24 8v19c0 14-10 24-24 30C18 54 8 44 8 30V11z', { fill: '#0B3A24', stroke: '#F2B705', 'stroke-width': '3', 'stroke-linejoin': 'round' }),
    mk('M19 17h26a5 5 0 0 1 5 5v14a5 5 0 0 1-5 5H33l-8 7v-7h-6a5 5 0 0 1-5-5V22a5 5 0 0 1 5-5z', { fill: '#FFFFFF' }),
    mk('M29 27h6v7h-6z', { fill: '#F2B705' }),
  )
  return svg
}

const root = document.getElementById('app')!

function showLogin(message?: string) {
  root.replaceChildren(
    h('main', { class: 'login' },
      h('div', { class: 'login-card' },
        logo(), h('h1', {}, 'DÎYOY'), h('p', { class: 'sub' }, T.title), h('p', {}, T.loginText),
        message ? h('p', { class: 'error', role: 'alert' }, message) : undefined,
        h('button', { type: 'button', click: () => void startLogin() }, T.login))))
}

function mountConsole(token: string) {
  const me = usernameOf(token)
  let rows: AgentRow[] = []
  let selected: string | undefined
  let page: 'agents' | 'roles' | 'enroll' | 'audit' | 'rooms' | 'archive' | 'server' = 'agents'
  let term = ''
  let roleMessage = '' // conservé entre deux affichages: l'écran est redessiné après chaque changement
  const content = h('main', { class: 'content' })
  const pageLabel = { agents: T.agents, enroll: T.enroll, rooms: T.rooms, roles: T.roles, archive: T.archive, audit: T.audit, server: T.server }
  const navItems = (['agents', 'enroll', 'rooms', 'roles', 'archive', 'audit', 'server'] as const).map((k) =>
    h('button', { type: 'button', class: 'nav-item', 'data-page': k, click: () => { page = k; roleMessage = ''; draw(); if (k === 'agents' || k === 'roles') void load() } }, pageLabel[k]))
  const side = h('aside', { class: 'side' },
    h('div', { class: 'brand' }, logo(), h('div', {}, h('strong', {}, 'DÎYOY'), h('span', {}, T.title))),
    h('nav', { class: 'nav-items', 'aria-label': T.title }, ...navItems),
    h('div', { class: 'side-foot' }, h('p', {}, T.hosted),
      h('button', { type: 'button', class: 'ghost', click: () => window.location.assign(logoutUrl()) }, T.logout)))
  root.replaceChildren(h('div', { class: 'shell' }, side, content))

  async function load() {
    const list = await listAgents(token).catch(() => 'error' as const)
    if (list === undefined) return showLogin(T.denied)
    if (list === 'error') return void content.replaceChildren(h('p', { class: 'error', role: 'alert' }, T.generic))
    rows = list
    draw()
  }

  function draw() {
    for (const b of navItems) b.setAttribute('aria-current', String(b.dataset.page === page))
    if (page === 'enroll') drawEnroll()
    else if (page === 'roles') drawRoles()
    else if (page === 'audit') void drawAudit()
    else if (page === 'rooms') void drawRooms()
    else if (page === 'server') void drawServer()
    else if (page === 'archive') drawArchive()
    else drawAgents()
  }

  function drawAgents() {
    const status = h('p', { class: 'ok', role: 'status' })
    const error = h('p', { class: 'error', role: 'alert' })
    const search = h('input', { type: 'search', placeholder: T.search, 'aria-label': T.search, value: term, input: () => { term = search.value.trim().toLowerCase(); fill() } })
    const body = h('tbody')
    const detail = h('section', { class: 'detail', 'aria-live': 'polite' })
    const badge = (a: AgentRow) => h('span', { class: a.status === 'active' ? 'badge ok' : 'badge off' }, a.status === 'active' ? T.active : T.revoked)
    const select = (u: string) => { selected = u; fill() }

    function fill() {
      const shown = rows.filter((a) => `${a.displayName} ${a.username} ${a.ministry} ${a.fonction}`.toLowerCase().includes(term))
      body.replaceChildren(...(shown.length === 0
        ? [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, T.none))]
        : shown.map((a) =>
          h('tr', { 'data-username': a.username, 'aria-selected': String(a.username === selected), tabindex: 0, click: () => select(a.username), keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') select(a.username) } },
            h('td', { class: 'who' }, avatar(a.displayName), h('strong', {}, a.displayName)),
            h('td', {}, a.ministry), h('td', {}, a.fonction), h('td', {}, T.role[a.role]), h('td', {}, badge(a))))))
      drawDetail()
    }

    function drawDetail() {
      const a = rows.find((r) => r.username === selected)
      if (!a) return void detail.replaceChildren(h('p', { class: 'muted' }, T.pick))
      let armed = false
      const revoke = h('button', { type: 'button', class: 'danger', click: () => {
        if (!armed) {
          armed = true
          revoke.textContent = T.revokeConfirm
          setTimeout(() => { armed = false; revoke.textContent = T.revoke }, 4000)
          return
        }
        error.textContent = ''
        revoke.disabled = true
        revokeAgent(token, a.username)
          .then(async () => { status.textContent = `${a.displayName} — ${T.revokedDone}`; rows = (await listAgents(token)) ?? rows; fill() })
          .catch((e) => { error.textContent = errorText(e); revoke.disabled = false })
      } }, T.revoke)
      const canRevoke = a.status === 'active' && a.username !== me
      detail.replaceChildren(
        h('div', { class: 'detail-head' }, avatar(a.displayName, true),
          h('div', {}, h('h2', {}, `${a.displayName}${a.username === me ? ` (${T.you})` : ''}`), h('p', { class: 'muted' }, `${a.fonction} · ${a.ministry}`))),
        h('dl', {}, h('dt', {}, T.identifier), h('dd', {}, a.username), h('dt', {}, T.colAccess), h('dd', {}, T.role[a.role]),
          h('dt', {}, T.colStatus), h('dd', {}, badge(a)), h('dt', {}, T.second), h('dd', {}, T.secondOn)),
        ...(canRevoke ? [h('div', { class: 'revoke-card' }, h('h3', {}, T.revTitle), h('p', {}, T.revText), revoke)] : []))
    }

    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.agents), search, h('button', { type: 'button', click: () => { page = 'enroll'; draw() } }, T.enrollBtn)),
      status, error,
      h('div', { class: 'split' },
        h('table', { class: 'agents' },
          h('thead', {}, h('tr', {}, ...[T.colAgent, T.colStructure, T.colFunction, T.colAccess, T.colStatus].map((c) => h('th', { scope: 'col' }, c)))), body),
        detail))
    fill()
  }

  /** Rôles et accès: ce que permet chaque rôle, et un sélecteur par agent actif (on ne change pas son propre rôle ici). */
  function drawRoles() {
    const status = h('p', { class: 'ok', role: 'status' }, roleMessage)
    const error = h('p', { class: 'error', role: 'alert' })
    const active = rows.filter((a) => a.status === 'active')
    const cards = (['admin', 'chef_de_service', 'agent'] as const).map((r) =>
      h('article', { class: 'role-card' }, h('h3', {}, T.role[r]), h('p', {}, T.roleDesc[r]),
        h('p', { class: 'muted' }, `${active.filter((a) => a.role === r).length} / ${active.length}`)))
    const body = h('tbody', {}, ...active.map((a) => {
      const select = h('select', { 'aria-label': `${T.colAccess} — ${a.displayName}` }, ...(['agent', 'chef_de_service', 'admin'] as const).map((r) => h('option', { value: r, ...(r === a.role ? { selected: true } : {}) }, T.role[r])))
      const apply = h('button', { type: 'button', click: () => {
        error.textContent = ''
        status.textContent = ''
        roleMessage = ''
        apply.disabled = true
        changeRole(token, a.username, select.value as AgentRole)
          .then(async () => { roleMessage = `${T.roleChanged} ${a.displayName} → ${T.role[select.value as AgentRole]}`; rows = (await listAgents(token)) ?? rows; drawRoles() })
          .catch((e) => { error.textContent = errorText(e); select.value = a.role; apply.disabled = false })
      } }, T.apply)
      const self = a.username === me
      return h('tr', { 'data-username': a.username },
        h('td', { class: 'who' }, avatar(a.displayName), h('strong', {}, `${a.displayName}${self ? ` (${T.you})` : ''}`)),
        h('td', {}, `${a.fonction} · ${a.ministry}`),
        h('td', {}, self ? T.role[a.role] : select),
        h('td', {}, self ? '' : apply))
    }))
    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.roles)), h('p', { class: 'muted' }, T.rolesHelp),
      h('div', { class: 'role-cards' }, ...cards), status, error,
      h('table', { class: 'agents' }, h('thead', {}, h('tr', {}, ...[T.colAgent, T.colFunction, T.colAccess, ''].map((c) => h('th', { scope: 'col' }, c)))), body))
  }

  /** Salons et canaux: métadonnées vues par le serveur (nom, créateur, membres, chiffrement), jamais le contenu. */
  async function drawRooms() {
    const error = h('p', { class: 'error', role: 'alert' })
    const body = h('tbody')
    const detail = h('section', { class: 'detail', 'aria-live': 'polite' }, h('p', { class: 'muted' }, T.pickRoom))
    let rooms: Awaited<ReturnType<typeof listRooms>> = []
    let chosen: string | undefined
    const who = (mxid: string) => mxid.replace(/^@/, '').split(':')[0] ?? mxid
    const refresh = h('button', { type: 'button', click: () => void load() }, T.refresh)
    async function show(id: string) {
      chosen = id
      fill()
      const room = rooms.find((r) => r.roomId === id)
      const members = await roomMembers(token, id).catch(() => undefined)
      if (chosen !== id || !room) return
      detail.replaceChildren(
        h('h2', {}, room.name),
        h('p', { class: 'muted' }, `${room.encryption ? T.encrypted : T.clear} · ${T.colMembers} : ${room.members}`),
        h('h3', {}, T.membersOf),
        h('ul', { class: 'member-list' }, ...(members ?? []).map((m) =>
          h('li', {}, avatar(m.displayName), h('span', {}, m.displayName), m.status === 'revoked' ? h('span', { class: 'badge off' }, T.revoked) : h('span')))))
    }
    function fill() {
      body.replaceChildren(...(rooms.length === 0
        ? [h('tr', {}, h('td', { colspan: 4, class: 'muted' }, T.roomsEmpty))]
        : rooms.map((r) =>
          h('tr', { 'data-room': r.roomId, 'aria-selected': String(r.roomId === chosen), tabindex: 0, click: () => void show(r.roomId), keydown: (e: Event) => { if ((e as KeyboardEvent).key === 'Enter') void show(r.roomId) } },
            h('td', { class: 'who' }, avatar(r.name), h('strong', {}, r.name)), h('td', {}, who(r.creator)), h('td', {}, String(r.members)),
            h('td', {}, h('span', { class: r.encryption ? 'badge ok' : 'badge off' }, r.encryption ? T.encrypted : T.clear))))))
    }
    async function load() {
      error.textContent = ''
      try {
        rooms = await listRooms(token)
        if (page === 'rooms') fill()
      } catch (e) {
        error.textContent = errorText(e)
      }
    }
    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.rooms), refresh), h('p', { class: 'muted' }, T.roomsHelp), error,
      h('div', { class: 'split' },
        h('table', { class: 'agents' }, h('thead', {}, h('tr', {}, ...[T.colRoom, T.colCreator, T.colMembers, T.colEncryption].map((c) => h('th', { scope: 'col' }, c)))), body),
        detail))
    await load()
  }

  /** Serveur: état réel des composants et chiffres clés. */
  async function drawServer() {
    const grid = h('div', { class: 'role-cards' })
    const error = h('p', { class: 'error', role: 'alert' })
    const state = (ok: boolean) => h('span', { class: ok ? 'badge ok' : 'badge off' }, ok ? T.up : T.down)
    const line = (k: string, v: Node | string) => h('div', { class: 'kv' }, h('dt', {}, k), h('dd', {}, v))
    const fmtUp = (s: number) => (s < 90 ? `${s} s` : s < 5400 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`)
    async function load() {
      error.textContent = ''
      try {
        const s = await serverStatus(token)
        if (page !== 'server') return
        const cards: HTMLElement[] = [
          h('article', { class: 'role-card' }, h('h3', {}, T.svSynapse), h('dl', {}, line('État', state(s.synapse.reachable)), line(T.version, s.synapse.version ?? '—'))),
          h('article', { class: 'role-card' }, h('h3', {}, T.svIdentity), h('dl', {}, line('État', state(s.identity.reachable)))),
          h('article', { class: 'role-card' }, h('h3', {}, T.svServer), h('dl', {}, line(T.serverName, s.serverName), line(T.uptime, fmtUp(s.uptimeSeconds)))),
        ]
        if (s.agents) {
          cards.push(h('article', { class: 'role-card' }, h('h3', {}, T.svAgents),
            h('dl', {}, line(T.total, String(s.agents.total)), line(T.activeN, String(s.agents.active)), line(T.revokedN, String(s.agents.revoked)), line(T.adminsN, String(s.agents.admins)))))
        }
        if (s.rooms) {
          cards.push(h('article', { class: 'role-card' }, h('h3', {}, T.svRooms),
            h('dl', {}, line(T.total, String(s.rooms.total)), line(T.encryptedN, String(s.rooms.encrypted)),
              line(T.clearN, h('span', { class: s.rooms.unencrypted > 0 ? 'badge off' : 'badge ok' }, String(s.rooms.unencrypted))))))
        }
        if (s.audit) {
          cards.push(h('article', { class: 'role-card' }, h('h3', {}, T.svJournal),
            h('dl', {}, line(T.entriesN, String(s.audit.entries)),
              line(T.chain, h('span', { class: s.audit.chainValid ? 'badge ok' : 'badge off' }, s.audit.chainValid ? T.chainShort : T.chainBrokenShort)))))
        }
        grid.replaceChildren(...cards)
      } catch (e) {
        error.textContent = errorText(e)
      }
    }
    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.server), h('button', { type: 'button', click: () => void load() }, T.refresh)),
      h('p', { class: 'muted' }, T.serverHelp), error, grid)
    await load()
  }

  /** Archivage légal: export des MÉTADONNÉES avec empreinte; le contenu chiffré n'est pas archivable par le serveur. */
  function drawArchive() {
    const status = h('p', { class: 'ok', role: 'status' })
    const error = h('p', { class: 'error', role: 'alert' })
    const button = h('button', { type: 'button', click: () => {
      error.textContent = ''
      status.textContent = ''
      button.disabled = true
      exportArchive(token)
        .then(({ blob, filename, digest }) => {
          const url = URL.createObjectURL(blob)
          const a = h('a', { href: url, download: filename })
          document.body.append(a)
          a.click()
          a.remove()
          URL.revokeObjectURL(url)
          status.textContent = `${T.exported} ${filename} — ${T.digestLabel} ${digest}`
        })
        .catch((e) => { error.textContent = errorText(e) })
        .finally(() => { button.disabled = false })
    } }, T.exportBtn)
    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.archive)), h('p', { class: 'muted' }, T.archiveHelp),
      h('div', { class: 'revoke-card' }, h('h3', {}, T.archive), h('p', {}, T.archiveLimit)), h('p', {}, button), status, error)
  }

  /** Journal d'audit: lecture seule, vérification du chaînage affichée en tête. */
  async function drawAudit() {
    const banner = h('p', { role: 'status' })
    const body = h('tbody')
    const error = h('p', { class: 'error', role: 'alert' })
    const roleName = (r: string) => T.role[r as AgentRole] ?? r
    const detail = (e: { action: string; detail?: string }) =>
      e.action === 'role' ? (e.detail ?? '').split(' → ').map(roleName).join(' → ')
        : e.action === 'enroll' ? (e.detail ?? '').split(' · ').map((x, i) => (i === 0 ? roleName(x) : x)).join(' · ') : (e.detail ?? '')
    const refresh = h('button', { type: 'button', click: () => void fill() }, T.refresh)
    async function fill() {
      error.textContent = ''
      try {
        const { entries, chainValid } = await listAudit(token)
        if (page !== 'audit') return
        banner.textContent = chainValid ? T.chainOk : T.chainBad
        banner.className = chainValid ? 'ok' : 'error'
        body.replaceChildren(...(entries.length === 0
          ? [h('tr', {}, h('td', { colspan: 5, class: 'muted' }, T.auditEmpty))]
          : entries.map((e) => h('tr', { 'data-action': e.action },
            h('td', {}, new Date(e.ts).toLocaleString('fr-FR')),
            h('td', {}, e.actor.startsWith('service-account-') ? T.cliActor : e.actor),
            h('td', {}, h('span', { class: `badge act-${e.action}` }, T.actions[e.action] ?? e.action)),
            h('td', {}, e.target), h('td', {}, detail(e))))))
      } catch (e) { error.textContent = errorText(e) }
    }
    content.replaceChildren(
      h('header', { class: 'top' }, h('h1', {}, T.audit), refresh), h('p', { class: 'muted' }, T.auditHelp), banner, error,
      h('table', { class: 'agents audit' }, h('thead', {}, h('tr', {}, ...[T.colDate, T.colActor, T.colAction, T.colTarget, T.colDetail].map((c) => h('th', { scope: 'col' }, c)))), body))
    await fill()
  }

  function drawEnroll() {
    const field = (id: string, label: string) => h('input', { id: `f-${id}`, placeholder: label, 'aria-label': label, required: true })
    const username = field('username', T.username)
    const displayName = field('displayName', T.displayName)
    const ministry = field('ministry', T.ministry)
    const fonction = field('fonction', T.fonction)
    const role = h('select', { id: 'f-role', 'aria-label': T.colAccess }, ...(['agent', 'chef_de_service', 'admin'] as const).map((r) => h('option', { value: r }, T.role[r])))
    const status = h('p', { class: 'ok', role: 'status' })
    const error = h('p', { class: 'error', role: 'alert' })
    const form = h('form', { class: 'enroll-form', submit: (e: Event) => {
      e.preventDefault()
      error.textContent = ''
      status.textContent = ''
      enrollAgent(token, { username: username.value.trim().toLowerCase(), displayName: displayName.value.trim(), ministry: ministry.value.trim(), fonction: fonction.value.trim(), role: role.value as AgentRole })
        .then(async (password) => {
          status.textContent = `${T.created} ${password}`
          for (const i of [username, displayName, ministry, fonction]) i.value = ''
          rows = (await listAgents(token)) ?? rows
        })
        .catch((err) => { error.textContent = errorText(err) })
    } }, username, displayName, ministry, fonction, role, h('button', { type: 'submit' }, T.enrollTitle))
    content.replaceChildren(h('header', { class: 'top' }, h('h1', {}, T.enrollTitle)), h('p', { class: 'muted' }, T.enrollHelp), form, status, error)
  }

  draw()
  void load()
}

try {
  const token = await finishLogin()
  if (token) mountConsole(token)
  else showLogin()
} catch {
  showLogin(T.failed)
}
