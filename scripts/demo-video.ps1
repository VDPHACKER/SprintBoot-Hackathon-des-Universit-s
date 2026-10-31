# Aide au tournage de la video de demonstration (3 minutes maximum).
# Enchaine les moments "terminal" avec des pauses pour commenter. Les moments "navigateur" sont decrits a l'ecran.
#
#   powershell -File scripts\demo-video.ps1                       -> verifie que tout est pret (prepare)
#   powershell -File scripts\demo-video.ps1 -Etape tout           -> deroule la demonstration avec pauses
#   powershell -File scripts\demo-video.ps1 -Etape code -Arg awa.ouedraogo
#   powershell -File scripts\demo-video.ps1 -Etape serveur-aveugle -Arg "texte envoye depuis le navigateur"
#   powershell -File scripts\demo-video.ps1 -Etape en-clair
#   powershell -File scripts\demo-video.ps1 -Etape revoquer -Arg moussa.sawadogo
# Ajouter -SansPause pour tout enchainer sans attendre (essais).
param(
  [ValidateSet('prepare', 'etat', 'code', 'serveur-aveugle', 'en-clair', 'revoquer', 'tout')]
  [string]$Etape = 'prepare',
  [string]$Arg = '',
  [switch]$SansPause
)
$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$compose = @('compose')
$ComptesDemo = @('admin.demo', 'issa.kabore', 'awa.ouedraogo', 'moussa.sawadogo')

function Titre($texte) { Write-Host ""; Write-Host "=== $texte ===" -ForegroundColor Cyan }
function Dire($texte) { Write-Host "  > $texte" -ForegroundColor Yellow }
function Ok($texte) { Write-Host "  OK  $texte" -ForegroundColor Green }
function Ko($texte) { Write-Host "  !!  $texte" -ForegroundColor Red }
function Pause-Demo($message) {
  if ($SansPause) { return }
  Write-Host ""; Write-Host "  [ $message ]" -ForegroundColor DarkGray
  [void](Read-Host "  Entree pour continuer")
}
function Psql($requete) {
  docker @compose exec -T postgres psql -U synapse -d synapse -c $requete 2>&1
}

function Etape-Etat {
  Titre "Etat de la pile"
  Dire "Tout doit etre 'healthy' (installation faite avant l'enregistrement: docker compose up -d --wait)"
  docker @compose ps --format "table {{.Service}}\t{{.Status}}"
  $json = node scripts/admin.mjs list | ConvertFrom-Json
  foreach ($nom in $ComptesDemo) {
    $a = $json | Where-Object { $_.username -eq $nom }
    if ($a -and $a.status -eq 'active') { Ok "$nom ($($a.role)) actif" } else { Ko "$nom absent ou revoque: relancer une installation propre (scripts/clean-install-check.sh --yes)" }
  }
}

function Etape-Code($compte) {
  if (-not $compte) { $compte = 'awa.ouedraogo' }
  Titre "Code a usage unique de $compte"
  Dire "Mot de passe de demonstration: voir README. Code a saisir apres le mot de passe:"
  node scripts/totp-demo.mjs $compte
}

function Etape-ServeurAveugle($phrase) {
  Titre "Le serveur ne lit rien"
  Dire "Types d'evenements stockes: seulement des evenements 'chiffres' (m.room.encrypted) pour les messages"
  Psql "SELECT type, count(*) AS nombre FROM events GROUP BY type ORDER BY 2 DESC LIMIT 8;"
  Pause-Demo "Montrer qu'il n'y a aucun message en clair (m.room.message)"
  Dire "Un message tel que le serveur le stocke (contenu illisible):"
  Psql "SELECT e.type, left(j.json, 190) AS extrait FROM event_json j JOIN events e USING (event_id) WHERE e.type = 'm.room.encrypted' ORDER BY e.stream_ordering DESC LIMIT 1;"
  if ($phrase) {
    Pause-Demo "Chercher dans toute la base le texte que vous avez ecrit dans le navigateur"
    $dump = (docker @compose exec -T postgres pg_dump -U synapse synapse | Out-String)
    if ($dump.Contains($phrase)) { Ko "ATTENTION: la phrase '$phrase' est lisible dans la base" } else { Ok "La phrase '$phrase' n'apparait nulle part dans la base ($([math]::Round($dump.Length / 1024)) Ko examines)" }
  }
  Dire "Les fichiers: aucun nom, type generique, contenu chiffre:"
  Psql "SELECT coalesce(upload_name, '(aucun nom)') AS nom, media_type, media_length AS octets FROM local_media_repository ORDER BY created_ts DESC LIMIT 3;"
}

function Etape-EnClair {
  Titre "Un client modifie essaie de deposer du texte lisible"
  Dire "Le serveur refuse tout contenu en clair qu'il sait reconnaitre (module no_plaintext)"
  node scripts/demo-plaintext.mjs
  if ($LASTEXITCODE -ne 0) { Ko "Lancer d'abord: docker compose -f compose.yaml -f compose.test.yaml up -d --wait" }
}

function Etape-Revoquer($compte) {
  if (-not $compte) { Ko "Indiquer le compte: -Etape revoquer -Arg <identifiant>"; return }
  Titre "Revocation de $compte"
  Dire "Gardez la fenetre de cet agent ouverte dans le navigateur: elle doit revenir seule a l'ecran de connexion."
  Pause-Demo "Pret ? La revocation part a l'appui sur Entree"
  $chrono = [Diagnostics.Stopwatch]::StartNew()
  node scripts/admin.mjs revoke $compte
  $chrono.Stop()
  Ok "Revocation terminee en $([math]::Round($chrono.Elapsed.TotalSeconds, 1)) s: acces coupe sur tous ses appareils"
  $apres = (node scripts/admin.mjs list | ConvertFrom-Json) | Where-Object { $_.username -eq $compte }
  Dire "Etat apres: $($apres.username) = $($apres.status)"
  Dire "Un message envoye maintenant dans le groupe utilise une NOUVELLE cle: l'agent revoque ne peut pas le lire."
  Write-Host ""; Write-Host "  Ce compte de demonstration reste coupe jusqu'a une reinstallation (scripts/clean-install-check.sh --yes)." -ForegroundColor DarkGray
}

switch ($Etape) {
  'prepare' {
    Titre "Preparation du tournage"
    Etape-Etat
    try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8008/_matrix/client/versions' -TimeoutSec 5 | Out-Null; Ok "Synapse direct disponible (necessaire pour l'etape en-clair)" } catch { Ko "Pour l'etape en-clair: docker compose -f compose.yaml -f compose.test.yaml up -d --wait" }
    Dire "Codes a usage unique actuels (valables 30 s): relancer -Etape code juste avant de les saisir"
    foreach ($nom in @('awa.ouedraogo', 'moussa.sawadogo')) { Write-Host "    $nom : $(node scripts/totp-demo.mjs $nom)" }
    Dire "Navigateur: deux profils ou fenetres distinctes (une seule session par navigateur), http://localhost:8080"
    Dire "Deroule complet: powershell -File scripts\demo-video.ps1 -Etape tout"
  }
  'etat' { Etape-Etat }
  'code' { Etape-Code $Arg }
  'serveur-aveugle' { Etape-ServeurAveugle $Arg }
  'en-clair' { Etape-EnClair }
  'revoquer' { Etape-Revoquer $Arg }
  'tout' {
    Titre "Deroule de la demonstration (3 minutes)"
    Etape-Etat
    Pause-Demo "0:15 NAVIGATEUR: connexion de awa.ouedraogo (mot de passe puis code), creer un salon, inviter moussa.sawadogo; 2e fenetre: moussa rejoint; echanger 2 messages. Notez une phrase."
    $phrase = if ($SansPause) { '' } else { Read-Host "  Phrase ecrite dans le navigateur (pour la chercher dans la base)" }
    Etape-ServeurAveugle $phrase
    Pause-Demo "NAVIGATEUR (facultatif): montrer en 10 s le message confidentiel (badge, flou quand on change de fenetre)"
    Etape-EnClair
    $cible = if ($Arg) { $Arg } else { 'moussa.sawadogo' }
    Etape-Revoquer $cible
    Pause-Demo "NAVIGATEUR: montrer la fenetre de l'agent revoque revenue a la connexion avec le message d'avis, puis l'innovation (instruction de service + 'Lu par 1 sur 2')"
    Titre "Fin"
    Dire "Dernier plan: docs/note-securite.md, paragraphe 4 (limites connues): dire aussi ce qui n'est PAS garanti."
  }
}