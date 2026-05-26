import { db, queries, type RepoRow } from "./db";
import {
  getOpenIssues,
  getOpenPullRequests,
  getRepo,
  type GitHubIssue,
  type GitHubPullRequest,
} from "./github";
import { analyzeIssue, isLLMAvailable } from "./llm";

function isExternalAuthor(
  author: GitHubPullRequest["user"],
  repoOwner: string
): boolean {
  if (!author?.login) return false;
  if (author.type === "Bot") return false;
  if (/\[bot\]$/i.test(author.login)) return false;
  const login = author.login.toLowerCase();
  if (login === repoOwner.toLowerCase()) return false;
  return true;
}

const POLL_INTERVAL_MS = Number(
  process.env.SENTINEL_INTERVAL_MS ?? 1000 * 60 * 30
);
const SCAN_ON_START = ["1", "true", "yes"].includes(
  (process.env.SENTINEL_SCAN_ON_START ?? "").toLowerCase()
);

let timer: Timer | null = null;
let isChecking = false;
let lastRun: string | null = null;

type CheckResult = {
  repo: string;
  newIssues: number;
  totalOpen: number;
  openPRs: number;
  externalPRs: number;
  error?: string;
};

function labelName(l: GitHubIssue["labels"][number]): string {
  return typeof l === "string" ? l : l.name;
}

async function checkRepo(repo: RepoRow): Promise<CheckResult> {
  const repoKey = `${repo.owner}/${repo.name}`;
  const now = new Date().toISOString();

  try {
    const meta = await getRepo(repo.owner, repo.name);
    queries.updateRepoMeta.run(
      meta.description,
      meta.stargazers_count,
      meta.open_issues_count,
      now,
      repo.id
    );

    const issues = await getOpenIssues(repo.owner, repo.name);
    let newCount = 0;

    for (const issue of issues) {
      const exists = queries.hasIssue.get(repo.id, issue.number);
      if (exists) continue;

      const labels = issue.labels.map(labelName);
      queries.insertIssue.run(
        repo.id,
        issue.number,
        issue.title,
        issue.body,
        issue.html_url,
        issue.state,
        issue.user?.login ?? null,
        issue.user?.avatar_url ?? null,
        JSON.stringify(labels),
        issue.comments,
        issue.created_at,
        issue.updated_at,
        now
      );
      newCount++;
    }

    let openPRs = 0;
    let externalPRs = 0;
    try {
      const prs = await getOpenPullRequests(repo.owner, repo.name);
      openPRs = prs.length;
      const seenPrNumbers: number[] = [];
      for (const pr of prs) {
        const external = isExternalAuthor(pr.user, repo.owner);
        if (external && !pr.draft) externalPRs++;
        const labels = pr.labels.map(labelName);
        queries.upsertPullRequest.run(
          repo.id,
          pr.number,
          pr.title,
          pr.body,
          pr.html_url,
          pr.state,
          pr.user?.login ?? null,
          pr.user?.avatar_url ?? null,
          pr.user?.type ?? null,
          pr.draft ? 1 : 0,
          external ? 1 : 0,
          JSON.stringify(labels),
          pr.comments ?? 0,
          pr.created_at,
          pr.updated_at,
          pr.closed_at,
          now
        );
        seenPrNumbers.push(pr.number);
      }

      if (seenPrNumbers.length > 0) {
        queries.closeMissingPRs.run(now, repo.id, JSON.stringify(seenPrNumbers));
      } else {
        queries.closeAllRepoPRs.run(now, repo.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sentinel] PRs ${repoKey}: ${msg}`);
    }

    return {
      repo: repoKey,
      newIssues: newCount,
      totalOpen: meta.open_issues_count,
      openPRs,
      externalPRs,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[sentinel] error en ${repoKey}: ${msg}`);
    return {
      repo: repoKey,
      newIssues: 0,
      totalOpen: 0,
      openPRs: 0,
      externalPRs: 0,
      error: msg,
    };
  }
}

export async function runCheck(): Promise<CheckResult[]> {
  if (isChecking) {
    return [
      {
        repo: "*",
        newIssues: 0,
        totalOpen: 0,
        openPRs: 0,
        externalPRs: 0,
        error: "Ya en curso",
      },
    ];
  }

  isChecking = true;
  const results: CheckResult[] = [];
  const startedAt = new Date().toISOString();

  try {
    const repos = queries.listRepos.all();
    for (const repo of repos) {
      try {
        results.push(await checkRepo(repo));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[sentinel] ${startedAt} fallo no controlado en ${repo.owner}/${repo.name}: ${msg}`
        );
      }
    }
    lastRun = new Date().toISOString();
    const totalNew = results.reduce((a, r) => a + r.newIssues, 0);
    console.log(
      `[sentinel] ${lastRun} scan completado: ${results.length} repos, ${totalNew} nuevas`
    );

    void backgroundAnalyze().catch((err) => {
      console.warn(`[sentinel] backgroundAnalyze cayó: ${err}`);
    });
  } finally {
    isChecking = false;
  }

  return results;
}

async function backgroundAnalyze() {
  const available = await isLLMAvailable();
  if (!available) return;

  const pending = db
    .query<
      {
        id: number;
        title: string;
        body: string | null;
        labels: string | null;
        owner: string;
        repo_name: string;
      },
      []
    >(
      `SELECT i.id, i.title, i.body, i.labels, r.owner, r.name as repo_name
       FROM issues i
       JOIN repos r ON r.id = i.repo_id
       WHERE i.analyzed_at IS NULL
       ORDER BY i.seen_at DESC
       LIMIT 5`
    )
    .all();

  for (const issue of pending) {
    try {
      const labels = JSON.parse(issue.labels ?? "[]") as string[];
      const result = await analyzeIssue({
        owner: issue.owner,
        repo: issue.repo_name,
        title: issue.title,
        body: issue.body,
        labels,
      });

      queries.saveAnalysis.run(
        JSON.stringify(result),
        result.summary,
        result.type,
        result.risk,
        new Date().toISOString(),
        issue.id
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[sentinel] análisis fallido issue ${issue.id}: ${msg}`);
    }
  }
}

export function startScheduler() {
  if (timer) return;
  console.log(
    `[sentinel] polling cada ${(POLL_INTERVAL_MS / 1000 / 60).toFixed(0)} min`
  );
  if (SCAN_ON_START) {
    void runCheck();
  } else {
    console.log(
      "[sentinel] scan inicial desactivado; usa SCAN NOW o espera al siguiente polling"
    );
  }
  timer = setInterval(() => {
    void runCheck();
  }, POLL_INTERVAL_MS);
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
}

export function status() {
  return {
    intervalMs: POLL_INTERVAL_MS,
    isChecking,
    lastRun,
  };
}
