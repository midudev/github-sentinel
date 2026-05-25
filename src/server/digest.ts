import { queries } from "./db";
import { status as sentinelStatus } from "./sentinel";
import {
  buildDigestMessage,
  collectDigestItems,
  sendWhatsApp,
  whatsappConfig,
  type DigestContext,
} from "./whatsapp";

const CHECK_INTERVAL_MS = 60_000;
const LAST_SLOT_KEY = "digest:last_slot";
const LAST_SENT_AT_KEY = "digest:last_sent_at";

let timer: Timer | null = null;

type Slot = "morning" | "evening";

type LocalTime = {
  date: string;
  hour: number;
  minute: number;
};

function nowInTimezone(timezone: string): LocalTime {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "00";

  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function slotKey(local: LocalTime, slot: Slot): string {
  return `${local.date}:${slot}`;
}

async function maybeSend(): Promise<void> {
  const cfg = whatsappConfig();
  if (!cfg.enabled || !cfg.configured) return;

  const local = nowInTimezone(cfg.timezone);

  const due: Slot | null =
    local.hour === cfg.morningHour
      ? "morning"
      : local.hour === cfg.eveningHour
        ? "evening"
        : null;

  if (!due) return;

  const key = slotKey(local, due);
  const last = queries.getSetting.get(LAST_SLOT_KEY)?.value;
  if (last === key) return;

  try {
    await runDigest({ slot: due, timezone: cfg.timezone });
    queries.setSetting.run(LAST_SLOT_KEY, key);
    queries.setSetting.run(LAST_SENT_AT_KEY, new Date().toISOString());
    console.log(`[digest] ${new Date().toISOString()} enviado slot=${due}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[digest] error enviando slot=${due}: ${msg}`);
  }
}

export async function runDigest(ctx: DigestContext): Promise<{
  message: string;
  prs: number;
  issues: number;
}> {
  const items = collectDigestItems(sentinelStatus().lastRun);
  const message = buildDigestMessage(items, ctx);
  await sendWhatsApp(message);
  queries.setSetting.run(LAST_SENT_AT_KEY, new Date().toISOString());
  return {
    message,
    prs: items.prs.length + items.truncatedPRs,
    issues: items.issues.length + items.truncatedIssues,
  };
}

export function previewDigest(ctx: DigestContext): {
  message: string;
  prs: number;
  issues: number;
} {
  const items = collectDigestItems(sentinelStatus().lastRun);
  return {
    message: buildDigestMessage(items, ctx),
    prs: items.prs.length + items.truncatedPRs,
    issues: items.issues.length + items.truncatedIssues,
  };
}

export function startDigestScheduler(): void {
  if (timer) return;
  const cfg = whatsappConfig();
  if (!cfg.configured) {
    console.log(
      "[digest] WhatsApp no configurado (faltan WHATSAPP_PHONE / CALLMEBOT_API_KEY). Scheduler en pausa."
    );
    return;
  }
  console.log(
    `[digest] activo · ${cfg.timezone} · ${cfg.morningHour}:00 y ${cfg.eveningHour}:00`
  );
  timer = setInterval(() => {
    void maybeSend();
  }, CHECK_INTERVAL_MS);
}

export function stopDigestScheduler(): void {
  if (timer) clearInterval(timer);
  timer = null;
}

export function digestStatus(): {
  config: ReturnType<typeof whatsappConfig>;
  lastSent: string | null;
  lastSlot: string | null;
} {
  const config = whatsappConfig();
  const lastSent = queries.getSetting.get(LAST_SENT_AT_KEY)?.value ?? null;
  const lastSlot = queries.getSetting.get(LAST_SLOT_KEY)?.value ?? null;
  return { config, lastSent, lastSlot };
}
