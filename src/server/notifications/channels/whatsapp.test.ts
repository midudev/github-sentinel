import { describe, it, expect, beforeEach, spyOn, Mock } from "bun:test";
import { INotification } from "../types";
import { create } from "./whatsapp";

const getExpectedUrl = (text: string) =>
  `https://api.callmebot.com/whatsapp.php?phone=34666123456&text=${text}&apikey=1234567890`;

type FetchMock = Mock<
  (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
>;

const fetchMock = spyOn(globalThis, "fetch") as unknown as FetchMock;

describe("Whatsapp", () => {
  describe("if whatsapp is enabled", () => {
    beforeEach(() => {
      process.env.WHATSAPP_ENABLED = "true";
      process.env.WHATSAPP_PHONE = "+34666123456";
      process.env.CALLMEBOT_API_KEY = "1234567890";

      fetchMock.mockImplementation(() =>
        Promise.resolve(new Response("OK", { status: 200 })),
      );
    });

    it("should send a notification", async () => {
      const whatsapp = create();

      if (!whatsapp) {
        throw new Error("Whatsapp channel not initialized");
      }

      await whatsapp.sendNotification("test");

      expect(fetch).toHaveBeenCalledWith(
        getExpectedUrl("test"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    it("should truncate the message if it is too long", async () => {
      const whatsapp = create();

      if (!whatsapp) {
        throw new Error("Whatsapp channel not initialized");
      }

      const message = "test".repeat(1000);

      await whatsapp.sendNotification(message);

      expect(fetch).toHaveBeenCalledWith(
        getExpectedUrl(
          `${message.slice(0, 3500 - 20)}%0A%E2%80%A6+%28truncado%29`,
        ),
        expect.objectContaining({
          method: "GET",
          signal: AbortSignal.timeout(15_000),
        }),
      );
    });

    it("should throw an error if response is not ok", async () => {
      const whatsapp = create();

      if (!whatsapp) {
        throw new Error("Whatsapp channel not initialized");
      }

      fetchMock.mockResolvedValueOnce(new Response("Error", { status: 500 }));

      await expect(whatsapp.sendNotification("test")).rejects.toThrow(
        "CallMeBot 500: Error",
      );
    });
  });

  describe("if whatsapp is disabled", () => {
    beforeEach(() => {
      process.env.WHATSAPP_ENABLED = "false";
    });

    it("should not initialize the channel", async () => {
      const whatsapp = create();

      expect(whatsapp).toBeNull();
    });
  });

  describe("if whatsapp is not configured", () => {
    beforeEach(() => {
      process.env.WHATSAPP_ENABLED = "true";
      process.env.WHATSAPP_PHONE = "";
      process.env.CALLMEBOT_API_KEY = "";
    });

    it("should not initialize the channel", async () => {
      const whatsapp = create();

      expect(whatsapp).toBeNull();
    });
  });
});
