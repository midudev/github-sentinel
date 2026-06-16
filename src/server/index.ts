import { serve } from "bun";
import { join, normalize, resolve, sep } from "node:path";
import index from "../client/index.html";
import { closeDatabase, DB_PATH, queries } from "./db";
import {
  getRepo as fetchRepo,
  listUserRepos,
  parseRepoInput,
  parseUserInput,
} from "./github";
import { isLLMAvailable, llmConfig, analyzeIssue, reloadLLMConfig } from "./llm";
import {
  runCheck,
  startScheduler,
  status,
  stopScheduler,
  updateInterval,
} from "./sentinel";
import {
  digestStatus,
  previewDigest,
  runDigest,
  startDigestScheduler,
  stopDigestScheduler,
} from "./digest";
import {
  getCloneStatus,
  invalidatePullThrottle,
  gitConfig,
  ensureRepo as ensureRepoClone,
  getHeadSha as getRepoHeadSha,
  purgeAllClones,
  getCloneCacheInfo,
} from "./git";
import { contextConfig, getCachedKeys, contextCacheSize, reloadContextConfig, clearContextCache } from "./context";
import {
  getAllSettings,
  setSetting,
  fetchLLMModels,
  getSetting,
} from "./settings";

const PORT = Number(process.env.PORT ?? 3741);
const HOST = process.env.HOST ?? "127.0.0.1";
const IDLE_TIMEOUT_SECONDS = positiveInt(
  process.env.SERVER_IDLE_TIMEOUT_SECONDS,
  60
);

const PROJECT_ROOT = process.cwd();
const PUBLIC_DIR = resolve(PROJECT_ROOT, "public");
const STARTED_AT = Date.now();

function json(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

function badRequest(message: string) {
  return json({ error: message }, { status: 400 });
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function serveStatic(req: Request) {
  const url = new URL(req.url);
  const pathname = decodeURIComponent(url.pathname);
  const safe = normalize(pathname).replace(/^([/\\])+/, "");
  const full = join(PUBLIC_DIR, safe);
  if (!full.startsWith(PUBLIC_DIR + sep) && full !== PUBLIC_DIR) {
    return new Response("Forbidden", { status: 403 });
  }
  return new Response(Bun.file(full), {
    headers: {
      "Cache-Control":
        process.env.NODE_ENV === "production"
          ? "public, max-age=31536000, immutable"
          : "no-cache",
    },
  });
}

const server = serve({
  port: PORT,
  hostname: HOST,
  idleTimeout: IDLE_TIMEOUT_SECONDS,

  error(err) {
    console.error(`[sentinel] ${ts()} unhandled server error:`, err);
    return new Response("Internal Server Error", { status: 500 });
  },

  routes: {
    "/favicon.svg": (req) => serveStatic(req),
    "/favicon.ico": (req) => serveStatic(req),
    "/*": index,

    "/api/health": {
      GET() {
        return json({
          ok: true,
          uptime: Math.round((Date.now() - STARTED_AT) / 1000),
          pid: process.pid,
          platform: process.platform,
          bun: Bun.version,
        });
      },
    },

    "/api/status": {
      async GET() {
        const repos = queries.listRepos.all();
        const total = queries.countIssues.get()?.total ?? 0;
        const analyzed = queries.countAnalyzed.get()?.total ?? 0;
        const openPRs = queries.countOpenPRs.get()?.total ?? 0;
        const llmAvailable = await isLLMAvailable();
        const digest = digestStatus();
        return json({
          ...status(),
          repos: repos.length,
          issues: total,
          analyzed,
          openPRs,
          llm: {
            available: llmAvailable,
            url: llmConfig.url,
            model: llmConfig.model,
            backend: getSetting("llm_backend") ?? "openai",
          },
          whatsapp: {
            ...digest.config,
            lastSent: digest.lastSent,
            nextRunAt: digest.nextRunAt,
          },
          platform: process.platform,
        });
      },
    },

    "/api/notify/preview": {
      async GET() {
        const cfg = digestStatus().config;
        return json(
          await previewDigest({ slot: "manual", timezone: cfg.timezone })
        );
      },
    },

    "/api/notify/test": {
      async POST() {
        try {
          const cfg = digestStatus().config;
          if (!cfg.configured) {
            return badRequest(
              "WhatsApp no configurado. Define WHATSAPP_PHONE y CALLMEBOT_API_KEY."
            );
          }
          const result = await runDigest({
            slot: "manual",
            timezone: cfg.timezone,
          });
          return json({ ok: true, ...result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return json({ error: msg }, { status: 500 });
        }
      },
    },

    "/api/repos": {
      async GET() {
        return json(queries.listRepos.all());
      },
      async POST(req) {
        try {
          const body = (await req.json()) as { repo?: string };
          if (!body.repo) return badRequest("Falta 'repo'");

          const { owner, name } = parseRepoInput(body.repo);
          const existing = queries.findRepo.get(owner, name);
          if (existing) return json(existing, { status: 200 });

          const meta = await fetchRepo(owner, name);
          const row = queries.insertRepo.get(
            owner,
            name,
            meta.description,
            meta.stargazers_count,
            meta.open_issues_count,
            new Date().toISOString()
          );
          void runCheck();
          return json(row, { status: 201 });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return badRequest(msg);
        }
      },
    },

    "/api/repos/preview": {
      async POST(req) {
        try {
          const body = (await req.json()) as {
            user?: string;
            excludeForks?: boolean;
            excludeArchived?: boolean;
          };
          if (!body.user) return badRequest("Falta 'user'");

          const user = parseUserInput(body.user);
          const remote = await listUserRepos(user, {
            excludeForks: body.excludeForks ?? true,
            excludeArchived: body.excludeArchived ?? true,
          });

          const repos = remote.map((meta) => {
            const owner = meta.owner.login;
            const name = meta.name;
            const existing = queries.findRepo.get(owner, name);
            return {
              owner,
              name,
              description: meta.description,
              stars: meta.stargazers_count,
              open_issues: meta.open_issues_count,
              fork: meta.fork ?? false,
              archived: meta.archived ?? false,
              already_watched: Boolean(existing),
            };
          });

          return json({
            ok: true,
            user,
            total: repos.length,
            repos,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return badRequest(msg);
        }
      },
    },

    "/api/repos/bulk": {
      async POST(req) {
        try {
          const body = (await req.json()) as {
            repos?: Array<{
              owner?: string;
              name?: string;
              description?: string | null;
              stars?: number;
              open_issues?: number;
            }>;
          };
          if (!Array.isArray(body.repos) || body.repos.length === 0) {
            return badRequest("Falta 'repos' (array no vacío)");
          }

          const now = new Date().toISOString();
          let added = 0;
          let skipped = 0;

          for (const meta of body.repos) {
            if (!meta.owner || !meta.name) continue;
            const existing = queries.findRepo.get(meta.owner, meta.name);
            if (existing) {
              skipped++;
              continue;
            }
            queries.insertRepo.get(
              meta.owner,
              meta.name,
              meta.description ?? null,
              meta.stars ?? 0,
              meta.open_issues ?? 0,
              now
            );
            added++;
          }

          if (added > 0) void runCheck();

          return json({
            ok: true,
            total: body.repos.length,
            added,
            skipped,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return badRequest(msg);
        }
      },
    },

    "/api/repos/:id": {
      async DELETE(req) {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return badRequest("id inválido");
        queries.deleteRepo.run(id);
        return json({ ok: true });
      },
    },

    "/api/issues": {
      async GET(req) {
        const url = new URL(req.url);
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);
        const issues = queries.listIssues.all(limit).map((row) => ({
          ...row,
          labels: JSON.parse(row.labels ?? "[]"),
        }));
        return json(issues);
      },
    },

    "/api/issues/:id/analyze": {
      async POST(req) {
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return badRequest("id inválido");

        const issue = queries.getIssue.get(id);
        if (!issue) return json({ error: "issue no encontrada" }, { status: 404 });

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
            id
          );

          return json({ ok: true, analysis: result });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return json({ error: msg }, { status: 500 });
        }
      },
    },

    "/api/settings": {
      async GET() {
        const settings = getAllSettings();
        return json({ settings });
      },
      async PUT(req) {
        try {
          const body = (await req.json()) as { key?: string; value?: string };
          if (!body.key || body.value === undefined) {
            return badRequest("Faltan 'key' y 'value'");
          }

          const ok = setSetting(body.key, body.value);
          if (!ok) return badRequest(`Setting '${body.key}' no válida`);

          if (body.key.startsWith("llm_")) {
            reloadLLMConfig();
          } else if (body.key.startsWith("sentinel_context_")) {
            reloadContextConfig();
          } else if (body.key === "sentinel_interval_ms") {
            updateInterval(Number(body.value));
          }

          const updated = getAllSettings();
          return json({ ok: true, settings: updated });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return badRequest(msg);
        }
      },
    },

    "/api/settings/models": {
      async GET(req) {
        const url = new URL(req.url);
        const backend = url.searchParams.get("backend") || undefined;
        const llmUrl = url.searchParams.get("url") || undefined;
        const models = await fetchLLMModels(
          backend || llmUrl ? { backend, url: llmUrl } : undefined
        );
        const currentModel = getSetting("llm_model");
        return json({
          models,
          current: currentModel,
          url: llmUrl ?? getSetting("llm_url"),
        });
      },
    },

    "/api/clones": {
      async GET() {
        const repos = queries.listRepos.all();
        const clones = repos.map((r) => getCloneStatus(r.owner, r.name));
        return json({
          clones,
          cache: {
            entries: getCachedKeys().length,
            sizeChars: contextCacheSize(),
            hasRipgrep: contextConfig.hasRipgrep,
          },
          config: gitConfig,
        });
      },
    },

    "/api/clones/sync": {
      async POST() {
        const repos = queries.listRepos.all();
        let synced = 0;
        let failed = 0;
        for (const repo of repos) {
          try {
            invalidatePullThrottle(repo.owner, repo.name);
            await ensureRepoClone(repo.owner, repo.name);
            const headSha = await getRepoHeadSha(repo.owner, repo.name);
            if (headSha) {
              queries.updateHeadSha.run(headSha, repo.id);
              queries.updateCloneStatus.run("synced", null, repo.id);
            }
            synced++;
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            queries.updateCloneStatus.run("error", msg, repo.id);
            failed++;
          }
        }
        return json({ ok: true, synced, failed });
      },
    },

    "/api/clones/purge": {
      async POST() {
        try {
          const deleted = await purgeAllClones();
          queries.resetCloneStatus.run();
          clearContextCache();
          return json({ ok: true, deleted });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return json({ error: msg }, { status: 500 });
        }
      },
    },

    "/api/clones/purge-status": {
      async GET() {
        const info = getCloneCacheInfo();
        const oldestHours = info.oldestMtime
          ? Math.round((Date.now() - info.oldestMtime) / 3600000)
          : null;
        return json({
          repoCount: info.repoCount,
          totalSizeBytes: info.totalSizeBytes,
          totalSizeMb: info.totalSizeBytes
            ? Math.round(info.totalSizeBytes / (1024 * 1024))
            : 0,
          oldestHours,
          autoCleanup: getSetting("clone_cache_auto_cleanup"),
          maxAgeHours: getSetting("clone_cache_max_age_hours"),
        });
      },
    },

    "/api/check": {
      async POST() {
        const results = await runCheck();
        return json({ ok: true, results });
      },
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

startScheduler();
startDigestScheduler();

function ts() {
  return new Date().toISOString();
}

console.log(`\n  GitHub Sentinel`);
console.log(`  ───────────────`);
console.log(`  url      ${server.url}`);
console.log(`  platform ${process.platform} · bun ${Bun.version}`);
console.log(`  db       ${DB_PATH}`);
console.log(`  pid      ${process.pid}\n`);

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[sentinel] ${ts()} ${signal} recibido, cerrando…`);
  try {
    stopScheduler();
    stopDigestScheduler();
    await server.stop(true);
    closeDatabase();
    console.log(`[sentinel] ${ts()} cierre limpio. bye.`);
    process.exit(0);
  } catch (err) {
    console.error(`[sentinel] error durante el cierre:`, err);
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
if (process.platform === "win32") {
  process.on("SIGBREAK", () => void shutdown("SIGBREAK"));
  process.on("SIGHUP", () => void shutdown("SIGHUP"));
}

process.on("uncaughtException", (err) => {
  console.error(`[sentinel] ${ts()} uncaughtException:`, err);
});
process.on("unhandledRejection", (reason) => {
  console.error(`[sentinel] ${ts()} unhandledRejection:`, reason);
});
