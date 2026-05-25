# GitHub Sentinel

Agente local que vigila tus repositorios de GitHub, detecta nuevas issues y
te prepara un resumen + propuesta de solución usando un LLM local (Ollama),
todo sin salir de tu red.

Pensado para correr 24/7 en un MiniPC o servidor (Windows o macOS).

```
 ┌─ cron interno (cada N min) ──────────────────────────────────┐
 │   → GitHub REST API   (issues + metadata)                    │
 │   → SQLite local      (issues vistas, no duplicar)           │
 │   → Ollama local      (resumen + tipo + riesgo + propuesta)  │
 │   → Dashboard React   (terminal-style, Geist Pixel / Mono)   │
 └──────────────────────────────────────────────────────────────┘
```

---

## Stack

- **Runtime**: [Bun](https://bun.com) (servidor + bundler + sqlite + .env loader)
- **Frontend**: React 19 + Tailwind 4 + Geist Pixel / Geist Mono
- **Base de datos**: `bun:sqlite` (modo WAL)
- **LLM**: Ollama (opcional, recomendado `qwen2.5-coder:3b` o `7b`)

Sin dependencias extra de Node.js, Express, dotenv, better-sqlite3 ni nada por el estilo.

---

## Funcionalidades (v0.1)

- ✓ Vigila N repos cada N minutos (configurable).
- ✓ Detecta issues nuevas y las guarda en SQLite.
- ✓ Las analiza con LLM local: resumen, tipo (bug/feature/docs/question), riesgo (low/med/high), archivos probables y propuesta de solución.
- ✓ Dashboard minimalista con filtros y búsqueda.
- ✓ Health check (`/api/health`) y status (`/api/status`).
- ✓ Apagado limpio con SIGINT/SIGTERM (cierra SQLite sin corromper el WAL).
- ✓ Recuperación de errores (un repo que falla no para el resto).

---

## Quick start (desarrollo)

Requisito: [Bun ≥ 1.3](https://bun.com/docs/installation).

```bash
bun install
cp .env.example .env       # edita y añade tu GITHUB_TOKEN
bun dev                    # http://localhost:3741
```

`bun dev` arranca con HMR activo. Para producción local usa `bun start`.

---

## Variables de entorno

Bun carga `.env` automáticamente. Variables:

| Variable | Por defecto | Descripción |
|---|---|---|
| `GITHUB_TOKEN` | _(vacío)_ | Fine-grained PAT con permisos read-only de Issues + Metadata sobre los repos a vigilar. **Recomendado**, sin token estás limitado a 60 req/h. |
| `GITHUB_USER` | _(vacío)_ | Tu usuario, solo para mostrar en el header. Ej: `midudev`. |
| `OLLAMA_URL` | `http://localhost:11434` | URL de tu instancia de Ollama. Puede apuntar a otra máquina de la LAN. |
| `OLLAMA_MODEL` | `qwen2.5-coder:3b` | Modelo a usar. Tiene que estar `ollama pull` previamente. |
| `SENTINEL_INTERVAL_MS` | `1800000` (30 min) | Cada cuánto hacer el barrido. |
| `SENTINEL_DB_PATH` | `data/sentinel.db` | Ruta al SQLite. Puede ser absoluta. |
| `PORT` | `3741` | Puerto del servidor. |
| `HOST` | `0.0.0.0` | Interfaz a la que bindear. Déjalo así para acceder desde la LAN. |

> Token recomendado: [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new) → "Only select repositories" → solo los que quieras vigilar → permisos `Issues: Read-only` y `Metadata: Read-only`.

---

## Endpoints

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/api/health` | Healthcheck simple (uptime, pid, plataforma). Útil para monitorización externa. |
| `GET` | `/api/status` | Estado completo: contadores, ollama, último scan. |
| `GET` | `/api/repos` | Lista repos vigilados. |
| `POST` | `/api/repos` | Añadir repo. Body: `{ "repo": "owner/name" }`. |
| `DELETE` | `/api/repos/:id` | Dejar de vigilar. |
| `GET` | `/api/issues?limit=N` | Issues con su análisis. |
| `POST` | `/api/issues/:id/analyze` | Forzar análisis LLM de una issue. |
| `POST` | `/api/check` | Disparar un scan inmediato. |

---

## Estructura del proyecto

```
src/
  server/
    index.ts        # Bun.serve + rutas + shutdown handler
    db.ts           # bun:sqlite, schema y queries preparadas
    github.ts       # cliente GitHub REST (fetch, sin Octokit)
    llm.ts          # cliente Ollama, JSON forzado
    sentinel.ts     # scheduler de polling + analyzer en background
  client/
    index.html
    main.tsx        # entry React
    App.tsx
    api.ts          # cliente tipado del API
    styles.css      # @font-face + @theme Tailwind 4
    utils.ts
    fonts/          # Geist Pixel + Geist Mono (.woff2)
    components/
      Header.tsx
      Stats.tsx
      AddRepoForm.tsx
      RepoList.tsx
      IssueCard.tsx
public/
  favicon.svg
scripts/
  service.ts             # wrapper cross-platform (Windows/macOS)
  win/
    install.ps1          # NSSM install
    uninstall.ps1        # NSSM uninstall
  macos/
    sentinel.plist.template  # plantilla launchd
data/                # generado en runtime (sqlite + logs)
```

---

## Gestionar el servicio (Windows y macOS)

Todo se hace con un único set de scripts de `package.json`. El wrapper
[`scripts/service.ts`](./scripts/service.ts) detecta la plataforma y delega
en el backend correcto: **NSSM en Windows**, **launchd en macOS**.

```bash
bun service:install     # instala y arranca como servicio del sistema
bun service:uninstall   # detiene, desinstala y opcionalmente borra data/
bun service:start
bun service:stop
bun service:restart
bun service:status
bun service:logs        # tail -f del log en data/sentinel.log
```

En ambos sistemas, al instalar:

- El servicio queda configurado para **arrancar automáticamente** al iniciar el equipo.
- Si el proceso cae, se **reinicia solo** (NSSM en Windows, `KeepAlive` en launchd).
- **Logs** centralizados en `data/sentinel.log`.
- El stop envía **SIGTERM**, no `kill -9`, así que el shutdown handler cierra SQLite limpio.

### Requisitos en Windows

1. [Bun para Windows](https://bun.com/docs/installation#windows) en el PATH (`%USERPROFILE%\.bun\bin\bun.exe`).
2. [NSSM](https://nssm.cc/download) en el PATH:
   - Chocolatey: `choco install nssm`
   - Scoop: `scoop install nssm`
3. PowerShell **elevado** (Administrador) para `service:install` y `service:uninstall`.

```powershell
# Desde la carpeta del proyecto, en PowerShell admin:
bun install
bun service:install
```

El backend Windows ejecuta [`scripts/win/install.ps1`](./scripts/win/install.ps1)
que registra el servicio `GitHubSentinel` con NSSM:

- Ejecutable: `bun.exe src/server/index.ts`
- Logs rotados: `data\sentinel.log`, max 5 MB o 24 h por archivo.
- Stop con Ctrl+C con 10 s de gracia, kill del árbol de procesos si no responde.
- Reinicio automático tras 5 s si cae.

### Requisitos en macOS

1. Bun instalado (lo detecta en `~/.bun/bin/bun`, Homebrew o `/usr/local`).
2. Nada más. No requiere `sudo` porque el servicio se instala como **LaunchAgent**
   del usuario (`~/Library/LaunchAgents/com.midudev.github-sentinel.plist`).

```bash
bun install
bun service:install
```

El backend macOS renderiza el plist desde [`scripts/macos/sentinel.plist.template`](./scripts/macos/sentinel.plist.template),
sustituye `__PROJECT_DIR__`, `__BUN_PATH__` y `__PATH__`, lo copia a
`~/Library/LaunchAgents/` y hace `launchctl load -w`. `KeepAlive=true` y
`RunAtLoad=true` se encargan del resto.

### Personalizar el nombre del servicio (Windows)

Si quieres llamarlo de otra forma:

```powershell
$env:SENTINEL_SERVICE_NAME = "MiSentinel"
bun service:install
```

### Comandos avanzados (si los necesitas)

Si prefieres saltarte el wrapper, puedes invocar los scripts directamente:

```powershell
# Windows
.\scripts\win\install.ps1   -ServiceName GitHubSentinel
.\scripts\win\uninstall.ps1 -KeepData
```

```bash
# macOS
launchctl list | grep github-sentinel
launchctl unload -w ~/Library/LaunchAgents/com.midudev.github-sentinel.plist
```

### Otras alternativas en Windows (sin NSSM)

Si no quieres NSSM, tienes dos opciones manuales:

**Tarea Programada**: `taskschd.msc` → crear tarea "Al iniciar el equipo" →
ejecutar `C:\Users\TU_USUARIO\.bun\bin\bun.exe src/server/index.ts` desde
la carpeta del proyecto. En propiedades marca "Ejecutar con los privilegios
más altos" y "Reiniciar si falla".

**PM2**:
```powershell
npm i -g pm2 pm2-windows-startup
pm2-startup install
pm2 start "bun src/server/index.ts" --name github-sentinel --cwd C:\ruta\github-sentinel
pm2 save
```

---

## Notas para Windows

- **WAL en SSD local**. SQLite usa modo WAL (más rápido y resistente a cortes). No pongas el `data/` en OneDrive, Dropbox ni unidades de red, no es seguro con WAL.
- **Windows Defender**. Excluye la carpeta `data\` de escaneo en tiempo real, si no se pondrá a leer el `.db-wal` constantemente y notarás latencia.
- **Firewall**. Para acceder al dashboard desde otro equipo de la LAN:
  ```powershell
  New-NetFirewallRule -DisplayName "GitHub Sentinel" -Direction Inbound -Protocol TCP -LocalPort 3741 -Action Allow
  ```
  Luego: `http://IP-DEL-MINIPC:3741`.
- **Suspensión**. Desactívala en Configuración → Sistema → Inicio/apagado → "Nunca" para PC y para suspensión.
- **Ollama**. Si lo instalas en el mismo MiniPC, el default (`http://localhost:11434`) funciona. Si vive en otra máquina, pon `OLLAMA_URL=http://192.168.x.x:11434` en `.env` y abre el puerto 11434 en su firewall.

---

## Scripts disponibles

```bash
# Desarrollo
bun dev                  # servidor con HMR
bun start                # producción simple
bun start:prod           # producción con NODE_ENV=production
bun build                # build estático del cliente (opcional)

# Gestión del servicio (Windows + macOS)
bun service:install      # instala y arranca como servicio del sistema
bun service:uninstall    # desinstala (pregunta si borrar data/)
bun service:start
bun service:stop
bun service:restart
bun service:status
bun service:logs         # tail -f data/sentinel.log
```

---

## Roadmap

- v0.2 — clonar repo y aportar contexto real al LLM (ripgrep + heurística)
- v0.3 — ejecutar tests en Docker para validar propuestas
- v0.4 — generar patch (`git diff`) en lugar de prosa
- v0.5 — abrir PR en draft desde el sentinel
- v0.6 — soporte de webhooks (push-based en vez de polling)
- v0.7 — notificaciones a Telegram / Discord

---

## Licencia

MIT
