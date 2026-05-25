import type { Status } from "../api";
import { formatNumber } from "../utils";

export function Stats({ status }: { status: Status | null }) {
  const items = [
    { label: "repos", value: status?.repos ?? 0 },
    { label: "issues", value: status?.issues ?? 0 },
    { label: "analyzed", value: status?.analyzed ?? 0 },
    {
      label: "interval",
      value: `${Math.round((status?.intervalMs ?? 0) / 60000)}min`,
      raw: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-[var(--color-ink-3)] border border-[var(--color-ink-3)] mb-8">
      {items.map((it) => (
        <div key={it.label} className="bg-[var(--color-ink-1)] p-5">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-2">
            {it.label}
          </div>
          <div className="font-pixel text-3xl text-[var(--color-fg-1)]">
            {it.raw ? it.value : formatNumber(it.value as number)}
          </div>
        </div>
      ))}
    </div>
  );
}
