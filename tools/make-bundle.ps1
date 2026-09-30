<#
  tools/make-bundle.ps1

  Concatenates supabase/migrations/*.sql in numeric order into one paste-ready
  file for the Supabase Dashboard SQL Editor. Supabase has no migration runner in
  this project (no CLI, no config.toml), so a fresh project is set up by pasting
  one batch - this builds that batch and checks it before you touch the Dashboard.

  The output is gitignored on purpose: it is derived from the migrations, and a
  committed copy goes stale the moment someone adds a migration.

  Usage:
    powershell -File tools\make-bundle.ps1              # bundle every migration
    powershell -File tools\make-bundle.ps1 -From 9      # bundle 009 upward
#>
param([int]$From = 0)

$ErrorActionPreference = 'Stop'
$root  = Split-Path -Parent $PSScriptRoot
$dir   = Join-Path $root 'supabase\migrations'
$files = Get-ChildItem $dir -Filter '*.sql' | Sort-Object Name |
         Where-Object { [int]($_.Name.Substring(0, 3)) -ge $From }

if (-not $files -or $files.Count -eq 0) { throw "no migrations found in $dir from $From" }

$parts = @(
  '/* GENERATED helper - paste once in Supabase SQL Editor. Source of truth stays in supabase/migrations/. Do not edit here. */',
  ''
)
foreach ($f in $files) {
  $parts += ('-- ========== SOURCE: ' + $f.Name + ' ==========')
  $parts += (Get-Content -LiteralPath $f.FullName -Raw).TrimEnd()
  $parts += ''
}
$sql = $parts -join "`n"

$first = $files[0].Name.Substring(0, 3)
$last  = $files[-1].Name.Substring(0, 3)
$out   = Join-Path $root ("supabase\apply-" + $first + "-to-" + $last + ".sql")

# No BOM: the SQL Editor is fed by the clipboard and a BOM becomes a stray character.
[System.IO.File]::WriteAllText($out, $sql, (New-Object System.Text.UTF8Encoding($false)))

# ---- preflight: the checks worth automating before a batch hits a live database ----
$numbers     = @($files | ForEach-Object { [int]$_.Name.Substring(0, 3) })
$gaps        = @()
for ($n = $numbers[0]; $n -le $numbers[-1]; $n++) { if ($numbers -notcontains $n) { $gaps += $n } }
$dollars     = ([regex]::Matches($sql, '\$\$')).Count
$destructive = [regex]::Matches($sql, '(?im)^\s*(drop\s+table|truncate|delete\s+from|grant|revoke|drop\s+schema)')
$markers     = ([regex]::Matches($sql, '-- ========== SOURCE:')).Count

Write-Output ("wrote        : " + $out)
Write-Output ("migrations   : " + ($numbers -join ', ') + "   (" + $files.Count + " files)")
Write-Output ("lines        : " + ($sql -split "`n").Count + "  (source files: " + (($files | Get-Content | Measure-Object -Line).Lines) + ")")
Write-Output ("source marks : " + $markers + $(if ($markers -eq $files.Count) { '  matches file count' } else { '  MISMATCH' }))
Write-Output ("dollar quotes: " + $dollars + $(if ($dollars % 2 -eq 0) { '  balanced' } else { '  UNBALANCED - do not paste' }))
Write-Output ("number gaps  : " + $(if ($gaps.Count -eq 0) { 'none' } else { ($gaps -join ', ') }))
Write-Output ("destructive  : " + $destructive.Count + $(if ($destructive.Count -eq 0) { '  no drop table / truncate / delete / grant / revoke' } else { '  PRESENT - read them' }))

foreach ($m in $destructive) { Write-Output ("    " + $m.Value.Trim()) }
if ($dollars % 2 -ne 0)              { throw 'unbalanced dollar quotes' }
if ($markers -ne $files.Count)       { throw 'SOURCE marker count does not match file count' }
if ($gaps.Count -gt 0)               { throw ("migration numbers have gaps: " + ($gaps -join ', ') + " - confirm the missing files really are absent") }
