# Controle automatique du dossier de candidature. Code de sortie 1 si un point manque.
# Usage: powershell -File scripts/check-dossier.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$failures = New-Object System.Collections.Generic.List[string]
function Fail($message) { $failures.Add($message); Write-Host "ECHEC  $message" -ForegroundColor Red }
function Ok($message) { Write-Host "OK     $message" -ForegroundColor Green }
function WordCount($path) { ([IO.File]::ReadAllText((Join-Path $root $path), [Text.Encoding]::UTF8) -split '\s+' | Where-Object { $_ }).Count }

# 1. Licence a la racine
if ((Test-Path LICENSE) -and ((Get-Content LICENSE -TotalCount 3) -join ' ') -match 'GNU AFFERO GENERAL PUBLIC LICENSE') { Ok 'LICENSE (AGPL-3.0) a la racine' } else { Fail 'LICENSE absent ou ce n est pas l AGPL-3.0' }

# 2. README en francais avec les sections exigees
$readme = [IO.File]::ReadAllText((Join-Path $root 'README.md'), [Text.Encoding]::UTF8)
foreach ($section in @('Concept', 'Architecture', 'Technologies et licences', 'Niveau d.engagement', 'Installation', 'Limites')) {
  if ($readme -match "(?m)^## $section") { Ok "README: section '$section'" } else { Fail "README: section '$section' manquante" }
}
if ($readme -match 'docker compose up') { Ok 'README: commande d installation' } else { Fail 'README: commande d installation manquante' }

# 3. Longueurs: deux pages maximum (choix prudent: 950 mots, tableaux compris)
foreach ($doc in @('README.md', 'docs\note-securite.md', 'docs\note-pre-projet.md')) {
  $n = WordCount $doc
  if ($n -le 950) { Ok "$doc : $n mots (max 950)" } else { Fail "$doc : $n mots, depasse 950" }
}

# 4. Chaque composant du tableau de la specification est cite avec licence et lien
$third = [IO.File]::ReadAllText((Join-Path $root 'THIRD-PARTY.md'), [Text.Encoding]::UTF8)
foreach ($component in @('Synapse', 'matrix-js-sdk', 'matrix-sdk-crypto-wasm', 'Keycloak', 'PostgreSQL', 'Caddy')) {
  $line = ($third -split "`n" | Where-Object { $_ -match "^\| $component" } | Select-Object -First 1)
  if ($line -and $line -match 'https://' -and $line -match '(AGPL|Apache|MIT|PostgreSQL)') { Ok "THIRD-PARTY: $component (licence et lien)" } else { Fail "THIRD-PARTY: $component sans licence ou sans lien" }
}

# 5. Pieces du dossier presentes
foreach ($file in @('dossier\2-note-pre-projet.pdf', 'dossier\3-note-securite.pdf', 'docs\note-securite.md', 'docs\note-pre-projet.md', 'docs\fiche-equipe.md', 'docs\video-script.md', 'docs\traduction-moore.md', 'compose.yaml', 'deploy\keycloak\demo-users.json')) {
  if (Test-Path $file) { Ok "present: $file" } else { Fail "manquant: $file" }
}

# 6. La fiche equipe et la repartition des roles sont a completer par l'equipe: on le rappelle sans bloquer
$fiche = [IO.File]::ReadAllText((Join-Path $root 'docs\fiche-equipe.md'), [Text.Encoding]::UTF8)
if ($fiche -match '(?m)^\| 1 \| \| |à compléter') { Write-Host 'RAPPEL docs/fiche-equipe.md contient encore des champs a completer (universite, filieres, niveaux, contacts, attestations).' -ForegroundColor Yellow }

# 7. Aucun secret ni donnee generee dans le depot
$tracked = git ls-files
foreach ($bad in @('^data/', '(^|/)\.env$', 'node_modules/')) {
  if ($tracked | Where-Object { $_ -match $bad }) { Fail "fichier a ne pas versionner: $bad" } else { Ok "non versionne: $bad" }
}

# 8. Historique Git progressif
$commits = [int](git rev-list --count HEAD)
if ($commits -ge 10) { Ok "$commits commits dans l historique" } else { Fail "seulement $commits commits" }

if ($failures.Count -gt 0) { Write-Host "`n$($failures.Count) point(s) a corriger." -ForegroundColor Red; exit 1 }
Write-Host "`nDossier: tous les controles passent." -ForegroundColor Green
exit 0