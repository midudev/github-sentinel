import type { Status } from "../api";
import { formatRelative } from "../utils";

type Props = {
  status: Status | null;
  onCheck: () => void;
  checking: boolean;
};

export function Header({ status, onCheck, checking }: Props) {
  const llm = status?.llm;

  return (
    <header className="border-b border-[var(--color-ink-3)] bg-[var(--color-ink-1)]/80 backdrop-blur sticky top-0 z-20">
      <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-6">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-tight">
            <h1 className="font-pixel text-lg text-[var(--color-fg-1)] glow">
              GITHUB SENTINEL
            </h1>
            <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-3)]">
              local watchtower
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-7 text-xs text-[var(--color-fg-3)]">
          <div className="flex items-center gap-6">
            <StatusPill
              label="GitHub"
              ok={true}
              value={status ? "ok" : "..."}
            />
            <StatusPill
              label="LLM"
              ok={Boolean(llm?.available)}
              value={llm?.available ? llm.model : "offline"}
            />
          </div>
          <div className="hidden md:flex items-baseline gap-2 text-[10px] whitespace-nowrap">
            <span className="uppercase tracking-[0.18em] text-[var(--color-fg-4)]">
              last check
            </span>
            <span className="text-[var(--color-fg-2)]">
              {formatRelative(status?.lastRun ?? null)}
            </span>
          </div>
          <button
            onClick={onCheck}
            disabled={checking}
            className="font-pixel uppercase text-xs px-3 py-2 border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
          >
            {checking ? "scanning..." : "scan now"}
          </button>
        </div>
      </div>
    </header>
  );
}

function StatusPill({
  label,
  ok,
  value,
}: {
  label: string;
  ok: boolean;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          ok ? "bg-[var(--color-accent)]" : "bg-[var(--color-warn)]"
        }`}
      />
      <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--color-fg-4)]">
        {label}
      </span>
      <span className="text-[var(--color-fg-2)] text-[11px]">{value}</span>
    </div>
  );
}

function Logo() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 32 32"
      shapeRendering="crispEdges"
      className="text-[var(--color-accent)]"
    >
      <rect x="10" y="6" width="12" height="2" fill="currentColor" />
      <rect x="8" y="8" width="2" height="16" fill="currentColor" />
      <rect x="22" y="8" width="2" height="16" fill="currentColor" />
      <rect x="10" y="24" width="12" height="2" fill="currentColor" />
      <rect x="14" y="12" width="4" height="4" fill="currentColor" />
      <rect x="14" y="18" width="4" height="2" fill="currentColor" />
    </svg>
  );
}
