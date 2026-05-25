export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (diff < 0) return "ahora";
  const s = Math.floor(diff / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  if (d < 30) return `hace ${d}d`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `hace ${mo}mo`;
  return date.toLocaleDateString();
}

export function formatNumber(n: number | null | undefined): string {
  if (n == null) return "0";
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

export function riskColor(risk: string | null): string {
  if (risk === "high") return "text-[var(--color-danger)]";
  if (risk === "medium") return "text-[var(--color-warn)]";
  if (risk === "low") return "text-[var(--color-accent)]";
  return "text-[var(--color-fg-3)]";
}

export function typeLabel(type: string | null): string {
  if (!type) return "—";
  return type.toUpperCase();
}
