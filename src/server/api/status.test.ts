import { describe, it, expect, spyOn } from "bun:test";
import { INotification } from "../notifications/types";
import { initialize } from "../notifications/notificationsManager";
import * as llm from "../llm";
import { buildWhatsappApiStatus, getStatusPayload } from "./status";

class MockChannel implements INotification {
  async sendNotification(_text: string): Promise<void> {}
}

spyOn(llm, "isLLMAvailable").mockResolvedValue(false);

describe("buildWhatsappApiStatus", () => {
  it("merges channel status with digest scheduling fields", () => {
    const whatsapp = buildWhatsappApiStatus(
      {
        enabled: true,
        configured: true,
        phone: "34…456",
      },
      {
        config: { cron: "0 9,18 * * *", timezone: "Europe/Madrid" },
        lastSent: "2026-06-19T08:00:00.000Z",
        nextRunAt: "2026-06-19T09:00:00.000Z",
      },
    );

    expect(whatsapp).toEqual({
      enabled: true,
      configured: true,
      phone: "34…456",
      timezone: "Europe/Madrid",
      cron: "0 9,18 * * *",
      lastSent: "2026-06-19T08:00:00.000Z",
      nextRunAt: "2026-06-19T09:00:00.000Z",
    });
  });

  it("clears nextRunAt when no channel is active", () => {
    const whatsapp = buildWhatsappApiStatus(
      {
        enabled: true,
        configured: false,
        phone: null,
      },
      {
        config: { cron: "0 9,18 * * *", timezone: "Europe/Madrid" },
        lastSent: null,
        nextRunAt: null,
      },
    );

    expect(whatsapp.configured).toBe(false);
    expect(whatsapp.nextRunAt).toBeNull();
  });
});

describe("getStatusPayload", () => {
  it("returns the client whatsapp contract", async () => {
    initialize([new MockChannel()]);
    process.env.WHATSAPP_ENABLED = "true";
    process.env.WHATSAPP_PHONE = "+34666123456";
    process.env.CALLMEBOT_API_KEY = "1234567890";

    const payload = await getStatusPayload();

    expect(payload.whatsapp).toMatchObject({
      enabled: expect.any(Boolean),
      configured: expect.any(Boolean),
      timezone: expect.any(String),
      cron: expect.any(String),
      lastSent: null,
    });
    expect(payload.llm).toMatchObject({
      available: false,
      url: expect.any(String),
      model: expect.any(String),
    });
  });
});
