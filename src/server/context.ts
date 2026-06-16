import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { getRepoPath, getHeadSha, repoExists } from "./git";
import { getSetting } from "./settings";

const APPROX_CHARS_PER_TOKEN = 4;

let _CONTEXT_TOKENS = positiveInt(process.env.SENTINEL_CONTEXT_TOKENS, 1024);
let _MAX_CONTEXT_CHARS = _CONTEXT_TOKENS * APPROX_CHARS_PER_TOKEN;
let _CACHE_TTL_MS = positiveInt(
  process.env.SENTINEL_CONTEXT_CACHE_TTL_MS,
  5 * 60 * 1000,
);

function readContextConfig() {
  const fromDb = getSetting("sentinel_context_tokens");
  _CONTEXT_TOKENS = fromDb ? Number(fromDb) : positiveInt(process.env.SENTINEL_CONTEXT_TOKENS, 1024);
  _MAX_CONTEXT_CHARS = _CONTEXT_TOKENS * APPROX_CHARS_PER_TOKEN;

  const cacheTtl = getSetting("sentinel_context_cache_ttl_ms");
  _CACHE_TTL_MS = cacheTtl ? Number(cacheTtl) : positiveInt(process.env.SENTINEL_CONTEXT_CACHE_TTL_MS, 5 * 60 * 1000);
}

try {
  readContextConfig();
} catch {}

export function reloadContextConfig(): void {
  readContextConfig();
  clearContextCache();
  console.log(`[context] config recargada: tokens=${_CONTEXT_TOKENS}, cacheTtl=${_CACHE_TTL_MS}ms`);
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".rb",
  ".php",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".dart",
  ".scala",
  ".elm",
  ".ex",
  ".exs",
  ".vue",
  ".svelte",
  ".astro",
  ".css",
  ".scss",
  ".less",
  ".html",
  ".xml",
  ".yaml",
  ".yml",
  ".json",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".md",
  ".mdx",
  ".txt",
  ".graphql",
  ".gql",
  ".prisma",
  ".sql",
  ".dockerfile",
  ".config",
]);

const EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
  ".nyc_output",
  ".husky",
  ".github",
  "__pycache__",
  ".venv",
  "venv",
  ".rbenv",
  "vendor",
  ".idea",
  ".vscode",
  "target",
  ".gradle",
  "podfile.lock",
  "gemfile.lock",
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "pnpm-lock.yaml",
]);

const EXCLUDE_FILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "bun.lock",
  "pnpm-lock.yaml",
  ".gitignore",
  ".gitkeep",
  ".DS_Store",
  "thumbs.db",
  ".editorconfig",
  ".prettierrc",
  ".eslintrc",
  ".eslintrc.json",
]);

type CachedContext = {
  context: string;
  headSha: string | null;
  extractedAt: number;
};

const contextCache = new Map<string, CachedContext>();

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function cleanPromptText(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateForPrompt(value: string, maxChars: number): string {
  const clean = cleanPromptText(value);
  if (clean.length <= maxChars) return clean;
  if (maxChars <= 20) return clean.slice(0, Math.max(0, maxChars));

  const marker = "\n...[truncado]...\n";
  const available = Math.max(0, maxChars - marker.length);
  const head = Math.ceil(available * 0.7);
  const tail = available - head;

  return `${clean.slice(0, head).trimEnd()}${marker}${clean
    .slice(clean.length - tail)
    .trimStart()}`;
}

function extractKeywords(text: string | null): Set<string> {
  if (!text) return new Set();

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúüñ\s_-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && w.length < 40 && !/^\d+$/.test(w))
    .filter(
      (w) =>
        ![
          "this",
          "that",
          "with",
          "from",
          "have",
          "been",
          "were",
          "when",
          "what",
          "does",
          "should",
          "would",
          "could",
          "after",
          "then",
          "just",
          "also",
          "more",
          "some",
          "them",
          "than",
          "very",
          "much",
          "such",
          "each",
          "well",
          "even",
          "still",
          "already",
          "about",
          "into",
          "over",
          "between",
          "without",
          "because",
          "being",
          "done",
          "made",
          "make",
          "need",
          "using",
          "used",
          "use",
          "like",
          "support",
          "implement",
          "issue",
        ].includes(w),
    )
    .map((w) => w.replace(/^[-_]+|[-_]+$/g, ""));

  const unique = new Set(words);
  const sorted = [...unique].sort((a, b) => b.length - a.length);
  return new Set(sorted.slice(0, 15));
}

type SearchHit = {
  file: string;
  line: number;
  content: string;
  score: number;
};

function searchWithRipgrep(repoDir: string, keywords: string[]): SearchHit[] {
  if (keywords.length === 0) return [];

  const pattern = keywords
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  try {
    const excludes = [...EXCLUDE_DIRS]
      .map((d) => `--glob='!${d}/**'`)
      .join(" ");
    const exts = [...SOURCE_EXTENSIONS]
      .map((e) => `--type-add 'code:*.${e.slice(1)}'`)
      .join(" ");
    const cmd = `rg -n -C 2 --no-heading -i -e "${pattern}" ${excludes} ${exts} "${repoDir}" 2>/dev/null | head -200`;

    const result = Bun.spawnSync(["sh", "-c", cmd]);
    if (result.exitCode !== 0 && result.exitCode !== 1) return [];
    const output = result.stdout.toString();
    if (!output.trim()) return [];

    const hits: SearchHit[] = [];
    const lines = output.split("\n");
    for (const line of lines) {
      const match = line.match(/^(.+?):(\d+):(.+)$/);
      if (!match) continue;
      const [, file, lineNum, content] = match;
      const relFile = relative(repoDir, file);
      const score = keywords.filter((kw) =>
        content.toLowerCase().includes(kw),
      ).length;
      hits.push({ file: relFile, line: Number(lineNum), content, score });
    }
    return hits;
  } catch {
    return [];
  }
}

function collectSourceFiles(dir: string, baseDir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          files.push(...collectSourceFiles(fullPath, baseDir));
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (
          SOURCE_EXTENSIONS.has(ext) &&
          !EXCLUDE_FILES.has(entry.name) &&
          !entry.name.startsWith(".")
        ) {
          files.push(fullPath);
        }
      }
    }
  } catch {}
  return files;
}

function searchFsBfs(repoDir: string, keywords: string[]): SearchHit[] {
  if (keywords.length === 0) return [];

  const keywordSet = new Set(keywords);

  try {
    const files = collectSourceFiles(repoDir, repoDir);

    const hits: SearchHit[] = [];
    for (const file of files) {
      try {
        const stat = statSync(file);
        if (stat.size > 100_000) continue;

        const content = readFileSync(file, "utf-8").slice(0, 5000);

        let score = 0;
        const matchedLines: { lineNum: number; lineContent: string }[] = [];
        const contentLines = content.split("\n");

        for (let i = 0; i < contentLines.length; i++) {
          const line = contentLines[i];
          const lineLower = line.toLowerCase();
          let lineScore = 0;
          for (const kw of keywordSet) {
            if (lineLower.includes(kw)) {
              const regex = new RegExp(
                kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
                "gi",
              );
              const matches = line.match(regex);
              lineScore += matches?.length ?? 1;
            }
          }
          if (lineScore > 0) {
            score += lineScore;
            matchedLines.push({ lineNum: i + 1, lineContent: line });
          }
        }

        if (score > 0) {
          const relFile = relative(repoDir, file);
          for (const ml of matchedLines.slice(0, 5)) {
            hits.push({
              file: relFile,
              line: ml.lineNum,
              content: ml.lineContent.trim(),
              score,
            });
          }
        }
      } catch {}
    }

    return hits;
  } catch {
    return [];
  }
}

function hasRipgrep(): boolean {
  try {
    const result = Bun.spawnSync(["which", "rg"]);
    return result.exitCode === 0;
  } catch {
    return false;
  }
}

function aggregateContext(hits: SearchHit[], maxChars: number): string {
  if (hits.length === 0) return "";

  const unique = new Map<string, SearchHit[]>();
  for (const hit of hits) {
    const existing = unique.get(hit.file) ?? [];
    existing.push(hit);
    unique.set(hit.file, existing);
  }

  const sorted = [...unique.entries()]
    .map(([file, fileHits]) => ({
      file,
      totalScore: fileHits.reduce((a, h) => a + h.score, 0),
      hits: fileHits.slice(0, 8),
    }))
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10);

  let result = "";
  let remaining = maxChars;

  for (const { file, hits } of sorted) {
    if (remaining <= 0) break;

    let block = `\`${file}\`:\n`;
    for (const hit of hits) {
      if (remaining - block.length - hit.content.length - 10 <= 0) break;
      block += `  ${hit.line}: ${hit.content}\n`;
    }
    block += "\n";

    if (block.length <= remaining) {
      result += block;
      remaining -= block.length;
    }
  }

  return result.trim();
}

export async function extractContext(
  owner: string,
  repo: string,
  title: string,
  body: string | null,
  maxChars?: number,
): Promise<string> {
  const budget = maxChars ?? _MAX_CONTEXT_CHARS;
  const repoKey = `${owner}/${repo}`;
  const now = Date.now();

  const cached = contextCache.get(repoKey);
  if (cached && now - cached.extractedAt < _CACHE_TTL_MS) {
    const headSha = await getHeadSha(owner, repo);
    if (headSha === cached.headSha) {
      return cached.context.length <= budget
        ? cached.context
        : truncateForPrompt(cached.context, budget);
    }
  }

  if (!repoExists(owner, repo)) {
    return "";
  }

  const repoDir = getRepoPath(owner, repo);
  if (!existsSync(repoDir)) {
    return "";
  }

  const keywords = extractKeywords(`${title} ${body ?? ""}`);
  if (keywords.size === 0) {
    return "";
  }

  const kwArray = [...keywords];
  const useRipgrep = hasRipgrep();
  let hits: SearchHit[];

  if (useRipgrep) {
    hits = searchWithRipgrep(repoDir, kwArray);
  } else {
    hits = searchFsBfs(repoDir, kwArray);
  }

  const context = aggregateContext(hits, budget);

  const headSha = await getHeadSha(owner, repo);
  contextCache.set(repoKey, {
    context,
    headSha,
    extractedAt: now,
  });

  if (context && useRipgrep) {
    console.log(
      `[context] ${repoKey}: ${kwArray.length} keywords, ${hits.length} hits, ${context.length} chars (ripgrep)`,
    );
  } else if (context) {
    console.log(
      `[context] ${repoKey}: ${kwArray.length} keywords, ${hits.length} hits, ${context.length} chars (fs)`,
    );
  }

  return context;
}

export function invalidateRepoContext(owner: string, repo: string): void {
  contextCache.delete(`${owner}/${repo}`);
}

export function clearContextCache(): void {
  contextCache.clear();
}

export function getCachedKeys(): string[] {
  return [...contextCache.keys()];
}

export function contextCacheSize(): number {
  let totalChars = 0;
  for (const entry of contextCache.values()) {
    totalChars += entry.context.length;
  }
  return totalChars;
}

export const contextConfig = {
  get maxTokens() { return _CONTEXT_TOKENS; },
  get maxChars() { return _MAX_CONTEXT_CHARS; },
  get cacheTtlMs() { return _CACHE_TTL_MS; },
  hasRipgrep: hasRipgrep(),
};
