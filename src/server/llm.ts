const LLM_URL = (process.env.LLM_URL ?? "http://localhost:1234/v1").replace(
  /\/$/,
  ""
);
const LLM_MODEL = process.env.LLM_MODEL ?? "local-model";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "sentinel-local";

export type IssueAnalysis = {
  summary: string;
  type: "bug" | "feature" | "docs" | "question" | "other";
  risk: "low" | "medium" | "high";
  files: string[];
  proposal: string;
};

export type PullRequestPriorityInput = {
  id: string;
  repo: string;
  number: number;
  title: string;
  description: string | null;
  author: string | null;
  age: string;
  comments: number;
  labels: string[];
  url: string;
};

export type PullRequestPriority = {
  id: string;
  priority: "high" | "medium" | "low";
  reason: string;
  action: string;
};

export type PullRequestPriorityResult = {
  summary: string;
  focus: PullRequestPriority[];
};

const SYSTEM_PROMPT = `Eres un agente de mantenimiento de repositorios open source.
Recibes una issue y devuelves UN SOLO JSON válido (sin texto extra, sin markdown, sin backticks)
con esta forma exacta:

{
  "summary": "string corto y claro (máx 240 caracteres)",
  "type": "bug" | "feature" | "docs" | "question" | "other",
  "risk": "low" | "medium" | "high",
  "files": ["rutas/probables", "..."],
  "proposal": "Propuesta de solución concreta en 3-5 frases, en español."
}`;

const PR_PRIORITY_SYSTEM_PROMPT = `Eres un agente de triage para un digest de WhatsApp.
Vas muy a saco: directo, útil, sin relleno y optimizado para leer en móvil.
Tu trabajo es elegir como máximo 3 PRs externas que merecen foco ahora.
Prioriza impacto, urgencia, riesgo, antigüedad, bloqueos probables y facilidad de revisión.
Usa SOLO repo, título, descripción de la PR, autor, labels, comentarios y edad.
No pidas ver archivos, no menciones diffs, no inventes datos y no listes todas las PRs.
Devuelve UN SOLO JSON válido (sin texto extra, sin markdown, sin backticks) con esta forma exacta:

{
  "summary": "frase corta del estado general, máximo 140 caracteres",
  "focus": [
    {
      "id": "owner/repo#123",
      "priority": "high" | "medium" | "low",
      "reason": "por qué importa ahora, máximo 120 caracteres",
      "action": "qué hacer, máximo 100 caracteres"
    }
  ]
}`;

const ISSUE_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "issue_analysis",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "type", "risk", "files", "proposal"],
      properties: {
        summary: { type: "string" },
        type: {
          type: "string",
          enum: ["bug", "feature", "docs", "question", "other"],
        },
        risk: { type: "string", enum: ["low", "medium", "high"] },
        files: { type: "array", items: { type: "string" } },
        proposal: { type: "string" },
      },
    },
  },
} as const;

const PR_PRIORITY_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "pull_request_priority",
    schema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "focus"],
      properties: {
        summary: { type: "string" },
        focus: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["id", "priority", "reason", "action"],
            properties: {
              id: { type: "string" },
              priority: { type: "string", enum: ["high", "medium", "low"] },
              reason: { type: "string" },
              action: { type: "string" },
            },
          },
        },
      },
    },
  },
} as const;

function buildUserPrompt(input: {
  owner: string;
  repo: string;
  title: string;
  body: string | null;
  labels: string[];
}) {
  return `Repositorio: ${input.owner}/${input.repo}
Labels: ${input.labels.join(", ") || "ninguna"}

Título de la issue:
${input.title}

Descripción:
${input.body?.slice(0, 4000) || "(sin descripción)"}

Devuelve SOLO el JSON, nada más.`;
}

function buildPullRequestPriorityPrompt(input: PullRequestPriorityInput[]) {
  const compact = input.map((pr) => ({
    id: pr.id,
    repo: pr.repo,
    number: pr.number,
    title: pr.title,
    description: pr.description,
    author: pr.author,
    age: pr.age,
    comments: pr.comments,
    labels: pr.labels,
    url: pr.url,
  }));

  return `PRs candidatas en JSON compacto:
${JSON.stringify(compact)}

Elige máximo 3. Si ninguna merece foco real, devuelve focus vacío.
Devuelve SOLO el JSON, nada más.`;
}

const authHeaders: HeadersInit = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${LLM_API_KEY}`,
};

export async function isLLMAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${LLM_URL}/models`, {
      signal: AbortSignal.timeout(2000),
      headers: { Authorization: `Bearer ${LLM_API_KEY}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

function extractJson(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  return candidate.slice(start, end + 1);
}

function normalizeFiles(files: unknown): string[] {
  if (!Array.isArray(files)) return [];

  const unique = new Set<string>();
  for (const file of files) {
    if (typeof file !== "string") continue;
    const value = file.trim();
    if (!value) continue;
    unique.add(value);
    if (unique.size >= 10) break;
  }

  return [...unique];
}

export async function analyzeIssue(input: {
  owner: string;
  repo: string;
  title: string;
  body: string | null;
  labels: string[];
}): Promise<IssueAnalysis> {
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: ISSUE_RESPONSE_FORMAT,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(input) },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonRaw = extractJson(content) ?? content;

  let parsed: IssueAnalysis;
  try {
    parsed = JSON.parse(jsonRaw) as IssueAnalysis;
  } catch {
    throw new Error(`No pude parsear la respuesta del modelo:\n${content}`);
  }

  return {
    summary: parsed.summary ?? "",
    type: (parsed.type ?? "other") as IssueAnalysis["type"],
    risk: (parsed.risk ?? "low") as IssueAnalysis["risk"],
    files: normalizeFiles(parsed.files),
    proposal: parsed.proposal ?? "",
  };
}

function normalizePriority(value: unknown): PullRequestPriority["priority"] {
  return value === "high" || value === "medium" || value === "low"
    ? value
    : "medium";
}

function cleanShortText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export async function prioritizePullRequests(
  input: PullRequestPriorityInput[]
): Promise<PullRequestPriorityResult> {
  if (input.length === 0) return { summary: "Sin PRs externas abiertas.", focus: [] };

  const validIds = new Set(input.map((pr) => pr.id));
  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.1,
      response_format: PR_PRIORITY_RESPONSE_FORMAT,
      messages: [
        { role: "system", content: PR_PRIORITY_SYSTEM_PROMPT },
        { role: "user", content: buildPullRequestPriorityPrompt(input) },
      ],
      stream: false,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  const jsonRaw = extractJson(content) ?? content;

  let parsed: { summary?: unknown; focus?: unknown };
  try {
    parsed = JSON.parse(jsonRaw) as { summary?: unknown; focus?: unknown };
  } catch {
    throw new Error(`No pude parsear la priorización de PRs:\n${content}`);
  }

  const focus: PullRequestPriority[] = [];
  if (Array.isArray(parsed.focus)) {
    for (const item of parsed.focus) {
      if (!item || typeof item !== "object") continue;
      const raw = item as Record<string, unknown>;
      const id = cleanShortText(raw.id, 120);
      if (!validIds.has(id)) continue;
      focus.push({
        id,
        priority: normalizePriority(raw.priority),
        reason: cleanShortText(raw.reason, 120),
        action: cleanShortText(raw.action, 100),
      });
      if (focus.length >= 3) break;
    }
  }

  return {
    summary: cleanShortText(parsed.summary, 140),
    focus,
  };
}

export const llmConfig = {
  url: LLM_URL,
  model: LLM_MODEL,
};
