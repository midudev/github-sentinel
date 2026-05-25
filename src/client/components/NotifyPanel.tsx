import { useEffect, useState } from "react";
import { api, type Status } from "../api";
import { formatRelative } from "../utils";

type Props = {
  status: Status | null;
};

export function NotifyPanel({ status }: Props) {
  const [preview, setPreview] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: "ok" | "err";
    text: string;
  } | null>(null);

  const wa = status?.whatsapp;

  useEffect(() => {
    setPreview(null);
  }, [status?.lastRun]);

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
              ? "bg-[var(--color-accent)] blink"
              : "bg-[var(--color-fg-4)]"
          }`}
        />
        <span className="font-pixel uppercase text-xs text-[var(--color-fg-1)] tracking-wider">
          whatsapp digest
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)]">
          {wa?.configured
            ? `${wa.phone} · ${wa.morningHour}:00 & ${wa.eveningHour}:00 · ${wa.timezone}`
            : "no configurado"}
        </span>
        <span className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] ml-auto">
          último envío {formatRelative(wa?.lastSent ?? null)}
        </span>
      </div>

      {!wa?.configured && (
        <p className="mt-3 text-xs text-[var(--color-fg-3)] font-mono">
          define <code>WHATSAPP_PHONE</code> y <code>CALLMEBOT_API_KEY</code>{" "}
          en el <code>.env</code> y reinicia para activar los envíos.
        </p>
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
          {sending ? "sending..." : "send now"}
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
