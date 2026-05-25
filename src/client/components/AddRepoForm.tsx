import { useMemo, useState, type FormEvent } from "react";
import { api } from "../api";

type Props = {
  onAdded: () => void;
};

type Mode = "repo" | "user" | "empty";

function detectMode(raw: string): Mode {
  const value = raw.trim();
  if (!value) return "empty";

  const stripped = value
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/\/+$/, "")
    .trim();

  if (!stripped) return "empty";

  const segments = stripped.split("/").filter(Boolean);
  if (segments.length >= 2) return "repo";
  if (segments.length === 1 && /^[\w.-]+$/.test(segments[0]!)) return "user";
  return "empty";
}

export function AddRepoForm({ onAdded }: Props) {
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const mode = useMemo(() => detectMode(value), [value]);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (mode === "empty") return;
    setLoading(true);
    setError(null);
    setInfo(null);
    try {
      if (mode === "user") {
        const res = await api.importUser(value.trim());
        setInfo(
          `${res.user}: ${res.added} nuevos, ${res.skipped} ya vigilados (de ${res.total})`
        );
      } else {
        await api.addRepo(value.trim());
      }
      setValue("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const buttonLabel =
    loading ? "..." : mode === "user" ? "watch all" : "watch";

  return (
    <div>
      <form
        onSubmit={submit}
        className="flex items-stretch gap-0 border border-[var(--color-ink-3)] focus-within:border-[var(--color-accent)] transition-colors bg-[var(--color-ink-1)]"
      >
        <span className="px-3 py-2 text-[var(--color-fg-4)] font-mono text-sm select-none">
          $
        </span>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="owner/repo  ·  owner (todos sus repos)  ·  URL de GitHub"
          className="flex-1 bg-transparent border-0 outline-none text-[var(--color-fg-1)] font-mono text-sm py-2 placeholder:text-[var(--color-fg-4)]"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || mode === "empty"}
          className="font-pixel uppercase text-xs px-4 border-l border-[var(--color-ink-3)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40"
        >
          {buttonLabel}
        </button>
      </form>
      {(error || info) && (
        <div
          className={`mt-1 text-xs font-mono ${
            error ? "text-[var(--color-danger)]" : "text-[var(--color-fg-3)]"
          }`}
        >
          {error ?? info}
        </div>
      )}
    </div>
  );
}
