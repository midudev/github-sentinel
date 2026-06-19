import { describe, it, expect, beforeEach, Mock, mock } from "bun:test";
import { INotification } from "./types";
import {
  initialize,
  isThereAnyChannelConfigured,
  sendNotifications,
  getNotificationsConfig,
  getNotificationsSendIntervalMs,
} from "./notificationsManager";

class NotificationImplementation implements INotification {
  static sendNotificationSpy: Mock<(text: string) => Promise<void>> | undefined;

  constructor() {
    NotificationImplementation.sendNotificationSpy = mock();
  }

  async sendNotification(text: string): Promise<void> {
    NotificationImplementation.sendNotificationSpy?.(text);
  }
}

describe("notificationsManager", () => {
  beforeEach(() => {
    initialize([new NotificationImplementation()]);
  });

  it("sends a notification", async () => {
    const delivered = await sendNotifications("test");

    expect(delivered).toBe(1);
    expect(NotificationImplementation.sendNotificationSpy).toHaveBeenCalledWith(
      "test",
    );
  });

  it("returns 0 when no channels are configured", async () => {
    initialize([]);

    expect(await sendNotifications("test")).toBe(0);
  });

  describe("isThereAnyChannelConfigured", () => {
    it("returns true when at least one channel is configured", () => {
      initialize([new NotificationImplementation()]);
      expect(isThereAnyChannelConfigured()).toBe(true);
    });

    it("returns false when no channels are configured", () => {
      initialize([]);
      expect(isThereAnyChannelConfigured()).toBe(false);
    });
  });

  describe("getNotificationsConfig", () => {
    it("reads NOTIFICATIONS_* vars first", () => {
      process.env.NOTIFICATIONS_CRON = "0 8 * * *";
      process.env.NOTIFICATIONS_TIMEZONE = "America/New_York";

      expect(getNotificationsConfig()).toEqual({
        cron: "0 8 * * *",
        timezone: "America/New_York",
      });
    });

    it("falls back to legacy WHATSAPP_* vars", () => {
      delete process.env.NOTIFICATIONS_CRON;
      delete process.env.NOTIFICATIONS_TIMEZONE;
      delete process.env.NOTIFICATION_DIGEST_CRON;
      delete process.env.NOTIFICATION_TIMEZONE;
      process.env.WHATSAPP_DIGEST_CRON = "0 7 * * *";
      process.env.WHATSAPP_TIMEZONE = "Asia/Tokyo";

      expect(getNotificationsConfig()).toEqual({
        cron: "0 7 * * *",
        timezone: "Asia/Tokyo",
      });
    });
  });

  describe("getNotificationsSendIntervalMs", () => {
    it("falls back to WHATSAPP_SEND_INTERVAL_MS", () => {
      delete process.env.NOTIFICATIONS_SEND_INTERVAL_MS;
      delete process.env.NOTIFICATION_SEND_INTERVAL_MS;
      process.env.WHATSAPP_SEND_INTERVAL_MS = "3000";

      expect(getNotificationsSendIntervalMs()).toBe(3000);
    });
  });
});
