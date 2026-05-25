#!/usr/bin/env bun
/**
 * Cross-platform wrapper for the GitHub Sentinel system service.
 *
 *   bun service:install      install + start
 *   bun service:uninstall    stop + remove
 *   bun service:start
 *   bun service:stop
 *   bun service:restart
 *   bun service:status
 *   bun service:logs         tail -f the log file
 *
 * Windows backend: NSSM (via scripts/win/*.ps1)
 * macOS   backend: launchd (via scripts/macos/sentinel.plist.template)
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_DIR = resolve(import.meta.dir, "..");
const SERVICE_NAME = process.env.SENTINEL_SERVICE_NAME ?? "GitHubSentinel";
const MACOS_LABEL = "com.midudev.github-sentinel";
const LOG_FILE = join(PROJECT_DIR, "data", "sentinel.log");

const ACTIONS = [
  "install",
  "uninstall",
  "start",
  "stop",
  "restart",
  "status",
  "logs",
] as const;
type Action = (typeof ACTIONS)[number];

function fail(msg: string, code = 1): never {
  console.error(`\x1b[31mERROR\x1b[0m ${msg}`);
  process.exit(code);
}

function info(msg: string) {
  console.log(`\x1b[36m→\x1b[0m ${msg}`);
}

function ok(msg: string) {
  console.log(`\x1b[32m✓\x1b[0m ${msg}`);
}

async function run(cmd: string[], opts: { check?: boolean } = {}) {
  const proc = Bun.spawn(cmd, {
    cwd: PROJECT_DIR,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (opts.check !== false && code !== 0) {
    fail(`comando falló (exit ${code}): ${cmd.join(" ")}`, code);
  }
  return code;
}

async function capture(cmd: string[]): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(cmd, {
    cwd: PROJECT_DIR,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const code = await proc.exited;
  return { code, stdout };
}

// ─────────────────────────── Windows backend ───────────────────────────

const WIN_INSTALL = join(PROJECT_DIR, "scripts", "win", "install.ps1");
const WIN_UNINSTALL = join(PROJECT_DIR, "scripts", "win", "uninstall.ps1");

function powershell(args: string[]) {
  return run([
    "powershell.exe",
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    ...args,
  ]);
}

const windowsBackend = {
  async install() {
    info(`ejecutando ${WIN_INSTALL} (requiere PowerShell elevado)`);
    await powershell(["-File", WIN_INSTALL, "-ServiceName", SERVICE_NAME]);
  },
  async uninstall() {
    info(`ejecutando ${WIN_UNINSTALL}`);
    await powershell(["-File", WIN_UNINSTALL, "-ServiceName", SERVICE_NAME]);
  },
  async start() {
    await powershell(["-Command", `Start-Service '${SERVICE_NAME}'`]);
    ok(`servicio '${SERVICE_NAME}' arrancado`);
  },
  async stop() {
    await powershell(["-Command", `Stop-Service '${SERVICE_NAME}'`]);
    ok(`servicio '${SERVICE_NAME}' detenido`);
  },
  async restart() {
    await powershell(["-Command", `Restart-Service '${SERVICE_NAME}'`]);
    ok(`servicio '${SERVICE_NAME}' reiniciado`);
  },
  async status() {
    await powershell([
      "-Command",
      `Get-Service '${SERVICE_NAME}' | Format-List Name,Status,StartType,DisplayName`,
    ]);
  },
  async logs() {
    if (!existsSync(LOG_FILE)) {
      fail(`No existe el log todavía: ${LOG_FILE}\n¿Está instalado el servicio? Prueba: bun service:install`);
    }
    info(`tail -f ${LOG_FILE}  (Ctrl+C para salir)`);
    await powershell([
      "-Command",
      `Get-Content -Path '${LOG_FILE}' -Wait -Tail 50`,
    ]);
  },
};

// ─────────────────────────── macOS backend ───────────────────────────

const PLIST_TEMPLATE = join(PROJECT_DIR, "scripts", "macos", "sentinel.plist.template");
const LAUNCHAGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_DEST = join(LAUNCHAGENTS_DIR, `${MACOS_LABEL}.plist`);

function findBunPath(): string {
  if (process.execPath && process.execPath.endsWith("bun")) {
    return process.execPath;
  }
  const candidates = [
    join(homedir(), ".bun", "bin", "bun"),
    "/opt/homebrew/bin/bun",
    "/usr/local/bin/bun",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  fail("No encuentro el binario de bun. Define SENTINEL_BUN_PATH o reinstala Bun.");
}

const macosBackend = {
  async install() {
    if (!existsSync(LAUNCHAGENTS_DIR)) {
      mkdirSync(LAUNCHAGENTS_DIR, { recursive: true });
    }

    mkdirSync(join(PROJECT_DIR, "data"), { recursive: true });

    const bunPath = process.env.SENTINEL_BUN_PATH ?? findBunPath();
    info(`bun: ${bunPath}`);
    info(`proyecto: ${PROJECT_DIR}`);

    const template = readFileSync(PLIST_TEMPLATE, "utf-8");
    const plist = template
      .replaceAll("__LABEL__", MACOS_LABEL)
      .replaceAll("__PROJECT_DIR__", PROJECT_DIR)
      .replaceAll("__BUN_PATH__", bunPath)
      .replaceAll("__PATH__", process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin");

    writeFileSync(PLIST_DEST, plist, "utf-8");
    info(`plist escrito en ${PLIST_DEST}`);

    await capture(["launchctl", "unload", PLIST_DEST]);
    await run(["launchctl", "load", "-w", PLIST_DEST]);
    ok(`servicio cargado como ${MACOS_LABEL}`);
    ok(`logs: ${LOG_FILE}`);
  },

  async uninstall() {
    if (!existsSync(PLIST_DEST)) {
      info(`no hay plist instalado en ${PLIST_DEST}, nada que hacer`);
      return;
    }
    await capture(["launchctl", "unload", "-w", PLIST_DEST]);
    rmSync(PLIST_DEST);
    ok(`servicio desinstalado (${PLIST_DEST} eliminado)`);
  },

  async start() {
    if (!existsSync(PLIST_DEST)) {
      fail("El servicio no está instalado. Ejecuta: bun service:install");
    }
    await capture(["launchctl", "unload", PLIST_DEST]);
    await run(["launchctl", "load", "-w", PLIST_DEST]);
    ok(`servicio ${MACOS_LABEL} arrancado`);
  },

  async stop() {
    if (!existsSync(PLIST_DEST)) {
      fail("El servicio no está instalado.");
    }
    await run(["launchctl", "unload", "-w", PLIST_DEST]);
    ok(`servicio ${MACOS_LABEL} detenido`);
  },

  async restart() {
    if (!existsSync(PLIST_DEST)) {
      fail("El servicio no está instalado. Ejecuta: bun service:install");
    }
    await capture(["launchctl", "unload", "-w", PLIST_DEST]);
    await new Promise((r) => setTimeout(r, 500));
    await run(["launchctl", "load", "-w", PLIST_DEST]);
    ok(`servicio ${MACOS_LABEL} reiniciado`);
  },

  async status() {
    const { stdout } = await capture(["launchctl", "list"]);
    const line = stdout.split("\n").find((l) => l.includes(MACOS_LABEL));
    if (!line) {
      console.log(`Servicio ${MACOS_LABEL} NO está cargado.`);
      console.log(`Instálalo con: bun service:install`);
      return;
    }
    const [pid, exit, label] = line.trim().split(/\s+/);
    const installed = existsSync(PLIST_DEST);
    console.log(`label:     ${label}`);
    console.log(`pid:       ${pid === "-" ? "(parado)" : pid}`);
    console.log(`last exit: ${exit}`);
    console.log(`plist:     ${installed ? PLIST_DEST : "(no encontrado)"}`);
  },

  async logs() {
    if (!existsSync(LOG_FILE)) {
      fail(`No existe el log todavía: ${LOG_FILE}\n¿Está instalado el servicio? Prueba: bun service:install`);
    }
    info(`tail -f ${LOG_FILE}  (Ctrl+C para salir)`);
    await run(["tail", "-n", "50", "-f", LOG_FILE]);
  },
};

// ─────────────────────────── entry ───────────────────────────

function usage(): never {
  console.log(`uso:  bun scripts/service.ts <${ACTIONS.join("|")}>`);
  console.log(`o desde package.json:  bun service:install / service:logs / ...`);
  process.exit(1);
}

const action = process.argv[2] as Action | undefined;
if (!action || !ACTIONS.includes(action)) usage();

const backend = (() => {
  switch (platform()) {
    case "win32":
      return windowsBackend;
    case "darwin":
      return macosBackend;
    default:
      fail(
        `Plataforma '${platform()}' no soportada para gestión de servicio.\n` +
          `Soportadas: win32 (NSSM), darwin (launchd).\n` +
          `Puedes correr el sentinel manualmente con: bun start`
      );
  }
})();

await backend[action]();
