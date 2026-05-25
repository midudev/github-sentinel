const GITHUB_API = "https://api.github.com";

const token = process.env.GITHUB_TOKEN;

if (!token) {
  console.warn(
    "[sentinel] GITHUB_TOKEN no está definido. El rate limit será muy bajo."
  );
}

const headers: HeadersInit = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": "github-sentinel",
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

export type GitHubRepo = {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  stargazers_count: number;
  open_issues_count: number;
  owner: { login: string; avatar_url: string };
  html_url: string;
  fork?: boolean;
  archived?: boolean;
  disabled?: boolean;
  private?: boolean;
  has_issues?: boolean;
};

export type GitHubIssue = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  user: { login: string; avatar_url: string } | null;
  labels: Array<{ name: string; color: string } | string>;
  comments: number;
  created_at: string;
  updated_at: string;
  pull_request?: unknown;
};

export type GitHubPullRequest = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  draft: boolean;
  user: { login: string; avatar_url: string; type?: string } | null;
  labels: Array<{ name: string; color: string } | string>;
  comments?: number;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  merged_at: string | null;
};

async function gh<T>(path: string): Promise<T> {
  const res = await fetch(`${GITHUB_API}${path}`, { headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${res.status} ${path}: ${text}`);
  }
  return res.json() as Promise<T>;
}

export function getRepo(owner: string, name: string) {
  return gh<GitHubRepo>(`/repos/${owner}/${name}`);
}

export type ListUserReposOptions = {
  excludeForks?: boolean;
  excludeArchived?: boolean;
  excludeDisabled?: boolean;
  excludeWithoutIssues?: boolean;
  maxPages?: number;
};

export async function listUserRepos(
  username: string,
  opts: ListUserReposOptions = {}
): Promise<GitHubRepo[]> {
  const {
    excludeForks = true,
    excludeArchived = true,
    excludeDisabled = true,
    excludeWithoutIssues = true,
    maxPages = 20,
  } = opts;

  const user = encodeURIComponent(username);
  const all: GitHubRepo[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const batch = await gh<GitHubRepo[]>(
      `/users/${user}/repos?type=owner&sort=updated&per_page=100&page=${page}`
    );
    if (batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
  }

  return all.filter((repo) => {
    if (excludeForks && repo.fork) return false;
    if (excludeArchived && repo.archived) return false;
    if (excludeDisabled && repo.disabled) return false;
    if (excludeWithoutIssues && repo.has_issues === false) return false;
    return true;
  });
}

export function parseUserInput(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Usuario vacío");

  const url = trimmed.match(/github\.com\/([\w.-]+)\/?$/i);
  if (url) return url[1]!;

  if (/^[\w.-]+$/.test(trimmed)) return trimmed;

  throw new Error(
    "Formato inválido. Usa un usuario/organización (ej: midudev) o su URL de GitHub."
  );
}

export async function getOpenIssues(
  owner: string,
  name: string,
  perPage = 30
): Promise<GitHubIssue[]> {
  const all = await gh<GitHubIssue[]>(
    `/repos/${owner}/${name}/issues?state=open&sort=created&direction=desc&per_page=${perPage}`
  );
  return all.filter((issue) => !issue.pull_request);
}

export function getOpenPullRequests(
  owner: string,
  name: string,
  perPage = 30
): Promise<GitHubPullRequest[]> {
  return gh<GitHubPullRequest[]>(
    `/repos/${owner}/${name}/pulls?state=open&sort=created&direction=desc&per_page=${perPage}`
  );
}

export function parseRepoInput(input: string): { owner: string; name: string } {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Repositorio vacío");

  const url = trimmed.match(
    /github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/|$)/i
  );
  if (url) return { owner: url[1]!, name: url[2]! };

  const slash = trimmed.split("/").filter(Boolean);
  if (slash.length === 2) return { owner: slash[0]!, name: slash[1]! };

  throw new Error(
    "Formato inválido. Usa owner/repo o una URL completa de GitHub."
  );
}
