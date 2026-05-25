import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type Issue, type Repo, type Status } from "./api";
import { AddRepoForm } from "./components/AddRepoForm";
import { Header } from "./components/Header";
import { IssueCard } from "./components/IssueCard";
import { NotifyPanel } from "./components/NotifyPanel";
import { RepoList } from "./components/RepoList";
import { Stats } from "./components/Stats";

export function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [checking, setChecking] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const refresh = useCallback(async () => {
    const [s, r, i] = await Promise.all([
      api.status(),
      api.listRepos(),
      api.listIssues(),
    ]);
    setStatus(s);
    setRepos(r);
    setIssues(i);
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 15_000);
    return () => clearInterval(t);
  }, [refresh]);

  const onCheck = async () => {
    setChecking(true);
    try {
      await api.check();
      await refresh();
    } finally {
      setChecking(false);
    }
  };

  const filteredIssues = useMemo(() => {
    const q = search.trim().toLowerCase();
    return issues.filter((issue) => {
      if (filter === "analyzed" && !issue.analyzed_at) return false;
      if (filter === "pending" && issue.analyzed_at) return false;
      if (filter === "bug" && issue.analysis_type !== "bug") return false;
      if (filter === "feature" && issue.analysis_type !== "feature") return false;
      if (filter === "high" && issue.analysis_risk !== "high") return false;
      if (q) {
        const hay = `${issue.title} ${issue.owner}/${issue.repo_name} ${issue.body ?? ""} ${issue.analysis_summary ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [issues, filter, search]);

  const filters: { id: string; label: string; count?: number }[] = [
    { id: "all", label: "all", count: issues.length },
    {
      id: "pending",
      label: "pending",
      count: issues.filter((i) => !i.analyzed_at).length,
    },
    {
      id: "analyzed",
      label: "analyzed",
      count: issues.filter((i) => i.analyzed_at).length,
    },
    {
      id: "bug",
      label: "bug",
      count: issues.filter((i) => i.analysis_type === "bug").length,
    },
    {
      id: "feature",
      label: "feature",
      count: issues.filter((i) => i.analysis_type === "feature").length,
    },
    {
      id: "high",
      label: "high-risk",
      count: issues.filter((i) => i.analysis_risk === "high").length,
    },
  ];

  return (
    <div className="min-h-screen relative">
      <div className="scanline" />
      <Header status={status} onCheck={onCheck} checking={checking} />

      <main className="max-w-6xl mx-auto px-6 py-10 relative z-10">
        <Stats status={status} />

        <section className="mb-12">
          <SectionTitle index="01" title="watched repositories" />
          <div className="mb-3">
            <AddRepoForm onAdded={refresh} />
          </div>
          <RepoList repos={repos} onChange={refresh} />
        </section>

        <section className="mb-12">
          <SectionTitle index="02" title="notifications" />
          <NotifyPanel status={status} />
        </section>

        <section>
          <SectionTitle index="03" title="incoming signals" />

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {filters.map((f) => (
              <button
                key={f.id}
                onClick={() => setFilter(f.id)}
                className={`font-pixel uppercase text-[10px] px-2.5 py-1.5 border transition-colors ${
                  filter === f.id
                    ? "border-[var(--color-accent)] text-[var(--color-accent)] bg-[var(--color-ink-2)]"
                    : "border-[var(--color-ink-3)] text-[var(--color-fg-3)] hover:border-[var(--color-ink-4)] hover:text-[var(--color-fg-2)]"
                }`}
              >
                {f.label}
                <span className="ml-1 text-[var(--color-fg-4)]">
                  [{f.count ?? 0}]
                </span>
              </button>
            ))}

            <div className="ml-auto flex items-center border border-[var(--color-ink-3)] focus-within:border-[var(--color-accent)] bg-[var(--color-ink-1)] min-w-[260px]">
              <span className="px-2 text-[var(--color-fg-4)] text-xs">⌕</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="filtrar por texto..."
                className="bg-transparent border-0 outline-none text-sm py-1.5 text-[var(--color-fg-1)] placeholder:text-[var(--color-fg-4)] flex-1 pr-2"
              />
            </div>
          </div>

          {filteredIssues.length === 0 ? (
            <div className="border border-dashed border-[var(--color-ink-3)] p-10 text-center text-sm text-[var(--color-fg-3)]">
              <div className="font-pixel text-2xl text-[var(--color-fg-4)] mb-3">
                ∅
              </div>
              {issues.length === 0
                ? "no signals captured yet — añade repos y pulsa SCAN NOW"
                : "ningún resultado con esos filtros"}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredIssues.map((issue) => (
                <IssueCard
                  key={issue.id}
                  issue={issue}
                  expanded={expanded === issue.id}
                  llmAvailable={status?.llm.available ?? false}
                  onToggle={() =>
                    setExpanded(expanded === issue.id ? null : issue.id)
                  }
                  onAnalyzed={refresh}
                />
              ))}
            </div>
          )}
        </section>

        <footer className="mt-20 pt-8 border-t border-[var(--color-ink-3)] text-[10px] uppercase tracking-[0.25em] text-[var(--color-fg-4)] flex items-center justify-between">
          <span>github-sentinel · v0.1</span>
          <span>
            poll every {Math.round((status?.intervalMs ?? 0) / 60000)} min ·
            local-first
          </span>
        </footer>
      </main>
    </div>
  );
}

function SectionTitle({ index, title }: { index: string; title: string }) {
  return (
    <h2 className="flex items-center gap-3 mb-4">
      <span className="font-pixel text-xs text-[var(--color-accent)]">
        {index}
      </span>
      <span className="font-pixel uppercase text-sm text-[var(--color-fg-1)] tracking-wider">
        {title}
      </span>
      <span className="flex-1 h-px bg-[var(--color-ink-3)]" />
    </h2>
  );
}
