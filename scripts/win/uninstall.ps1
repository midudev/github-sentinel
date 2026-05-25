<#
.SYNOPSIS
    Desinstala el servicio de Windows "GitHubSentinel".

.PARAMETER ServiceName
    Nombre del servicio a eliminar. Por defecto: GitHubSentinel.

.PARAMETER NssmPath
    Ruta a nssm.exe. Si no se indica, se busca en el PATH.

.PARAMETER KeepData
    Si se indica, no pregunta y conserva la carpeta data/ (sqlite + logs).

.PARAMETER PurgeData
    Si se indica, borra la carpeta data/ sin preguntar.

.EXAMPLE
    PS> .\scripts\uninstall-windows-service.ps1

.EXAMPLE
    PS> .\scripts\uninstall-windows-service.ps1 -KeepData

.NOTES
    Ejecuta este script en PowerShell elevado (Administrador).
#>

[CmdletBinding()]
param(
    [string]$ServiceName = "GitHubSentinel",
    [string]$NssmPath,
    [switch]$KeepData,
    [switch]$PurgeData
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Error "Este script debe ejecutarse como Administrador."
    exit 1
}

# ---------- comprobar que el servicio existe ----------
$svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if (-not $svc) {
    Write-Host "El servicio '$ServiceName' no existe. Nada que hacer." -ForegroundColor Yellow
    exit 0
}

Write-Host "→ servicio encontrado: $ServiceName ($($svc.Status))"

# ---------- localizar nssm ----------
if (-not $NssmPath) {
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $NssmPath = $cmd.Source }
}

if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    Write-Warning "No encuentro nssm.exe. Intento parar con sc.exe como fallback."
}

# ---------- parar el servicio ----------
if ($svc.Status -ne "Stopped") {
    Write-Host "→ deteniendo servicio..." -ForegroundColor Cyan
    if ($NssmPath) {
        & $NssmPath stop $ServiceName | Out-Null
    } else {
        Stop-Service -Name $ServiceName -Force
    }
    Start-Sleep -Seconds 3
}

# ---------- eliminar ----------
Write-Host "→ eliminando servicio..." -ForegroundColor Cyan
if ($NssmPath) {
    & $NssmPath remove $ServiceName confirm | Out-Null
} else {
    & sc.exe delete $ServiceName | Out-Null
}

Start-Sleep -Seconds 1
$check = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($check) {
    Write-Error "No pude eliminar el servicio. Reinicia y prueba de nuevo, o usa: sc.exe delete $ServiceName"
    exit 1
}

Write-Host "✓ Servicio eliminado." -ForegroundColor Green

# ---------- limpieza opcional de data/ ----------
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$DataDir = Join-Path $ProjectDir "data"

if (-not (Test-Path $DataDir)) {
    Write-Host ""
    exit 0
}

if ($KeepData) {
    Write-Host "→ se conserva $DataDir"
    exit 0
}

if (-not $PurgeData) {
    Write-Host ""
    $answer = Read-Host "¿Borrar también $DataDir (sqlite + logs)? [y/N]"
    if ($answer -notmatch '^[yY]') {
        Write-Host "→ se conserva $DataDir"
        exit 0
    }
}

Remove-Item -Path $DataDir -Recurse -Force
Write-Host "✓ $DataDir eliminado." -ForegroundColor Green
