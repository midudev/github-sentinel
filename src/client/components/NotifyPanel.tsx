import { useEffect, useState } from "react";
import { api, type Status } from "../api";
import { formatRelative } from "../utils";

type Props = {
  status: Status | null;
  onChange: () => void | Promise<void>;
};

export function NotifyPanel({ status, onChange }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const wa = status?.whatsapp;

  useEffect(() => {
    setPreview(null);
  }, [status?.lastRun]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const loadPreview = async () => {
    setLoadingPreview(true);
    setFeedback(null);
    try {
      const res = await api.previewDigest();
      setPreview(res.message);
    } catch (err) {
      setFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLoadingPreview(false);
    }
  };

  const send = async () => {
    setSending(true);
    setFeedback(null);
    try {
      const res = await api.sendDigest();
      setFeedback({
        kind: "ok",
        text: `enviado · ${res.prs} PRs · ${res.issues} issues`,
      });
      await onChange();
    } catch (err) {
      setFeedback({
        kind: "err",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] p-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span
          className={`w-1.5 h-1.5 rounded-full ${
            wa?.configured
              ? "bg-[var(--color-accent)]"
              : "bg-[var(--color-warn)]"
          }`}
        />
        <span className="font-pixel uppercase text-xs text-[var(--color-fg-1)] tracking-wider">
          whatsapp digest
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)]">
          {wa?.configured
            ? `${wa.phone} · ${wa.timezone}`
            : "no configurado"}
        </span>
      </div>

      {!wa?.configured && (
        <p className="mt-3 text-xs text-[var(--color-fg-3)] font-mono">
          define <code>WHATSAPP_PHONE</code> y <code>CALLMEBOT_API_KEY</code>{" "}
          en el <code>.env</code> y reinicia para activar los envíos.
        </p>
      )}

      {wa?.configured && (
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-px bg-[var(--color-ink-3)] border border-[var(--color-ink-3)]">
          <DigestMetric label="cron" value={`${wa.cron} UTC`} />
          <DigestMetric
            label="próximo"
            value={formatCountdown(wa.nextRunAt, now)}
            highlight
          />
          <DigestMetric
            label="último envío"
            value={formatRelative(wa.lastSent)}
          />
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 flex-wrap">
        <button
          onClick={loadPreview}
          disabled={loadingPreview}
          className="font-pixel uppercase text-[10px] px-3 py-1.5 border border-[var(--color-ink-3)] text-[var(--color-fg-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors disabled:opacity-40"
        >
          {loadingPreview ? "..." : "preview"}
        </button>
        <button
          onClick={send}
          disabled={sending || !wa?.configured}
          className="font-pixel uppercase text-[10px] px-3 py-1.5 border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {sending ? "sending..." : "force send now"}
        </button>
        {feedback && (
          <span
            className={`text-xs font-mono ${
              feedback.kind === "ok"
                ? "text-[var(--color-accent)]"
                : "text-[var(--color-danger)]"
            }`}
          >
            {feedback.text}
          </span>
        )}
      </div>

      {preview && (
        <pre className="mt-4 max-h-96 overflow-auto bg-[var(--color-ink-0)] border border-[var(--color-ink-3)] p-3 text-[11px] font-mono text-[var(--color-fg-2)] whitespace-pre-wrap leading-relaxed">
          {preview}
        </pre>
      )}
    </div>
  );
}

function DigestMetric({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="bg-[var(--color-ink-1)] p-3">
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-1">
        {label}
      </div>
      <div
        className={`font-mono text-sm ${
          highlight ? "text-[var(--color-accent)]" : "text-[var(--color-fg-2)]"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function formatCountdown(iso: string | null | undefined, now: number): string {
  if (!iso) return "—";
  const diff = new Date(iso).getTime() - now;
  if (diff <= 0) return "ahora";

  const totalSeconds = Math.ceil(diff / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `en ${days}d ${hours}h`;
  if (hours > 0) return `en ${hours}h ${minutes}m`;
  if (minutes > 0) return `en ${minutes}m ${seconds}s`;
  return `en ${seconds}s`;
}
