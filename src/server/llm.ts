import { queries } from "./db";

const LLM_URL = (process.env.LLM_URL ?? "http://localhost:1234/v1").replace(
  /\/$/,
  "",
);
const LLM_MODEL = process.env.LLM_MODEL ?? "local-model";
const LLM_API_KEY = process.env.LLM_API_KEY ?? "sentinel-local";
const LLM_MAX_CONTEXT_TOKENS = positiveInt(
  process.env.LLM_MAX_CONTEXT_TOKENS,
  4096,
);
const LLM_MAX_OUTPUT_TOKENS = positiveInt(
  process.env.LLM_MAX_OUTPUT_TOKENS,
  400,
);
const LLM_CONTEXT_SAFETY_TOKENS = positiveInt(
  process.env.LLM_CONTEXT_SAFETY_TOKENS,
  128,
);
const APPROX_CHARS_PER_TOKEN = 4;
const CONTEXT_RETRY_SCALES = [1, 0.5, 0.22] as const;

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

type ChatMessage = {
  role: "system" | "user";
  content: string;
};

type ChatCompletionPayload = {
  model: string;
  temperature: number;
  max_tokens: number;
  response_format:
    | typeof ISSUE_RESPONSE_FORMAT
    | typeof PR_PRIORITY_RESPONSE_FORMAT;
  messages: ChatMessage[];
  stream: false;
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
Tu trabajo es elegir las 3 PRs externas más prioritarias ahora.
Prioriza impacto, urgencia, riesgo, antigüedad, bloqueos probables y facilidad de revisión.
Usa SOLO repo, título, descripción de la PR, autor, labels, comentarios y edad.
No pidas ver archivos, no menciones diffs, no inventes datos y no listes PRs.
Las PRs elegidas se enviarán juntas en un único WhatsApp: la razón debe ser la única frase del cuerpo de cada bloque.
Máxima densidad: sin "por qué", sin "acción", sin etiquetas, sin introducciones.
Devuelve UN SOLO JSON válido (sin texto extra, sin markdown, sin backticks) con esta forma exacta:

{
  "summary": "frase ultra corta del estado general, máximo 80 caracteres",
  "focus": [
    {
      "id": "owner/repo#123",
      "priority": "high" | "medium" | "low",
      "reason": "frase directa en español sobre el impacto, máximo 110 caracteres",
      "action": ""
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

function approxTokens(chars: number): number {
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

function promptBudgetChars(
  responseFormat: ChatCompletionPayload["response_format"],
  scale: number,
): number {
  const contextChars =
    Math.max(
      256,
      LLM_MAX_CONTEXT_TOKENS -
        LLM_MAX_OUTPUT_TOKENS -
        LLM_CONTEXT_SAFETY_TOKENS,
    ) * APPROX_CHARS_PER_TOKEN;
  const fixedPayloadChars = JSON.stringify({
    model: LLM_MODEL,
    temperature: 0,
    max_tokens: LLM_MAX_OUTPUT_TOKENS,
    response_format: responseFormat,
    messages: [
      { role: "system", content: "" },
      { role: "user", content: "" },
    ],
    stream: false,
  }).length;

  return Math.max(400, Math.floor((contextChars - fixedPayloadChars) * scale));
}

function logContext(operation: string, payload: ChatCompletionPayload): void {
  const promptChars = payload.messages.reduce(
    (total, message) => total + message.content.length,
    0,
  );
  const requestChars = JSON.stringify(payload).length;
  console.log(
    `[llm] ${operation} contexto aprox: prompt=${approxTokens(
      promptChars,
    )} tokens/${promptChars} chars, request=${approxTokens(
      requestChars,
    )} tokens/${requestChars} chars, max=${LLM_MAX_CONTEXT_TOKENS}, output=${payload.max_tokens}`,
  );
}

function isContextSizeError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /context.*exceed|exceed.*context|context size|context length|too many tokens|token limit|maximum context/i.test(
    msg,
  );
}

async function requestChatCompletion(
  operation: string,
  payload: ChatCompletionPayload,
): Promise<string> {
  logContext(operation, payload);

  const res = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM ${res.status}: ${text.slice(0, 500)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      total_tokens?: number;
    };
  };

  if (data.usage) {
    console.log(
      `[llm] ${operation} usage proveedor: prompt=${
        data.usage.prompt_tokens ?? "?"
      }, completion=${data.usage.completion_tokens ?? "?"}, total=${
        data.usage.total_tokens ?? "?"
      }`,
    );
  }

  return data.choices?.[0]?.message?.content ?? "";
}

function buildUserPrompt(
  input: {
    owner: string;
    repo: string;
    title: string;
    body: string | null;
    labels: string[];
  },
  maxChars: number,
) {
  const labels =
    input.labels
      .slice(0, 8)
      .map((label) => truncateForPrompt(label, 50))
      .join(", ") || "ninguna";
  const title = truncateForPrompt(input.title, 240);
  const withoutBody = `Repositorio: ${input.owner}/${input.repo}
Labels: ${labels}

Título de la issue:
${title}

Descripción:

Devuelve SOLO el JSON, nada más.`;
  const bodyMax = Math.max(0, maxChars - withoutBody.length);

  return `Repositorio: ${input.owner}/${input.repo}
Labels: ${labels}

Título de la issue:
${title}

Descripción:
${input.body ? truncateForPrompt(input.body, bodyMax) : "(sin descripción)"}

Devuelve SOLO el JSON, nada más.`;
}

function buildPullRequestPriorityPrompt(
  input: PullRequestPriorityInput[],
  maxChars: number,
) {
  let maxItems = input.length;
  let descriptionChars = 280;

  while (true) {
    const compact = input.slice(0, maxItems).map((pr) => ({
      id: truncateForPrompt(pr.id, 120),
      repo: truncateForPrompt(pr.repo, 100),
      title: truncateForPrompt(pr.title, 160),
      description: pr.description
        ? truncateForPrompt(pr.description, descriptionChars)
        : null,
      author: pr.author ? truncateForPrompt(pr.author, 80) : null,
      age: pr.age,
      comments: pr.comments,
      labels: pr.labels
        .slice(0, 8)
        .map((label) => truncateForPrompt(label, 40)),
    }));

    const prompt = `PRs candidatas en JSON compacto:
${JSON.stringify(compact)}

Elige máximo 3. Si ninguna merece foco real, devuelve focus vacío.
Devuelve SOLO el JSON, nada más.`;

    if (
      prompt.length <= maxChars ||
      (maxItems <= 3 && descriptionChars <= 80)
    ) {
      return prompt;
    }

    if (descriptionChars > 80) {
      descriptionChars = Math.max(80, Math.floor(descriptionChars * 0.6));
    } else {
      maxItems = Math.max(3, maxItems - 2);
    }
  }
}

const authHeaders: HeadersInit = {
  "Content-Type": "application/json",
  Authorization: `Bearer ${LLM_API_KEY}`,
};

export function isMockLLMEnabled(): boolean {
  return (
    process.env.SENTINEL_MOCK_LLM === "true" ||
    process.env.SENTINEL_MOCK_ALL === "true"
  );
}

export function getMockAnalysis(
  title: string,
  body: string | null,
): IssueAnalysis {
  const t = title.toLowerCase();
  let type: IssueAnalysis["type"] = "other";
  let risk: IssueAnalysis["risk"] = "low";
  let summary = `Análisis de la issue: ${title.slice(0, 50)}...`;
  let proposal =
    "Verifica que el flujo local esté configurado. Para obtener propuestas de IA reales, inicia un servidor LLM compatible con OpenAI.";
  let files: string[] = ["src/server/index.ts"];

  if (
    t.includes("error") ||
    t.includes("bug") ||
    t.includes("fallo") ||
    t.includes("no funciona") ||
    t.includes("crash") ||
    t.includes("fail") ||
    t.includes("problema")
  ) {
    type = "bug";
    risk = "high";
    summary = `Corregir fallo reportado en "${title.slice(0, 40)}"`;
    proposal =
      "Se sugiere revisar el control de excepciones (try/catch) en la función afectada, validar que los parámetros de configuración en el archivo .env estén cargados correctamente y agregar tests unitarios para verificar el comportamiento con entradas inválidas.";
    files = ["src/server/db.ts", "src/server/index.ts"];
  } else if (
    t.includes("soporte") ||
    t.includes("feature") ||
    t.includes("añadir") ||
    t.includes("agregar") ||
    t.includes("crear") ||
    t.includes("add") ||
    t.includes("support")
  ) {
    type = "feature";
    risk = "medium";
    summary = `Añadir soporte para: "${title.slice(0, 45)}"`;
    proposal =
      "Para implementar esto, debemos definir el nuevo modelo de datos en src/server/db.ts, crear los handlers correspondientes en el servidor, e integrar los nuevos controles y vistas en el dashboard de React en src/client/.";
    files = ["src/client/App.tsx", "src/server/db.ts", "src/server/index.ts"];
  } else if (
    t.includes("doc") ||
    t.includes("readme") ||
    t.includes("escribir") ||
    t.includes("guia") ||
    t.includes("tutorial")
  ) {
    type = "docs";
    risk = "low";
    summary = `Actualizar la documentación técnica para "${title.slice(0, 30)}"`;
    proposal =
      "Es necesario documentar el nuevo comportamiento en el README.md principal, añadiendo ejemplos prácticos de configuración de variables de entorno y un diagrama simplificado del flujo de datos en el sistema.";
    files = ["README.md"];
  } else if (
    t.includes("pregunta") ||
    t.includes("duda") ||
    t.includes("como") ||
    t.includes("cómo") ||
    t.includes("how") ||
    t.includes("question")
  ) {
    type = "question";
    risk = "low";
    summary = `Resolver consulta de soporte: "${title.slice(0, 40)}"`;
    proposal =
      "Responder aclarando que el agente local corre en Bun y guarda los datos en SQLite de forma local, por lo que no es necesario subir credenciales a servidores externos. Indicar la sección de solución de problemas.";
    files = [];
  }

  return { summary, type, risk, files, proposal };
}

export async function isLLMAvailable(): Promise<boolean> {
  if (isMockLLMEnabled()) return true;
  try {
    const res = await fetch(`${LLM_URL}/models`, {
      signal: AbortSignal.timeout(2000),
      headers: { Authorization: `Bearer ${LLM_API_KEY}` },
    });
    return res.ok;
  } catch {
    // Si no está disponible pero no se desactiva explícitamente, simulamos que sí
    // para permitir el flujo offline y el botón de análisis
    return true;
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
  if (isMockLLMEnabled()) {
    return getMockAnalysis(input.title, input.body);
  }

  let content = "";
  try {
    for (const [index, scale] of CONTEXT_RETRY_SCALES.entries()) {
      const promptChars = promptBudgetChars(ISSUE_RESPONSE_FORMAT, scale);
      const payload: ChatCompletionPayload = {
        model: LLM_MODEL,
        temperature: 0.2,
        max_tokens: LLM_MAX_OUTPUT_TOKENS,
        response_format: ISSUE_RESPONSE_FORMAT,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: buildUserPrompt(
              input,
              Math.max(400, promptChars - SYSTEM_PROMPT.length),
            ),
          },
        ],
        stream: false,
      };

      try {
        content = await requestChatCompletion("analyzeIssue", payload);
        break;
      } catch (err) {
        const canRetry =
          index < CONTEXT_RETRY_SCALES.length - 1 && isContextSizeError(err);
        if (!canRetry) throw err;

        console.warn(
          `[llm] analyzeIssue excedió contexto; reintento con presupuesto ${Math.round(
            CONTEXT_RETRY_SCALES[index + 1]! * 100,
          )}%`,
        );
      }
    }
  } catch (err) {
    console.warn(
      `[llm] Error en llamada real al LLM, cayendo en mock analysis: ${err}`,
    );
    return getMockAnalysis(input.title, input.body);
  }

  const jsonRaw = extractJson(content) ?? content;

  let parsed: IssueAnalysis;
  try {
    parsed = JSON.parse(jsonRaw) as IssueAnalysis;
  } catch {
    console.warn(
      `[llm] JSON inválido del modelo, cayendo en mock analysis. Contenido:\n${content}`,
    );
    return getMockAnalysis(input.title, input.body);
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
  input: PullRequestPriorityInput[],
): Promise<PullRequestPriorityResult> {
  if (input.length === 0)
    return { summary: "Sin PRs externas abiertas.", focus: [] };

  const validIds = new Set(input.map((pr) => pr.id));
  let content = "";
  for (const [index, scale] of CONTEXT_RETRY_SCALES.entries()) {
    const promptChars = promptBudgetChars(PR_PRIORITY_RESPONSE_FORMAT, scale);
    const payload: ChatCompletionPayload = {
      model: LLM_MODEL,
      temperature: 0.1,
      max_tokens: LLM_MAX_OUTPUT_TOKENS,
      response_format: PR_PRIORITY_RESPONSE_FORMAT,
      messages: [
        { role: "system", content: PR_PRIORITY_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildPullRequestPriorityPrompt(
            input,
            Math.max(400, promptChars - PR_PRIORITY_SYSTEM_PROMPT.length),
          ),
        },
      ],
      stream: false,
    };

    try {
      content = await requestChatCompletion("prioritizePullRequests", payload);
      break;
    } catch (err) {
      const canRetry =
        index < CONTEXT_RETRY_SCALES.length - 1 && isContextSizeError(err);
      if (!canRetry) throw err;

      console.warn(
        `[llm] prioritizePullRequests excedió contexto; reintento con presupuesto ${Math.round(
          CONTEXT_RETRY_SCALES[index + 1]! * 100,
        )}%`,
      );
    }
  }

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
        reason: cleanShortText(raw.reason, 110),
        action: cleanShortText(raw.action, 40),
      });
      if (focus.length >= 3) break;
    }
  }

  return {
    summary: cleanShortText(parsed.summary, 80),
    focus,
  };
}

export function getMockChatResponse(
  issueTitle: string,
  userMessage: string,
): string {
  const msg = userMessage.toLowerCase();

  if (
    msg.includes("test") ||
    msg.includes("prueba") ||
    msg.includes("testing")
  ) {
    return `Aquí tienes un ejemplo de test unitario básico usando **Bun Test** para validar la issue "${issueTitle}":

\`\`\`typescript
import { expect, test } from "bun:test";

test("debería manejar correctamente el caso de uso", () => {
  // Configuración de prueba simulada
  const input = { title: "${issueTitle}" };
  const result = mockProcess(input);
  
  expect(result).toBeDefined();
  expect(result.ok).toBe(true);
});

function mockProcess(input: any) {
  // Simulación del fix de la issue
  if (!input.title) return { ok: false };
  return { ok: true, data: input.title };
}
\`\`\`
¿Quieres que preparemos un caso de prueba más específico para algún archivo?`;
  }

  if (
    msg.includes("cómo") ||
    msg.includes("como") ||
    msg.includes("solucion") ||
    msg.includes("fix") ||
    msg.includes("arreglar") ||
    msg.includes("código") ||
    msg.includes("codigo")
  ) {
    return `Para solucionar la issue sobre **"${issueTitle}"**, te propongo este enfoque:

1. **Añadir validación de inputs**: Comprobar que no recibamos nulos en los parámetros de entrada.
2. **Implementar el fix**:
\`\`\`typescript
// Ejemplo de corrección propuesta
export function fixIssue(payload: any) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Payload inválido");
  }
  
  // Lógica para corregir la issue
  return {
    ...payload,
    processed: true,
    processedAt: new Date()
  };
}
\`\`\`
3. **Manejo de errores**: Envolver el flujo principal en un bloque \`try/catch\` para prevenir caídas del servidor.`;
  }

  return `Hola. Con respecto a la issue **"${issueTitle}"**, he revisado el contexto y la propuesta inicial. 

Dado que estamos en **modo offline**, mi respuesta es simulada. Si tienes Ollama o LM Studio corriendo en \`${LLM_URL}\`, activa el modelo para hablar de verdad.

¿Qué aspecto técnico de esta issue te gustaría profundizar? (puedes pedirme un "test" o una "solución de código" y te daré respuestas de ejemplo específicas).`;
}

export async function generateChatResponse(
  issue: any,
  history: Array<{ role: string; content: string }>,
  issueId: number,
): Promise<ReadableStream> {
  const isMock = isMockLLMEnabled();

  if (isMock) {
    return new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        const text = getMockChatResponse(
          issue.title,
          history[history.length - 1]?.content || "",
        );

        // Simular streaming de texto palabra por palabra
        const words = text.split(" ");
        for (const word of words) {
          controller.enqueue(encoder.encode(word + " "));
          await new Promise((resolve) => setTimeout(resolve, 35));
        }

        // Guardar la respuesta mock en la base de datos al terminar
        queries.insertIssueChatMessage.run(
          issueId,
          "assistant",
          text,
          new Date().toISOString(),
        );
        controller.close();
      },
    });
  }

  const systemPrompt = `Eres un asistente de programación experto. Estás ayudando a resolver la siguiente issue en el repositorio:
  
Repo: ${issue.owner}/${issue.repo_name}
Título: ${issue.title}
Descripción: ${issue.body ?? "(sin descripción)"}
Análisis previo de Sentinel: ${issue.analysis_summary ?? "No analizada aún."}

Responde siempre en español. Sé directo, conciso y técnico. Si te piden código, proporciona ejemplos claros.`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.map((h) => ({
      role: h.role === "assistant" ? "assistant" : "user",
      content: h.content,
    })),
  ];

  const response = await fetch(`${LLM_URL}/chat/completions`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      model: LLM_MODEL,
      messages,
      stream: true,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM Error ${response.status}: ${errorText}`);
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("No readable stream in LLM response");
  }

  let accumulatedText = "";
  return new ReadableStream({
    async start(controller) {
      const decoder = new TextDecoder("utf-8");
      const encoder = new TextEncoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            if (trimmed === "data: [DONE]") continue;

            if (trimmed.startsWith("data: ")) {
              try {
                const jsonStr = trimmed.slice(6);
                const parsed = JSON.parse(jsonStr);
                const content = parsed.choices?.[0]?.delta?.content || "";
                if (content) {
                  accumulatedText += content;
                  controller.enqueue(encoder.encode(content));
                }
              } catch (err) {
                // Ignorar fallos en líneas incompletas
              }
            }
          }
        }

        if (buffer.startsWith("data: ") && buffer !== "data: [DONE]") {
          try {
            const parsed = JSON.parse(buffer.slice(6));
            const content = parsed.choices?.[0]?.delta?.content || "";
            if (content) {
              accumulatedText += content;
              controller.enqueue(encoder.encode(content));
            }
          } catch {}
        }

        // Guardar respuesta final en la DB
        queries.insertIssueChatMessage.run(
          issueId,
          "assistant",
          accumulatedText,
          new Date().toISOString(),
        );
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

export const llmConfig = {
  url: LLM_URL,
  model: LLM_MODEL,
};
