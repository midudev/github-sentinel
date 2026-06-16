import { useCallback, useEffect, useState } from "react";
import {
  api,
  type SettingMeta,
  type ModelsResponse,
  type CloneCacheStatus,
} from "../api";

type Props = {
  onClose: () => void;
};

const CATEGORY_LABELS: Record<string, string> = {
  github: "GitHub API",
  llm: "LLM",
  monitoring: "Monitor",
  context: "Contexto",
  whatsapp: "WhatsApp",
  server: "Servidor",
};

const CATEGORY_ORDER = [
  "github",
  "llm",
  "monitoring",
  "context",
  "whatsapp",
  "server",
];

function useSetting() {
  const [settings, setSettings] = useState<SettingMeta[]>([]);
  const [dirty, setDirty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [models, setModels] = useState<ModelsResponse | null>(null);
  const [loadingModels, setLoadingModels] = useState(false);
  const [cacheInfo, setCacheInfo] = useState<CloneCacheStatus | null>(null);
  const [purging, setPurging] = useState(false);
  const [testResults, setTestResults] = useState<
    Record<string, "testing" | "ok" | "fail">
  >({});

  useEffect(() => {
    api
      .settings()
      .then((r) => setSettings(r.settings))
      .catch(() => {});
    loadModels();
    loadCacheInfo();
  }, []);

  const loadModels = async () => {
    setLoadingModels(true);
    try {
      const params: Record<string, string> = {};
      if (dirty.llm_backend) params.backend = dirty.llm_backend;
      if (dirty.llm_url) params.url = dirty.llm_url;
      const r = await api.listModels(params);
      setModels(r);
    } catch {}
    setLoadingModels(false);
  };

  const loadCacheInfo = async () => {
    try {
      const r = await api.cloneCacheStatus();
      setCacheInfo(r);
    } catch {}
  };

  const purgeCache = async () => {
    setPurging(true);
    try {
      const r = await api.purgeClones();
      setSuccess(`${r.deleted} clones eliminados`);
      setTimeout(() => setSuccess(null), 3000);
      await loadCacheInfo();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setPurging(false);
  };

  const currentValue = useCallback(
    (key: string) => {
      if (dirty[key] !== undefined) return dirty[key];
      return settings.find((s) => s.key === key)?.value ?? "";
    },
    [dirty, settings],
  );

  const setVal = (key: string, val: string) => {
    setDirty((prev) => ({ ...prev, [key]: val }));
  };

  const hasChanges = Object.keys(dirty).length > 0;

  const save = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      let lastResult: { settings: SettingMeta[] } | null = null;
      for (const [key, value] of Object.entries(dirty)) {
        const r = await api.updateSetting(key, value);
        lastResult = r;
      }
      if (lastResult) {
        setSettings(lastResult.settings);
      }
      setDirty({});
      setSuccess("Configuración guardada");
      setTimeout(() => setSuccess(null), 3000);
      loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
    setSaving(false);
  };

  const testLLM = async () => {
    setTestResults((prev) => ({ ...prev, llm: "testing" }));
    try {
      const r = await api.listModels();
      if (r.models.length > 0) {
        setTestResults((prev) => ({ ...prev, llm: "ok" }));
      } else {
        setTestResults((prev) => ({ ...prev, llm: "fail" }));
      }
    } catch {
      setTestResults((prev) => ({ ...prev, llm: "fail" }));
    }
  };

  const testGitHub = async () => {
    setTestResults((prev) => ({ ...prev, github: "testing" }));
    try {
      const s = await api.status();
      setTestResults((prev) => ({
        ...prev,
        github: s.repos >= 0 ? "ok" : "fail",
      }));
    } catch {
      setTestResults((prev) => ({ ...prev, github: "fail" }));
    }
  };

  const restartNeeded = Object.entries(dirty).some(
    ([key]) => !settings.find((s) => s.key === key)?.hotReload,
  );

  return {
    models,
    testLLM,
    testGitHub,
    restartNeeded,
    hasChanges,
    save,
    loadModels,
    currentValue,
    testResults,
    success,
    error,
    saving,
    loadingModels,
    settings,
    setVal,
    cacheInfo,
    purgeCache,
    purging,
    loadCacheInfo,
  };
}

export function SettingsModal({ onClose }: Props) {
  const {
    currentValue,
    error,
    hasChanges,
    loadModels,
    loadingModels,
    models,
    restartNeeded,
    save,
    saving,
    success,
    testGitHub,
    testLLM,
    settings,
    testResults,
    setVal,
    cacheInfo,
    purgeCache,
    purging,
    loadCacheInfo,
  } = useSetting();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-0/80 backdrop-blur">
      <div className="w-full max-w-2xl max-h-[80vh] overflow-y-auto border border-ink-3 bg-ink-1 shadow-2xl">
        <div className="sticky top-0 bg-ink-1 border-b border-ink-3 px-6 py-4 flex items-center gap-3 z-10">
          <span className="font-pixel text-lg text-fg-1 glow">⚙ SETTINGS</span>
          <span className="flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="font-pixel text-xs px-2 py-1 border border-ink-3 text-fg-3 hover:border-fg-3 transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="border border-danger bg-danger/10 px-4 py-2 text-sm text-danger">
              {error}
            </div>
          )}
          {success && (
            <div className="border border-accent bg-accent/10 px-4 py-2 text-sm text-accent">
              {success}
            </div>
          )}

          {CATEGORY_ORDER.map((cat) => {
            const catSettings = settings.filter((s) => s.category === cat);
            if (catSettings.length === 0) return null;
            return (
              <section key={cat}>
                <h2 className="flex items-center gap-3 mb-4">
                  <span className="font-pixel text-xs text-accent">
                    {CATEGORY_ORDER.indexOf(cat) + 1}
                  </span>
                  <span className="font-pixel uppercase text-xs text-fg-1 tracking-wider">
                    {CATEGORY_LABELS[cat]}
                  </span>
                  <span className="flex-1 h-px bg-ink-3" />
                </h2>

                <div className="space-y-3">
                  {cat === "llm" && (
                    <div className="mb-3">
                      <div className="mb-3">
                        <label className="block text-[10px] uppercase tracking-[0.18em] text-fg-4 mb-1.5">
                          Provider
                        </label>
                        <select
                          value={currentValue("llm_backend")}
                          onChange={(e) => {
                            const b = e.target.value;
                            setVal("llm_backend", b);
                            const url = currentValue("llm_url");
                            const defaults: Record<string, string> = {
                              openai: "http://localhost:1234/v1",
                              ollama: "http://localhost:11434/v1",
                            };
                            if (
                              !url ||
                              url === defaults.openai ||
                              url === defaults.ollama
                            ) {
                              setVal("llm_url", defaults[b] ?? defaults.openai);
                            }
                          }}
                          className="w-full bg-ink-2 border border-ink-3 text-sm text-fg-1 px-3 py-2 outline-none focus:border-accent appearance-none font-mono"
                        >
                          <option value="openai">
                            OpenAI-compatible (LM Studio, vLLM…)
                          </option>
                          <option value="ollama">Ollama</option>
                        </select>
                      </div>
                      <div className="mb-3">
                        <label className="block text-[10px] uppercase tracking-[0.18em] text-fg-4 mb-1.5">
                          Modelo
                        </label>
                        <select
                          value={currentValue("llm_model")}
                          onChange={(e) => setVal("llm_model", e.target.value)}
                          className="w-full bg-ink-2 border border-ink-3 text-sm text-fg-1 px-3 py-2 outline-none focus:border-accent appearance-none font-mono"
                        >
                          <option value="">Selecciona un modelo…</option>
                          {models?.models.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="flex items-center gap-2 mb-3">
                        <button
                          type="button"
                          onClick={loadModels}
                          className="font-pixel uppercase text-[10px] px-2.5 py-1.5 border border-ink-3 text-fg-3 hover:border-fg-3 transition-colors"
                        >
                          {loadingModels ? "cargando..." : "recargar modelos"}
                        </button>
                        <button
                          type="button"
                          onClick={testLLM}
                          className="font-pixel uppercase text-[10px] px-2.5 py-1.5 border border-ink-3 text-fg-3 hover:border-fg-3 transition-colors"
                        >
                          {testResults.llm === "testing"
                            ? "probando..."
                            : "test conexión"}
                        </button>
                        {testResults.llm === "ok" && (
                          <span className="text-[var(--color-accent)] text-xs">
                            ✓ {models?.models.length ?? 0} modelos
                          </span>
                        )}
                        {testResults.llm === "fail" && (
                          <span className="text-danger text-xs">✗ error</span>
                        )}
                      </div>
                    </div>
                  )}

                  {cat === "github" && (
                    <div className="flex items-center gap-2 mb-3">
                      <button
                        type="button"
                        onClick={testGitHub}
                        className="font-pixel uppercase text-[10px] px-2.5 py-1.5 border border-ink-3 text-fg-3 hover:border-fg-3 transition-colors"
                      >
                        {testResults.github === "testing"
                          ? "probando..."
                          : "test conexión"}
                      </button>
                      {testResults.github === "ok" && (
                        <span className="text-accent text-xs">✓ ok</span>
                      )}
                      {testResults.github === "fail" && (
                        <span className="text-danger text-xs">✗ error</span>
                      )}
                    </div>
                  )}

                  {catSettings
                    .filter(
                      (s) => s.key !== "llm_model" && s.key !== "llm_backend",
                    )
                    .map((setting) => (
                      <SettingRow
                        key={setting.key}
                        setting={setting}
                        value={currentValue(setting.key)}
                        onChange={(v) => setVal(setting.key, v)}
                      />
                    ))}

                  {cat === "context" && (
                    <div className="mt-4 pt-4 border-t border-[var(--color-ink-3)]">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-4)]">
                          Caché de clones local
                        </span>
                        <span className="flex-1 h-px bg-[var(--color-ink-3)]" />
                      </div>

                      {cacheInfo ? (
                        <div className="text-[11px] text-[var(--color-fg-3)] mb-3 space-y-1">
                          <span className="block">
                            {cacheInfo.repoCount} repos ·{" "}
                            {cacheInfo.totalSizeMb} MB
                            {cacheInfo.oldestHours !== null &&
                              ` · más viejo ${cacheInfo.oldestHours}h`}
                          </span>
                        </div>
                      ) : (
                        <div className="text-[11px] text-[var(--color-fg-4)] mb-3">
                          cargando…
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            if (
                              window.confirm(
                                "¿Eliminar todos los clones locales? Se regenerarán en el próximo scan.",
                              )
                            ) {
                              purgeCache();
                            }
                          }}
                          disabled={
                            purging || (cacheInfo?.repoCount ?? 0) === 0
                          }
                          className="font-pixel uppercase text-[10px] px-2.5 py-1.5 border border-[var(--color-danger)] text-[var(--color-danger)] hover:bg-[var(--color-danger)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {purging ? "eliminando..." : "🗑 limpiar caché"}
                        </button>
                        <button
                          type="button"
                          onClick={loadCacheInfo}
                          className="font-pixel uppercase text-[10px] px-2.5 py-1.5 border border-[var(--color-ink-3)] text-[var(--color-fg-3)] hover:border-[var(--color-fg-3)] transition-colors"
                        >
                          refrescar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </section>
            );
          })}

          {restartNeeded && (
            <div className="border border-dashed border-warn px-4 py-3 text-xs text-warn">
              ⚠ Algunos cambios requieren reinicio del servidor para aplicarse
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-ink-1 border-t border-ink-3 px-6 py-4 flex items-center gap-3 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="font-pixel uppercase text-xs px-4 py-2 border border-ink-3 text-fg-3 hover:border-fg-3 transition-colors"
          >
            cerrar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!hasChanges || saving}
            className="font-pixel uppercase text-xs px-4 py-2 border border-accent text-accent hover:bg-accent hover:text-ink-0 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {saving ? "guardando..." : "guardar"}
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingRow({
  setting,
  value,
  onChange,
}: {
  setting: SettingMeta;
  value: string;
  onChange: (v: string) => void;
}) {
  const [show, setShow] = useState(false);

  const isDirty = value !== setting.value && value !== setting.fallback;

  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <label className="block text-[10px] uppercase tracking-[0.18em] text-color-fg-4 mb-1">
          {setting.label}
        </label>
        {setting.type === "boolean" ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onChange(value === "true" ? "false" : "true")}
              className={`font-pixel uppercase text-[10px] px-2.5 py-1.5 border transition-colors ${
                value === "true"
                  ? "border-accent text-accent bg-ink-2"
                  : "border-ink-3 text-fg-3"
              }`}
            >
              {value === "true" ? "✓ activo" : "✗ inactivo"}
            </button>
          </div>
        ) : setting.type === "cron" ? (
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-[var(--color-ink-2)] border border-ink-3 text-sm text-fg-1 px-3 py-2 outline-none focus:border-accent font-mono"
          />
        ) : setting.type === "select" && setting.options ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full bg-[var(--color-ink-2)] border border-[var(--color-ink-3)] text-sm text-[var(--color-fg-1)] px-3 py-2 outline-none focus:border-[var(--color-accent)] appearance-none font-mono"
          >
            {setting.options.map((opt) => (
              <option key={opt} value={opt}>
                {opt === "openai" ? "OpenAI-compatible" : "Ollama"}
              </option>
            ))}
          </select>
        ) : (
          <div className="flex items-center border border-ink-3 focus-within:border-accent bg-ink-2">
            <input
              type={setting.type === "password" && !show ? "password" : "text"}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              className="flex-1 bg-transparent border-0 outline-none text-sm text-fg-1 px-3 py-2 font-mono"
            />
            {setting.type === "password" && (
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="px-2 text-[10px] text-fg-4 hover:text-fg-2 uppercase tracking-wider font-pixel"
              >
                {show ? "ocultar" : "mostrar"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {isDirty && (
          <span className="text-[10px] text-accent font-pixel">*</span>
        )}
        {!setting.hotReload && (
          <span className="text-[9px] uppercase tracking-wider text-warn whitespace-nowrap border border-warn px-1.5 py-0.5">
            restart
          </span>
        )}
      </div>
    </div>
  );
}
