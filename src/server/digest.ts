import { queries } from "./db";
import { status as sentinelStatus } from "./sentinel";
import {
  buildDigestMessage,
  collectDigestItems,
  sendWhatsApp,
  whatsappConfig,
  type DigestContext,
} from "./whatsapp";

const LAST_SENT_AT_KEY = "digest:last_sent_at";

type CronJobHandle = {
  stop(): CronJobHandle;
};

type LocalTime = {
  hour: number;
};

let digestJob: CronJobHandle | null = null;

function localTimeInTimezone(timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    hour: Number(get("hour")),
  };
}

function currentDigestSlot(timezone: string): DigestContext["slot"] {
  return localTimeInTimezone(timezone).hour < 12 ? "morning" : "evening";
}

async function runScheduledDigest(): Promise<void> {
  const cfg = whatsappConfig();
  if (!cfg.enabled || !cfg.configured) return;

  const slot = currentDigestSlot(cfg.timezone);
  try {
    await runDigest({ slot, timezone: cfg.timezone });
    console.log(`[digest] ${new Date().toISOString()} enviado cron="${cfg.cron}"`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[digest] error enviando cron="${cfg.cron}": ${msg}`);
  }
}

export async function runDigest(ctx: DigestContext): Promise<{
  message: string;
  prs: number;
  issues: number;
}> {
  const items = collectDigestItems(sentinelStatus().lastRun);
  const message = await buildDigestMessage(items, ctx);
  await sendWhatsApp(message);
  queries.setSetting.run(LAST_SENT_AT_KEY, new Date().toISOString());
  return {
    message,
    prs: items.prs.length + items.truncatedPRs,
    issues: items.issues.length + items.truncatedIssues,
  };
}

export async function previewDigest(ctx: DigestContext): Promise<{
  message: string;
  prs: number;
  issues: number;
}> {
  const items = collectDigestItems(sentinelStatus().lastRun);
  return {
    message: await buildDigestMessage(items, ctx),
    prs: items.prs.length + items.truncatedPRs,
    issues: items.issues.length + items.truncatedIssues,
  };
}

export function startDigestScheduler(): void {
  if (digestJob) return;
  const cfg = whatsappConfig();
  if (!cfg.configured) {
    console.log(
      "[digest] WhatsApp no configurado (faltan WHATSAPP_PHONE / CALLMEBOT_API_KEY). Scheduler en pausa."
    );
    return;
  }
  if (!cfg.enabled) {
    console.log("[digest] WhatsApp desactivado por WHATSAPP_ENABLED=false.");
    return;
  }

  try {
    digestJob = Bun.cron(cfg.cron, runScheduledDigest);
    console.log(
      `[digest] activo · cron="${cfg.cron}" UTC · formato ${cfg.timezone}`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[digest] cron inválido "${cfg.cron}": ${msg}`);
  }
}

export function stopDigestScheduler(): void {
  digestJob?.stop();
  digestJob = null;
}

function nextDigestRun(cron: string): string | null {
  try {
    return Bun.cron.parse(cron)?.toISOString() ?? null;
  } catch {
    return null;
  }
}

export function digestStatus(): {
  config: ReturnType<typeof whatsappConfig>;
  lastSent: string | null;
  nextRunAt: string | null;
} {
  const config = whatsappConfig();
  const lastSent = queries.getSetting.get(LAST_SENT_AT_KEY)?.value ?? null;
  const nextRunAt =
    config.enabled && config.configured ? nextDigestRun(config.cron) : null;
  return { config, lastSent, nextRunAt };
}
