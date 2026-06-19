import { queries } from "../db";
import { isLLMAvailable, llmConfig } from "../llm";
import { status } from "../sentinel";
import { digestStatus } from "../digest";
import {
  getWhatsappChannelStatus,
  type WhatsappChannelStatus,
} from "../notifications/channels";

export type WhatsappApiStatus = WhatsappChannelStatus & {
  timezone: string;
  cron: string;
  lastSent: string | null;
  nextRunAt: string | null;
};

export type ApiStatusPayload = {
  intervalMs: number;
  isChecking: boolean;
  lastRun: string | null;
  repos: number;
  issues: number;
  analyzed: number;
  openPRs: number;
  llm: { available: boolean; url: string; model: string };
  whatsapp: WhatsappApiStatus;
  platform: string;
};

export function buildWhatsappApiStatus(
  channel: WhatsappChannelStatus,
  digest: ReturnType<typeof digestStatus>,
): WhatsappApiStatus {
  return {
    ...channel,
    timezone: digest.config.timezone,
    cron: digest.config.cron,
    lastSent: digest.lastSent,
    nextRunAt: digest.nextRunAt,
  };
}

export async function getStatusPayload(): Promise<ApiStatusPayload> {
  const repos = queries.listRepos.all();
  const total = queries.countIssues.get()?.total ?? 0;
  const analyzed = queries.countAnalyzed.get()?.total ?? 0;
  const openPRs = queries.countOpenPRs.get()?.total ?? 0;
  const llmAvailable = await isLLMAvailable();
  const digest = digestStatus();
  const whatsapp = buildWhatsappApiStatus(getWhatsappChannelStatus(), digest);

  return {
    ...status(),
    repos: repos.length,
    issues: total,
    analyzed,
    openPRs,
    llm: {
      available: llmAvailable,
      url: llmConfig.url,
      model: llmConfig.model,
    },
    whatsapp,
    platform: process.platform,
  };
}
