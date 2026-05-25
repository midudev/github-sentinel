import { api, type Repo } from "../api";
import { formatNumber, formatRelative } from "../utils";

type Props = {
  repos: Repo[];
  onChange: () => void;
};

export function RepoList({ repos, onChange }: Props) {
  if (repos.length === 0) {
    return (
      <div className="border border-dashed border-[var(--color-ink-3)] p-6 text-center text-sm text-[var(--color-fg-3)]">
        <span className="text-[var(--color-fg-4)]">[ </span>
        no repos watched yet
        <span className="text-[var(--color-fg-4)]"> ]</span>
      </div>
    );
  }

  return (
    <ul className="border border-[var(--color-ink-3)] divide-y divide-[var(--color-ink-3)] bg-[var(--color-ink-1)]">
      {repos.map((repo) => (
        <li
          key={repo.id}
          className="flex items-center gap-4 px-4 py-3 hover:bg-[var(--color-ink-2)] transition-colors group"
        >
          <span className="text-[var(--color-fg-4)] text-xs font-mono">
            ▸
          </span>
          <a
            href={`https://github.com/${repo.owner}/${repo.name}`}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-sm text-[var(--color-fg-1)] hover:text-[var(--color-accent)]"
          >
            <span className="text-[var(--color-fg-3)]">{repo.owner}</span>
            <span className="text-[var(--color-fg-4)]">/</span>
            <span>{repo.name}</span>
          </a>
          <div className="flex items-center gap-3 ml-auto text-xs text-[var(--color-fg-3)]">
            <span title="stars" className="flex items-center gap-1">
              <span className="text-[var(--color-fg-4)]">★</span>
              {formatNumber(repo.stars)}
            </span>
            <span title="open issues" className="flex items-center gap-1">
              <span className="text-[var(--color-fg-4)]">●</span>
              {formatNumber(repo.open_issues)}
            </span>
            <span
              title="last checked"
              className="hidden md:inline text-[var(--color-fg-4)]"
            >
              {formatRelative(repo.last_checked_at)}
            </span>
            <button
              onClick={async () => {
                if (!confirm(`¿Dejar de vigilar ${repo.owner}/${repo.name}?`))
                  return;
                await api.removeRepo(repo.id);
                onChange();
              }}
              className="opacity-0 group-hover:opacity-100 transition-opacity text-[var(--color-fg-4)] hover:text-[var(--color-danger)]"
              title="dejar de vigilar"
            >
              ✕
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
