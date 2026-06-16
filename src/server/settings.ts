export type SettingMeta = {
  key: string;
  label: string;
  category: "github" | "llm" | "monitoring" | "context" | "whatsapp" | "server";
  type: "text" | "password" | "number" | "boolean" | "cron" | "select";
  options?: string[];
  hotReload: boolean;
  value: string;
  fallback: string;
  source: "env" | "db" | "default";
};

const SETTINGS_DEFS: Omit<SettingMeta, "value" | "source">[] = [
  { key: "github_token", label: "GitHub Token", category: "github", type: "password", hotReload: false, fallback: "" },
  { key: "github_user", label: "GitHub User", category: "github", type: "text", hotReload: true, fallback: "" },
  { key: "llm_backend", label: "Backend LLM", category: "llm", type: "select", options: ["openai", "ollama"], hotReload: true, fallback: "openai" },
  { key: "llm_url", label: "LLM URL", category: "llm", type: "text", hotReload: true, fallback: "http://localhost:1234/v1" },
  { key: "llm_model", label: "Modelo", category: "llm", type: "text", hotReload: true, fallback: "local-model" },
  { key: "llm_api_key", label: "LLM API Key", category: "llm", type: "password", hotReload: true, fallback: "sentinel-local" },
  { key: "llm_max_context_tokens", label: "Contexto máx (tokens)", category: "llm", type: "number", hotReload: true, fallback: "4096" },
  { key: "llm_max_output_tokens", label: "Output máx (tokens)", category: "llm", type: "number", hotReload: true, fallback: "400" },
  { key: "sentinel_interval_ms", label: "Intervalo de scan (ms)", category: "monitoring", type: "number", hotReload: true, fallback: "1800000" },
  { key: "sentinel_scan_on_start", label: "Scan al iniciar", category: "monitoring", type: "boolean", hotReload: false, fallback: "false" },
  { key: "sentinel_repos_dir", label: "Directorio de clones", category: "context", type: "text", hotReload: false, fallback: "data/repos" },
  { key: "sentinel_context_tokens", label: "Contexto código (tokens)", category: "context", type: "number", hotReload: true, fallback: "1024" },
  { key: "sentinel_context_cache_ttl_ms", label: "Cache TTL (ms)", category: "context", type: "number", hotReload: true, fallback: "300000" },
  { key: "sentinel_pull_cooldown_ms", label: "Cooldown git pull (ms)", category: "context", type: "number", hotReload: true, fallback: "300000" },
  { key: "sentinel_clone_depth", label: "Profundidad clone", category: "context", type: "number", hotReload: false, fallback: "1" },
  { key: "clone_cache_auto_cleanup", label: "Auto-cleanup caché clones", category: "context", type: "boolean", hotReload: true, fallback: "false" },
  { key: "clone_cache_max_age_hours", label: "Edad máx clones (horas)", category: "context", type: "number", hotReload: true, fallback: "72" },
  { key: "whs_phone", label: "Teléfono WhatsApp", category: "whatsapp", type: "text", hotReload: true, fallback: "" },
  { key: "whs_api_key", label: "CallMeBot API Key", category: "whatsapp", type: "password", hotReload: true, fallback: "" },
  { key: "whs_enabled", label: "WhatsApp activo", category: "whatsapp", type: "boolean", hotReload: true, fallback: "true" },
  { key: "whs_timezone", label: "Zona horaria", category: "whatsapp", type: "text", hotReload: true, fallback: "Europe/Madrid" },
  { key: "whs_digest_cron", label: "Cron digest", category: "whatsapp", type: "cron", hotReload: true, fallback: "0 9,18 * * *" },
  { key: "whs_send_interval_ms", label: "Intervalo entre msgs (ms)", category: "whatsapp", type: "number", hotReload: true, fallback: "5000" },
  { key: "port", label: "Puerto", category: "server", type: "number", hotReload: false, fallback: "3741" },
  { key: "host", label: "Host", category: "server", type: "text", hotReload: false, fallback: "127.0.0.1" },
];

const ENV_MAP: Record<string, string> = {
  github_token: "GITHUB_TOKEN",
  github_user: "GITHUB_USER",
  llm_backend: "LLM_BACKEND",
  llm_url: "LLM_URL",
  llm_model: "LLM_MODEL",
  llm_api_key: "LLM_API_KEY",
  llm_max_context_tokens: "LLM_MAX_CONTEXT_TOKENS",
  llm_max_output_tokens: "LLM_MAX_OUTPUT_TOKENS",
  sentinel_interval_ms: "SENTINEL_INTERVAL_MS",
  sentinel_scan_on_start: "SENTINEL_SCAN_ON_START",
  sentinel_repos_dir: "SENTINEL_REPOS_DIR",
  sentinel_context_tokens: "SENTINEL_CONTEXT_TOKENS",
  sentinel_context_cache_ttl_ms: "SENTINEL_CONTEXT_CACHE_TTL_MS",
  sentinel_pull_cooldown_ms: "SENTINEL_PULL_COOLDOWN_MS",
  sentinel_clone_depth: "SENTINEL_CLONE_DEPTH",
  whs_phone: "WHATSAPP_PHONE",
  whs_api_key: "CALLMEBOT_API_KEY",
  whs_enabled: "WHATSAPP_ENABLED",
  whs_timezone: "WHATSAPP_TIMEZONE",
  whs_digest_cron: "WHATSAPP_DIGEST_CRON",
  whs_send_interval_ms: "WHATSAPP_SEND_INTERVAL_MS",
  clone_cache_auto_cleanup: "",
  clone_cache_max_age_hours: "",
  port: "PORT",
  host: "HOST",
};

import { db, queries } from "./db";

function readDbValue(key: string): string | null {
  try {
    return queries.getSetting.get(key)?.value ?? null;
  } catch {
    return null;
  }
}

export function getAllSettings(): SettingMeta[] {
  return SETTINGS_DEFS.map((def) => {
    const dbVal = readDbValue(def.key);
    const envVal = ENV_MAP[def.key] ? (process.env[ENV_MAP[def.key]] ?? undefined) : undefined;

    if (dbVal !== null) {
      return { ...def, value: dbVal, source: "db" };
    }
    if (envVal !== undefined && envVal !== "") {
      return { ...def, value: envVal, source: "env" };
    }
    return { ...def, value: def.fallback, source: "default" };
  });
}

export function getSetting(key: string): string | null {
  const dbVal = readDbValue(key);
  if (dbVal !== null) return dbVal;

  const envName = ENV_MAP[key];
  if (envName && process.env[envName]) return process.env[envName]!;

  const def = SETTINGS_DEFS.find((d) => d.key === key);
  return def?.fallback ?? null;
}

export function setSetting(key: string, value: string): boolean {
  try {
    const def = SETTINGS_DEFS.find((d) => d.key === key);
    if (!def) return false;

    queries.setSetting.run(key, value);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[settings] error guardando ${key}: ${msg}`);
    return false;
  }
}

export function getLLMBaseUrl(): string {
  const raw = getSetting("llm_url");
  const backend = getSetting("llm_backend") ?? "openai";
  const defaults: Record<string, string> = {
    openai: "http://localhost:1234/v1",
    ollama: "http://localhost:11434/v1",
  };
  if (!raw || raw === defaults.openai || raw === defaults.ollama) {
    return (defaults[backend] ?? defaults.openai).replace(/\/$/, "");
  }
  return raw.replace(/\/$/, "");
}

export function getLLMModel(): string {
  return getSetting("llm_model") ?? "local-model";
}

export function getLLMApiKey(): string {
  return getSetting("llm_api_key") ?? "sentinel-local";
}

export function getLLMMaxContextTokens(): number {
  return Number(getSetting("llm_max_context_tokens") ?? 4096);
}

export function getLLMMaxOutputTokens(): number {
  return Number(getSetting("llm_max_output_tokens") ?? 400);
}

export type LLMModelInfo = {
  id: string;
  name: string;
};

function resolveLLMBaseUrl(opts?: { backend?: string; url?: string }): string {
  const backend = opts?.backend ?? getSetting("llm_backend") ?? "openai";
  const raw = opts?.url ?? getSetting("llm_url");
  const defaults: Record<string, string> = {
    openai: "http://localhost:1234/v1",
    ollama: "http://localhost:11434/v1",
  };
  if (!raw || raw === defaults.openai || raw === defaults.ollama) {
    return (defaults[backend] ?? defaults.openai).replace(/\/$/, "");
  }
  return raw.replace(/\/$/, "");
}

export async function fetchLLMModels(opts?: { backend?: string; url?: string }): Promise<LLMModelInfo[]> {
  const baseUrl = resolveLLMBaseUrl(opts);
  const backend = opts?.backend ?? getSetting("llm_backend") ?? "openai";
  const apiKey = getLLMApiKey();

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (backend !== "ollama") {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    const res = await fetch(`${baseUrl}/models`, {
      headers,
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return [];

    const data = (await res.json()) as Record<string, unknown>;

    if (Array.isArray(data.data)) {
      return (data.data as Array<{ id: string; name?: string }>).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
      }));
    }

    if (Array.isArray(data.models)) {
      return (data.models as Array<{ name: string; model?: string }>).map((m) => {
        const id = m.model ?? m.name;
        return {
          id,
          name: m.name.replace(/:latest$/, ""),
        };
      });
    }

    return [];
  } catch (err) {
    console.warn(`[settings] error fetching models from ${baseUrl}/models:`, err instanceof Error ? err.message : String(err));
    return [];
  }
}
