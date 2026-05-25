import { useState } from "react";
import { api, type Issue, type Analysis } from "../api";
import { formatRelative, riskColor, typeLabel } from "../utils";

type Props = {
  issue: Issue;
  expanded: boolean;
  llmAvailable: boolean;
  onToggle: () => void;
  onAnalyzed: () => void;
};

function parseAnalysis(issue: Issue): Analysis | null {
  if (!issue.analysis) return null;
  try {
    return JSON.parse(issue.analysis) as Analysis;
  } catch {
    return null;
  }
}

export function IssueCard({
  issue,
  expanded,
  llmAvailable,
  onToggle,
  onAnalyzed,
}: Props) {
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const analysis = parseAnalysis(issue);

  const analyze = async () => {
    setAnalyzing(true);
    setError(null);
    try {
      await api.analyzeIssue(issue.id);
      onAnalyzed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAnalyzing(false);
    }
  };

  return (
    <article className="border border-[var(--color-ink-3)] bg-[var(--color-ink-1)] hover:border-[var(--color-ink-4)] transition-colors">
      <button
        onClick={onToggle}
        className="w-full text-left px-5 py-4 flex items-start gap-4"
      >
        <div className="flex flex-col items-center pt-1 min-w-[44px]">
          <span className="font-pixel text-[10px] text-[var(--color-fg-4)] uppercase tracking-wider">
            #{issue.issue_number}
          </span>
          <span
            className={`mt-1 text-[10px] font-pixel uppercase tracking-wider ${riskColor(
              issue.analysis_risk
            )}`}
          >
            {typeLabel(issue.analysis_type)}
          </span>
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-3 mb-1">
            <span className="text-[11px] text-[var(--color-fg-4)] font-mono">
              {issue.owner}/{issue.repo_name}
            </span>
            <span className="text-[11px] text-[var(--color-fg-4)]">·</span>
            <span className="text-[11px] text-[var(--color-fg-4)] font-mono">
              {formatRelative(issue.created_at)}
            </span>
            {issue.author && (
              <>
                <span className="text-[11px] text-[var(--color-fg-4)]">·</span>
                <span className="text-[11px] text-[var(--color-fg-4)] font-mono">
                  by {issue.author}
                </span>
              </>
            )}
          </div>
          <h3 className="text-[var(--color-fg-1)] font-medium leading-snug mb-2">
            {issue.title}
          </h3>
          {issue.analysis_summary ? (
            <p className="text-sm text-[var(--color-fg-2)] line-clamp-2">
              <span className="text-[var(--color-accent-dim)]">›</span>{" "}
              {issue.analysis_summary}
            </p>
          ) : (
            <p className="text-xs text-[var(--color-fg-4)] italic">
              {llmAvailable
                ? "pendiente de análisis…"
                : "LLM offline · pulsa para ver detalles"}
            </p>
          )}

          {issue.labels.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {issue.labels.slice(0, 5).map((l) => (
                <span
                  key={l}
                  className="text-[10px] px-1.5 py-0.5 border border-[var(--color-ink-4)] text-[var(--color-fg-3)] font-mono"
                >
                  {l}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="text-[var(--color-fg-4)] text-xs pt-1">
          {expanded ? "−" : "+"}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[var(--color-ink-3)] p-5 space-y-4">
          {issue.body && (
            <details className="text-sm">
              <summary className="cursor-pointer text-[var(--color-fg-3)] text-xs uppercase tracking-wider mb-2">
                descripción original
              </summary>
              <pre className="mt-3 whitespace-pre-wrap text-[var(--color-fg-2)] text-sm font-mono leading-relaxed max-h-72 overflow-y-auto scrollbar-thin">
                {issue.body}
              </pre>
            </details>
          )}

          {analysis ? (
            <div className="space-y-4">
              <Section title="resumen">
                <p className="text-sm text-[var(--color-fg-1)]">
                  {analysis.summary}
                </p>
              </Section>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-xs">
                <Meta
                  label="tipo"
                  value={analysis.type.toUpperCase()}
                />
                <Meta
                  label="riesgo"
                  value={analysis.risk.toUpperCase()}
                  className={riskColor(analysis.risk)}
                />
                <Meta
                  label="analizado"
                  value={formatRelative(issue.analyzed_at)}
                />
              </div>

              {analysis.files.length > 0 && (
                <Section title="archivos relevantes">
                  <ul className="font-mono text-sm space-y-1">
                    {analysis.files.map((f) => (
                      <li key={f} className="text-[var(--color-fg-2)]">
                        <span className="text-[var(--color-fg-4)]">→ </span>
                        {f}
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="propuesta">
                <p className="text-sm text-[var(--color-fg-1)] whitespace-pre-wrap leading-relaxed">
                  {analysis.proposal}
                </p>
              </Section>
            </div>
          ) : (
            <div className="text-sm text-[var(--color-fg-3)]">
              Sin análisis todavía.
            </div>
          )}

          <div className="flex items-center gap-3 pt-2 border-t border-[var(--color-ink-3)]">
            <a
              href={issue.html_url}
              target="_blank"
              rel="noreferrer"
              className="font-pixel uppercase text-xs px-3 py-1.5 border border-[var(--color-ink-4)] text-[var(--color-fg-2)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] transition-colors"
            >
              abrir en github →
            </a>
            <button
              onClick={analyze}
              disabled={analyzing || !llmAvailable}
              className="font-pixel uppercase text-xs px-3 py-1.5 border border-[var(--color-accent)] text-[var(--color-accent)] hover:bg-[var(--color-accent)] hover:text-[var(--color-ink-0)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title={llmAvailable ? "" : "LLM no disponible"}
            >
              {analyzing
                ? "analyzing..."
                : analysis
                ? "re-analyze"
                : "analyze"}
            </button>
            {error && (
              <span className="text-xs text-[var(--color-danger)]">{error}</span>
            )}
          </div>
        </div>
      )}
    </article>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-4)] mb-2">
        // {title}
      </div>
      {children}
    </div>
  );
}

function Meta({
  label,
  value,
  className = "",
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className="border border-[var(--color-ink-3)] p-2 px-3">
      <div className="text-[10px] uppercase tracking-wider text-[var(--color-fg-4)]">
        {label}
      </div>
      <div className={`font-pixel text-sm ${className || "text-[var(--color-fg-1)]"}`}>
        {value}
      </div>
    </div>
  );
}
