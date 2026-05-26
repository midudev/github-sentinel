export type Repo = {
  id: number;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  open_issues: number;
  added_at: string;
  last_checked_at: string | null;
};

export type Issue = {
  id: number;
  repo_id: number;
  owner: string;
  repo_name: string;
  issue_number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  author: string | null;
  author_avatar: string | null;
  labels: string[];
  comments: number;
  created_at: string;
  seen_at: string;
  analysis: string | null;
  analysis_summary: string | null;
  analysis_type: string | null;
  analysis_risk: string | null;
  analyzed_at: string | null;
};

export type Analysis = {
  summary: string;
  type: "bug" | "feature" | "docs" | "question" | "other";
  risk: "low" | "medium" | "high";
  files: string[];
  proposal: string;
};

export type Status = {
  intervalMs: number;
  isChecking: boolean;
  lastRun: string | null;
  repos: number;
  issues: number;
  analyzed: number;
  openPRs: number;
  llm: { available: boolean; url: string; model: string };
  whatsapp: {
    enabled: boolean;
    configured: boolean;
    phone: string | null;
    timezone: string;
    cron: string;
    lastSent: string | null;
    nextRunAt: string | null;
  };
};

export type DigestPreview = {
  message: string;
  prs: number;
  issues: number;
};

export type RepoPreview = {
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  open_issues: number;
  fork: boolean;
  archived: boolean;
  already_watched: boolean;
};

export type UserPreview = {
  ok: true;
  user: string;
  total: number;
  repos: RepoPreview[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const api = {
  status: () => request<Status>("/api/status"),
  listRepos: () => request<Repo[]>("/api/repos"),
  addRepo: (repo: string) =>
    request<Repo>("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
  previewUser: (
    user: string,
    opts: { excludeForks?: boolean; excludeArchived?: boolean } = {}
  ) =>
    request<UserPreview>("/api/repos/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user, ...opts }),
    }),
  bulkAddRepos: (
    repos: Array<{
      owner: string;
      name: string;
      description?: string | null;
      stars?: number;
      open_issues?: number;
    }>
  ) =>
    request<{ ok: true; total: number; added: number; skipped: number }>(
      "/api/repos/bulk",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repos }),
      }
    ),
  removeRepo: (id: number) =>
    request<{ ok: true }>(`/api/repos/${id}`, { method: "DELETE" }),
  listIssues: (limit = 100) =>
    request<Issue[]>(`/api/issues?limit=${limit}`),
  analyzeIssue: (id: number) =>
    request<{ ok: true; analysis: Analysis }>(
      `/api/issues/${id}/analyze`,
      { method: "POST" }
    ),
  check: () =>
    request<{ ok: true; results: Array<{ repo: string; newIssues: number }> }>(
      "/api/check",
      { method: "POST" }
    ),
  previewDigest: () => request<DigestPreview>("/api/notify/preview"),
  sendDigest: () =>
    request<{ ok: true; message: string; prs: number; issues: number }>(
      "/api/notify/test",
      { method: "POST" }
    ),
};
