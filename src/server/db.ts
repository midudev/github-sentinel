import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

const RAW_DB_PATH = process.env.SENTINEL_DB_PATH ?? "data/sentinel.db";
export const DB_PATH = isAbsolute(RAW_DB_PATH)
  ? RAW_DB_PATH
  : resolve(process.cwd(), RAW_DB_PATH);

mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA synchronous = NORMAL;");
db.exec("PRAGMA busy_timeout = 5000;");

export function closeDatabase() {
  try {
    db.exec("PRAGMA optimize;");
  } catch {}
  db.close(false);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    owner TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    stars INTEGER DEFAULT 0,
    open_issues INTEGER DEFAULT 0,
    added_at TEXT NOT NULL,
    last_checked_at TEXT,
    UNIQUE(owner, name)
  );

  CREATE TABLE IF NOT EXISTS issues (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    issue_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    html_url TEXT NOT NULL,
    state TEXT NOT NULL,
    author TEXT,
    author_avatar TEXT,
    labels TEXT,
    comments INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    seen_at TEXT NOT NULL,
    analysis TEXT,
    analysis_summary TEXT,
    analysis_type TEXT,
    analysis_risk TEXT,
    analyzed_at TEXT,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, issue_number)
  );

  CREATE INDEX IF NOT EXISTS idx_issues_repo ON issues(repo_id);
  CREATE INDEX IF NOT EXISTS idx_issues_seen ON issues(seen_at DESC);

  CREATE TABLE IF NOT EXISTS pull_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    repo_id INTEGER NOT NULL,
    pr_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    html_url TEXT NOT NULL,
    state TEXT NOT NULL,
    author TEXT,
    author_avatar TEXT,
    author_type TEXT,
    draft INTEGER DEFAULT 0,
    is_external INTEGER DEFAULT 0,
    labels TEXT,
    comments INTEGER DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    closed_at TEXT,
    seen_at TEXT NOT NULL,
    FOREIGN KEY (repo_id) REFERENCES repos(id) ON DELETE CASCADE,
    UNIQUE(repo_id, pr_number)
  );

  CREATE INDEX IF NOT EXISTS idx_prs_repo ON pull_requests(repo_id);
  CREATE INDEX IF NOT EXISTS idx_prs_open ON pull_requests(state, is_external);

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export type RepoRow = {
  id: number;
  owner: string;
  name: string;
  description: string | null;
  stars: number;
  open_issues: number;
  added_at: string;
  last_checked_at: string | null;
};

export type IssueRow = {
  id: number;
  repo_id: number;
  issue_number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  author: string | null;
  author_avatar: string | null;
  labels: string | null;
  comments: number;
  created_at: string;
  updated_at: string | null;
  seen_at: string;
  analysis: string | null;
  analysis_summary: string | null;
  analysis_type: string | null;
  analysis_risk: string | null;
  analyzed_at: string | null;
};

export type IssueWithRepo = IssueRow & {
  owner: string;
  repo_name: string;
};

export type PullRequestRow = {
  id: number;
  repo_id: number;
  pr_number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: string;
  author: string | null;
  author_avatar: string | null;
  author_type: string | null;
  draft: number;
  is_external: number;
  labels: string | null;
  comments: number;
  created_at: string;
  updated_at: string | null;
  closed_at: string | null;
  seen_at: string;
};

export type PullRequestWithRepo = PullRequestRow & {
  owner: string;
  repo_name: string;
};

export const queries = {
  listRepos: db.query<RepoRow, []>(
    "SELECT * FROM repos ORDER BY added_at DESC"
  ),
  getRepo: db.query<RepoRow, [number]>("SELECT * FROM repos WHERE id = ?"),
  findRepo: db.query<RepoRow, [string, string]>(
    "SELECT * FROM repos WHERE owner = ? AND name = ?"
  ),
  insertRepo: db.prepare(
    `INSERT INTO repos (owner, name, description, stars, open_issues, added_at)
     VALUES (?, ?, ?, ?, ?, ?)
     RETURNING *`
  ),
  updateRepoMeta: db.prepare(
    `UPDATE repos SET description = ?, stars = ?, open_issues = ?, last_checked_at = ?
     WHERE id = ?`
  ),
  deleteRepo: db.prepare("DELETE FROM repos WHERE id = ?"),

  listIssues: db.query<IssueWithRepo, [number]>(
    `SELECT i.*, r.owner, r.name as repo_name
     FROM issues i
     JOIN repos r ON r.id = i.repo_id
     ORDER BY i.seen_at DESC
     LIMIT ?`
  ),
  listIssuesByRepo: db.query<IssueRow, [number]>(
    `SELECT * FROM issues WHERE repo_id = ? ORDER BY seen_at DESC LIMIT 50`
  ),
  getIssue: db.query<IssueWithRepo, [number]>(
    `SELECT i.*, r.owner, r.name as repo_name
     FROM issues i
     JOIN repos r ON r.id = i.repo_id
     WHERE i.id = ?`
  ),
  hasIssue: db.query<{ id: number }, [number, number]>(
    "SELECT id FROM issues WHERE repo_id = ? AND issue_number = ?"
  ),
  insertIssue: db.prepare(
    `INSERT INTO issues (
      repo_id, issue_number, title, body, html_url, state,
      author, author_avatar, labels, comments, created_at, updated_at, seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING *`
  ),
  saveAnalysis: db.prepare(
    `UPDATE issues
     SET analysis = ?, analysis_summary = ?, analysis_type = ?, analysis_risk = ?, analyzed_at = ?
     WHERE id = ?`
  ),
  countIssues: db.query<{ total: number }, []>(
    "SELECT COUNT(*) as total FROM issues"
  ),
  countAnalyzed: db.query<{ total: number }, []>(
    "SELECT COUNT(*) as total FROM issues WHERE analyzed_at IS NOT NULL"
  ),
  getSetting: db.query<{ value: string }, [string]>(
    "SELECT value FROM settings WHERE key = ?"
  ),
  setSetting: db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ),

  upsertPullRequest: db.prepare(
    `INSERT INTO pull_requests (
      repo_id, pr_number, title, body, html_url, state,
      author, author_avatar, author_type, draft, is_external,
      labels, comments, created_at, updated_at, closed_at, seen_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(repo_id, pr_number) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      state = excluded.state,
      author = excluded.author,
      author_avatar = excluded.author_avatar,
      author_type = excluded.author_type,
      draft = excluded.draft,
      is_external = excluded.is_external,
      labels = excluded.labels,
      comments = excluded.comments,
      updated_at = excluded.updated_at,
      closed_at = excluded.closed_at,
      seen_at = excluded.seen_at`
  ),
  closeMissingPRs: db.prepare(
    `UPDATE pull_requests
     SET state = 'closed', closed_at = COALESCE(closed_at, ?)
     WHERE repo_id = ? AND state = 'open' AND pr_number NOT IN (SELECT value FROM json_each(?))`
  ),
  closeAllRepoPRs: db.prepare(
    `UPDATE pull_requests
     SET state = 'closed', closed_at = COALESCE(closed_at, ?)
     WHERE repo_id = ? AND state = 'open'`
  ),
  listOpenExternalPRs: db.query<PullRequestWithRepo, []>(
    `SELECT p.*, r.owner, r.name as repo_name
     FROM pull_requests p
     JOIN repos r ON r.id = p.repo_id
     WHERE p.state = 'open' AND p.draft = 0 AND p.is_external = 1
     ORDER BY p.created_at ASC`
  ),
  listOpenHighRiskIssues: db.query<IssueWithRepo, []>(
    `SELECT i.*, r.owner, r.name as repo_name
     FROM issues i
     JOIN repos r ON r.id = i.repo_id
     WHERE i.state = 'open' AND i.analysis_risk = 'high'
     ORDER BY i.created_at DESC`
  ),
  countOpenPRs: db.query<{ total: number }, []>(
    "SELECT COUNT(*) as total FROM pull_requests WHERE state = 'open' AND draft = 0 AND is_external = 1"
  ),
};
