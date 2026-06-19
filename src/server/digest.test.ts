import { describe, it, expect, beforeEach, afterEach, Mock, spyOn } from "bun:test";
import { INotification } from "./notifications/types";
import {
  getNotificationsConfig,
  initialize,
} from "./notifications/notificationsManager";
import { startDigestScheduler, stopDigestScheduler } from "./digest";

class NotificationImplementation implements INotification {
  async sendNotification(_text: string): Promise<void> {}
}

type BunCronMock = Mock<
  (
    schedule: Bun.CronWithAutocomplete,
    handler: (this: Bun.CronJob) => unknown,
  ) => Bun.CronJob
>;

const bunCronMock = spyOn(Bun, "cron") as unknown as BunCronMock;

describe("startDigestScheduler", () => {
  beforeEach(() => {
    stopDigestScheduler();
    bunCronMock.mockClear();
  });

  afterEach(() => {
    stopDigestScheduler();
    bunCronMock.mockClear();
  });

  describe("when no channels are configured", () => {
    beforeEach(() => {
      initialize([]);
    });

    it("does not schedule the digest", () => {
      startDigestScheduler();

      expect(bunCronMock).not.toHaveBeenCalled();
    });
  });

  describe("when channels are configured", () => {
    beforeEach(() => {
      initialize([new NotificationImplementation()]);
    });

    it("schedules the digest with configured cron", () => {
      startDigestScheduler();

      expect(bunCronMock).toHaveBeenCalledTimes(1);
      expect(bunCronMock).toHaveBeenCalledWith(
        getNotificationsConfig().cron,
        expect.any(Function),
      );
    });

    it("does not register duplicate cron jobs", () => {
      startDigestScheduler();
      startDigestScheduler();

      expect(bunCronMock).toHaveBeenCalledTimes(1);
    });
  });
});
