import { existsSync, mkdirSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, resolve, isAbsolute } from "node:path";

const REPOS_DIR = (() => {
  const raw = process.env.SENTINEL_REPOS_DIR ?? "data/repos";
  return isAbsolute(raw) ? raw : resolve(process.cwd(), raw);
})();

const PULL_COOLDOWN_MS = positiveInt(
  process.env.SENTINEL_PULL_COOLDOWN_MS,
  5 * 60 * 1000
);

const CLONE_DEPTH = positiveInt(process.env.SENTINEL_CLONE_DEPTH, 1);

type CloneStatus = {
  repoKey: string;
  path: string;
  cloned: boolean;
  headSha: string | null;
  lastPullAt: number | null;
  error: string | null;
  sizeBytes: number | null;
};

type BackoffEntry = {
  nextRetryAt: number;
  attempt: number;
};

const pullThrottle = new Map<string, number>();
const cloneBackoff = new Map<string, BackoffEntry>();

let gitBusy = false;
const gitQueue: Array<() => Promise<void>> = [];

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function repoKey(owner: string, name: string): string {
  return `${owner}/${name}`;
}

function repoPath(owner: string, name: string): string {
  return join(REPOS_DIR, owner, name);
}

function ensureReposDir(): void {
  mkdirSync(REPOS_DIR, { recursive: true });
}

async function acquireGitLock<T>(fn: () => Promise<T>): Promise<T> {
  if (!gitBusy) {
    gitBusy = true;
    try {
      return await fn();
    } finally {
      gitBusy = false;
      processQueue();
    }
  }

  return new Promise<T>((resolve, reject) => {
    gitQueue.push(async () => {
      gitBusy = true;
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      } finally {
        gitBusy = false;
        processQueue();
      }
    });
  });
}

function processQueue(): void {
  if (gitQueue.length > 0 && !gitBusy) {
    const next = gitQueue.shift()!;
    next().catch((err) => {
      console.error(`[git] error en cola:`, err);
    });
  }
}

export function getRepoPath(owner: string, name: string): string {
  return repoPath(owner, name);
}

export function repoExists(owner: string, name: string): boolean {
  const gitDir = join(repoPath(owner, name), ".git");
  return existsSync(gitDir);
}

export async function cloneRepo(
  owner: string,
  name: string
): Promise<void> {
  const key = repoKey(owner, name);
  const backoff = cloneBackoff.get(key);
  if (backoff && Date.now() < backoff.nextRetryAt) {
    throw new Error(
      `Clone postergado (intento ${backoff.attempt}). Próximo reintento en ${Math.round(
        (backoff.nextRetryAt - Date.now()) / 1000
      )}s`
    );
  }

  const dest = repoPath(owner, name);
  if (existsSync(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }

  return acquireGitLock(async () => {
    ensureReposDir();
    const url = `https://github.com/${owner}/${name}.git`;
    console.log(`[git] clonando ${key} (depth=${CLONE_DEPTH})…`);

    const result = await Bun.$`git clone --depth ${CLONE_DEPTH} ${url} ${dest}`.quiet();
    if (result.exitCode !== 0) {
      const stderr = result.stderr.toString().trim();
      cloneBackoff.set(key, {
        nextRetryAt: Date.now() + Math.min(60000 * Math.pow(2, backoff?.attempt ?? 0), 3600000),
        attempt: (backoff?.attempt ?? 0) + 1,
      });
      throw new Error(`git clone falló: ${stderr}`);
    }

    cloneBackoff.delete(key);
    const headSha = await getHeadSha(owner, name);
    pullThrottle.set(key, Date.now());
    console.log(`[git] ${key} clonado en ${dest} (HEAD: ${headSha?.slice(0, 7) ?? "?"})`);
  });
}

export async function updateRepo(
  owner: string,
  name: string
): Promise<boolean> {
  const key = repoKey(owner, name);
  const path = repoPath(owner, name);

  if (!repoExists(owner, name)) {
    await cloneRepo(owner, name);
    return true;
  }

  const lastPull = pullThrottle.get(key) ?? 0;
  if (Date.now() - lastPull < PULL_COOLDOWN_MS) {
    return false;
  }

  const backoff = cloneBackoff.get(key);
  if (backoff && Date.now() < backoff.nextRetryAt) {
    return false;
  }

  return acquireGitLock(async () => {
    try {
      const hasChanges = await hasRemoteChanges(owner, name);
      if (!hasChanges) {
        pullThrottle.set(key, Date.now());
        return false;
      }

      console.log(`[git] actualizando ${key}…`);
      const result = await Bun.$`git -C ${path} pull --ff-only`.quiet();
      if (result.exitCode !== 0) {
        const stderr = result.stderr.toString().trim();
        cloneBackoff.set(key, {
          nextRetryAt: Date.now() + Math.min(60000 * Math.pow(2, backoff?.attempt ?? 0), 3600000),
          attempt: (backoff?.attempt ?? 0) + 1,
        });
        console.warn(`[git] pull falló ${key}: ${stderr}`);
        return false;
      }

      cloneBackoff.delete(key);
      pullThrottle.set(key, Date.now());
      const headSha = await getHeadSha(owner, name);
      console.log(`[git] ${key} actualizado (HEAD: ${headSha?.slice(0, 7) ?? "?"})`);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[git] updateRepo ${key}: ${msg}`);
      return false;
    }
  });
}

export async function ensureRepo(
  owner: string,
  name: string
): Promise<void> {
  if (repoExists(owner, name)) {
    await updateRepo(owner, name);
  } else {
    await cloneRepo(owner, name);
  }
}

export async function deleteRepo(owner: string, name: string): Promise<void> {
  const key = repoKey(owner, name);
  const path = repoPath(owner, name);
  if (existsSync(path)) {
    rmSync(path, { recursive: true, force: true });
  }
  pullThrottle.delete(key);
  cloneBackoff.delete(key);
}

async function hasRemoteChanges(
  owner: string,
  name: string
): Promise<boolean> {
  const path = repoPath(owner, name);
  try {
    const fetchResult =
      await Bun.$`git -C ${path} remote update`.quiet();
    if (fetchResult.exitCode !== 0) return true;

    const statusResult =
      await Bun.$`git -C ${path} status -uno`.quiet();
    const statusText = statusResult.text().toString();
    return statusText.includes("Your branch is behind");
  } catch {
    return true;
  }
}

export async function getHeadSha(
  owner: string,
  name: string
): Promise<string | null> {
  const path = repoPath(owner, name);
  if (!repoExists(owner, name)) return null;
  try {
    const result = await Bun.$`git -C ${path} rev-parse HEAD`.quiet();
    return result.text().toString().trim() || null;
  } catch {
    return null;
  }
}

export function getCloneStatus(
  owner: string,
  name: string
): CloneStatus {
  const key = repoKey(owner, name);
  const path = repoPath(owner, name);
  const cloned = repoExists(owner, name);
  const backoff = cloneBackoff.get(key);

  let sizeBytes: number | null = null;
  if (cloned && existsSync(path)) {
    try {
      const result = Bun.spawnSync(["du", "-sb", path]);
      if (result.exitCode === 0) {
        sizeBytes = Number(result.stdout.toString().split("\t")[0]) || null;
      }
    } catch {}
  }

  return {
    repoKey: key,
    path,
    cloned,
    headSha: cloned ? "(pendiente)" : null,
    lastPullAt: pullThrottle.get(key) ?? null,
    error: backoff
      ? `Reintento en ${Math.round((backoff.nextRetryAt - Date.now()) / 1000)}s (intento ${backoff.attempt})`
      : null,
    sizeBytes,
  };
}

export function invalidatePullThrottle(owner: string, name: string): void {
  pullThrottle.delete(repoKey(owner, name));
  cloneBackoff.delete(repoKey(owner, name));
}

export async function purgeAllClones(): Promise<number> {
  if (!existsSync(REPOS_DIR)) return 0;

  let count = 0;
  const owners = readdirSync(REPOS_DIR, { withFileTypes: true });
  for (const ownerDir of owners) {
    if (!ownerDir.isDirectory()) continue;
    const ownerPath = join(REPOS_DIR, ownerDir.name);
    const repos = readdirSync(ownerPath, { withFileTypes: true });
    for (const repoDir of repos) {
      if (!repoDir.isDirectory()) continue;
      const repoPath = join(ownerPath, repoDir.name);
      const gitDir = join(repoPath, ".git");
      if (existsSync(gitDir)) {
        rmSync(repoPath, { recursive: true, force: true });
        count++;
      }
    }
    try {
      rmSync(ownerPath, { recursive: true, force: true });
    } catch {}
  }

  pullThrottle.clear();
  cloneBackoff.clear();

  return count;
}

export type CloneCacheInfo = {
  repoCount: number;
  totalSizeBytes: number;
  oldestMtime: number | null;
};

export function getCloneCacheInfo(): CloneCacheInfo {
  if (!existsSync(REPOS_DIR)) {
    return { repoCount: 0, totalSizeBytes: 0, oldestMtime: null };
  }

  let repoCount = 0;
  let totalSizeBytes = 0;
  let oldestMtime: number | null = null;

  const owners = readdirSync(REPOS_DIR, { withFileTypes: true });
  for (const ownerDir of owners) {
    if (!ownerDir.isDirectory()) continue;
    const ownerPath = join(REPOS_DIR, ownerDir.name);
    const repos = readdirSync(ownerPath, { withFileTypes: true });
    for (const repoDir of repos) {
      if (!repoDir.isDirectory()) continue;
      const repoPath = join(ownerPath, repoDir.name);
      const gitDir = join(repoPath, ".git");
      if (!existsSync(gitDir)) continue;
      repoCount++;

      try {
        const du = Bun.spawnSync(["du", "-sb", repoPath]);
        if (du.exitCode === 0) {
          totalSizeBytes += Number(du.stdout.toString().split("\t")[0]) || 0;
        }
      } catch {}

      try {
        const st = statSync(repoPath);
        if (oldestMtime === null || st.mtimeMs < oldestMtime) {
          oldestMtime = st.mtimeMs;
        }
      } catch {}
    }
  }

  return { repoCount, totalSizeBytes, oldestMtime };
}

export async function deleteStaleClones(maxAgeHours: number): Promise<number> {
  if (!existsSync(REPOS_DIR)) return 0;

  const maxAgeMs = maxAgeHours * 3600 * 1000;
  const now = Date.now();
  let deleted = 0;

  const owners = readdirSync(REPOS_DIR, { withFileTypes: true });
  for (const ownerDir of owners) {
    if (!ownerDir.isDirectory()) continue;
    const ownerPath = join(REPOS_DIR, ownerDir.name);
    const repos = readdirSync(ownerPath, { withFileTypes: true });
    for (const repoDir of repos) {
      if (!repoDir.isDirectory()) continue;
      const repoPath = join(ownerPath, repoDir.name);
      const gitDir = join(repoPath, ".git");
      if (!existsSync(gitDir)) continue;
      try {
        const st = statSync(repoPath);
        if (now - st.mtimeMs > maxAgeMs) {
          rmSync(repoPath, { recursive: true, force: true });
          deleted++;
          const key = `${ownerDir.name}/${repoDir.name}`;
          pullThrottle.delete(key);
          cloneBackoff.delete(key);
        }
      } catch {}
    }
    try {
      if (existsSync(ownerPath) && readdirSync(ownerPath).length === 0) {
        rmSync(ownerPath, { recursive: true, force: true });
      }
    } catch {}
  }

  return deleted;
}

export const gitConfig = {
  reposDir: REPOS_DIR,
  pullCooldownMs: PULL_COOLDOWN_MS,
  cloneDepth: CLONE_DEPTH,
};
