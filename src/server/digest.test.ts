import { describe, it, expect, beforeEach, Mock, spyOn } from "bun:test";
import { INotification } from "./notifications/types";
import { initialize } from "./notifications/notificationsManager";
import { startDigestScheduler } from "./digest";

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
  describe("if not channels are configured", () => {
    beforeEach(() => {
      initialize([]);
    });

    it("should not schedule the digest", () => {
      startDigestScheduler();

      expect(bunCronMock).not.toHaveBeenCalled();
    });
  });

  describe("if channels are configured", () => {
    beforeEach(() => {
      initialize([new NotificationImplementation()]);
    });

    it("should schedule the digest", () => {
      startDigestScheduler();

      expect(bunCronMock).toHaveBeenCalled();
    });
  });
});
