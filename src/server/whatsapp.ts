import { queries, type IssueWithRepo, type PullRequestWithRepo } from "./db";

const CALLMEBOT_URL = "https://api.callmebot.com/whatsapp.php";

const MAX_MESSAGE_LENGTH = 3500;
const MAX_PRS_IN_DIGEST = 15;
const MAX_ISSUES_IN_DIGEST = 10;

export type WhatsAppConfig = {
  enabled: boolean;
  configured: boolean;
  phone: string | null;
  timezone: string;
  morningHour: number;
  eveningHour: number;
};

export function whatsappConfig(): WhatsAppConfig {
  const phone = process.env.WHATSAPP_PHONE?.trim() || null;
  const apikey = process.env.CALLMEBOT_API_KEY?.trim() || null;
  const enabled = (process.env.WHATSAPP_ENABLED ?? "true").toLowerCase() !== "false";
  return {
    enabled,
    configured: Boolean(phone && apikey),
    phone: phone ? maskPhone(phone) : null,
    timezone: process.env.WHATSAPP_TIMEZONE ?? "Europe/Madrid",
    morningHour: clampHour(process.env.WHATSAPP_MORNING_HOUR, 9),
    eveningHour: clampHour(process.env.WHATSAPP_EVENING_HOUR, 18),
  };
}

function clampHour(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.floor(n)));
}

function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  if (clean.length <= 4) return clean;
  return `${clean.slice(0, 2)}…${clean.slice(-3)}`;
}

export async function sendWhatsApp(text: string): Promise<void> {
  const phone = process.env.WHATSAPP_PHONE?.trim();
  const apikey = process.env.CALLMEBOT_API_KEY?.trim();
  if (!phone || !apikey) {
    throw new Error(
      "Faltan WHATSAPP_PHONE y/o CALLMEBOT_API_KEY en el entorno."
    );
  }

  const truncated =
    text.length > MAX_MESSAGE_LENGTH
      ? `${text.slice(0, MAX_MESSAGE_LENGTH - 20)}\n… (truncado)`
      : text;

  const url = new URL(CALLMEBOT_URL);
  url.searchParams.set("phone", phone.replace(/\D/g, ""));
  url.searchParams.set("text", truncated);
  url.searchParams.set("apikey", apikey);

  const res = await fetch(url.toString(), {
    method: "GET",
    signal: AbortSignal.timeout(15_000),
  });

  const body = await res.text();
  if (!res.ok || /APIKey is invalid|ERROR/i.test(body)) {
    throw new Error(`CallMeBot ${res.status}: ${body.slice(0, 200)}`);
  }
}

export type DigestItems = {
  prs: PullRequestWithRepo[];
  issues: IssueWithRepo[];
  truncatedPRs: number;
  truncatedIssues: number;
  totals: {
    repos: number;
    openIssues: number;
    analyzedIssues: number;
    openPRs: number;
    lastScan: string | null;
  };
};

export function collectDigestItems(lastScan: string | null = null): DigestItems {
  const prsAll = queries.listOpenExternalPRs.all();
  const issuesAll = queries.listOpenHighRiskIssues.all();
  return {
    prs: prsAll.slice(0, MAX_PRS_IN_DIGEST),
    issues: issuesAll.slice(0, MAX_ISSUES_IN_DIGEST),
    truncatedPRs: Math.max(0, prsAll.length - MAX_PRS_IN_DIGEST),
    truncatedIssues: Math.max(0, issuesAll.length - MAX_ISSUES_IN_DIGEST),
    totals: {
      repos: queries.listRepos.all().length,
      openIssues: queries.countIssues.get()?.total ?? 0,
      analyzedIssues: queries.countAnalyzed.get()?.total ?? 0,
      openPRs: queries.countOpenPRs.get()?.total ?? 0,
      lastScan,
    },
  };
}

export type DigestContext = {
  slot: "morning" | "evening" | "manual";
  timezone: string;
};

export function buildDigestMessage(
  items: DigestItems,
  ctx: DigestContext
): string {
  const greeting =
    ctx.slot === "morning"
      ? "Buenos días"
      : ctx.slot === "evening"
        ? "Buenas tardes"
        : "Resumen";
  const time = new Date().toLocaleString("es-ES", {
    timeZone: ctx.timezone,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    day: "2-digit",
    month: "short",
  });

  const lines: string[] = [];
  lines.push(`*GitHub Sentinel* · ${greeting}`);
  lines.push(`_${time}_`);
  lines.push("");

  if (items.prs.length === 0 && items.issues.length === 0) {
    lines.push("✅ Todo en orden, nada pendiente de revisar.");
    lines.push("");
    lines.push(
      `_${items.totals.repos} repos · ${items.totals.openIssues} issues totales · ${items.totals.analyzedIssues} analizadas_`
    );
    if (items.totals.lastScan) {
      lines.push(`_último scan: ${relativeAge(items.totals.lastScan)}_`);
    }
    return lines.join("\n");
  }

  if (items.prs.length > 0) {
    lines.push(
      `*PRs externos a revisar (${items.prs.length}${items.truncatedPRs ? `+${items.truncatedPRs}` : ""})*`
    );
    for (const pr of items.prs) {
      const age = relativeAge(pr.created_at);
      lines.push(
        `• ${pr.owner}/${pr.repo_name} #${pr.pr_number} _by ${pr.author ?? "anon"}_ · ${age}`
      );
      lines.push(`  ${truncate(pr.title, 90)}`);
      lines.push(`  ${pr.html_url}`);
    }
    if (items.truncatedPRs > 0) {
      lines.push(`  …y ${items.truncatedPRs} más`);
    }
    lines.push("");
  }

  if (items.issues.length > 0) {
    lines.push(
      `*Issues high-risk (${items.issues.length}${items.truncatedIssues ? `+${items.truncatedIssues}` : ""})*`
    );
    for (const issue of items.issues) {
      const age = relativeAge(issue.created_at);
      lines.push(
        `• ${issue.owner}/${issue.repo_name} #${issue.issue_number} · ${age}`
      );
      lines.push(`  ${truncate(issue.title, 90)}`);
      if (issue.analysis_summary) {
        lines.push(`  _${truncate(issue.analysis_summary, 120)}_`);
      }
      lines.push(`  ${issue.html_url}`);
    }
    if (items.truncatedIssues > 0) {
      lines.push(`  …y ${items.truncatedIssues} más`);
    }
  }

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1).trimEnd()}…`;
}

function relativeAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "ahora";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  const days = Math.round(hours / 24);
  return `${days}d`;
}
