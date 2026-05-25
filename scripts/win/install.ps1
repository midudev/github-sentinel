<#
.SYNOPSIS
    Instala GitHub Sentinel como servicio de Windows usando NSSM.

.DESCRIPTION
    Crea el servicio "GitHubSentinel" que ejecuta `bun src/server/index.ts`
    desde la carpeta del proyecto. Configura logs rotados en data/sentinel.log
    y arranque automático al iniciar Windows.

    El servicio enviará SIGTERM al detenerse y el proceso cerrará SQLite
    de forma limpia gracias al handler de shutdown del servidor.

.PARAMETER ServiceName
    Nombre del servicio. Por defecto: GitHubSentinel.

.PARAMETER NssmPath
    Ruta al ejecutable nssm.exe. Si no se indica, se busca en el PATH.

.PARAMETER BunPath
    Ruta al ejecutable bun.exe. Si no se indica, se busca en el PATH y
    luego en %USERPROFILE%\.bun\bin\bun.exe.

.EXAMPLE
    PS> .\scripts\install-windows-service.ps1

.EXAMPLE
    PS> .\scripts\install-windows-service.ps1 -ServiceName MySentinel

.NOTES
    Ejecuta este script en PowerShell elevado (Administrador).
    Requiere NSSM: https://nssm.cc/download
#>

[CmdletBinding()]
param(
    [string]$ServiceName = "GitHubSentinel",
    [string]$NssmPath,
    [string]$BunPath
)

$ErrorActionPreference = "Stop"

function Test-Admin {
    $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Admin)) {
    Write-Error "Este script debe ejecutarse como Administrador. Abre PowerShell con 'Ejecutar como administrador'."
    exit 1
}

# ---------- localizar bun.exe ----------
if (-not $BunPath) {
    $candidates = @(
        (Get-Command bun.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
        (Join-Path $env:USERPROFILE ".bun\bin\bun.exe")
    ) | Where-Object { $_ -and (Test-Path $_) }

    if ($candidates.Count -eq 0) {
        Write-Error "No encuentro bun.exe. Instala Bun: https://bun.com/docs/installation o pasa -BunPath."
        exit 1
    }
    $BunPath = $candidates[0]
}
Write-Host "→ bun.exe: $BunPath"

# ---------- localizar nssm.exe ----------
if (-not $NssmPath) {
    $cmd = Get-Command nssm.exe -ErrorAction SilentlyContinue
    if ($cmd) { $NssmPath = $cmd.Source }
}

if (-not $NssmPath -or -not (Test-Path $NssmPath)) {
    Write-Error @"
No encuentro nssm.exe. Tienes dos opciones:
  1. Descárgalo de https://nssm.cc/download, extráelo y añádelo al PATH.
  2. Pasa la ruta con -NssmPath "C:\ruta\a\nssm.exe".
  3. Si tienes Chocolatey: choco install nssm
  4. Si tienes Scoop:      scoop install nssm
"@
    exit 1
}
Write-Host "→ nssm.exe: $NssmPath"

# ---------- directorio del proyecto ----------
$ProjectDir = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Write-Host "→ proyecto: $ProjectDir"

if (-not (Test-Path (Join-Path $ProjectDir "src\server\index.ts"))) {
    Write-Error "No encuentro src/server/index.ts en $ProjectDir. ¿Estás ejecutando el script desde la carpeta del proyecto?"
    exit 1
}

# ---------- crear data/ si no existe ----------
$DataDir = Join-Path $ProjectDir "data"
if (-not (Test-Path $DataDir)) {
    New-Item -ItemType Directory -Path $DataDir | Out-Null
    Write-Host "→ creado $DataDir"
}

$LogFile = Join-Path $DataDir "sentinel.log"

# ---------- si ya existe el servicio, parar y borrar ----------
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "→ el servicio '$ServiceName' ya existe, reinstalando..."
    if ($existing.Status -ne "Stopped") {
        & $NssmPath stop $ServiceName | Out-Null
        Start-Sleep -Seconds 2
    }
    & $NssmPath remove $ServiceName confirm | Out-Null
    Start-Sleep -Seconds 1
}

# ---------- instalar ----------
Write-Host ""
Write-Host "Instalando servicio '$ServiceName'..." -ForegroundColor Cyan

& $NssmPath install $ServiceName $BunPath "src/server/index.ts"
& $NssmPath set $ServiceName AppDirectory $ProjectDir
& $NssmPath set $ServiceName AppStdout $LogFile
& $NssmPath set $ServiceName AppStderr $LogFile
& $NssmPath set $ServiceName AppRotateFiles 1
& $NssmPath set $ServiceName AppRotateOnline 1
& $NssmPath set $ServiceName AppRotateSeconds 86400
& $NssmPath set $ServiceName AppRotateBytes 5242880
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppStopMethodSkip 0
& $NssmPath set $ServiceName AppStopMethodConsole 10000
& $NssmPath set $ServiceName AppKillProcessTree 1
& $NssmPath set $ServiceName AppExit Default Restart
& $NssmPath set $ServiceName AppRestartDelay 5000
& $NssmPath set $ServiceName Description "GitHub Sentinel - monitor de issues con LLM local"
& $NssmPath set $ServiceName AppNoConsole 1

Write-Host "→ servicio configurado" -ForegroundColor Green

# ---------- arrancar ----------
Write-Host ""
Write-Host "Arrancando servicio..." -ForegroundColor Cyan
& $NssmPath start $ServiceName | Out-Null
Start-Sleep -Seconds 2

$svc = Get-Service -Name $ServiceName
Write-Host "→ estado: $($svc.Status)" -ForegroundColor Green

Write-Host ""
Write-Host "✓ Instalado." -ForegroundColor Green
Write-Host ""
Write-Host "  servicio:   $ServiceName"
Write-Host "  logs:       $LogFile"
Write-Host "  dashboard:  http://localhost:$(if ($env:PORT) { $env:PORT } else { '3741' })"
Write-Host ""
Write-Host "Comandos útiles:"
Write-Host "  Get-Service $ServiceName"
Write-Host "  Restart-Service $ServiceName"
Write-Host "  Stop-Service $ServiceName"
Write-Host "  Get-Content '$LogFile' -Wait -Tail 50"
Write-Host ""
Write-Host "Para desinstalar:  .\scripts\uninstall-windows-service.ps1"
