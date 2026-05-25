const LLM_URL = (process.env.LLM_URL ?? "http://localhost:1234/v1").replace(
  /\/$/,
  ""
);
const LLM_MODEL = process.env.LLM_MODEL ?? "local-model";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "lm-studio";

export type IssueAnalysis = {
  summary: string;
  type: "bug" | "feature" | "docs" | "question" | "other";
  risk: "low" | "medium" | "high";
  files: string[];
  proposal: string;
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
      response_format: { type: "json_object" },
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
    files: Array.isArray(parsed.files) ? parsed.files.slice(0, 10) : [],
    proposal: parsed.proposal ?? "",
  };
}

export const llmConfig = {
  url: LLM_URL,
  model: LLM_MODEL,
};
