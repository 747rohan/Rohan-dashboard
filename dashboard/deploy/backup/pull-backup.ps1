# Pull the newest /opt/dashboard snapshot off 43.198.49.213 onto this machine.
#
# The server keeps five archives, but they live on the same instance as the
# data — that is a rollback, not a backup. This is the copy that survives
# losing the instance, so run it regularly (see the scheduled-task snippet at
# the bottom of README.md).
#
#   powershell -ExecutionPolicy Bypass -File pull-backup.ps1
#   ... -Fresh          take a new snapshot on the server first
#   ... -Dest D:\Backups -Keep 30

[CmdletBinding()]
param(
    [string]$Dest = "$env:USERPROFILE\DashboardBackups",
    [string]$Key,
    [string]$Host_ = 'ubuntu@43.198.49.213',
    [int]$Keep = 14,
    [switch]$Fresh
)

$ErrorActionPreference = 'Stop'

# The key lives in a folder with a Cyrillic name, and Windows PowerShell reads
# .ps1 files as ANSI unless they carry a BOM - spelling the path out here would
# break the parser on a fresh checkout. Match it with a wildcard instead.
if (-not $Key) {
    $Key = (Get-Item "$env:USERPROFILE\*\Credo\AntonK.pem" -ErrorAction SilentlyContinue |
            Select-Object -First 1).FullName
}
if (-not $Key -or -not (Test-Path $Key)) {
    throw 'SSH key AntonK.pem not found under the user profile - pass -Key explicitly.'
}
if (-not (Test-Path $Dest)) { New-Item -ItemType Directory -Path $Dest -Force | Out-Null }

$ssh = @('-i', $Key, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20')

if ($Fresh) {
    Write-Host 'Taking a fresh snapshot on the server...'
    & ssh @ssh $Host_ 'sudo systemctl start dash-backup.service && sleep 2 && systemctl is-active dash-backup.service'
    # oneshot units report "inactive" once done; failure shows up in the next step.
}

# Resolve the symlink server-side: scp of a symlink copies the link, not the file.
$latest = (& ssh @ssh $Host_ 'readlink -f /opt/dashboard/backups/latest.tar.gz').Trim()
if (-not $latest) { throw 'No backup found on the server. Run with -Fresh, or check dash-backup.service.' }

$name  = Split-Path $latest -Leaf
$local = Join-Path $Dest $name

if (Test-Path $local) {
    Write-Host "Already have $name - nothing to pull."
} else {
    Write-Host "Pulling $name ..."
    & scp @ssh "${Host_}:$latest" $local
    if ($LASTEXITCODE -ne 0) { throw "scp failed with exit code $LASTEXITCODE" }
}

# Verify rather than trust: a truncated transfer looks like a backup until the
# day it is needed.
& tar -tzf $local ./orchestrator.db | Out-Null
if ($LASTEXITCODE -ne 0) { Remove-Item $local -Force; throw 'Archive is unreadable - deleted the partial copy.' }

$size = '{0:N1} MB' -f ((Get-Item $local).Length / 1MB)
Write-Host "OK  $local  ($size)"

& tar -xzOf $local ./MANIFEST.txt | Select-String 'taken:|rows=' | ForEach-Object { "    $_" }

# Rotation: keep the newest $Keep archives here.
Get-ChildItem $Dest -Filter 'dashboard-*.tar.gz' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -Skip $Keep |
    ForEach-Object { Write-Host "    dropping $($_.Name)"; Remove-Item $_.FullName -Force }
