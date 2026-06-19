import { describe, it, expect, beforeEach, Mock, mock } from "bun:test";
import { INotification } from "./types";
import {
  initialize,
  isThereAnyChannelConfigured,
  sendNotifications,
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

describe("NotificationManager", () => {
  beforeEach(() => {
    initialize([new NotificationImplementation()]);
  });

  it("can send a notification", async () => {
    await sendNotifications("test");

    expect(NotificationImplementation.sendNotificationSpy).toHaveBeenCalledWith(
      "test",
    );
  });

  describe("isThereAnyChannelConfigured", () => {
    it("should return true if there is at least one channel configured", () => {
      initialize([new NotificationImplementation()]);
      expect(isThereAnyChannelConfigured()).toBe(true);
    });

    it("should return false if no channels are configured", () => {
      initialize([]);
      expect(isThereAnyChannelConfigured()).toBe(false);
    });
  });
});
